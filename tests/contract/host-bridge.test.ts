import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionHost, HostError, ERR } from '../../contract/host/host-bridge.ts';

const GLOBALS = ['window', 'document', 'localStorage'];
let saved: Record<string, PropertyDescriptor | undefined> = {};
let listeners: Set<(e: any) => any>;
let timers: { fn: () => void; ms: number; kind: string }[];
let frames: any[];
let store: Map<string, string>;

function makeFrame(tag: string) {
  const attrs: Record<string, string> = {};
  const frame: any = {
    tag,
    attrs,
    style: { cssText: '' },
    className: '',
    src: '',
    removed: false,
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
    getAttribute: (k: string) => attrs[k],
    contentWindow: {
      sent: [] as any[],
      targets: [] as any[],
      postMessage(message: any, target: any) {
        this.sent.push(message);
        this.targets.push(target);
      },
    },
    remove() {
      frame.removed = true;
    },
  };
  return frame;
}

beforeEach(() => {
  listeners = new Set();
  timers = [];
  frames = [];
  store = new Map();
  const win = {
    addEventListener: (type: string, fn: (e: any) => any) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: any) => any) => {
      if (type === 'message') listeners.delete(fn);
    },
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms, kind: 'timeout' });
      return 1_000_000_000 + timers.length;
    },
    setInterval: (fn: () => void, ms: number) => {
      timers.push({ fn, ms, kind: 'interval' });
      return 1_000_000_000 + timers.length;
    },
  };
  const doc = {
    createElement: (tag: string) => {
      const frame = makeFrame(tag);
      frames.push(frame);
      return frame;
    },
  };
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  const values: Record<string, unknown> = { window: win, document: doc, localStorage: ls };
  saved = {};
  for (const name of GLOBALS) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  }
});

afterEach(() => {
  for (const name of GLOBALS) {
    const prior = saved[name];
    if (prior) Object.defineProperty(globalThis, name, prior);
    else delete (globalThis as any)[name];
  }
});

function container() {
  const children: any[] = [];
  return { children, appendChild: (f: any) => children.push(f) } as any;
}

function record(permissions: string[] = [], over: Record<string, unknown> = {}): any {
  return {
    id: 'beat-markers',
    name: 'Beat Markers',
    version: '0.1.0',
    source: 'catalogue',
    permissions,
    base: '/api/extensions/files/beat-markers/0.1.0/',
    entryUi: 'ui/index.html',
    panels: [{ id: 'main', title: 'Beat Markers', location: 'dock' }],
    commands: [{ id: 'mark-beats', title: 'Mark Beats in Selected Clip' }],
    state: 'ready',
    ...over,
  };
}

function handlers(over: Record<string, unknown> = {}): any {
  const calls: any[] = [];
  const h: any = {
    calls,
    product: 'formcut',
    app: 'FormCut',
    appVersion: '2.14.0',
    locale: () => 'en-GB',
    theme: () => ({ mode: 'dark', tokens: { '--bg': '#0d0d0d' } }),
    notify: (_ext: any, message: string, level: string) => calls.push(['notify', message, level]),
    consent: async () => true,
    ...over,
  };
  return h;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

async function deliver(frame: any, data: unknown, source: unknown = frame.contentWindow) {
  await Promise.all([...listeners].map((fn) => fn({ data, source, origin: 'null' })));
  await tick();
}

function replies(frame: any, id: unknown) {
  return frame.contentWindow.sent.filter((m: any) => m && m.id === id && m.method === undefined);
}

async function call(frame: any, id: number, method: string, params?: unknown) {
  const body: any = { formext: 1, jsonrpc: '2.0', id, method };
  if (params !== undefined) body.params = params;
  await deliver(frame, body);
  const got = replies(frame, id);
  assert.equal(got.length, 1, `expected one reply to ${method}`);
  return got[0];
}

async function granted(host: any, ext: any, opts: any = {}) {
  const handle = await host.open(ext, container(), opts);
  assert.ok(handle);
  return handle;
}

test('the frame is sandboxed with scripts only and loads the entry page', () => {
  const host = new ExtensionHost(handlers());
  const box = container();
  const handle = host.mount(record(), box);
  const frame: any = handle.frame;
  assert.equal(frame.tag, 'iframe');
  assert.equal(frame.attrs.sandbox, 'allow-scripts');
  assert.equal(frame.attrs.allow, '');
  assert.equal(frame.attrs.referrerpolicy, 'no-referrer');
  assert.equal(frame.src, '/api/extensions/files/beat-markers/0.1.0/ui/index.html');
  assert.deepEqual(box.children, [frame]);
});

test('host.hello is answered with the same id and the contract fields', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record([], { source: 'development' }), container());
  const reply = await call(handle.frame, 7, 'host.hello', {});
  assert.equal(reply.formext, 1);
  assert.equal(reply.jsonrpc, '2.0');
  assert.equal(reply.id, 7);
  assert.equal(reply.error, undefined);
  assert.deepEqual(reply.result, {
    product: 'formcut',
    app: 'FormCut',
    appVersion: '2.14.0',
    api: '1',
    extension: { id: 'beat-markers', version: '0.1.0', source: 'development' },
    permissions: [],
    theme: { mode: 'dark', tokens: { '--bg': '#0d0d0d' } },
    locale: 'en-GB',
  });
});

