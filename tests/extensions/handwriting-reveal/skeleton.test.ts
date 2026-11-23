import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as geometry from '../../../extensions/handwriting-reveal/src/geometry.ts';

const sourceUrl = new URL('../../../extensions/handwriting-reveal/src/skeleton.ts', import.meta.url);
const importLine = "import { Box, Pt, ShapePath, pathBox, polylineLength, simplify, smooth, traceInto } from './geometry';";
const raw = readFileSync(sourceUrl, 'utf8');
assert.ok(raw.includes(importLine));
(globalThis as any).__skeletonGeometry = geometry;
const js = stripTypeScriptTypes(
  raw.replace(importLine, 'const { pathBox, polylineLength, simplify, smooth, traceInto } = globalThis.__skeletonGeometry;'),
  { mode: 'transform' },
);
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const thin: (r: any) => Uint8Array = mod.thin;
const distance: (r: any) => Float64Array = mod.distance;
const traceGlyph: (paths: any[], opts: { scale: number }) => any[] = mod.traceGlyph;

const PAD = 2;

function grid(rows: string[]) {
  const w = rows[0].length + PAD * 2;
  const h = rows.length + PAD * 2;
  const ink = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === '#') ink[(y + PAD) * w + x + PAD] = 1;
    });
  });
  return { w, h, ink, box: { x0: 0, y0: 0, x1: w, y1: h }, scale: 1, pad: 0 };
}

function mirror(rows: string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}

function pixels(img: Uint8Array, w: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < img.length; i++) if (img[i]) out.push([(i % w) - PAD, Math.floor(i / w) - PAD]);
  return out;
}

function pieces(img: Uint8Array, w: number, h: number, value: number, diagonal: boolean): number {
  const seen = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || (img[i] ? 1 : 0) !== value) continue;
    n++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!diagonal && dx && dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!seen[q] && (img[q] ? 1 : 0) === value) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
  }
  return n;
}

function neighbourCount(img: Uint8Array, w: number, i: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && img[i + dy * w + dx]) n++;
  return n;
}

function ends(img: Uint8Array, w: number): number {
  let n = 0;
  for (let i = 0; i < img.length; i++) if (img[i] && neighbourCount(img, w, i) === 1) n++;
  return n;
}

const BAR = Array(3).fill('#########');
const ELL = [...Array(8).fill('###........'), ...Array(3).fill('###########')];
const RING = [...Array(3).fill('###########'), ...Array(5).fill('###.....###'), ...Array(3).fill('###########')];
const PLUS = [...Array(6).fill('......###......'), ...Array(3).fill('###############'), ...Array(6).fill('......###......')];
const TWO = Array(7).fill('###...###');
const ALL: Record<string, string[]> = { BAR, ELL, RING, PLUS, TWO };

test('a thick horizontal bar thins to one line along its middle row', () => {
  const r = grid(BAR);
  const px = pixels(thin(r), r.w);
  assert.ok(px.length >= 5 && px.length <= 9);
  for (const [, y] of px) assert.equal(y, 1);
  const xs = px.map((p) => p[0]).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.equal(xs[i], xs[i - 1] + 1);
});

test('a thinned bar has exactly two ends', () => {
  const r = grid(BAR);
  assert.equal(ends(thin(r), r.w), 2);
});

test('a thick vertical bar thins to one line along its middle column', () => {
  const r = grid(Array(9).fill('###'));
  const px = pixels(thin(r), r.w);
  assert.ok(px.length >= 5 && px.length <= 9);
  for (const [x] of px) assert.equal(x, 1);
});

test('a thick L keeps one corner and two ends', () => {
  const r = grid(ELL);
  const sk = thin(r);
  assert.equal(ends(sk, r.w), 2);
  assert.equal(pieces(sk, r.w, r.h, 1, true), 1);
  const px = pixels(sk, r.w);
  assert.ok(px.some(([x, y]) => x === 1 && y === 2));
  assert.ok(px.some(([x, y]) => x === 7 && y === 9));
  for (const [x, y] of px) assert.ok(x === 1 || y === 9);
});

test('a ring stays a closed loop with no ends', () => {
  const r = grid(RING);
  const sk = thin(r);
  assert.equal(ends(sk, r.w), 0);
  assert.equal(pieces(sk, r.w, r.h, 1, true), 1);
  assert.equal(pieces(sk, r.w, r.h, 0, false), 2);
});

