import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type Listener = (event: { data: unknown; source: unknown }) => void;

function makeWindow() {
  const sent: any[] = [];
  const targets: unknown[] = [];
  const listeners = new Set<Listener>();
  const timers: { id: number; fn: () => void; ms: number; cleared: boolean }[] = [];
  const styles: Record<string, string> = {};
  const root = {
    dataset: {} as Record<string, string>,
    style: { setProperty: (name: string, value: string) => { styles[name] = value; } },
  };
  const parent = {
    postMessage(message: unknown, target: unknown) {
      sent.push(message);
      targets.push(target);
    },
  };
  const win = {
    parent,
    addEventListener(type: string, fn: Listener) {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      if (type === 'message') listeners.delete(fn);
    },
    setTimeout(fn: () => void, ms: number) {
      const id = 900000 + timers.length;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout(id: number) {
      const found = timers.find((t) => t.id === id);
      if (found) found.cleared = true;
    },
  };
  const deliver = (data: unknown, source: unknown = parent) => {
    for (const fn of [...listeners]) fn({ data, source });
  };
  return { win, parent, sent, targets, timers, styles, root, deliver, document: { documentElement: root } };
}

const env = (body: Record<string, unknown>) => ({ formext: 1, jsonrpc: '2.0', ...body });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function state(promise: Promise<unknown>): Promise<string> {
  let seen = 'pending';
  promise.then(() => { seen = 'resolved'; }, () => { seen = 'rejected'; });
  await tick();
  await tick();
  return seen;
}

const saved: Record<string, unknown> = {};
let sdk: typeof import('../../contract/sdk/formext.ts');
let host: ReturnType<typeof makeWindow>;
let ext: InstanceType<typeof sdk.FormExt>;

function install() {
  host = makeWindow();
  (globalThis as any).window = host.win;
  (globalThis as any).document = host.document;
}

before(async () => {
  saved.window = Object.getOwnPropertyDescriptor(globalThis, 'window');
  saved.document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  install();
  sdk = await import('../../contract/sdk/formext.ts');
});

after(() => {
  for (const name of ['window', 'document']) {
    delete (globalThis as any)[name];
    if (saved[name]) Object.defineProperty(globalThis, name, saved[name] as PropertyDescriptor);
  }
});

beforeEach(() => {
  install();
  ext = new sdk.FormExt();
});

test('hello sends a host.hello request in the formext envelope', () => {
  ext.hello().catch(() => {});
  assert.equal(host.sent.length, 1);
  const msg = host.sent[0];
  assert.equal(msg.formext, 1);
  assert.equal(msg.jsonrpc, '2.0');
  assert.equal(msg.method, 'host.hello');
  assert.deepEqual(msg.params, {});
  assert.notEqual(msg.id, undefined);
  assert.notEqual(msg.id, null);
});

test('hello resolves with the host answer and applies its theme', async () => {
  const answer = {
    product: 'formcut',
    app: 'FormCut',
    appVersion: '2.14.0',
    api: '1',
    extension: { id: 'hello', version: '0.1.0', source: 'development' },
    permissions: ['document'],
    theme: { mode: 'light', tokens: { '--bg': '#fff', '--accent': '#f97316' } },
    locale: 'en',
  };
  const promise = ext.hello();
  host.deliver(env({ id: host.sent[0].id, result: answer }));
  assert.deepEqual(await promise, answer);
  assert.equal(host.root.dataset.theme, 'light');
  assert.equal(host.styles['--bg'], '#fff');
  assert.equal(host.styles['--accent'], '#f97316');
});

test('every call posts to the parent window with a fresh id', () => {
  ext.call('ui.notify', { message: 'a', level: 'info' }).catch(() => {});
  ext.call('storage.get', { key: 'k' }).catch(() => {});
  ext.call('storage.get', { key: 'k' }).catch(() => {});
  assert.equal(host.sent.length, 3);
  const ids = host.sent.map((m) => m.id);
  assert.equal(new Set(ids).size, 3);
  for (const msg of host.sent) {
    assert.equal(msg.formext, 1);
    assert.equal(msg.jsonrpc, '2.0');
  }
  assert.deepEqual(host.sent[1].params, { key: 'k' });
});

test('a call resolves with the result of the reply that carries its id', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  host.deliver(env({ id: host.sent[0].id, result: { stored: [1, 2, 3] } }));
  assert.deepEqual(await promise, { stored: [1, 2, 3] });
});