test('host.hello carries the granted permissions after consent', async () => {
  const host = new ExtensionHost(handlers());
  const handle = await granted(host, record(['document', 'files-read']));
  const reply = await call(handle.frame, 1, 'host.hello', {});
  assert.deepEqual(reply.result.permissions, ['document', 'files-read']);
});

test('no frame is created when the person chooses Not Now and the next open asks again', async () => {
  let asked = 0;
  const host = new ExtensionHost(
    handlers({
      consent: async () => {
        asked += 1;
        return false;
      },
    }),
  );
  const ext = record(['document']);
  assert.equal(await host.open(ext, container()), null);
  assert.equal(frames.length, 0);
  assert.equal(await host.open(ext, container()), null);
  assert.equal(asked, 2);
});

test('Allow is remembered for the same id, version and permission set', async () => {
  let asked = 0;
  const h = handlers({
    consent: async () => {
      asked += 1;
      return true;
    },
  });
  const host = new ExtensionHost(h);
  await granted(host, record(['document']));
  await granted(host, record(['document']));
  assert.equal(asked, 1);
  const other = new ExtensionHost(h);
  await granted(other, record(['document']));
  assert.equal(asked, 1);
});

test('a new version or a larger permission set asks again', async () => {
  let asked = 0;
  const host = new ExtensionHost(
    handlers({
      consent: async () => {
        asked += 1;
        return true;
      },
    }),
  );
  await granted(host, record(['document']));
  await granted(host, record(['document'], { version: '0.2.0' }));
  assert.equal(asked, 2);
  await granted(host, record(['document', 'network']));
  assert.equal(asked, 3);
});

test('a method whose permission the manifest does not declare is refused with -32001', async () => {
  let read = 0;
  const host = new ExtensionHost(
    handlers({
      readDocument: () => {
        read += 1;
        return { secret: true };
      },
    }),
  );
  const handle = await granted(host, record(['files-read']));
  const reply = await call(handle.frame, 3, 'document.read', {});
  assert.equal(reply.result, undefined);
  assert.equal(reply.error.code, -32001);
  assert.equal(typeof reply.error.message, 'string');
  assert.equal(read, 0);
});

test('each permissioned method is refused with -32001 when nothing is declared', async () => {
  let reached = 0;
  const hit = async () => {
    reached += 1;
    return null;
  };
  const host = new ExtensionHost(
    handlers({ readDocument: hit, applyDocument: hit, commands: hit, run: hit, openFiles: hit, saveFile: hit, fetch: hit }),
  );
  const handle: any = host.mount(record([]), container());
  const cases: [string, unknown][] = [
    ['document.read', {}],
    ['document.apply', { label: 'x', ops: [{ command: 'a' }] }],
    ['app.commands', {}],
    ['app.run', { command: 'a', args: {} }],
    ['files.open', { accept: ['.wav'] }],
    ['files.save', { name: 'a.txt', type: 'text/plain', data: 'YQ==' }],
    ['net.fetch', { url: 'https://example.com/' }],
  ];
  let id = 10;
  for (const [method, params] of cases) {
    const reply = await call(handle.frame, ++id, method, params);
    assert.equal(reply.error?.code, -32001, method);
  }
  assert.equal(reached, 0);
});