test('a plus sign keeps one junction with four arms', () => {
  const r = grid(PLUS);
  const sk = thin(r);
  assert.equal(ends(sk, r.w), 4);
  assert.equal(pieces(sk, r.w, r.h, 1, true), 1);
  for (const [x, y] of pixels(sk, r.w)) assert.ok(x === 7 || y === 7);
  assert.equal(sk[(7 + PAD) * r.w + 7 + PAD], 1);
});

test('a single pixel is kept as it is', () => {
  const r = grid(['#']);
  assert.deepEqual(pixels(thin(r), r.w), [[0, 0]]);
});

test('an empty bitmap thins to an empty bitmap', () => {
  const r = grid(['....', '....']);
  assert.equal(thin(r).reduce((a, b) => a + b, 0), 0);
});

test('a bitmap with no pixels at all does not fail', () => {
  const out = thin({ w: 0, h: 0, ink: new Uint8Array(0), box: { x0: 0, y0: 0, x1: 0, y1: 0 }, scale: 1, pad: 0 });
  assert.equal(out.length, 0);
});

test('two separate bars thin to two separate lines', () => {
  const r = grid(TWO);
  const sk = thin(r);
  assert.equal(pieces(sk, r.w, r.h, 1, true), 2);
  for (const [x] of pixels(sk, r.w)) assert.ok(x === 1 || x === 7);
});

test('thinning does not change the input bitmap', () => {
  const r = grid(PLUS);
  const copy = r.ink.slice();
  thin(r);
  assert.deepEqual(r.ink, copy);
});

for (const [name, rows] of Object.entries(ALL)) {
  test(`the skeleton of ${name} only uses pixels of the shape`, () => {
    const r = grid(rows);
    const sk = thin(r);
    for (let i = 0; i < sk.length; i++) if (sk[i]) assert.equal(r.ink[i], 1);
    assert.ok(sk.reduce((a, b) => a + b, 0) < r.ink.reduce((a, b) => a + b, 0));
  });

  test(`the skeleton of ${name} keeps the number of connected pieces`, () => {
    const r = grid(rows);
    const sk = thin(r);
    assert.equal(pieces(sk, r.w, r.h, 1, true), pieces(r.ink, r.w, r.h, 1, true));
    assert.equal(pieces(sk, r.w, r.h, 0, false), pieces(r.ink, r.w, r.h, 0, false));
  });

  test(`thinning the skeleton of ${name} again changes nothing`, () => {
    const r = grid(rows);
    const sk = thin(r);
    assert.deepEqual(thin({ ...r, ink: sk }), sk);
  });
}

test('a bar and its mirror image thin to the same line', () => {
  const a = grid(BAR);
  const b = grid(mirror(BAR));
  assert.deepEqual(thin(a), thin(b));
});

test('a mirrored L thins to a line in the mirrored column', { todo: 'defect: thinning is not mirror symmetric, the corner of a mirrored L is cut diagonally' }, () => {
  const r = grid(mirror(ELL));
  const sk = thin(r);
  assert.equal(ends(sk, r.w), 2);
  for (const [x, y] of pixels(sk, r.w)) assert.ok(x === 9 || y === 9);
});

test('distance is zero outside the shape and grows toward the middle', () => {
  const r = grid(BAR);
  const d = distance(r);
  assert.equal(d[0], 0);
  assert.equal(d[(0 + PAD) * r.w + 4 + PAD], 1);
  assert.equal(d[(1 + PAD) * r.w + 4 + PAD], 2);
  assert.equal(d[(2 + PAD) * r.w + 4 + PAD], 1);
});

test('distance of a single pixel is one', () => {
  const r = grid(['#']);
  assert.equal(distance(r)[PAD * r.w + PAD], 1);
});

class FakeCanvas {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  getContext() {
    const { w, h } = this;
    let polys: number[][][] = [];
    let cur: number[][] = [];
    const data = new Uint8ClampedArray(w * h * 4);
    return {
      fillStyle: '',
      clearRect() {},
      beginPath() {
        polys = [];
      },
      moveTo(x: number, y: number) {
        cur = [[x, y]];
        polys.push(cur);
      },
      bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) {
        cur.push([x, y]);
      },
      closePath() {},
      fill() {
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            let wn = 0;
            for (const p of polys)
              for (let i = 0; i < p.length; i++) {
                const a = p[i];
                const b = p[(i + 1) % p.length];
                const cross = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
                if (a[1] <= py && b[1] > py && cross > 0) wn++;
                else if (a[1] > py && b[1] <= py && cross < 0) wn--;
              }
            data[(y * w + x) * 4 + 3] = wn ? 255 : 0;
          }
      },
      getImageData() {
        return { data };
      },
    };
  }
}

