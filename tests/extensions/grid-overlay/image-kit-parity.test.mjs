import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { crc32 } from 'node:zlib';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'extensions', 'grid-overlay');
const UI = join(EXT, 'package', 'ui');

const listeners = [];
const sent = [];
const timers = [];
const parent = { postMessage(msg, origin) { sent.push({ msg, origin }); } };
globalThis.window = {
  parent,
  addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
  setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.push({ fn, ms }); return t; },
};
const rootEl = { dataset: {}, scrollHeight: 0, style: { props: {}, setProperty(n, v) { this.props[n] = v; } } };
const found = {};
const canvases = [];
let blobBytes = new Uint8Array([1, 2, 3]);
let pixels = null;
let imageFails = false;
const images = [];
function fakeCanvas() {
  const c = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (...a) => { c.drawn = a; },
      getImageData: (x, y, w, h) => { c.read = [x, y, w, h]; return { data: pixels }; },
      putImageData: (d, x, y) => { c.put = [d, x, y]; },
    }),
    toBlob: (cb, type) => { c.type = type; cb(blobBytes && { arrayBuffer: async () => blobBytes.slice().buffer }); },
  };
  canvases.push(c);
  return c;
}
globalThis.document = { documentElement: rootEl, body: {}, querySelector: (sel) => found[sel] ?? null, createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : null) };
globalThis.Image = class {
  set src(v) {
    this.url = v;
    this.naturalWidth = 2;
    this.naturalHeight = 1;
    images.push(this);
    queueMicrotask(() => (imageFails ? this.onerror() : this.onload()));
  }
};

const sdk = await import('../../../extensions/grid-overlay/package/ui/formext.js');
const kit = await import('../../../extensions/grid-overlay/package/ui/kit.js');
const image = await import('../../../extensions/grid-overlay/package/ui/image.js');

const env = (body) => ({ formext: 1, jsonrpc: '2.0', ...body });
const flush = () => new Promise((r) => setImmediate(r));
const singleton = (data, source = parent) => listeners[0]({ source, data });
function fresh() {
  const at = listeners.length;
  const ext = new sdk.FormExt();
  return { ext, deliver: (data, source = parent) => listeners[at]({ source, data }) };
}
async function waitFor(method) {
  for (let i = 0; i < 100; i++) {
    const hit = sent.find((s) => s.msg.method === method && !s.seen);
    if (hit) {
      hit.seen = true;
      return hit.msg;
    }
    await flush();
  }
  throw new Error(`nothing posted for ${method}`);
}
async function settle(p) {
  let state = 'pending';
  p.then(() => (state = 'resolved'), () => (state = 'rejected'));
  await flush();
  return state;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IHDR = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82]);
const bytes = (...parts) => new Uint8Array(Buffer.concat(parts));

function listFiles(dir) {
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).sort();
}

test('a call posts a request envelope and resolves with the reply carrying its id', async () => {
  const { ext, deliver } = fresh();
  sent.length = 0;
  const a = ext.call('storage.get', { key: 'a' });
  const b = ext.call('storage.get', { key: 'b' });
  assert.deepEqual(sent.map((s) => s.msg), [
    env({ id: 1, method: 'storage.get', params: { key: 'a' } }),
    env({ id: 2, method: 'storage.get', params: { key: 'b' } }),
  ]);
  assert.equal(sent[0].origin, '*');
  deliver(env({ id: 2, result: 'B' }));
  deliver(env({ id: 1, result: 'A' }));
  assert.equal(await a, 'A');
  assert.equal(await b, 'B');
});

test('an error reply rejects with a FormExtError holding code message and data', async () => {
  const { ext, deliver } = fresh();
  const p = ext.call('document.read');
  deliver(env({ id: 1, error: { code: -32001, message: 'not allowed', data: { why: 'x' } } }));
  await assert.rejects(p, (err) => {
    assert.ok(err instanceof sdk.FormExtError);
    assert.ok(err instanceof Error);
    assert.equal(err.code, -32001);
    assert.equal(err.message, 'not allowed');
    assert.deepEqual(err.data, { why: 'x' });
    return true;
  });
});

