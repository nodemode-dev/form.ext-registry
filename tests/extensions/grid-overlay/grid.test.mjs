import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPES,
  DEFAULTS,
  merge,
  hasCells,
  usesSize,
  pixelsPerUnit,
  borderPx,
  layout,
  triangleSide,
  colName,
  buildSvg,
  summary,
} from '../../../extensions/grid-overlay/src/grid.js';

const near = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not within ${eps} of ${expected}`);
const nearAll = (actual, expected, eps = 1e-6) => {
  assert.equal(actual.length, expected.length, `got ${actual.join(', ')}`);
  actual.forEach((v, i) => near(v, expected[i], eps));
};
const ps = (lines) => lines.map((l) => l.p);
const ks = (lines) => lines.map((l) => l.k);
const paths = (svg) => [...svg.matchAll(/<path d="([^"]*)" stroke-width="([^"]*)"/g)].map((m) => ({ d: m[1], w: Number(m[2]) }));
const square = (over = {}) => merge({ type: 'square', ...over });

test('rule of thirds lines sit at exactly one and two thirds', () => {
  const L = layout(merge({ type: 'thirds' }), 900, 600);
  nearAll(ps(L.xs), [300, 600]);
  nearAll(ps(L.ys), [200, 400]);
  assert.deepEqual(ks(L.xs), [1, 2]);
  assert.deepEqual(L.area, { x: 0, y: 0, w: 900, h: 600 });
  assert.equal(L.border, 0);
});

test('golden ratio lines sit at 0.382 and 0.618 of each side', () => {
  const L = layout(merge({ type: 'phi' }), 1000, 500);
  const small = (3 - Math.sqrt(5)) / 2;
  const large = (Math.sqrt(5) - 1) / 2;
  nearAll(ps(L.xs), [1000 * small, 1000 * large], 0.001);
  nearAll(ps(L.ys), [500 * small, 500 * large], 0.001);
  near(L.xs[0].p + L.xs[1].p, 1000, 1e-9);
});

test('a square canvas shares its thirds and a quarter turn swaps them between axes', () => {
  const sq = layout(merge({ type: 'thirds' }), 1200, 1200);
  assert.deepEqual(ps(sq.xs), ps(sq.ys));
  nearAll(ps(sq.xs), [400, 800]);
  const a = layout(merge({ type: 'thirds' }), 1600, 900);
  const b = layout(merge({ type: 'thirds' }), 900, 1600);
  nearAll(ps(a.xs), ps(b.ys), 1e-9);
  nearAll(ps(a.ys), ps(b.xs), 1e-9);
});

test('thirds with fractional pixels stay at exact thirds and mirror about the centre', () => {
  const L = layout(merge({ type: 'thirds' }), 1001, 667);
  nearAll(ps(L.xs), [1001 / 3, 2002 / 3], 1e-9);
  near(L.xs[0].p + L.xs[1].p, 1001, 1e-9);
  near(L.ys[0].p + L.ys[1].p, 667, 1e-9);
});

test('a border shrinks the area and the thirds follow the inner area', () => {
  const s = merge({ type: 'thirds', border: { on: true, width: 40 } });
  const L = layout(s, 900, 600);
  assert.deepEqual(L.area, { x: 40, y: 40, w: 820, h: 520 });
  nearAll(ps(L.xs), [40 + 820 / 3, 40 + 1640 / 3]);
  nearAll(ps(L.ys), [40 + 520 / 3, 40 + 1040 / 3]);
});

test('a border wider than half the short side is capped one pixel short of it', () => {
  const s = merge({ type: 'thirds', border: { on: true, width: 1000 } });
  const L = layout(s, 900, 600);
  assert.equal(L.border, 299);
  assert.deepEqual(L.area, { x: 299, y: 299, w: 302, h: 2 });
});

test('six square columns on 1200 by 800 give 200 pixel cells that add up to the full size', () => {
  const L = layout(square({ cols: 6, square: true }), 1200, 800);
  assert.deepEqual(ps(L.xs), [200, 400, 600, 800, 1000]);
  assert.deepEqual(ps(L.ys), [200, 400, 600]);
  assert.deepEqual(ks(L.xs), [1, 2, 3, 4, 5]);
  const edges = [0, ...ps(L.xs), 1200];
  const widths = edges.slice(1).map((v, i) => v - edges[i]);
  assert.deepEqual(widths, [200, 200, 200, 200, 200, 200]);
});

test('columns plus the border margins on both sides add up to the full width', () => {
  const s = square({ cols: 5, square: true, border: { on: true, width: 40 } });
  const L = layout(s, 1080, 680);
  assert.deepEqual(ps(L.xs), [240, 440, 640, 840]);
  assert.deepEqual(ps(L.ys), [240, 440]);
  const edges = [L.area.x, ...ps(L.xs), L.area.x + L.area.w];
  const cells = edges.slice(1).map((v, i) => v - edges[i]);
  assert.equal(cells.reduce((a, b) => a + b, 0) + 2 * L.border, 1080);
});

test('free rows and columns divide each side on its own', () => {
  const L = layout(square({ cols: 4, rows: 3, square: false }), 1000, 600);
  assert.deepEqual(ps(L.xs), [250, 500, 750]);
  assert.deepEqual(ps(L.ys), [200, 400]);
});

test('three columns over 1000 pixels give fractional lines that still add up', () => {
  const s = square({ cols: 3, rows: 3, square: false });
  const L = layout(s, 1000, 1000);
  nearAll(ps(L.xs), [1000 / 3, 2000 / 3], 1e-9);
  const svg = buildSvg(s, 1000, 1000);
  assert.ok(svg.includes('M333.33 0V1000M666.67 0V1000'));
});

test('a count of one, zero or below draws a single cell with no inner lines', () => {
  for (const cols of [1, 0, -3, NaN]) {
    const L = layout(square({ cols, rows: cols, square: false }), 1200, 800);
    assert.deepEqual(L.xs, [], `cols ${cols}`);
    assert.deepEqual(L.ys, [], `rows ${cols}`);
  }
  const two = layout(square({ cols: 2, rows: 1, square: false }), 1200, 800);
  assert.deepEqual(ps(two.xs), [600]);
  assert.deepEqual(two.ys, []);
});

test('a huge column count is capped at 500 columns', () => {
  const L = layout(square({ cols: 10000, square: true }), 1000, 10);
  assert.equal(L.xs.length, 499);
  assert.equal(L.xs[0].p, 2);
  assert.equal(L.xs.at(-1).p, 998);
  assert.deepEqual(ps(L.ys), [2, 4, 6, 8]);
});

test('print size rows step by exactly the cell size in pixels', () => {
  const s = square({ sizeMode: 'print', printWidth: 16, cellSize: 2 });
  assert.equal(pixelsPerUnit(s, 3200), 200);
  const L = layout(s, 3200, 2400);
  assert.deepEqual(ps(L.xs), [400, 800, 1200, 1600, 2000, 2400, 2800]);
  assert.deepEqual(ps(L.ys), [400, 800, 1200, 1600, 2000]);
});

test('print cells under half a pixel draw no lines at all', () => {
  const L = layout(square({ sizeMode: 'print', printWidth: 16, cellSize: 0.001 }), 320, 320);
  assert.deepEqual(L.xs, []);
  assert.deepEqual(L.ys, []);
});

test('print width sets pixels per unit and border width uses it only for sized grids', () => {
  assert.equal(pixelsPerUnit({ printWidth: 0 }, 3200), 32000);
  assert.equal(pixelsPerUnit({ printWidth: -4 }, 3200), 32000);
  assert.equal(pixelsPerUnit({ printWidth: 20000 }, 3200), 0.32);
  assert.equal(pixelsPerUnit({ printWidth: 10 }, 2540), 254);
  const sized = merge({ type: 'square', sizeMode: 'print', printWidth: 16, border: { on: true, width: 0.5 } });
  assert.equal(borderPx(sized, 3200), 100);
  const thirds = merge({ type: 'thirds', sizeMode: 'print', printWidth: 16, border: { on: true, width: 0.5 } });
  assert.equal(borderPx(thirds, 3200), 0.5);
  assert.equal(borderPx(merge({ border: { on: false, width: 80 } }), 3200), 0);
  assert.equal(borderPx(merge({ border: { on: true, width: -30 } }), 3200), 0);
});

test('a centred grid spreads the leftover evenly and mirrors its lines', () => {
  const L = layout(square({ cols: 6, square: true, center: true }), 1200, 900);
  assert.deepEqual(ps(L.ys), [50, 250, 450, 650, 850]);
  for (const p of ps(L.ys)) assert.ok(ps(L.ys).includes(900 - p));
  assert.deepEqual(ks(L.ys), [2, 1, 0, 1, 2]);
  assert.deepEqual(ks(L.xs), [2, 1, 0, 1, 2]);
});

test('a centred grid with an odd number of whole rows counts major lines symmetrically', { todo: 'defect: centred grid with an odd number of whole cells gives mirrored lines different major counts (k 2,1,0,1)' }, () => {
  const L = layout(square({ cols: 6, square: true, center: true }), 1200, 700);
  assert.deepEqual(ps(L.ys), [50, 250, 450, 650]);
  const k = ks(L.ys);
  assert.equal(k[0], k[3]);
  assert.equal(k[1], k[2]);
});

test('every line stays strictly inside the canvas across sizes and settings', () => {
  const sizes = [[640, 480], [1920, 1080], [1080, 1920], [4000, 50], [50, 4000], [333, 777], [2, 2]];
  const settings = [
    merge({ type: 'thirds' }),
    merge({ type: 'phi', border: { on: true, width: 30 } }),
    ...[1, 2, 5, 7, 12].flatMap((cols) => [square({ cols }), square({ cols, center: true }), square({ cols, rows: 3, square: false })]),
    square({ sizeMode: 'print', cellSize: 1.3, printWidth: 9 }),
  ];
  for (const [W, H] of sizes) {
    for (const s of settings) {
      const L = layout(s, W, H);
      for (const p of ps(L.xs)) assert.ok(p > 0 && p < W, `x ${p} outside ${W} for ${s.type}`);
      for (const p of ps(L.ys)) assert.ok(p > 0 && p < H, `y ${p} outside ${H} for ${s.type}`);
    }
  }
});

test('thirds on a strip one pixel tall keep their lines at exact thirds', { todo: 'defect: a canvas under 2 px on its short side gets a negative border, so the area spills outside the canvas and lines shift' }, () => {
  const L = layout(merge({ type: 'thirds' }), 1000, 1);
  assert.equal(L.border, 0);
  nearAll(ps(L.xs), [1000 / 3, 2000 / 3]);
  nearAll(ps(L.ys), [1 / 3, 2 / 3]);
});

test('a zero or negative size does not throw or produce NaN', () => {
  for (const [W, H] of [[0, 0], [-100, 50], [100, -50]]) {
    for (const type of Object.keys(TYPES)) {
      const svg = buildSvg(merge({ type }), W, H);
      assert.ok(svg.startsWith('<svg'));
      assert.ok(!svg.includes('NaN'), `${type} at ${W}x${H}`);
    }
  }
  assert.equal(summary(merge({ type: 'square' }), 0, 800), 'Square grid');
});

test('the thirds svg draws exactly the four lines with the default stroke', () => {
  const svg = buildSvg(merge({ type: 'thirds' }), 900, 600);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">'));
  assert.deepEqual(paths(svg), [{ d: 'M300 0V600M600 0V600M0 200H900M0 400H900', w: 3 }]);
  assert.ok(svg.includes('stroke="#000000" opacity="0.8"'));
  assert.ok(!svg.includes('clip-path'));
});

test('major lines are drawn heavier every nth square line but never on thirds', () => {
  const major = { on: true, every: 2, mult: 2.5 };
  const sq = paths(buildSvg(square({ cols: 6, square: true, major }), 1200, 800));
  assert.deepEqual(sq, [
    { d: 'M200 0V800M600 0V800M1000 0V800M0 200H1200M0 600H1200', w: 3 },
    { d: 'M400 0V800M800 0V800M0 400H1200', w: 7.5 },
  ]);
  const th = paths(buildSvg(merge({ type: 'thirds', major: { on: true, every: 1 } }), 900, 600));
  assert.equal(th.length, 1);
  assert.equal(th[0].w, 3);
});

test('stroke width and opacity are clamped to their ranges', () => {
  const w = (width) => paths(buildSvg(merge({ stroke: { width } }), 900, 600))[0].w;
  assert.equal(w(0), 0.25);
  assert.equal(w(-5), 0.25);
  assert.equal(w(1000), 500);
  assert.ok(buildSvg(merge({ stroke: { opacity: 0 } }), 900, 600).includes('opacity="0.02"'));
  assert.ok(buildSvg(merge({ stroke: { opacity: 5 } }), 900, 600).includes('opacity="1"'));
});

test('dashed and dotted styles scale their pattern with the stroke width', () => {
  assert.ok(buildSvg(merge({ stroke: { style: 'dashed', width: 3 } }), 900, 600).includes('stroke-dasharray="12 9"'));
  const dotted = buildSvg(merge({ stroke: { style: 'dotted', width: 4 } }), 900, 600);
  assert.ok(dotted.includes('stroke-dasharray="0 10" stroke-linecap="round"'));
});

test('border band, edge outline and colours are drawn and escaped', () => {
  const s = merge({
    type: 'thirds',
    edge: true,
    stroke: { color: '"><x', style: 'dashed' },
    border: { on: true, width: 40, color: '#ffffff' },
  });
  const svg = buildSvg(s, 900, 600);
  assert.ok(svg.includes('<path fill="#ffffff" fill-rule="evenodd" d="M0 0H900V600H0Z M40 40H860V560H40Z"/>'));
  assert.ok(svg.includes('<path d="M40 40H860V560H40Z" stroke-width="3"/>'));
  assert.ok(svg.includes('stroke="&quot;&gt;&lt;x"'));
  assert.ok(!svg.includes('"><x'));
});

test('diagonals cross every thirds cell corner to corner', () => {
  const svg = buildSvg(merge({ type: 'thirds', diagonals: true }), 900, 600);
  const diag = svg.match(/<g opacity="0.7"><path d="([^"]*)" stroke-width="([^"]*)"/);
  assert.ok(diag);
  assert.equal(diag[2], '1.8');
  assert.equal((diag[1].match(/L/g) ?? []).length, 18);
  assert.ok(diag[1].startsWith('M0 0L300 200M300 0L0 200'));
  assert.ok(diag[1].endsWith('M600 400L900 600M900 400L600 600'));
});

test('labels name columns by letter and rows by number inside the cells', () => {
  const svg = buildSvg(merge({ type: 'thirds', labels: true }), 900, 600);
  assert.ok(svg.includes('font-size="28"'));
  const texts = [...svg.matchAll(/<text x="([^"]*)" y="([^"]*)"[^>]*>([^<]*)<\/text>/g)].map((m) => [m[3], Number(m[1]), Number(m[2])]);
  assert.deepEqual(texts, [
    ['A', 9.8, 9.8],
    ['B', 309.8, 9.8],
    ['C', 609.8, 9.8],
    ['1', 9.8, 42],
    ['2', 9.8, 209.8],
    ['3', 9.8, 409.8],
  ]);
});

test('labels move into a wide border and contrast with its colour', () => {
  const svg = buildSvg(merge({ type: 'thirds', labels: true, border: { on: true, width: 100, color: '#ffffff' } }), 1100, 800);
  const texts = [...svg.matchAll(/<text x="([^"]*)" y="([^"]*)"[^>]*>([^<]*)<\/text>/g)].map((m) => [m[3], Number(m[1]), Number(m[2])]);
  assert.deepEqual(texts, [
    ['A', 250, 50],
    ['B', 550, 50],
    ['C', 850, 50],
    ['1', 50, 200],
    ['2', 50, 400],
    ['3', 50, 600],
  ]);
  assert.ok(svg.includes('font-size="28" fill="#000000">'));
});

test('the triangular grid rows step by the triangle height and are clipped to the area', () => {
  const area = { x: 0, y: 0, w: 1200, h: 600 };
  assert.equal(triangleSide(merge({ type: 'triangle', cols: 6 }), 1200, area), 200);
  assert.equal(triangleSide(merge({ type: 'triangle', cols: 0 }), 1200, area), 1200);
  assert.equal(triangleSide(merge({ type: 'triangle', sizeMode: 'print', printWidth: 16, cellSize: 2 }), 3200, area), 400);
  const svg = buildSvg(merge({ type: 'triangle', cols: 6 }), 1200, 600);
  const d = paths(svg)[0].d;
  assert.ok(d.startsWith('M0 173.21H1200M0 346.41H1200M0 519.62H1200M'));
  assert.ok(!d.includes('H1200M0 692.82'));
  assert.ok(svg.includes('<clipPath id="a"><rect x="0" y="0" width="1200" height="600"/></clipPath>'));
  assert.ok(svg.includes('clip-path="url(#a)"'));
});

test('radial spokes start at the centre and the centre cross is heavier', () => {
  const svg = buildSvg(merge({ type: 'radial', radial: { spokes: 4, rings: 2 } }), 800, 600);
  const [minor, major] = paths(svg);
  assert.ok(minor.d.startsWith('M400 300L1400 300M400 300L400 1300M400 300L-600 300M400 300L400 -700'));
  assert.ok(minor.d.includes('M250 300a150 150 0 1 0 300 0a150 150 0 1 0 -300 0'));
  assert.ok(minor.d.includes('M100 300a300 300 0 1 0 600 0a300 300 0 1 0 -600 0'));
  assert.deepEqual(major, { d: 'M400 0V600M0 300H800', w: 4.8 });
  const spokes = (n) => (paths(buildSvg(merge({ type: 'radial', radial: { spokes: n } }), 800, 600))[0].d.match(/M400 300L/g) ?? []).length;
  assert.equal(spokes(1), 2);
  assert.equal(spokes(8), 8);
  assert.equal(spokes(1000), 360);
});

test('column names run A to Z then AA onwards', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colName), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('merge fills defaults, keeps nested sections and rejects unknown types', () => {
  const m = merge({ type: 'bogus', stroke: { width: 9 }, major: { on: true } });
  assert.equal(m.type, 'thirds');
  assert.deepEqual(m.stroke, { width: 9, color: '#000000', opacity: 0.8, style: 'solid' });
  assert.deepEqual(m.major, { on: true, every: 4, mult: 2.5 });
  assert.deepEqual(merge(undefined), DEFAULTS);
  m.border.width = 1;
  assert.equal(DEFAULTS.border.width, 40);
});

test('cell types and sized types are told apart', () => {
  assert.deepEqual(Object.keys(TYPES).filter(hasCells), ['thirds', 'square', 'phi']);
  assert.deepEqual(Object.keys(TYPES).filter(usesSize), ['square', 'triangle']);
});

test('summary describes each grid type', () => {
  assert.equal(summary(square({ cols: 6, square: true }), 1200, 800), 'Square grid, 6 × 4');
  assert.equal(summary(square({ cols: 6, square: true }), 1200, 700), 'Square grid, 6 × 4');
  assert.equal(summary(square({ cols: 4, rows: 3, square: false }), 1000, 600), 'Square grid, 4 × 3');
  assert.equal(summary(square({ cols: 5, border: { on: true, width: 40 } }), 1080, 680), 'Square grid, 5 × 3');
  assert.equal(summary(square({ sizeMode: 'print', cellSize: 2, unit: 'cm' }), 1200, 800), 'Square grid, 2 cm cells');
  assert.equal(summary(merge({ type: 'triangle', cols: 6 }), 1200, 800), 'Triangular, 6 across');
  assert.equal(summary(merge({ type: 'radial' }), 1200, 800), 'Radial, 8 spokes');
  assert.equal(summary(merge({ type: 'phi' }), 1200, 800), 'Golden ratio');
});

test('summary reports the counts the drawing actually uses', { todo: 'defect: summary shows raw cols and spokes (0 x 0, 1 spoke) while layout and buildSvg clamp them to 1 column and 2 spokes' }, () => {
  assert.equal(summary(square({ cols: 0, square: true }), 1200, 800), 'Square grid, 1 × 1');
  assert.equal(summary(merge({ type: 'radial', radial: { spokes: 1 } }), 1200, 800), 'Radial, 2 spokes');
});