test('a reply with another id leaves the call pending', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  const id = host.sent[0].id;
  host.deliver(env({ id: id + 1000, result: 'wrong' }));
  host.deliver(env({ id: String(id) + 'x', result: 'wrong' }));
  assert.equal(await state(promise), 'pending');
  host.deliver(env({ id, result: 'right' }));
  assert.equal(await promise, 'right');
});

test('an error reply rejects with FormExtError carrying code, message and data', async () => {
  const promise = ext.call('files.open', { accept: ['.wav'] });
  host.deliver(env({ id: host.sent[0].id, error: { code: -32001, message: 'permission not granted', data: { permission: 'files-read' } } }));
  await assert.rejects(promise, (err: any) => {
    assert.ok(err instanceof sdk.FormExtError);
    assert.ok(err instanceof Error);
    assert.equal(err.code, -32001);
    assert.equal(err.message, 'permission not granted');
    assert.deepEqual(err.data, { permission: 'files-read' });
    return true;
  });
});

test('an error reply without data rejects with data undefined', async () => {
  const promise = ext.call('net.fetch', { url: 'https://example.com' });
  host.deliver(env({ id: host.sent[0].id, error: { code: -32003, message: 'no network here' } }));
  await assert.rejects(promise, (err: any) => {
    assert.ok(err instanceof sdk.FormExtError);
    assert.equal(err.code, -32003);
    assert.equal(err.message, 'no network here');
    assert.equal(err.data, undefined);
    return true;
  });
});

test('a reply from a source that is not the parent window is ignored', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  const id = host.sent[0].id;
  host.deliver(env({ id, result: 'forged' }), { postMessage() {} });
  host.deliver(env({ id, result: 'forged' }), host.win);
  host.deliver(env({ id, result: 'forged' }), null);
  host.deliver(env({ id, error: { code: -32004, message: 'forged' } }), { parent: host.parent });
  assert.equal(await state(promise), 'pending');
  host.deliver(env({ id, result: 'genuine' }));
  assert.equal(await promise, 'genuine');
});

test('a reply without the formext marker or the jsonrpc version is ignored', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  const id = host.sent[0].id;
  host.deliver({ jsonrpc: '2.0', id, result: 'no marker' });
  host.deliver({ formext: 2, jsonrpc: '2.0', id, result: 'wrong marker' });
  host.deliver({ formext: 1, id, result: 'no jsonrpc' });
  host.deliver({ formext: 1, jsonrpc: '1.0', id, result: 'old jsonrpc' });
  assert.equal(await state(promise), 'pending');
  host.deliver(env({ id, result: 'ok' }));
  assert.equal(await promise, 'ok');
});

test('two calls in flight get their own replies when answered in order', async () => {
  const first = ext.call('storage.get', { key: 'a' });
  const second = ext.call('storage.get', { key: 'b' });
  host.deliver(env({ id: host.sent[0].id, result: 'for a' }));
  assert.equal(await state(second), 'pending');
  host.deliver(env({ id: host.sent[1].id, result: 'for b' }));
  assert.equal(await first, 'for a');
  assert.equal(await second, 'for b');
});

test('two calls in flight get their own replies when answered in reverse order', async () => {
  const first = ext.call('storage.get', { key: 'a' });
  const second = ext.call('storage.get', { key: 'b' });
  host.deliver(env({ id: host.sent[1].id, result: 'for b' }));
  assert.equal(await state(first), 'pending');
  assert.equal(await second, 'for b');
  host.deliver(env({ id: host.sent[0].id, error: { code: -32002, message: 'cancelled' } }));
  await assert.rejects(first, (err: any) => err instanceof sdk.FormExtError && err.code === -32002);
});

test('a second reply for an answered id changes nothing and does not throw', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  const id = host.sent[0].id;
  host.deliver(env({ id, result: 'first' }));
  assert.doesNotThrow(() => host.deliver(env({ id, error: { code: -32004, message: 'late' } })));
  assert.doesNotThrow(() => host.deliver(env({ id, result: 'second' })));
  assert.equal(await promise, 'first');
});

test('ext.activate reaches the activation subscriber with its params', async () => {
  const seen: unknown[] = [];
  ext.onActivate((a) => { seen.push(a); });
  host.deliver(env({ method: 'ext.activate', params: { reason: 'command', command: 'mark-beats', args: { n: 2 } } }));
  await tick();
  assert.deepEqual(seen, [{ reason: 'command', command: 'mark-beats', args: { n: 2 } }]);
});