test('messages from a stranger or without the formext envelope are ignored', async () => {
  const { ext, deliver } = fresh();
  const p = ext.call('ui.setTitle', { title: 't' });
  deliver(env({ id: 1, result: 'from stranger' }), { postMessage() {} });
  deliver({ jsonrpc: '2.0', id: 1, result: 'no formext flag' });
  deliver({ formext: 1, jsonrpc: '1.0', id: 1, result: 'wrong version' });
  deliver(null);
  assert.equal(await settle(p), 'pending');
  deliver(env({ id: 1, result: 'real' }));
  assert.equal(await p, 'real');
});

test('a reply for an unknown id is dropped and a second reply cannot change a settled call', async () => {
  const { ext, deliver } = fresh();
  const p = ext.call('app.commands');
  deliver(env({ id: 99, result: 'nobody asked' }));
  assert.equal(await settle(p), 'pending');
  deliver(env({ id: 1, result: 'first' }));
  deliver(env({ id: 1, error: { code: 1, message: 'late' } }));
  assert.equal(await p, 'first');
});

test('a call times out after 30 seconds or 5 minutes for long methods and late replies are ignored', async () => {
  const { ext, deliver } = fresh();
  timers.length = 0;
  const short = ext.call('ui.notify', { message: 'm' });
  const long = ext.call('files.save', {});
  assert.deepEqual(timers.map((t) => t.ms), [30000, 300000]);
  timers[0].fn();
  await assert.rejects(short, (err) => err.code === -32003 && err.message === 'ui.notify timed out');
  deliver(env({ id: 1, result: 'too late' }));
  deliver(env({ id: 2, result: 'saved' }));
  assert.equal(await long, 'saved');
});

test('a host request reaches its handler and the result is posted back with the same id', async () => {
  const { ext, deliver } = fresh();
  ext.on('x.ping', (p) => ({ got: p.n * 2 }));
  ext.on('x.quiet', () => undefined);
  sent.length = 0;
  deliver(env({ id: 7, method: 'x.ping', params: { n: 3 } }));
  deliver(env({ id: 8, method: 'x.quiet' }));
  deliver(env({ method: 'x.ping', params: { n: 1 } }));
  await flush();
  assert.deepEqual(sent.map((s) => s.msg), [env({ id: 7, result: { got: 6 } }), env({ id: 8, result: null })]);
});

test('a host request with no handler gets a not found error unless it is a notification', async () => {
  const { deliver } = fresh();
  sent.length = 0;
  deliver(env({ id: 3, method: 'x.unknown' }));
  deliver(env({ method: 'x.unknown' }));
  await flush();
  assert.deepEqual(sent.map((s) => s.msg), [env({ id: 3, error: { code: -32601, message: 'no handler for x.unknown' } })]);
});

test('a throwing handler answers refused or its own error code', async () => {
  const { ext, deliver } = fresh();
  ext.on('x.plain', () => { throw new Error('nope'); });
  ext.on('x.coded', async () => { throw new sdk.FormExtError(-32002, 'stopped'); });
  sent.length = 0;
  deliver(env({ id: 1, method: 'x.plain' }));
  deliver(env({ id: 2, method: 'x.coded' }));
  await flush();
  assert.deepEqual(sent.map((s) => s.msg), [
    env({ id: 1, error: { code: -32004, message: 'nope' } }),
    env({ id: 2, error: { code: -32002, message: 'stopped' } }),
  ]);
});

test('an ext.theme message sets the theme mode and only custom property tokens', async () => {
  const { deliver } = fresh();
  rootEl.style.props = {};
  deliver(env({ method: 'ext.theme', params: { mode: 'dark', tokens: { '--accent': '#f97316', color: 'red' } } }));
  await flush();
  assert.equal(rootEl.dataset.theme, 'dark');
  assert.deepEqual(rootEl.style.props, { '--accent': '#f97316' });
});

test('hello asks the host once, caches the answer and applies its theme', async () => {
  const { ext, deliver } = fresh();
  sent.length = 0;
  const first = ext.hello();
  const second = ext.hello();
  assert.equal(first, second);
  assert.deepEqual(sent.map((s) => s.msg), [env({ id: 1, method: 'host.hello', params: {} })]);
  deliver(env({ id: 1, result: { app: 'FormVis', theme: { mode: 'light', tokens: {} } } }));
  assert.equal((await first).app, 'FormVis');
  assert.equal(rootEl.dataset.theme, 'light');
});

