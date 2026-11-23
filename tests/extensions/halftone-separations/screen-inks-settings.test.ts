import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, screenPlate, tile, type DotShape } from '../../../extensions/halftone-separations/src/screen.ts';
import type { Job } from '../../../extensions/halftone-separations/src/separate.ts';
import { PROCESS, PROCESS_ANGLES, SPOT_ANGLES, SPOT_INKS, SPOT_PRESETS, hexToRgb, inkByName, nameForHex, rgbToHex } from '../../../extensions/halftone-separations/src/inks.ts';
import { clean, defaults, offsetOf, platesOf, spotPlates } from '../../../extensions/halftone-separations/src/settings.ts';

let reply: unknown = null;
const sent: { method: string; params: unknown }[] = [];
let listener: ((e: { source: unknown; data: unknown }) => void) | null = null;
const parent = {
  postMessage(msg: { id: number; method: string; params: unknown }) {
    sent.push({ method: msg.method, params: msg.params });
    setImmediate(() => listener?.({ source: parent, data: { formext: 1, jsonrpc: '2.0', id: msg.id, result: reply } }));
  },
};
(globalThis as Record<string, unknown>).window = {
  addEventListener: (_type: string, fn: typeof listener) => {
    listener = fn;
  },
  parent,
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
};
const { readDoc, workScale, layerOps } = await import('../../../extensions/halftone-separations/src/app.ts');

const job = (): Job => ({ cancelled: false, progress: () => {} });
const HEX = /^#[0-9a-f]{6}$/;

async function plateOf(shape: DotShape, angle: number, density: number, opt: { cov?: number; size?: number; ppi?: number; lpi?: number; hard?: boolean; dx?: number; field?: Uint8Array } = {}): Promise<Uint8Array> {
  const size = opt.size ?? 16;
  const cov = opt.field ?? new Uint8Array(size * size).fill(opt.cov ?? 255);
  return screenPlate(cov, size, size, { angle, lpi: opt.lpi ?? 10, shape, density, dx: opt.dx ?? 0, dy: 0 }, { ppi: opt.ppi ?? 80, hard: opt.hard ?? true }, job(), 0, 1);
}

function quarterTurn(p: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = p[((((7 - x) % 8) + 8) % 8) * size + y];
  return out;
}

test('a line screen at 0 degrees inks rows 3 and 4 of every 8 pixel cell at 80 ppi and 10 lpi', async () => {
  const out = await plateOf('line', 0, 25);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) assert.equal(out[y * 16 + x], y % 8 === 3 || y % 8 === 4 ? 255 : 0, `pixel ${x},${y}`);
});

test('a line screen at 90 degrees turns those rows into columns', async () => {
  const out = await plateOf('line', 90, 25);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) assert.equal(out[y * 16 + x], x % 8 === 3 || x % 8 === 4 ? 255 : 0, `pixel ${x},${y}`);
});

test('doubling the resolution at the same frequency doubles the cell to 16 pixels', async () => {
  const out = await plateOf('line', 0, 25, { size: 32, ppi: 160, lpi: 10 });
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) assert.equal(out[y * 32 + x], [6, 7, 8, 9].includes(y % 16) ? 255 : 0, `pixel ${x},${y}`);
});

