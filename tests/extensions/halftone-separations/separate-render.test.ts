import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cancelled, bands, separateCmyk, separateSpot, spotLut, type Job, type Picture } from '../../../extensions/halftone-separations/src/separate.ts';
import type { Result } from '../../../extensions/halftone-separations/src/render.ts';
import { screenPlate, type Screen } from '../../../extensions/halftone-separations/src/screen.ts';
import { defaults } from '../../../extensions/halftone-separations/src/settings.ts';
import type { Rgb } from '../../../extensions/halftone-separations/src/inks.ts';

class FakeImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}
(globalThis as Record<string, unknown>).ImageData ??= FakeImageData;
class FakeChannel {
  port1: { onmessage: null | (() => void) } = { onmessage: null };
  port2 = { postMessage: () => setImmediate(() => this.port1.onmessage?.()) };
}
(globalThis as Record<string, unknown>).MessageChannel = FakeChannel;
(globalThis as Record<string, unknown>).window ??={ addEventListener: () => {}, parent: null };

const { Renderer, composite, scaled } = await import('../../../extensions/halftone-separations/src/render.ts');

const job = (): Job => ({ cancelled: false, progress: () => {} });

function solid(width: number, height: number, rgba: number[]): Picture {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

function pixels(width: number, height: number, list: number[][]): Picture {
  return { width, height, data: new Uint8ClampedArray(list.flat()) };
}

const cmyk = (pic: Picture, black: number, limit = 400) => separateCmyk(pic, black, limit, job(), 0, 1);
const firsts = (plates: Uint8Array[]) => plates.map((p) => p[0]);
const all = (plate: Uint8Array, value: number) => plate.every((v) => v === value);
const mean = (plate: Uint8Array) => plate.reduce((a, b) => a + b, 0) / plate.length / 255;

const WHITE: Rgb = [255, 255, 255];
const luts = new Map<string, Promise<Float32Array>>();
function lutFor(inks: Rgb[], paper: Rgb): Promise<Float32Array> {
  const key = JSON.stringify([inks, paper]);
  let hit = luts.get(key);
  if (!hit) {
    hit = spotLut(inks, paper, job(), 0, 1);
    luts.set(key, hit);
  }
  return hit;
}
async function spot(pic: Picture, inks: Rgb[], paper: Rgb = WHITE): Promise<Uint8Array[]> {
  return separateSpot(pic, await lutFor(inks, paper), inks.length, paper, job(), 0, 1);
}

const screen = (over: Partial<Screen> = {}): Screen => ({ angle: 0, lpi: 30, shape: 'round', density: 100, dx: 0, dy: 0, ...over });
function flat(width: number, height: number, value: number): Uint8Array {
  return new Uint8Array(width * height).fill(value);
}

test('cmyk gives four plates the size of the picture', async () => {
  const plates = await cmyk(solid(3, 2, [10, 200, 90, 255]), 1);
  assert.equal(plates.length, 4);
  for (const p of plates) assert.equal(p.length, 6);
});

test('cmyk leaves every plate empty for pure white', async () => {
  const plates = await cmyk(solid(2, 2, [255, 255, 255, 255]), 1);
  for (const p of plates) assert.ok(all(p, 0));
});

test('cmyk with full black generation puts pure black on the black plate only', async () => {
  const plates = await cmyk(solid(2, 2, [0, 0, 0, 255]), 1);
  assert.ok(all(plates[0], 0));
  assert.ok(all(plates[1], 0));
  assert.ok(all(plates[2], 0));
  assert.ok(all(plates[3], 255));
});

test('cmyk with no black generation prints pure black as full cyan magenta and yellow', async () => {
  const plates = await cmyk(solid(2, 2, [0, 0, 0, 255]), 0, 400);
  assert.deepEqual(firsts(plates), [255, 255, 255, 0]);
});

test('cmyk puts pure cyan magenta and yellow each on its own plate only', async () => {
  const pic = pixels(3, 1, [[0, 255, 255, 255], [255, 0, 255, 255], [255, 255, 0, 255]]);
  const plates = await cmyk(pic, 1);
  assert.deepEqual(Array.from(plates[0]), [255, 0, 0]);
  assert.deepEqual(Array.from(plates[1]), [0, 255, 0]);
  assert.deepEqual(Array.from(plates[2]), [0, 0, 255]);
  assert.deepEqual(Array.from(plates[3]), [0, 0, 0]);
});

test('cmyk prints pure red as magenta plus yellow with no black', async () => {
  const plates = await cmyk(solid(1, 1, [255, 0, 0, 255]), 1);
  assert.deepEqual(firsts(plates), [0, 255, 255, 0]);
});

test('cmyk with full black generation carries a mid grey on black alone', async () => {
  const plates = await cmyk(solid(2, 2, [128, 128, 128, 255]), 1);
  assert.deepEqual(firsts(plates), [0, 0, 0, 127]);
});

test('cmyk with no black generation carries a mid grey on equal cyan magenta and yellow', async () => {
  const plates = await cmyk(solid(2, 2, [128, 128, 128, 255]), 0);
  assert.deepEqual(firsts(plates), [127, 127, 127, 0]);
});

test('cmyk with half black generation splits a mid grey between black and colour', async () => {
  const plates = await cmyk(solid(1, 1, [128, 128, 128, 255]), 0.5);
  assert.deepEqual(firsts(plates), [109, 109, 109, 32]);
});

test('cmyk black equals one minus the brightest channel for a dark red', async () => {
  const plates = await cmyk(solid(1, 1, [128, 0, 0, 255]), 1);
  assert.deepEqual(firsts(plates), [0, 255, 255, 127]);
});

test('cmyk treats a fully transparent pixel as white paper', async () => {
  const plates = await cmyk(solid(2, 2, [0, 0, 0, 0]), 1);
  for (const p of plates) assert.ok(all(p, 0));
});

test('cmyk blends a half transparent black pixel with white paper', async () => {
  const plates = await cmyk(solid(1, 1, [0, 0, 0, 128]), 1);
  assert.deepEqual(firsts(plates), [0, 0, 0, 128]);
});

test('cmyk ink limit of 200 percent scales three full colour plates to two thirds', async () => {
  const plates = await cmyk(solid(1, 1, [0, 0, 0, 255]), 0, 200);
  assert.deepEqual(firsts(plates), [170, 170, 170, 0]);
});

test('cmyk ink limit trims colour plates and keeps the black plate', async () => {
  const plates = await cmyk(solid(1, 1, [128, 0, 0, 255]), 1, 200);
  const [c, m, y, k] = firsts(plates);
  assert.equal(c, 0);
  assert.equal(k, 127);
  assert.equal(m, y);
  assert.ok(m === 191 || m === 192, `magenta ${m}`);
  assert.ok(c + m + y + k <= 2 * 255 + 2);
});

test('cmyk ink limit leaves a picture under the limit untouched', async () => {
  const plates = await cmyk(solid(1, 1, [255, 0, 0, 255]), 1, 200);
  assert.deepEqual(firsts(plates), [0, 255, 255, 0]);
});

test('cmyk separation is the same on a second run', async () => {
  const pic = pixels(2, 2, [[12, 200, 77, 255], [240, 3, 150, 200], [90, 90, 10, 30], [0, 0, 0, 255]]);
  const a = await cmyk(pic, 0.6, 300);
  const b = await cmyk(pic, 0.6, 300);
  assert.deepEqual(a, b);
});

test('cmyk darker greys never get less black', async () => {
  const levels = [255, 224, 192, 160, 128, 96, 64, 32, 0];
  const pic = pixels(levels.length, 1, levels.map((v) => [v, v, v, 255]));
  const plates = await cmyk(pic, 0.6, 400);
  for (let i = 1; i < levels.length; i++) assert.ok(plates[3][i] >= plates[3][i - 1]);
  assert.equal(plates[3][0], 0);
  assert.equal(plates[3][levels.length - 1], 153);
});

test('spot separation gives one plate per ink at picture size', async () => {
  const plates = await spot(solid(3, 2, [40, 90, 200, 255]), [[31, 95, 174], [255, 79, 163]]);
  assert.equal(plates.length, 2);
  for (const p of plates) assert.equal(p.length, 6);
});

test('spot separation leaves white empty on white paper', async () => {
  const plates = await spot(solid(2, 2, [255, 255, 255, 255]), [[31, 95, 174], [255, 79, 163]]);
  for (const p of plates) assert.ok(all(p, 0));
});

test('spot separation with one black ink follows the darkness of the pixel', async () => {
  const pic = pixels(3, 1, [[0, 0, 0, 255], [128, 128, 128, 255], [255, 255, 255, 255]]);
  const [plate] = await spot(pic, [[0, 0, 0]]);
  assert.equal(plate[0], 255);
  assert.ok(Math.abs(plate[1] - 127) <= 1, `grey ${plate[1]}`);
  assert.equal(plate[2], 0);
});

test('spot separation sends a pixel of an ink colour to that ink only', async () => {
  const red: Rgb = [255, 0, 0];
  const blue: Rgb = [0, 0, 255];
  const pic = pixels(2, 1, [[255, 0, 0, 255], [0, 0, 255, 255]]);
  const plates = await spot(pic, [red, blue]);
  assert.deepEqual(Array.from(plates[0]), [255, 0]);
  assert.deepEqual(Array.from(plates[1]), [0, 255]);
});

test('spot separation picks the nearest ink for an in between colour', async () => {
  const pic = pixels(2, 1, [[255, 60, 0, 255], [0, 60, 255, 255]]);
  const plates = await spot(pic, [[255, 0, 0], [0, 0, 255]]);
  assert.ok(plates[0][0] > 180 && plates[1][0] < 30, `orange ${plates[0][0]} ${plates[1][0]}`);
  assert.ok(plates[1][1] > 180 && plates[0][1] < 30, `azure ${plates[0][1]} ${plates[1][1]}`);
});

test('spot separation overprints both inks for black', async () => {
  const plates = await spot(solid(1, 1, [0, 0, 0, 255]), [[255, 0, 0], [0, 0, 255]]);
  assert.deepEqual(firsts(plates), [255, 255]);
});

test('spot separation matches real blue and pink inks to their own plates', async () => {
  const pic = pixels(2, 1, [[31, 95, 174, 255], [255, 79, 163, 255]]);
  const plates = await spot(pic, [[31, 95, 174], [255, 79, 163]]);
  assert.ok(plates[0][0] > 215 && plates[1][0] < 40, `blue ${plates[0][0]} ${plates[1][0]}`);
  assert.ok(plates[1][1] > 215 && plates[0][1] < 40, `pink ${plates[0][1]} ${plates[1][1]}`);
});

test('spot separation counts transparent pixels as paper', async () => {
  const paper: Rgb = [246, 243, 236];
  const inks: Rgb[] = [[35, 35, 35], [229, 59, 59]];
  const clear = await spot(solid(2, 2, [0, 0, 0, 0]), inks, paper);
  const sheet = await spot(solid(2, 2, [246, 243, 236, 255]), inks, paper);
  assert.deepEqual(clear, sheet);
  for (const p of clear) assert.ok(p.every((v) => v <= 10), `paper coverage ${p[0]}`);
});

test('spot separation is the same on a second run', async () => {
  const pic = pixels(2, 2, [[12, 200, 77, 255], [240, 3, 150, 200], [90, 90, 10, 30], [0, 0, 0, 255]]);
  const inks: Rgb[] = [[31, 95, 174], [255, 79, 163]];
  const a = await spot(pic, inks);
  const b = await separateSpot(pic, await spotLut(inks, WHITE, job(), 0, 1), 2, WHITE, job(), 0, 1);
  assert.deepEqual(a, b);
});

test('spot lookup table holds coverage between zero and one for every node', async () => {
  const lut = await lutFor([[31, 95, 174], [255, 79, 163]], WHITE);
  assert.equal(lut.length, 21 * 21 * 21 * 2);
  assert.ok(lut.every((v) => v >= 0 && v <= 1));
});

test('a cancelled job rejects with Cancelled before any work', async () => {
  let calls = 0;
  const stopped: Job = { cancelled: true, progress: () => {} };
  await assert.rejects(bands(10, stopped, 0, 1, () => { calls++; }), Cancelled);
  assert.equal(calls, 0);
  await assert.rejects(separateCmyk(solid(2, 2, [0, 0, 0, 255]), 1, 300, stopped, 0, 1), Cancelled);
});

test('bands cover every row once and finish the progress span', async () => {
  const rows: number[] = [];
  const seen: number[] = [];
  await bands(150, { cancelled: false, progress: (f) => seen.push(f) }, 0.2, 0.25, (y0, y1) => {
    for (let y = y0; y < y1; y++) rows.push(y);
  });
  assert.deepEqual(rows, Array.from({ length: 150 }, (_, i) => i));
  assert.ok(Math.abs(seen[seen.length - 1] - 0.45) < 1e-9);
});

test('screen leaves an empty plate empty and a solid plate solid', async () => {
  const opts = { ppi: 300, hard: false };
  const none = await screenPlate(flat(20, 20, 0), 20, 20, screen(), opts, job(), 0, 1);
  const full = await screenPlate(flat(20, 20, 255), 20, 20, screen(), opts, job(), 0, 1);
  assert.equal(none.length, 400);
  assert.ok(all(none, 0));
  assert.ok(all(full, 255));
});

test('hard screen gives only ink or paper and a half tint covers about half', async () => {
  const out = await screenPlate(flat(40, 40, 128), 40, 40, screen(), { ppi: 300, hard: true }, job(), 0, 1);
  assert.ok(out.every((v) => v === 0 || v === 255));
  assert.ok(Math.abs(mean(out) - 0.5) < 0.05, `covered ${mean(out)}`);
});

test('smooth screen keeps the average tone of a half tint for every dot shape', async () => {
  for (const shape of ['round', 'ellipse', 'square', 'diamond', 'line', 'cross'] as const) {
    const out = await screenPlate(flat(40, 40, 128), 40, 40, screen({ shape }), { ppi: 300, hard: false }, job(), 0, 1);
    assert.ok(Math.abs(mean(out) - 0.5) < 0.06, `${shape} covered ${mean(out)}`);
  }
});

test('dot area grows with coverage', async () => {
  const levels = [0, 26, 51, 77, 102, 128, 153, 179, 204, 230, 255];
  const areas: number[] = [];
  for (const level of levels) {
    const out = await screenPlate(flat(40, 40, level), 40, 40, screen({ angle: 15 }), { ppi: 300, hard: true }, job(), 0, 1);
    areas.push(mean(out));
  }
  for (let i = 1; i < areas.length; i++) assert.ok(areas[i] > areas[i - 1], `${levels[i]} gave ${areas[i]} after ${areas[i - 1]}`);
  for (let i = 0; i < areas.length; i++) assert.ok(Math.abs(areas[i] - levels[i] / 255) < 0.06, `${levels[i]} gave ${areas[i]}`);
});

test('ink density of 50 percent halves a solid plate', async () => {
  const out = await screenPlate(flat(40, 40, 255), 40, 40, screen({ density: 50 }), { ppi: 300, hard: true }, job(), 0, 1);
  assert.ok(Math.abs(mean(out) - 0.5) < 0.05, `covered ${mean(out)}`);
});

test('misregister offset moves the plate by whole pixels', async () => {
  const cov = new Uint8Array(8 * 3);
  for (let y = 0; y < 3; y++) cov[y * 8 + 3] = 255;
  const out = await screenPlate(cov, 8, 3, screen({ dx: 2 }), { ppi: 300, hard: true }, job(), 0, 1);
  for (let y = 0; y < 3; y++) assert.deepEqual(Array.from(out.subarray(y * 8, y * 8 + 8)), [0, 0, 0, 0, 0, 255, 0, 0]);
});

test('screening is the same on a second run', async () => {
  const cov = Uint8Array.from({ length: 30 * 30 }, (_, i) => (i * 37) % 256);
  const a = await screenPlate(cov, 30, 30, screen({ angle: 75, shape: 'ellipse' }), { ppi: 300, hard: false }, job(), 0, 1);
  const b = await screenPlate(cov, 30, 30, screen({ angle: 75, shape: 'ellipse' }), { ppi: 300, hard: false }, job(), 0, 1);
  assert.deepEqual(a, b);
});

test('scaled returns the same picture at full size', () => {
  const pic = solid(2, 2, [1, 2, 3, 255]);
  assert.equal(scaled(pic, 1), pic);
});

test('renderer reports the picture size and process ink colours', async () => {
  const r = new Renderer(solid(4, 3, [255, 255, 255, 255]));
  assert.equal(r.width, 4);
  assert.equal(r.height, 3);
  const res = await r.run(defaults(), 1, 300, job());
  assert.equal(res.width, 4);
  assert.equal(res.height, 3);
  assert.equal(res.scale, 1);
  assert.deepEqual(res.inks, [[0, 163, 224], [226, 0, 122], [255, 229, 0], [29, 29, 27]]);
  assert.deepEqual(res.paper, [246, 243, 236]);
  assert.equal(res.plates.length, 4);
  for (const p of res.plates) assert.ok(p.length === 12 && all(p, 0));
});

test('renderer prints black on the black plate alone at full black generation', async () => {
  const s = { ...defaults(), blackGeneration: 100 };
  const res = await new Renderer(solid(4, 4, [0, 0, 0, 255])).run(s, 1, 300, job());
  assert.ok(all(res.plates[0], 0));
  assert.ok(all(res.plates[1], 0));
  assert.ok(all(res.plates[2], 0));
  assert.ok(all(res.plates[3], 255));
});

test('renderer in spot mode gives one plate per spot ink', async () => {
  const s = { ...defaults(), mode: 'spot' as const, paper: '#ffffff' };
  const res = await new Renderer(solid(2, 2, [255, 255, 255, 255])).run(s, 1, 300, job());
  assert.deepEqual(res.inks, [[31, 95, 174], [255, 79, 163]]);
  assert.equal(res.plates.length, 2);
  for (const p of res.plates) assert.ok(p.length === 4 && all(p, 0));
});

test('renderer follows a settings change between runs', async () => {
  const r = new Renderer(solid(2, 2, [0, 0, 0, 255]));
  const first = await r.run({ ...defaults(), blackGeneration: 100 }, 1, 300, job());
  assert.ok(all(first.plates[3], 255) && all(first.plates[0], 0));
  const second = await r.run({ ...defaults(), blackGeneration: 0, inkLimit: 400 }, 1, 300, job());
  assert.ok(all(second.plates[3], 0));
  assert.ok(all(second.plates[0], 255) && all(second.plates[1], 255) && all(second.plates[2], 255));
});

test('composite shows bare paper where no plate has ink', async () => {
  const r: Result = { width: 2, height: 1, scale: 1, inks: [[29, 29, 27]], paper: [246, 243, 236], plates: [new Uint8Array(2)] };
  const img = await composite(r, [true], job());
  assert.deepEqual(Array.from(img.data), [246, 243, 236, 255, 246, 243, 236, 255]);
});

test('composite shows the ink colour under a solid plate and paper when it is hidden', async () => {
  const r: Result = { width: 1, height: 1, scale: 1, inks: [[29, 29, 27]], paper: [246, 243, 236], plates: [Uint8Array.of(255)] };
  const shown = await composite(r, [true], job());
  assert.deepEqual(Array.from(shown.data), [29, 29, 27, 255]);
  const hidden = await composite(r, [false], job());
  assert.deepEqual(Array.from(hidden.data), [246, 243, 236, 255]);
});

test('composite multiplies overprinted inks on white paper', async () => {
  const r: Result = { width: 1, height: 1, scale: 1, inks: [[255, 0, 0], [0, 0, 255]], paper: [255, 255, 255], plates: [Uint8Array.of(255), Uint8Array.of(255)] };
  const both = await composite(r, [], job());
  assert.deepEqual(Array.from(both.data), [0, 0, 0, 255]);
  const redOnly = await composite(r, [true, false], job());
  assert.deepEqual(Array.from(redOnly.data), [255, 0, 0, 255]);
});