test('the convenience calls post the documented methods and params', () => {
  const { ext } = fresh();
  sent.length = 0;
  ext.resize(10.2);
  ext.readDocument();
  ext.readDocument('selection');
  ext.done();
  ext.done({ ok: 1 });
  ext.fetch('https://a.test', { method: 'POST' });
  ext.run('grid.redraw');
  ext.openFiles('image/*');
  assert.deepEqual(sent.map((s) => [s.msg.method, s.msg.params]), [
    ['ui.resize', { height: 11 }],
    ['document.read', {}],
    ['document.read', { what: 'selection' }],
    ['ext.done', {}],
    ['ext.done', { result: { ok: 1 } }],
    ['net.fetch', { url: 'https://a.test', method: 'POST' }],
    ['app.run', { command: 'grid.redraw', args: {} }],
    ['files.open', { accept: 'image/*', multiple: false }],
  ]);
});

test('base64 helpers match node Buffer encoding across the chunk boundary and for unicode text', () => {
  const big = new Uint8Array(0x8000 * 2 + 5).map((_, i) => (i * 7) & 255);
  assert.equal(sdk.toBase64(big), Buffer.from(big).toString('base64'));
  assert.deepEqual(sdk.fromBase64(Buffer.from(big).toString('base64')), big);
  assert.equal(sdk.textToBase64('grid é ✓'), Buffer.from('grid é ✓', 'utf8').toString('base64'));
  assert.equal(sdk.toBase64(new Uint8Array([1, 2, 3])), 'AQID');
  assert.equal(image.toBase64, sdk.toBase64);
  assert.equal(image.fromBase64, sdk.fromBase64);
});