test('the same ratio of resolution to frequency gives the same plate', async () => {
  const a = await plateOf('round', 15, 100, { cov: 100, ppi: 80, lpi: 10 });
  const b = await plateOf('round', 15, 100, { cov: 100, ppi: 160, lpi: 20 });
  const c = await plateOf('round', 15, 100, { cov: 100, ppi: 80, lpi: 20 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('a cell never shrinks below 2 pixels', async () => {
  const tiny = await plateOf('round', 0, 100, { cov: 100, ppi: 10, lpi: 100 });
  const two = await plateOf('round', 0, 100, { cov: 100, ppi: 20, lpi: 10 });
  assert.deepEqual(tiny, two);
});

test('each quarter turn of the screen angle rotates the plate a quarter turn and four return to the start', async () => {
  const at = [];
  for (const angle of [0, 90, 180, 270, 360]) at.push(await plateOf('ellipse', angle, 100, { cov: 100 }));
  assert.notDeepEqual(at[0], at[1]);
  for (let i = 0; i < 4; i++) assert.deepEqual(quarterTurn(at[i], 16), at[i + 1], `turn ${i + 1}`);
  assert.deepEqual(at[4], at[0]);
});

test('no coverage or zero ink stays blank and full coverage prints solid', async () => {
  assert.ok((await plateOf('round', 15, 100, { cov: 0 })).every((v) => v === 0));
  assert.ok((await plateOf('round', 15, 0, { cov: 255 })).every((v) => v === 0));
  assert.ok((await plateOf('round', 15, 100, { cov: 255 })).every((v) => v === 255));
  assert.ok((await plateOf('round', 15, 150, { cov: 204 })).every((v) => v === 255));
});

test('hard edges give only 0 or 255 while smooth edges give values in between', async () => {
  const hard = await plateOf('round', 45, 50, { hard: true });
  const smooth = await plateOf('round', 45, 50, { hard: false });
  assert.ok(hard.every((v) => v === 0 || v === 255));
  assert.ok(hard.some((v) => v === 255) && hard.some((v) => v === 0));
  assert.ok(smooth.some((v) => v > 0 && v < 255));
});

test('a misregister offset moves the plate by whole pixels', async () => {
  const field = new Uint8Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) field[y * 16 + x] = 255;
  const still = await plateOf('round', 0, 100, { field });
  const moved = await plateOf('round', 0, 100, { field, dx: 2.4 });
  for (let x = 0; x < 16; x++) {
    assert.equal(still[5 * 16 + x], x < 8 ? 255 : 0, `still column ${x}`);
    assert.equal(moved[5 * 16 + x], x < 10 ? 255 : 0, `moved column ${x}`);
  }
});

test('every dot shape has 4096 thresholds strictly between 0 and 1 with each level used once', () => {
  for (const { id } of SHAPES) {
    const t = tile(id);
    assert.equal(t.length, 64 * 64, id);
    assert.ok(t.every((v) => v > 0 && v < 1), id);
    const sorted = Array.from(t).sort((a, b) => a - b);
    sorted.forEach((v, k) => assert.equal(v, (k + 0.5) / 4096, `${id} level ${k}`));
  }
});

test('a round dot starts in the centre of the cell and ends in a corner', () => {
  const t = tile('round');
  const lo = t.indexOf(Math.min(...t)), hi = t.indexOf(Math.max(...t));
  assert.ok([31, 32].includes(lo % 64) && [31, 32].includes(Math.floor(lo / 64)), `lowest at ${lo}`);
  assert.ok([0, 63].includes(hi % 64) && [0, 63].includes(Math.floor(hi / 64)), `highest at ${hi}`);
});

test('a line dot fills the two middle rows before any other row', () => {
  const t = tile('line');
  t.forEach((v, k) => {
    if (v < 128 / 4096) assert.ok([31, 32].includes(Math.floor(k / 64)), `index ${k}`);
  });
});

test('the six dot shapes have unique ids, the labels the panel shows and a tile built once', () => {
  assert.deepEqual(SHAPES.map((s) => s.label), ['Round', 'Ellipse', 'Square', 'Diamond', 'Line', 'Cross']);
  assert.equal(new Set(SHAPES.map((s) => s.id)).size, 6);
  assert.equal(tile('diamond'), tile('diamond'));
  assert.notEqual(tile('diamond'), tile('square'));
});

test('process inks are cyan magenta yellow and black with unique names and valid colours', () => {
  assert.deepEqual(PROCESS.map((i) => i.name), ['Cyan', 'Magenta', 'Yellow', 'Black']);
  for (const i of PROCESS) assert.match(i.hex, HEX);
});

test('spot inks have unique names and valid colours', () => {
  assert.equal(new Set(SPOT_INKS.map((i) => i.name)).size, SPOT_INKS.length);
  assert.equal(new Set(SPOT_INKS.map((i) => i.hex)).size, SPOT_INKS.length);
  for (const i of SPOT_INKS) assert.match(i.hex, HEX, i.name);
});

test('the traditional process angles give each plate its own angle with cyan magenta and black 30 degrees apart', () => {
  assert.deepEqual(PROCESS_ANGLES, [15, 75, 0, 45]);
  assert.equal(new Set(PROCESS_ANGLES).size, 4);
  const [c, m, , k] = PROCESS_ANGLES;
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b) % 90, 90 - (Math.abs(a - b) % 90));
  for (const [a, b] of [[c, m], [c, k], [m, k]]) assert.ok(gap(a, b) >= 30, `${a} and ${b}`);
});

test('spot angle sets cover two to four inks with no shared angle', () => {
  SPOT_ANGLES.forEach((set, i) => {
    assert.equal(set.length, i + 2);
    assert.equal(new Set(set).size, set.length);
  });
});

test('every spot preset names known inks and has two to four of them', () => {
  assert.equal(new Set(SPOT_PRESETS.map((p) => p.id)).size, SPOT_PRESETS.length);
  for (const id of ['blue-pink', 'black-red', 'teal-orange', 'pink-yellow-blue']) assert.ok(SPOT_PRESETS.some((p) => p.id === id), id);
  for (const p of SPOT_PRESETS) {
    assert.ok(p.inks.length >= 2 && p.inks.length <= 4, p.id);
    for (const n of p.inks) assert.ok(SPOT_INKS.some((i) => i.name === n), `${p.id} ${n}`);
  }
});

test('hex colours convert to and from red green and blue', () => {
  assert.deepEqual(hexToRgb('#00a3e0'), [0, 163, 224]);
  assert.deepEqual(hexToRgb('ff7a1a'), [255, 122, 26]);
  assert.deepEqual(hexToRgb(' #FFE500 '), [255, 229, 0]);
  assert.deepEqual(hexToRgb('#fff'), [0, 0, 0]);
  assert.deepEqual(hexToRgb('blue'), [0, 0, 0]);
  assert.equal(rgbToHex([0, 163, 224]), '#00a3e0');
  assert.equal(rgbToHex([300, -5, 127.6]), '#ff0080');
  for (const i of [...PROCESS, ...SPOT_INKS]) assert.equal(rgbToHex(hexToRgb(i.hex)), i.hex);
});

test('inks are found by name and colour with a fallback', () => {
  assert.deepEqual(inkByName('Teal'), { name: 'Teal', hex: '#00838a' });
  assert.deepEqual(inkByName('Gold'), { name: 'Black', hex: '#232323' });
  assert.equal(nameForHex('#1F5FAE'), 'Blue');
  assert.equal(nameForHex('#1d1d1b'), 'Black');
  assert.equal(nameForHex('#123456'), 'Ink #123456');
});

test('defaults are cmyk at 60 lpi on cream paper with the blue and pink pair ready', () => {
  const d = defaults();
  assert.equal(d.version, 1);
  assert.equal(d.mode, 'cmyk');
  assert.equal(d.preset, 'blue-pink');
  assert.equal(d.paper, '#f6f3ec');
  assert.deepEqual(d.cmyk.map((p) => [p.name, p.hex, p.angle, p.lpi, p.shape, p.density, p.visible]), [
    ['Cyan', '#00a3e0', 15, 60, 'round', 100, true],
    ['Magenta', '#e2007a', 75, 60, 'round', 100, true],
    ['Yellow', '#ffe500', 0, 60, 'round', 100, true],
    ['Black', '#1d1d1b', 45, 60, 'round', 100, true],
  ]);
  assert.deepEqual(d.spot.map((p) => [p.name, p.hex, p.angle, p.lpi]), [['Blue', '#1f5fae', 45, 45], ['Fluorescent Pink', '#ff4fa3', 75, 45]]);
  assert.deepEqual([d.ppi, d.hard, d.misreg, d.blackGeneration, d.inkLimit], [null, false, 0, 60, 300]);
  d.cmyk[0].angle = 99;
  assert.equal(defaults().cmyk[0].angle, 15);
});

test('spot plates take the preset inks, the angle set for their count and the given frequency', () => {
  assert.deepEqual(spotPlates('black-red', 30).map((p) => [p.name, p.hex, p.angle, p.lpi]), [['Black', '#232323', 45, 30], ['Red', '#e53b3b', 75, 30]]);
  assert.deepEqual(spotPlates('four-bright').map((p) => [p.name, p.angle, p.lpi]), [['Yellow', 15, 45], ['Fluorescent Pink', 75, 45], ['Sky', 0, 45], ['Black', 45, 45]]);
  assert.deepEqual(spotPlates('no-such-set'), spotPlates('blue-pink'));
});

test('settings round trip through save and load', () => {
  const s = defaults();
  s.mode = 'spot';
  s.preset = 'teal-orange';
  s.paper = '#112233';
  s.cmyk[1] = { ...s.cmyk[1], angle: 105, lpi: 85, shape: 'ellipse', density: 120, visible: false };
  s.spot = spotPlates('pink-yellow-blue', 55);
  s.spot[2] = { ...s.spot[2], name: 'Night Blue', hex: '#102040', shape: 'line', density: 70 };
  s.ppi = 600;
  s.hard = true;
  s.misreg = 3;
  s.blackGeneration = 80;
  s.inkLimit = 260;
  const loaded = clean(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(loaded, s);
  assert.deepEqual(clean(JSON.parse(JSON.stringify(defaults()))), defaults());
});

test('anything that is not a settings object loads as the defaults', () => {
  for (const raw of [null, undefined, 'text', 42, true, [], {}]) assert.deepEqual(clean(raw), defaults(), String(raw));
});

test('missing settings keep their defaults while given ones are kept', () => {
  const d = defaults();
  assert.deepEqual(clean({ mode: 'spot', misreg: 5 }), { ...d, mode: 'spot', misreg: 5 });
});

test('out of range numbers are brought back to the nearest allowed value', () => {
  const low = clean({ ppi: 10, misreg: -5, blackGeneration: -1, inkLimit: 100 });
  assert.deepEqual([low.ppi, low.misreg, low.blackGeneration, low.inkLimit], [36, 0, 0, 200]);
  const high = clean({ ppi: 5000, misreg: 30, blackGeneration: 150, inkLimit: 999 });
  assert.deepEqual([high.ppi, high.misreg, high.blackGeneration, high.inkLimit], [2400, 24, 100, 400]);
});

test('wrongly typed settings fall back to the defaults', () => {
  const d = defaults();
  const s = clean({ mode: 'rgb', preset: 7, paper: 'red', hard: 'yes', misreg: '3', blackGeneration: Number.NaN, inkLimit: Infinity, cmyk: 'none', spot: { a: 1 } });
  assert.deepEqual(s, d);
  assert.equal(clean({ paper: '#ABCDEF' }).paper, '#abcdef');
});

test('a wrongly typed resolution falls back to the automatic default', { todo: 'defect: clean() turns a non numeric ppi such as "auto" into 300 instead of the default null (automatic resolution)' }, () => {
  assert.equal(clean({ ppi: 'auto' }).ppi, defaults().ppi);
  assert.equal(clean({ ppi: null }).ppi, null);
});

test('plate settings are clamped and checked one field at a time', () => {
  const d = defaults();
  const long = 'x'.repeat(50);
  const s = clean({ spot: [{ name: long, hex: '#ABCDEF', angle: 200, lpi: 1, shape: 'star', density: 200, visible: 'no' }, { angle: -10, lpi: 1000, shape: 'cross', density: -3, visible: false, hex: 'blue', name: 3 }] });
  assert.deepEqual(s.spot[0], { name: 'x'.repeat(40), hex: '#abcdef', angle: 179, lpi: 5, shape: 'round', density: 150, visible: true });
  assert.deepEqual(s.spot[1], { name: d.spot[1].name, hex: d.spot[1].hex, angle: 0, lpi: 300, shape: 'cross', density: 0, visible: false });
});

test('cmyk plates keep their ink names and colours and wrong plate counts fall back', () => {
  const d = defaults();
  const s = clean({ cmyk: d.cmyk.map((p) => ({ ...p, name: 'Foo', hex: '#000000', lpi: 133 })) });
  assert.deepEqual(s.cmyk.map((p) => [p.name, p.hex, p.lpi]), d.cmyk.map((p) => [p.name, p.hex, 133]));
  assert.deepEqual(clean({ cmyk: d.cmyk.slice(0, 3) }).cmyk, d.cmyk);
  const five = [...d.spot, ...d.spot, d.spot[0]];
  assert.deepEqual(clean({ spot: five }).spot, d.spot);
  assert.deepEqual(clean({ spot: [d.spot[0]] }).spot, d.spot);
  assert.equal(clean({ spot: [...d.spot, ...d.spot] }).spot.length, 4);
});

test('unknown keys are ignored', () => {
  const s = clean({ ...defaults(), version: 7, colour: 'red', cmyk: defaults().cmyk.map((p) => ({ ...p, glow: true })) });
  assert.deepEqual(s, defaults());
  assert.ok(!('colour' in s));
  assert.ok(!('glow' in s.cmyk[0]));
});

test('the plates in use follow the mode and misregister offsets scale with the amount', () => {
  const s = defaults();
  assert.equal(platesOf(s), s.cmyk);
  assert.equal(platesOf({ ...s, mode: 'spot' }), s.spot);
  assert.equal(Math.hypot(...offsetOf(0, 10)), 0);
  assert.ok(Math.abs(Math.hypot(...offsetOf(1, 10)) - 10) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...offsetOf(2, 8)) - 6) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...offsetOf(3, 10)) - 6) < 1e-9);
  for (let i = 0; i < 4; i++) assert.equal(Math.hypot(...offsetOf(i, 0)), 0);
});