test('a declared permission that was never granted is refused with -32001', async () => {
  let read = 0;
  const host = new ExtensionHost(
    handlers({
      readDocument: () => {
        read += 1;
        return {};
      },
    }),
  );
  const handle: any = host.mount(record(['document']), container());
  const hello = await call(handle.frame, 1, 'host.hello', {});
  assert.deepEqual(hello.result.permissions, []);
  const reply = await call(handle.frame, 2, 'document.read', {});
  assert.equal(reply.error.code, -32001);
  assert.equal(read, 0);
});

test('a granted method reaches its handler and the result comes back', async () => {
  const seen: any[] = [];
  const host = new ExtensionHost(
    handlers({
      run: async (ext: any, command: string, args: unknown) => {
        seen.push([ext.id, command, args]);
        return { done: command };
      },
    }),
  );
  const handle = await granted(host, record(['document']));
  const reply = await call(handle.frame, 41, 'app.run', { command: 'split', args: { at: 3 } });
  assert.deepEqual(reply.result, { done: 'split' });
  assert.deepEqual(seen, [['beat-markers', 'split', { at: 3 }]]);
});

test('an unknown method is answered with -32601', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record(), container());
  const reply = await call(handle.frame, 5, 'models.run', {});
  assert.equal(reply.id, 5);
  assert.equal(reply.error.code, -32601);
  assert.equal(reply.result, undefined);
});

test(
  'a method named like a built-in object property is answered with -32601',
  { todo: 'defect: toString, constructor and __proto__ pass the method table lookup and are refused with -32001 instead of -32601' },
  async () => {
    const host = new ExtensionHost(handlers());
    const handle: any = host.mount(record(), container());
    let id = 0;
    for (const method of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const reply = await call(handle.frame, ++id, method, {});
      assert.equal(reply.error.code, -32601, method);
    }
  },
);

test('a message from another window is ignored', async () => {
  const h = handlers();
  const host = new ExtensionHost(h);
  const handle: any = host.mount(record(), container());
  const stranger = makeFrame('iframe');
  const body = { formext: 1, jsonrpc: '2.0', id: 1, method: 'ui.notify', params: { message: 'hi', level: 'info' } };
  await deliver(handle.frame, body, stranger.contentWindow);
  await deliver(handle.frame, body, null);
  await deliver(handle.frame, body, globalThis.window);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(handle.frame.contentWindow.sent, []);
  assert.deepEqual(stranger.contentWindow.sent, []);
});

test('a request is handled with the permissions of the frame it came from', async () => {
  let read = 0;
  const host = new ExtensionHost(
    handlers({
      readDocument: () => {
        read += 1;
        return { doc: 1 };
      },
    }),
  );
  const strong = await granted(host, record(['document']));
  const weak: any = host.mount(record([], { id: 'plain', name: 'Plain' }), container());
  const refused = await call(weak.frame, 1, 'document.read', {});
  assert.equal(refused.error.code, -32001);
  assert.equal(read, 0);
  assert.deepEqual(replies(strong.frame, 1), []);
  const allowed = await call(strong.frame, 2, 'document.read', {});
  assert.deepEqual(allowed.result, { doc: 1 });
  assert.deepEqual(replies(weak.frame, 2), []);
});

test('messages that are not objects never throw and never reach a handler', async () => {
  const h = handlers();
  const host = new ExtensionHost(h);
  const handle: any = host.mount(record(), container());
  for (const data of [null, undefined, 0, 42, true, 'host.hello', '', [], [1, 2], Symbol.iterator]) {
    await assert.doesNotReject(deliver(handle.frame, data));
  }
  assert.deepEqual(h.calls, []);
  assert.deepEqual(handle.frame.contentWindow.sent, []);
});

test('messages with a wrong or missing version marker are ignored', async () => {
  const h = handlers();
  const host = new ExtensionHost(h);
  const handle: any = host.mount(record(), container());
  const params = { message: 'hi', level: 'info' };
  const bad = [
    { jsonrpc: '2.0', id: 1, method: 'ui.notify', params },
    { formext: 2, jsonrpc: '2.0', id: 2, method: 'ui.notify', params },
    { formext: '1', jsonrpc: '2.0', id: 3, method: 'ui.notify', params },
    { formext: 1, id: 4, method: 'ui.notify', params },
    { formext: 1, jsonrpc: '1.0', id: 5, method: 'ui.notify', params },
    { formext: 1, jsonrpc: 2, id: 6, method: 'ui.notify', params },
    {},
  ];
  for (const data of bad) await assert.doesNotReject(deliver(handle.frame, data));
  assert.deepEqual(h.calls, []);
  assert.deepEqual(handle.frame.contentWindow.sent, []);
});