test('ext.event reaches the event subscriber once per event', async () => {
  const seen: unknown[] = [];
  ext.onEvent((e) => { seen.push(e); });
  host.deliver(env({ method: 'ext.event', params: { name: 'document.changed', data: { rev: 1 } } }));
  host.deliver(env({ method: 'ext.event', params: { name: 'selection.changed', data: null } }));
  await tick();
  assert.deepEqual(seen, [
    { name: 'document.changed', data: { rev: 1 } },
    { name: 'selection.changed', data: null },
  ]);
});

test('ext.deactivate reaches a subscriber registered for it', async () => {
  let count = 0;
  ext.on('ext.deactivate', () => { count += 1; });
  host.deliver(env({ method: 'ext.deactivate', params: {} }));
  await tick();
  assert.equal(count, 1);
});

test('host methods from a source that is not the parent window reach nobody', async () => {
  const seen: unknown[] = [];
  ext.onEvent((e) => { seen.push(e); });
  ext.onActivate((a) => { seen.push(a); });
  host.deliver(env({ method: 'ext.event', params: { name: 'document.changed', data: 1 } }), { postMessage() {} });
  host.deliver(env({ id: 7, method: 'ext.activate', params: { reason: 'panel' } }), host.win);
  await tick();
  assert.deepEqual(seen, []);
  assert.equal(host.sent.length, 0);
});

test('ext.theme applies the mode and the tokens to the page', async () => {
  host.deliver(env({ method: 'ext.theme', params: { mode: 'dark', tokens: { '--bg': '#0d0d0d', '--text': '#eee' } } }));
  await tick();
  assert.equal(host.root.dataset.theme, 'dark');
  assert.equal(host.styles['--bg'], '#0d0d0d');
  assert.equal(host.styles['--text'], '#eee');
});

test('a host request for an unknown method is answered with -32601 on the same id', async () => {
  host.deliver(env({ id: 41, method: 'ext.unknown', params: {} }));
  await tick();
  assert.equal(host.sent.length, 1);
  const reply = host.sent[0];
  assert.equal(reply.formext, 1);
  assert.equal(reply.jsonrpc, '2.0');
  assert.equal(reply.id, 41);
  assert.equal(reply.error.code, -32601);
  assert.equal(typeof reply.error.message, 'string');
  assert.equal('result' in reply, false);
});

test('a host notification without an id gets no reply', async () => {
  ext.onEvent(() => 'ignored');
  host.deliver(env({ method: 'ext.event', params: { name: 'document.changed', data: 1 } }));
  host.deliver(env({ method: 'ext.unknown', params: {} }));
  await tick();
  assert.equal(host.sent.length, 0);
});

test('a host request with an id gets the subscriber result on the same id', async () => {
  ext.onActivate(async () => ({ handled: true }));
  host.deliver(env({ id: 'req-9', method: 'ext.activate', params: { reason: 'panel', panel: 'main' } }));
  await tick();
  await tick();
  assert.equal(host.sent.length, 1);
  assert.deepEqual(host.sent[0], { formext: 1, jsonrpc: '2.0', id: 'req-9', result: { handled: true } });
});

test('a subscriber that throws does not throw into the host and yields an error reply', async () => {
  ext.onActivate(() => { throw new Error('broken subscriber'); });
  assert.doesNotThrow(() => host.deliver(env({ id: 5, method: 'ext.activate', params: { reason: 'panel' } })));
  await tick();
  await tick();
  assert.equal(host.sent.length, 1);
  assert.equal(host.sent[0].id, 5);
  assert.equal(typeof host.sent[0].error.code, 'number');
  assert.equal(host.sent[0].error.message, 'broken subscriber');
  assert.equal('result' in host.sent[0], false);
});

test('a host request that reuses a pending call id does not settle that call', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  const id = host.sent[0].id;
  host.deliver(env({ id, method: 'ext.deactivate', params: {} }));
  assert.equal(await state(promise), 'pending');
  host.deliver(env({ id, result: 'value' }));
  assert.equal(await promise, 'value');
});