test('pictures over 36 megapixels are worked at a reduced size', () => {
  const doc = (width: number, height: number) => ({ open: true, name: 'a', width, height, resolution: 300, mode: 'rgb' });
  assert.equal(workScale(doc(6000, 6000)), 1);
  assert.equal(workScale(doc(100, 100)), 1);
  assert.equal(workScale(doc(12000, 12000)), 0.5);
  assert.equal(workScale(doc(0, 0)), 1);
});

test('layer operations add a paper layer and one multiply layer per plate scaled back to the document', () => {
  const doc = { open: true, name: 'a', width: 400, height: 300, resolution: 300, mode: 'rgb' };
  const plates = [{ name: 'Cyan 15', png: 'AAA' }, { name: 'Black 45', png: 'BBB' }];
  assert.deepEqual(layerOps(doc, 1, '#f6f3ec', plates), [
    { command: 'tool:draw_shape', args: { kind: 'rectangle', x: 0, y: 0, width: 400, height: 300, fill: '#f6f3ec' } },
    { command: 'layer.set', args: { name: 'Paper' } },
    { command: 'tool:place_image', args: { data: 'AAA', name: 'Cyan 15', x: 0, y: 0 } },
    { command: 'layer.set', args: { blend: 'multiply' } },
    { command: 'tool:place_image', args: { data: 'BBB', name: 'Black 45', x: 0, y: 0 } },
    { command: 'layer.set', args: { blend: 'multiply' } },
  ]);
  const half = layerOps(doc, 0.5, null, plates);
  assert.equal(half.length, 4);
  assert.equal(half[0].args.scale, 200);
  assert.equal(layerOps(doc, 0.3, null, plates)[0].args.scale, 333.333);
});

test('reading the document reports a closed document or its size and resolution', async () => {
  reply = null;
  assert.deepEqual(await readDoc(), { open: false, name: '', width: 0, height: 0, resolution: 72, mode: 'rgb' });
  assert.deepEqual(sent.at(-1), { method: 'document.read', params: { what: 'document' } });
  reply = { open: false, name: 'x', width: 5 };
  assert.equal((await readDoc()).open, false);
  reply = { name: 'Poster', width: '800', height: 600, resolution: 0 };
  assert.deepEqual(await readDoc(), { open: true, name: 'Poster', width: 800, height: 600, resolution: 72, mode: 'rgb' });
  reply = { name: 'Scan', width: 10, height: 20, resolution: 600, mode: 'cmyk' };
  assert.deepEqual(await readDoc(), { open: true, name: 'Scan', width: 10, height: 20, resolution: 600, mode: 'cmyk' });
});