test('a message with no id never throws and gets no reply', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record(), container());
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', method: 'ui.notify', params: { message: 'hi', level: 'info' } }));
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', method: 'no.such' }));
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0' }));
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', result: 1 }));
  assert.deepEqual(handle.frame.contentWindow.sent, []);
});

test('odd params and method shapes are answered with errors and never throw', async () => {
  const h = handlers();
  const host = new ExtensionHost(h);
  const handle: any = host.mount(record(), container());
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: 1, method: 'ui.notify', params: null }));
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: 2, method: 'ui.notify', params: 'text' }));
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: 3, method: 42, params: {} }));
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: 4, method: { a: 1 } }));
  assert.equal(replies(handle.frame, 1)[0].error.code, -32602);
  assert.equal(replies(handle.frame, 2)[0].error.code, -32602);
  assert.equal(replies(handle.frame, 3)[0].error.code, -32601);
  assert.equal(replies(handle.frame, 4)[0].error.code, -32601);
  assert.deepEqual(h.calls, []);
});

test('invalid params are answered with -32602 before the handler runs', async () => {
  let reached = 0;
  const hit = async () => {
    reached += 1;
    return null;
  };
  const host = new ExtensionHost(handlers({ applyDocument: hit, run: hit, saveFile: hit, fetch: hit }));
  const handle = await granted(host, record(['document', 'files-write', 'network']));
  const cases: [string, unknown][] = [
    ['document.apply', { label: 'x', ops: 'nope' }],
    ['document.apply', { label: 'x', ops: [{ args: {} }] }],
    ['app.run', { args: {} }],
    ['files.save', { name: 'a.txt', type: 'text/plain' }],
    ['net.fetch', { url: 'http://example.com/' }],
    ['net.fetch', { url: 'file:///etc/passwd' }],
    ['net.fetch', {}],
  ];
  let id = 0;
  for (const [method, params] of cases) {
    const reply = await call(handle.frame, ++id, method, params);
    assert.equal(reply.error?.code, -32602, `${method} ${JSON.stringify(params)}`);
  }
  assert.equal(reached, 0);
});

test('a method the app does not offer is answered with -32003', async () => {
  const host = new ExtensionHost(handlers());
  const handle = await granted(host, record(['network', 'document']));
  assert.equal((await call(handle.frame, 1, 'net.fetch', { url: 'https://example.com/' })).error.code, -32003);
  assert.equal((await call(handle.frame, 2, 'document.read', {})).error.code, -32003);
});

test('a handler that throws comes back as a -32004 error reply with its words', async () => {
  const host = new ExtensionHost(
    handlers({
      readDocument: () => {
        throw new Error('the document is locked');
      },
      run: async () => {
        throw new Error('no clip is selected');
      },
    }),
  );
  const handle = await granted(host, record(['document']));
  const sync = await call(handle.frame, 1, 'document.read', {});
  assert.equal(sync.result, undefined);
  assert.equal(sync.error.code, -32004);
  assert.equal(sync.error.message, 'the document is locked');
  const later = await call(handle.frame, 2, 'app.run', { command: 'x', args: {} });
  assert.equal(later.error.code, -32004);
  assert.equal(later.error.message, 'no clip is selected');
  const after = await call(handle.frame, 3, 'host.hello', {});
  assert.equal(after.result.api, '1');
});

test('a handler error with its own code keeps that code', async () => {
  const host = new ExtensionHost(
    handlers({
      openFiles: async () => {
        throw new HostError(ERR.CANCELLED, 'cancelled');
      },
    }),
  );
  const handle = await granted(host, record(['files-read']));
  const reply = await call(handle.frame, 9, 'files.open', { accept: ['.wav'] });
  assert.equal(reply.error.code, -32002);
  assert.equal(reply.error.message, 'cancelled');
});