test('malformed incoming messages never throw and never settle a call', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  const id = host.sent[0].id;
  const junk: unknown[] = [
    undefined, null, 0, 1, '', 'text', true, [], [1, 2], {}, () => {}, Symbol('s'), 12n,
    { formext: 1 },
    { formext: '1', jsonrpc: '2.0', id, result: 1 },
    { formext: 1, jsonrpc: 2, id, result: 1 },
    { formext: 1, jsonrpc: '2.0' },
    { formext: 1, jsonrpc: '2.0', id: null },
    { formext: 1, jsonrpc: '2.0', id: {} },
    { formext: 1, jsonrpc: '2.0', result: 1 },
    { formext: 1, jsonrpc: '2.0', error: { code: -32004, message: 'no id' } },
    { formext: 1, jsonrpc: '2.0', method: 42 },
    { formext: 1, jsonrpc: '2.0', method: {}, params: 'x' },
    { formext: 1, jsonrpc: '2.0', method: 'ext.theme', params: null },
    { formext: 1, jsonrpc: '2.0', method: 'ext.theme', params: 'dark' },
    { formext: 1, jsonrpc: '2.0', method: 'ext.theme', params: { mode: 'dark', tokens: null } },
    { formext: 1, jsonrpc: '2.0', method: 'ext.theme', params: { tokens: 7 } },
    { formext: 1, jsonrpc: '2.0', method: 'ext.event' },
    { formext: 1, jsonrpc: '2.0', method: 'ext.activate', params: [] },
  ];
  ext.onEvent(() => {});
  ext.onActivate(() => {});
  for (const data of junk) assert.doesNotThrow(() => host.deliver(data));
  assert.equal(await state(promise), 'pending');
  host.deliver(env({ id, result: 'still works' }));
  assert.equal(await promise, 'still works');
});

test('malformed error replies never throw from the message listener', async () => {
  const shapes: unknown[] = ['boom', 7, true, [], { message: 'no code' }, { code: 'x' }];
  for (const error of shapes) {
    const before = host.sent.length;
    const promise = ext.call('storage.get', { key: 'k' });
    promise.catch(() => {});
    assert.doesNotThrow(() => host.deliver(env({ id: host.sent[before].id, error })));
    assert.equal(await state(promise), 'rejected');
  }
});

test('plain requests time out after 30 s', () => {
  ext.call('ui.notify', { message: 'm', level: 'info' }).catch(() => {});
  ext.call('storage.get', { key: 'k' }).catch(() => {});
  ext.call('host.hello').catch(() => {});
  assert.deepEqual(host.timers.map((t) => t.ms), [30000, 30000, 30000]);
});

test('files.open, files.save and app.run time out after 300 s', () => {
  ext.call('files.open', { accept: ['.wav'] }).catch(() => {});
  ext.call('files.save', { name: 'a.txt', type: 'text/plain', data: '' }).catch(() => {});
  ext.call('app.run', { command: 'c', args: {} }).catch(() => {});
  assert.deepEqual(host.timers.map((t) => t.ms), [300000, 300000, 300000]);
});

test('document.apply and net.fetch time out after 30 s', { todo: 'defect: the SDK gives document.apply and net.fetch 300 s, CONTRACT.md section 6 names only files.* and app.run for 300 s' }, () => {
  ext.call('document.apply', { label: 'l', ops: [] }).catch(() => {});
  ext.call('net.fetch', { url: 'https://example.com' }).catch(() => {});
  assert.deepEqual(host.timers.map((t) => t.ms), [30000, 30000]);
});

test('a call that times out rejects with FormExtError and ignores a late reply', async () => {
  const promise = ext.call('storage.get', { key: 'k' });
  promise.catch(() => {});
  assert.equal(host.timers.length, 1);
  host.timers[0].fn();
  await assert.rejects(promise, (err: any) => err instanceof sdk.FormExtError && typeof err.code === 'number');
  assert.doesNotThrow(() => host.deliver(env({ id: host.sent[0].id, result: 'late' })));
});