function rect(x0: number, y0: number, x1: number, y1: number, reverse = false) {
  const v = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return { vertices: reverse ? v.reverse() : v, in: [], out: [], closed: true };
}

before(() => {
  (globalThis as any).OffscreenCanvas = FakeCanvas;
});

after(() => {
  delete (globalThis as any).OffscreenCanvas;
  delete (globalThis as any).__skeletonGeometry;
});

test('tracing no paths gives no strokes', () => {
  assert.deepEqual(traceGlyph([], { scale: 1 }), []);
});

test('tracing a shape with no height gives no strokes', () => {
  assert.deepEqual(traceGlyph([rect(0, 0, 40, 0)], { scale: 1 }), []);
});

test('tracing a wide bar gives one open stroke from left to right along the middle', () => {
  const s = traceGlyph([rect(0, 0, 40, 10)], { scale: 1 });
  assert.equal(s.length, 1);
  assert.equal(s[0].closed, false);
  assert.equal(s[0].dot, false);
  const pts = s[0].points;
  assert.ok(pts[0][0] < pts[pts.length - 1][0]);
  assert.ok(pts[0][0] >= 0 && pts[0][0] <= 8);
  assert.ok(pts[pts.length - 1][0] >= 32 && pts[pts.length - 1][0] <= 40);
  for (const p of pts) assert.ok(Math.abs(p[1] - 5) <= 0.6);
  assert.equal(s[0].halfWidth, 5);
  assert.ok(s[0].length >= 24 && s[0].length <= 40);
});

test('tracing a tall bar gives one stroke from top to bottom', () => {
  const s = traceGlyph([rect(0, 0, 10, 40)], { scale: 1 });
  assert.equal(s.length, 1);
  const pts = s[0].points;
  assert.ok(pts[0][1] < pts[pts.length - 1][1]);
  for (const p of pts) assert.ok(Math.abs(p[0] - 5) <= 0.6);
});

test('tracing at double scale reports the same half width in layer units', () => {
  const s = traceGlyph([rect(0, 0, 40, 10)], { scale: 2 });
  assert.equal(s.length, 1);
  assert.equal(s[0].halfWidth, 5);
  for (const p of s[0].points) assert.ok(Math.abs(p[1] - 5) <= 0.6);
});

test('tracing two separate bars gives two strokes ordered left to right', () => {
  const s = traceGlyph([rect(0, 0, 6, 40), rect(30, 0, 36, 40)], { scale: 1 });
  assert.equal(s.length, 2);
  for (const p of s[0].points) assert.ok(Math.abs(p[0] - 3) <= 0.6);
  for (const p of s[1].points) assert.ok(Math.abs(p[0] - 33) <= 0.6);
});

test('tracing a ring gives one closed stroke that stays inside the band', () => {
  const s = traceGlyph([rect(0, 0, 40, 40), rect(6, 6, 34, 34, true)], { scale: 1 });
  assert.equal(s.length, 1);
  assert.equal(s[0].closed, true);
  for (const [x, y] of s[0].points) {
    assert.ok(x >= 0 && x <= 40 && y >= 0 && y <= 40);
    assert.ok(!(x > 6 && x < 34 && y > 6 && y < 34));
  }
});

test('tracing a plus sign gives two crossing strokes', () => {
  const s = traceGlyph([rect(17, 0, 23, 40), rect(0, 17, 40, 23)], { scale: 1 });
  assert.equal(s.length, 2);
  for (const st of s) assert.equal(st.closed, false);
  const spans = s.map((st) => {
    const a = st.points[0];
    const b = st.points[st.points.length - 1];
    return Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 'across' : 'down';
  });
  assert.deepEqual(spans.sort(), ['across', 'down']);
});

test('tracing a small square gives one dot', () => {
  const s = traceGlyph([rect(0, 0, 6, 6)], { scale: 1 });
  assert.equal(s.length, 1);
  assert.equal(s[0].dot, true);
  assert.equal(s[0].points.length, 2);
  for (const [x, y] of s[0].points) assert.ok(x >= 0 && x <= 6 && y >= 0 && y <= 6);
});