test('ui.notify, ui.resize and ui.setTitle answer null and reach the app', async () => {
  const titles: string[] = [];
  const heights: number[] = [];
  const h = handlers({ setTitle: (_e: any, _f: any, title: string) => titles.push(title) });
  const host = new ExtensionHost(h);
  const handle: any = host.mount(record(), container(), { onResize: (n: number) => heights.push(n) });
  const a = await call(handle.frame, 1, 'ui.notify', { message: 'Saved', level: 'success' });
  const b = await call(handle.frame, 2, 'ui.resize', { height: 320 });
  const c = await call(handle.frame, 3, 'ui.setTitle', { title: 'Beats' });
  assert.equal(a.result, null);
  assert.equal(b.result, null);
  assert.equal(c.result, null);
  assert.deepEqual(h.calls, [['notify', 'Saved', 'success']]);
  assert.deepEqual(heights, [320]);
  assert.deepEqual(titles, ['Beats']);
});

test('storage keeps values per extension and answers null for a missing key', async () => {
  const host = new ExtensionHost(handlers());
  const one: any = host.mount(record(), container());
  const two: any = host.mount(record([], { id: 'other', name: 'Other' }), container());
  assert.equal((await call(one.frame, 1, 'storage.get', { key: 'k' })).result, null);
  assert.equal((await call(one.frame, 2, 'storage.set', { key: 'k', value: { n: 1 } })).result, null);
  assert.deepEqual((await call(one.frame, 3, 'storage.get', { key: 'k' })).result, { n: 1 });
  assert.equal((await call(two.frame, 4, 'storage.get', { key: 'k' })).result, null);
});

test('storage refuses to grow past 256 KB and keeps what it had', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record(), container());
  await call(handle.frame, 1, 'storage.set', { key: 'small', value: 'kept' });
  const reply = await call(handle.frame, 2, 'storage.set', { key: 'big', value: 'x'.repeat(300 * 1024) });
  assert.equal(reply.result, undefined);
  assert.equal(typeof reply.error.code, 'number');
  assert.equal(typeof reply.error.message, 'string');
  assert.equal((await call(handle.frame, 3, 'storage.get', { key: 'big' })).result, null);
  assert.equal((await call(handle.frame, 4, 'storage.get', { key: 'small' })).result, 'kept');
});

test('activate waits for host.hello and then sends ext.activate as a request', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record(), container());
  const done = handle.activate({ reason: 'panel', panel: 'main' });
  await tick();
  assert.deepEqual(handle.frame.contentWindow.sent, []);
  await call(handle.frame, 1, 'host.hello', {});
  const sent = handle.frame.contentWindow.sent.filter((m: any) => m.method === 'ext.activate');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].formext, 1);
  assert.equal(sent[0].jsonrpc, '2.0');
  assert.deepEqual(sent[0].params, { reason: 'panel', panel: 'main' });
  assert.notEqual(sent[0].id, undefined);
  await deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: sent[0].id, result: { ok: true } });
  assert.deepEqual(await done, { ok: true });
});

test('an error answer from the extension rejects the request with its code', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record(), container());
  await call(handle.frame, 1, 'host.hello', {});
  const done = handle.send('ext.activate', { reason: 'panel' });
  done.catch(() => undefined);
  await tick();
  const sent = handle.frame.contentWindow.sent.find((m: any) => m.method === 'ext.activate');
  const stranger = makeFrame('iframe');
  await deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: sent.id, result: 'forged' }, stranger.contentWindow);
  await deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: sent.id + 1000, result: 'wrong id' });
  await deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: sent.id, error: { code: -32602, message: 'bad panel' } });
  await assert.rejects(done, (err: any) => err.code === -32602 && err.message === 'bad panel');
});

test('a request the extension never answers times out after 30 s', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record(), container());
  await call(handle.frame, 1, 'host.hello', {});
  const done = handle.send('ext.activate', { reason: 'panel' });
  let settled = false;
  done.catch(() => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false);
  const waiting = timers.filter((t) => t.kind === 'timeout');
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].ms, 30_000);
  waiting[0].fn();
  await assert.rejects(done, (err: any) => err instanceof HostError);
});