test('the typed helpers send the method names and params of the contract table', () => {
  const cases: [() => Promise<unknown>, string, unknown][] = [
    [() => ext.notify('saved'), 'ui.notify', { message: 'saved', level: 'info' }],
    [() => ext.notify('bad', 'error'), 'ui.notify', { message: 'bad', level: 'error' }],
    [() => ext.resize(240), 'ui.resize', { height: 240 }],
    [() => ext.setTitle('Beats'), 'ui.setTitle', { title: 'Beats' }],
    [() => ext.storageGet('k'), 'storage.get', { key: 'k' }],
    [() => ext.storageSet('k', { a: 1 }), 'storage.set', { key: 'k', value: { a: 1 } }],
    [() => ext.readDocument(), 'document.read', {}],
    [() => ext.readDocument('file'), 'document.read', { what: 'file' }],
    [() => ext.apply('Mark', [{ command: 'marker.add', args: { t: 1 } }]), 'document.apply', { label: 'Mark', ops: [{ command: 'marker.add', args: { t: 1 } }] }],
    [() => ext.commands(), 'app.commands', {}],
    [() => ext.run('marker.clear', { all: true }), 'app.run', { command: 'marker.clear', args: { all: true } }],
    [() => ext.openFiles(['.wav']), 'files.open', { accept: ['.wav'], multiple: false }],
    [() => ext.openFiles(['.wav', '.mp3'], true), 'files.open', { accept: ['.wav', '.mp3'], multiple: true }],
    [() => ext.saveFile('a.txt', 'text/plain', 'aGk='), 'files.save', { name: 'a.txt', type: 'text/plain', data: 'aGk=' }],
    [() => ext.fetch('https://example.com/x'), 'net.fetch', { url: 'https://example.com/x' }],
    [() => ext.fetch('https://example.com/x', { method: 'POST', headers: { a: 'b' }, body: 'aGk=' }), 'net.fetch', { url: 'https://example.com/x', method: 'POST', headers: { a: 'b' }, body: 'aGk=' }],
    [() => ext.done(), 'ext.done', {}],
    [() => ext.done({ count: 3 }), 'ext.done', { result: { count: 3 } }],
  ];
  for (const [run, method, params] of cases) {
    const at = host.sent.length;
    run().catch(() => {});
    assert.equal(host.sent.length, at + 1, method);
    assert.equal(host.sent[at].method, method);
    assert.deepEqual(host.sent[at].params, params, method);
    assert.equal(host.sent[at].formext, 1);
    assert.equal(host.sent[at].jsonrpc, '2.0');
  }
});

test('the error code table matches the contract', () => {
  assert.deepEqual({ ...sdk.ERR }, {
    NOT_FOUND: -32601,
    INVALID: -32602,
    PERMISSION: -32001,
    CANCELLED: -32002,
    UNAVAILABLE: -32003,
    REFUSED: -32004,
  });
});

test('toBase64 encodes known byte sequences', () => {
  assert.equal(sdk.toBase64(new Uint8Array([1, 2, 3])), 'AQID');
  assert.equal(sdk.toBase64(new Uint8Array([])), '');
  assert.equal(sdk.toBase64(new Uint8Array([104, 105])), 'aGk=');
  assert.equal(sdk.toBase64(new Uint8Array([255, 255, 255])), '////');
});

test('fromBase64 decodes known strings and the empty string', () => {
  assert.deepEqual([...sdk.fromBase64('AQID')], [1, 2, 3]);
  assert.deepEqual([...sdk.fromBase64('')], []);
  assert.deepEqual([...sdk.fromBase64('aGk=')], [104, 105]);
});

test('70000 bytes of every value round trip and match Buffer base64', () => {
  const bytes = new Uint8Array(70000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const encoded = sdk.toBase64(bytes);
  assert.equal(encoded, Buffer.from(bytes).toString('base64'));
  const decoded = sdk.fromBase64(encoded);
  assert.equal(decoded.length, 70000);
  assert.ok(decoded.every((value, i) => value === bytes[i]));
  assert.equal(decoded[32768], 0);
  assert.equal(decoded[65535], 255);
  assert.equal(decoded[69999], 69999 % 256);
});

test('chunk boundary sizes round trip', () => {
  for (const size of [0x7fff, 0x8000, 0x8001, 0x10000, 0x10001]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 7 + 3) % 256;
    const encoded = sdk.toBase64(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString('base64'), String(size));
    assert.deepEqual(sdk.fromBase64(encoded), bytes, String(size));
  }
});

test('fromBase64 decodes Buffer output to the original bytes', () => {
  const bytes = new Uint8Array(70000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (255 - (i % 256));
  const decoded = sdk.fromBase64(Buffer.from(bytes).toString('base64'));
  assert.equal(decoded.length, bytes.length);
  assert.ok(decoded.every((value, i) => value === bytes[i]));
});

test('non-ASCII text round trips through utf-8 bytes and base64', () => {
  const text = 'café über 日本語 \u{1f600}';
  const encoded = sdk.toBase64(new TextEncoder().encode(text));
  assert.equal(encoded, Buffer.from(text, 'utf8').toString('base64'));
  assert.equal(new TextDecoder().decode(sdk.fromBase64(encoded)), text);
  assert.equal(sdk.toBase64(new TextEncoder().encode('é')), 'w6k=');
});