test('withDpi inserts a pHYs chunk right after IHDR in pixels per metre', () => {
  const out = image.withDpi(bytes(SIG, IHDR, IEND), 300);
  const phys = chunk('pHYs', [0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1]);
  assert.deepEqual(out, bytes(SIG, IHDR, phys, IEND));
  assert.equal(out.length, 33 + 21 + 12);
  const at72 = image.withDpi(bytes(SIG, IHDR, IEND), 72);
  assert.deepEqual(at72.subarray(33, 54), new Uint8Array(chunk('pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])));
});

test('withDpi replaces an existing pHYs and keeps the other chunks in order', () => {
  const old = chunk('pHYs', [0, 0, 0x03, 0xe8, 0, 0, 0x03, 0xe8, 1]);
  const text = chunk('tEXt', [...Buffer.from('Title\0Grid')]);
  const out = image.withDpi(bytes(SIG, IHDR, old, text, IEND), 300);
  assert.deepEqual(out, bytes(SIG, IHDR, chunk('pHYs', [0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1]), text, IEND));
});

test('withDpi reads a PNG that sits inside a larger buffer', () => {
  const host = new Uint8Array(5 + 33 + 12 + 3);
  host.set(bytes(SIG, IHDR, IEND), 5);
  const view = host.subarray(5, 5 + 45);
  const out = image.withDpi(view, 300);
  assert.deepEqual(out, bytes(SIG, IHDR, chunk('pHYs', [0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1]), IEND));
});

test('withDpi returns the input untouched for a missing or non positive dpi or a too short file', () => {
  const png = bytes(SIG, IHDR, IEND);
  for (const dpi of [0, -300, NaN, undefined, null]) assert.equal(image.withDpi(png, dpi), png);
  const short = png.subarray(0, 32);
  assert.equal(image.withDpi(short, 300), short);
});

test('gridImage sends the SVG as is above 16 million pixels without touching a canvas', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">é</svg>';
  canvases.length = 0;
  const out = await image.gridImage(svg, 5000, 3201);
  assert.deepEqual(out, { data: Buffer.from(svg, 'utf8').toString('base64'), kind: 'svg' });
  assert.equal(canvases.length, 0);
});

test('gridImage draws a PNG at exactly 16 million pixels at full size', async () => {
  const svg = '<svg/>';
  canvases.length = 0;
  images.length = 0;
  blobBytes = new Uint8Array([137, 80, 78]);
  const out = await image.gridImage(svg, 4000, 4000);
  assert.deepEqual(out, { data: Buffer.from([137, 80, 78]).toString('base64'), kind: 'png' });
  assert.equal(images[0].url, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  const c = canvases[0];
  assert.equal(c.width, 4000);
  assert.equal(c.height, 4000);
  assert.deepEqual(c.drawn, [images[0], 0, 0, 4000, 4000]);
  assert.equal(c.type, 'image/png');
});

test('gridImage falls back to the SVG when decoding or PNG encoding fails', async () => {
  const svg = '<svg>x</svg>';
  const want = { data: Buffer.from(svg).toString('base64'), kind: 'svg' };
  imageFails = true;
  try {
    assert.deepEqual(await image.gridImage(svg, 10, 10), want);
  } finally {
    imageFails = false;
  }
  blobBytes = null;
  try {
    assert.deepEqual(await image.gridImage(svg, 10, 10), want);
  } finally {
    blobBytes = new Uint8Array([1, 2, 3]);
  }
});

test('grayscale writes Rec 709 luma into each pixel and keeps alpha', async () => {
  pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 7]);
  canvases.length = 0;
  blobBytes = new Uint8Array([9, 9]);
  const out = await image.grayscale('AAAA');
  assert.deepEqual(out, new Uint8Array([9, 9]));
  assert.equal(images.at(-1).url, 'data:image/png;base64,AAAA');
  const c = canvases[0];
  assert.deepEqual([c.width, c.height], [2, 1]);
  assert.deepEqual(c.read, [0, 0, 2, 1]);
  assert.deepEqual([...c.put[0].data], [54, 54, 54, 255, 182, 182, 182, 128, 18, 18, 18, 0, 19, 19, 19, 7]);
  blobBytes = new Uint8Array([1, 2, 3]);
});

test('esc escapes the five HTML characters once and turns nullish into empty text', () => {
  assert.equal(kit.esc(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(kit.esc('&lt;'), '&amp;lt;');
  assert.equal(kit.esc(null), '');
  assert.equal(kit.esc(undefined), '');
  assert.equal(kit.esc(0), '0');
});

test('errorText explains permission and cancel codes and falls back to the message', () => {
  assert.equal(kit.errorText(null), 'Something went wrong.');
  assert.equal(kit.errorText({ code: -32001, message: 'x' }), 'Allow this extension in the Extensions panel first.');
  assert.equal(kit.errorText(new sdk.FormExtError(-32002, 'user closed')), 'Cancelled.');
  assert.equal(kit.errorText(new Error('boom')), 'boom');
  assert.equal(kit.errorText('plain words'), 'plain words');
  assert.equal(kit.errorText(new Error('')), 'Error');
  assert.equal(kit.plural(1, 'cell'), '1 cell');
  assert.equal(kit.plural(0, 'cell'), '0 cells');
  assert.equal(kit.plural(3, 'box', 'boxes'), '3 boxes');
});

test('debounce runs once with the last arguments 120 ms after the last call', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const run = kit.debounce((...a) => calls.push(a));
  run(1);
  t.mock.timers.tick(100);
  run(2, 'b');
  t.mock.timers.tick(119);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [[2, 'b']]);
});

test('status fill and the query helper only write when the content changes', () => {
  let writes = 0;
  const el = { dataset: {}, _t: '', get textContent() { return this._t; }, set textContent(v) { writes++; this._t = v; } };
  found['#status'] = el;
  kit.status('Ready');
  kit.status('Ready', 'error');
  assert.equal(el.textContent, 'Ready');
  assert.equal(el.dataset.level, 'error');
  assert.equal(writes, 1);
  delete found['#status'];
  assert.doesNotThrow(() => kit.status('nobody'));
  let html = 0;
  const box = { _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { html++; this._h = v; } };
  kit.fill(box, '<b>1</b>');
  kit.fill(box, '<b>1</b>');
  kit.fill(null, 'x');
  assert.equal(box.innerHTML, '<b>1</b>');
  assert.equal(html, 1);
  const root = { querySelector: (s) => `found ${s}` };
  assert.equal(kit.$('.cell', root), 'found .cell');
});

test('headless runs a command activation and reports its result with ext.done', async () => {
  const seen = [];
  kit.headless(async (a) => { seen.push(a); return { placed: 2 }; }, () => seen.push('panel'));
  sent.length = 0;
  singleton(env({ id: 501, method: 'ext.activate', params: { reason: 'command', command: 'grid.add' } }));
  const done = await waitFor('ext.done');
  assert.deepEqual(done.params, { result: { placed: 2 } });
  assert.deepEqual(seen, [{ reason: 'command', command: 'grid.add' }]);
  assert.deepEqual(sent[0].msg, env({ id: 501, result: null }));
  singleton(env({ id: done.id, result: null }));
});

test('headless hands panel activations to onPanel and never runs the command', async () => {
  const seen = [];
  kit.headless(() => seen.push('run'), (a) => seen.push(a.reason));
  singleton(env({ id: 502, method: 'ext.activate', params: { reason: 'panel' } }));
  singleton(env({ id: 503, method: 'ext.activate', params: { reason: 'command', panel: true } }));
  for (let i = 0; i < 5; i++) await flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, ['panel', 'command']);
});