test('broadcast and setTheme reach every open frame as notifications', async () => {
  const host = new ExtensionHost(handlers());
  const one: any = host.mount(record(), container());
  const two: any = host.mount(record([], { id: 'other', name: 'Other' }), container());
  host.broadcast('selection.changed', { ids: [1] });
  host.setTheme({ mode: 'light', tokens: { '--bg': '#fff' } });
  for (const handle of [one, two]) {
    assert.deepEqual(handle.frame.contentWindow.sent, [
      { formext: 1, jsonrpc: '2.0', method: 'ext.event', params: { name: 'selection.changed', data: { ids: [1] } } },
      { formext: 1, jsonrpc: '2.0', method: 'ext.theme', params: { mode: 'light', tokens: { '--bg': '#fff' } } },
    ]);
  }
});

test('events reach only frames that are still open', async () => {
  const host = new ExtensionHost(handlers());
  const one: any = host.mount(record(), container());
  const two: any = host.mount(record([], { id: 'other', name: 'Other' }), container());
  host.disposeExtension('beat-markers');
  host.broadcast('document.changed', {});
  host.setTheme({ mode: 'dark', tokens: {} });
  assert.deepEqual(
    one.frame.contentWindow.sent.filter((m: any) => m.method === 'ext.event' || m.method === 'ext.theme'),
    [],
  );
  assert.equal(two.frame.contentWindow.sent.filter((m: any) => m.method === 'ext.event').length, 1);
  assert.equal(two.frame.contentWindow.sent.filter((m: any) => m.method === 'ext.theme').length, 1);
  assert.equal(one.frame.removed, true);
  assert.equal(two.frame.removed, false);
});

test('disposal sends ext.deactivate, removes the frame and stops answering', async () => {
  const h = handlers();
  const host = new ExtensionHost(h);
  const handle: any = host.mount(record(), container());
  await call(handle.frame, 1, 'host.hello', {});
  handle.dispose();
  const sent = handle.frame.contentWindow.sent;
  assert.deepEqual(sent[sent.length - 1], { formext: 1, jsonrpc: '2.0', method: 'ext.deactivate', params: {} });
  assert.equal(handle.frame.removed, true);
  const before = sent.length;
  await deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: 2, method: 'ui.notify', params: { message: 'late', level: 'info' } });
  assert.equal(sent.length, before);
  assert.deepEqual(h.calls, []);
  assert.equal(listeners.size, 0);
});

test('disposal rejects requests that are still waiting', async () => {
  const host = new ExtensionHost(handlers());
  const handle: any = host.mount(record(), container());
  await call(handle.frame, 1, 'host.hello', {});
  const done = handle.send('ext.activate', { reason: 'panel' });
  await tick();
  const sent = handle.frame.contentWindow.sent.find((m: any) => m.method === 'ext.activate');
  handle.dispose();
  await assert.rejects(done, (err: any) => err instanceof HostError && err.code === -32002);
  await assert.doesNotReject(deliver(handle.frame, { formext: 1, jsonrpc: '2.0', id: sent.id, result: 1 }));
});

test('a headless command activates a hidden frame and closes it on ext.done', async () => {
  const host = new ExtensionHost(handlers());
  const ext = record();
  const done = host.runCommand(ext, 'mark-beats', { clip: 4 }, container());
  await tick();
  assert.equal(frames.length, 1);
  const frame = frames[0];
  assert.equal(frame.attrs.sandbox, 'allow-scripts');
  assert.equal(frame.attrs['aria-hidden'], 'true');
  await deliver(frame, { formext: 1, jsonrpc: '2.0', id: 1, method: 'host.hello', params: {} });
  const activate = frame.contentWindow.sent.find((m: any) => m.method === 'ext.activate');
  assert.deepEqual(activate.params, { reason: 'command', command: 'mark-beats', args: { clip: 4 } });
  assert.equal(frame.removed, false);
  await deliver(frame, { formext: 1, jsonrpc: '2.0', id: 2, method: 'ext.done', params: { result: { markers: 12 } } });
  assert.deepEqual(await done, { markers: 12 });
  assert.equal(frame.removed, true);
});

test('a headless command the extension does not contribute is refused without a frame', async () => {
  const host = new ExtensionHost(handlers());
  await assert.rejects(host.runCommand(record(), 'nope', {}, container()), (err: any) => err.code === -32601);
  assert.equal(frames.length, 0);
});

test('a headless command follows the consent rules', async () => {
  const host = new ExtensionHost(handlers({ consent: async () => false }));
  await assert.rejects(host.runCommand(record(['document']), 'mark-beats', {}, container()), (err: any) => err.code === -32001);
  assert.equal(frames.length, 0);
});