test('headless reports a failing command as an error notice and an error result', async () => {
  kit.headless(async () => { throw new Error('no layer selected'); });
  sent.length = 0;
  singleton(env({ id: 504, method: 'ext.activate', params: { reason: 'command' } }));
  const note = await waitFor('ui.notify');
  assert.deepEqual(note.params, { message: 'no layer selected', level: 'error' });
  singleton(env({ id: note.id, error: { code: -32003, message: 'host busy' } }));
  const done = await waitFor('ext.done');
  assert.deepEqual(done.params, { result: { error: 'no layer selected' } });
  singleton(env({ id: done.id, result: null }));
});

test('fitHeight posts the rounded up page height and skips changes under 2 pixels', async () => {
  let observed = null;
  globalThis.ResizeObserver = class { constructor(cb) { observed = { cb }; } observe(el) { observed.el = el; } };
  globalThis.requestAnimationFrame = (fn) => fn();
  sent.length = 0;
  kit.fitHeight();
  assert.equal(observed.el, document.body);
  for (const h of [500.4, 501.9, 640]) {
    rootEl.scrollHeight = h;
    observed.cb();
  }
  const heights = sent.filter((s) => s.msg.method === 'ui.resize').map((s) => s.msg.params.height);
  assert.deepEqual(heights, [501, 640]);
});

test('package ui holds exactly the files of src and vendor byte for byte', () => {
  const sources = new Map();
  for (const dir of ['src', 'vendor']) for (const name of listFiles(join(EXT, dir))) sources.set(name, join(EXT, dir, name));
  const shipped = listFiles(UI);
  assert.deepEqual(shipped, ['app.js', 'formext.js', 'grid.css', 'grid.js', 'image.js', 'index.html', 'kit.js']);
  assert.deepEqual(shipped, [...sources.keys()].sort());
  for (const name of shipped) assert.ok(readFileSync(join(UI, name)).equals(readFileSync(sources.get(name))), `${name} differs from its source`);
  assert.deepEqual(readdirSync(UI).sort(), shipped);
});

test('the build on a temporary copy reproduces package ui exactly and leaves the manifest alone', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'grid-overlay-build-'));
  try {
    const copy = join(tmp, 'grid-overlay');
    cpSync(EXT, copy, { recursive: true });
    writeFileSync(join(copy, 'package', 'ui', 'stale.js'), 'old');
    mkdirSync(join(copy, 'src', 'nested'));
    writeFileSync(join(copy, 'src', 'nested', 'deep.js'), 'skip me');
    const manifest = readFileSync(join(copy, 'package', 'manifest.json'));
    const log = execFileSync(process.execPath, [join(copy, 'tools', 'build.mjs')], { cwd: tmp, encoding: 'utf8' });
    assert.equal(log, 'package/ui: 7 files (src/app.js, src/grid.css, src/grid.js, src/image.js, src/index.html, src/kit.js, vendor/formext.js)\n');
    const built = join(copy, 'package', 'ui');
    assert.deepEqual(readdirSync(built).sort(), readdirSync(UI).sort());
    assert.equal(existsSync(join(built, 'stale.js')), false);
    assert.equal(existsSync(join(built, 'nested')), false);
    for (const name of readdirSync(UI)) assert.ok(readFileSync(join(built, name)).equals(readFileSync(join(UI, name))), `${name} differs`);
    assert.ok(readFileSync(join(copy, 'package', 'manifest.json')).equals(manifest));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
