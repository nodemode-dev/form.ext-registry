import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBox,
  grow,
  isPath,
  pathBox,
  polylineLength,
  round,
  segments,
  simplify,
  smooth,
  toBezier,
} from '../../../extensions/handwriting-reveal/src/geometry.ts';
import { DEFAULTS, progressAt, schedule } from '../../../extensions/handwriting-reveal/src/timing.ts';

type P = [number, number];

const g = globalThis as any;
g.window ??= { addEventListener() {}, parent: null };
function fakeEl(): any {
  return {
    attrs: {} as Record<string, string>,
    style: {} as Record<string, string>,
    kids: [] as any[],
    setAttribute(k: string, v: string) { this.attrs[k] = String(v); },
    replaceChildren() { this.kids = []; },
    appendChild(c: any) { this.kids.push(c); },
  };
}
g.document ??= { createElementNS: () => fakeEl() };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => {};

const failing = (err: unknown): any => new Proxy({}, { get: (_, k) => { if (k === 'then') return undefined; throw err; } });
const tryImport = (p: string): Promise<any> => import(p).catch(failing);
const opsMod = await tryImport('../../../extensions/handwriting-reveal/src/ops.ts');
const docMod = await tryImport('../../../extensions/handwriting-reveal/src/document.ts');
const previewMod = await tryImport('../../../extensions/handwriting-reveal/src/preview.ts');

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const z = (pts: P[]) => pts.map((p) => [p[0] + 0, p[1] + 0]);

function stroke(length: number, points: P[] = [[0, 0], [length, 0]], extra: Record<string, unknown> = {}) {
  return { points, closed: false, dot: false, halfWidth: 3, medianHalf: 2, length, ...extra };
}

function settings(o: Record<string, unknown> = {}) {
  return { ...DEFAULTS, duration: 3, lift: 0.2, letterGap: 0.5, ...o } as any;
}

function letter(lengths: number[], spaceBefore = false) {
  return { char: 'a', spaceBefore, strokes: lengths.map((l) => stroke(l)) } as any;
}

const spans = (timed: { t0: number; t1: number }[]) => timed.map((t) => [t.t0, t.t1]);

function nearSpans(actual: number[][], expected: number[][]) {
  assert.equal(actual.length, expected.length);
  actual.forEach((pair, i) => {
    near(pair[0], expected[i][0]);
    near(pair[1], expected[i][1]);
  });
}

test('path length of a 3 4 5 triangle is 7 open and 12 closed, empty and single point paths have no length', () => {
  const tri: P[] = [[0, 0], [3, 0], [3, 4]];
  assert.equal(polylineLength(tri, false), 7);
  assert.equal(polylineLength(tri, true), 12);
  assert.equal(polylineLength([], false), 0);
  assert.equal(polylineLength([[4, 4]], true), 0);
  assert.equal(polylineLength([[0, 0], [3, 4]], true), 5);
});

test('simplifying a straight line with many points leaves only its two ends', () => {
  const line: P[] = Array.from({ length: 11 }, (_, i) => [i, i] as P);
  assert.deepEqual(simplify(line, 0.5), [[0, 0], [10, 10]]);
});

test('simplifying an L shape keeps the corner', () => {
  const pts: P[] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
  assert.deepEqual(simplify(pts, 0.5), [[0, 0], [10, 0], [10, 10]]);
});

test('simplification never moves the first and last point and never adds points', () => {
  const pts: P[] = Array.from({ length: 40 }, (_, i) => [i * 2, ((i * 7) % 5) - 2 + Math.sin(i)] as P);
  for (const tol of [0, 0.3, 1, 3, 100]) {
    const out = simplify(pts, tol);
    assert.ok(out.length <= pts.length);
    assert.deepEqual(out[0], pts[0]);
    assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
    for (const p of out) assert.ok(pts.includes(p));
  }
});

test('simplifying fewer than three points returns an equal copy', () => {
  for (const pts of [[], [[1, 2]], [[0, 0], [5, 5]]] as P[][]) {
    const out = simplify(pts, 1);
    assert.deepEqual(out, pts);
    assert.notEqual(out, pts);
  }
});

test('the tolerance decides whether a small bump survives simplification', () => {
  const bump: P[] = [[0, 0], [5, 1], [10, 0]];
  assert.deepEqual(simplify(bump, 0.5), bump);
  assert.deepEqual(simplify(bump, 2), [[0, 0], [10, 0]]);
});

test('smoothing an open path keeps both ends and pulls the middle in', () => {
  const pts: P[] = [[0, 0], [5, 10], [10, 0]];
  assert.deepEqual(smooth(pts, false, 1), [[0, 0], [5, 5], [10, 0]]);
  assert.deepEqual(smooth(pts, false), [[0, 0], [5, 2.5], [10, 0]]);
  assert.deepEqual(pts, [[0, 0], [5, 10], [10, 0]]);
  const two: P[] = [[0, 0], [3, 3]];
  assert.deepEqual(smooth(two, false), two);
});

test('smoothing a closed square pulls every corner inward', () => {
  const sq: P[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(smooth(sq, true, 1), [[2.5, 2.5], [7.5, 2.5], [7.5, 7.5], [2.5, 7.5]]);
});

test('bounds of a set of points start empty and grow to cover every point', () => {
  const b = emptyBox();
  assert.ok(!isFinite(b.x0) && !isFinite(b.x1));
  for (const p of [[3, -1], [-2, 4], [0, 0]] as P[]) grow(b, p);
  assert.deepEqual(b, { x0: -2, y0: -1, x1: 3, y1: 4 });
});

test('path bounds include the curve handles and a single vertex path adds nothing', () => {
  const p = { vertices: [[0, 0], [10, 0]] as P[], in: [[0, 0], [0, 5]] as P[], out: [[0, -5], [0, 0]] as P[], closed: false };
  assert.deepEqual(pathBox([p]), { x0: 0, y0: -5, x1: 10, y1: 5 });
  const single = { vertices: [[4, 4]] as P[], in: [], out: [], closed: true };
  assert.ok(!isFinite(pathBox([single]).x0));
  assert.ok(!isFinite(pathBox([]).x0));
});

test('segments join neighbours, closed paths add the way back, and isPath checks vertices', () => {
  const p = { vertices: [[0, 0], [10, 0], [10, 10]] as P[], in: [] as P[], out: [] as P[], closed: false };
  assert.deepEqual(segments(p), [
    [[0, 0], [0, 0], [10, 0], [10, 0]],
    [[10, 0], [10, 0], [10, 10], [10, 10]],
  ]);
  const closed = segments({ ...p, closed: true });
  assert.equal(closed.length, 3);
  assert.deepEqual(closed[2][3], [0, 0]);
  assert.equal(segments({ ...p, vertices: [[1, 1]] }).length, 0);
  assert.equal(isPath({ vertices: [[0, 0]] }), true);
  assert.equal(isPath(null), false);
  assert.equal(isPath({}), false);
  assert.equal(isPath({ vertices: [[0]] }), false);
});

test('a smooth curve through points has flat ends and handles a sixth of the neighbours apart', () => {
  const open = toBezier([[0, 0], [6, 0], [12, 6]], false);
  assert.deepEqual(open.vertices, [[0, 0], [6, 0], [12, 6]]);
  assert.deepEqual(z(open.out), [[0, 0], [2, 1], [0, 0]]);
  assert.deepEqual(z(open.in), [[0, 0], [-2, -1], [0, 0]]);
  const closed = toBezier([[0, 0], [6, 0], [6, 6], [0, 6]], true);
  assert.deepEqual(closed.out[0], [1, -1]);
  assert.deepEqual(closed.in[0], [-1, 1]);
  assert.equal(closed.closed, true);
  const r = round({ vertices: [[1.23456, 7.891011]], in: [[1.6, 2.4]], out: [[0.004, 9.999]], closed: false }, 2);
  assert.deepEqual(r.vertices, [[1.23, 7.89]]);
  assert.deepEqual(r.out, [[0, 10]]);
  assert.deepEqual(round({ vertices: [[1.6, 2.4]], in: [], out: [], closed: false }, 0).vertices, [[2, 2]]);
});

test('no letters or letters without strokes give an empty schedule', () => {
  assert.deepEqual(schedule([], settings(), 100), []);
  assert.deepEqual(schedule([letter([]), letter([])], settings(), 100), []);
});

test('a single stroke fills the whole duration', () => {
  nearSpans(spans(schedule([letter([10], true)], settings(), 100)), [[0, 3]]);
});

test('two equal strokes in one letter split the time around a pen lift', () => {
  nearSpans(spans(schedule([letter([10, 10])], settings(), 100)), [[0, 1.4], [1.6, 3]]);
});

test('the gap between letters is the letter gap, doubled at a space, and strokes keep their letter', () => {
  nearSpans(spans(schedule([letter([10]), letter([10])], settings(), 100)), [[0, 1.25], [1.75, 3]]);
  const spaced = schedule([letter([10]), letter([]), letter([10], true)], settings(), 100);
  nearSpans(spans(spaced), [[0, 1], [2, 3]]);
  assert.deepEqual(spaced.map((t) => t.letter), [0, 2]);
});

test('longer strokes are given more time and equal strokes equal time', () => {
  const t = schedule([letter([5, 10, 20, 20])], settings({ lift: 0 }), 1000);
  const d = t.map((x) => x.t1 - x.t0);
  assert.ok(d[0] < d[1] && d[1] < d[2]);
  near(d[2], d[3], 1e-3 + 1e-9);
  near(d.reduce((a, b) => a + b, 0), 3, 4e-3);
});

test('gaps shrink when they would leave less than 35 percent of the duration for drawing', () => {
  const t = schedule([letter([10]), letter([10]), letter([10])], settings({ duration: 1 }), 100);
  nearSpans(spans(t), [[0, 0.12], [0.44, 0.56], [0.88, 1]]);
});

test('a zero length stroke still lasts one frame', () => {
  const t = schedule([{ char: 'i', spaceBefore: false, strokes: [stroke(0, [[5, 5]]), stroke(10)] } as any], settings(), 100);
  near(t[0].t0, 0);
  near(t[0].t1 - t[0].t0, 0.01);
  assert.ok(t[1].t0 >= t[0].t1);
});

test('a total of zero gives each stroke one frame, back to back', () => {
  const t = schedule([letter([10, 10])], settings({ duration: 0, lift: 0.06 }), 100);
  nearSpans(spans(t), [[0, 0.01], [0.01, 0.02]]);
});

test('every stroke time lands on a frame and strokes never overlap', () => {
  const t = schedule([letter([3, 17]), letter([40], true), letter([1, 1, 9])], settings({ duration: 2.3 }), 24);
  let last = 0;
  for (const x of t) {
    for (const v of [x.t0, x.t1]) near(v * 24, Math.round(v * 24), 1e-6);
    assert.ok(x.t1 > x.t0);
    assert.ok(x.t0 >= last - 1e-9);
    last = x.t1;
  }
  near(last, 2.3, 1 / 24 + 1e-9);
});

test('stroke progress runs from 0 to 1 and ease bends it without moving the middle', () => {
  const span = { stroke: stroke(1), letter: 0, t0: 1, t1: 3 } as any;
  assert.equal(progressAt(span, 0.5, 45), 0);
  assert.equal(progressAt(span, 1, 45), 0);
  assert.equal(progressAt(span, 3, 45), 1);
  assert.equal(progressAt(span, 9, 45), 1);
  near(progressAt(span, 1.5, 0), 0.25);
  near(progressAt(span, 1.5, 100), 0.15625);
  near(progressAt(span, 1.5, 50), 0.184375);
  near(progressAt(span, 1.5, 500), 0.15625);
  near(progressAt(span, 1.5, -20), 0.25);
  for (const e of [0, 30, 100]) near(progressAt(span, 2, e), 0.5);
});

const textLayer = { id: 7, index: 1, name: 'Title', type: 'Text', in: 0, out: 10, selected: true, parent: null };
const twoStrokes = [
  { stroke: stroke(10, [[0, 0], [6, 0], [12, 6]]), letter: 0, t0: 0, t1: 1 },
  { stroke: stroke(5, [[0, 0], [0, 5]]), letter: 0, t0: 1.2, t1: 3 },
] as any[];
const findOps = (ops: any[], command: string) => ops.filter((o) => o.command === command);

test('the write on makes a shape layer named after the text layer and parented to it', () => {
  const ops = opsMod.buildOps(textLayer, undefined, twoStrokes, settings(), 2);
  assert.deepEqual(ops[0], { command: 'layer.newShape', args: { kind: 'none', name: 'Title Handwriting' } });
  assert.deepEqual(ops[1], { command: 'layer.setParent', args: { layers: ['$1.layer'], parent: 7 } });
  const tf = findOps(ops, 'layer.setTransform').map((o) => [o.args.prop, o.args.value]);
  assert.deepEqual(tf, [['anchor', [0, 0]], ['position', [0, 0]], ['scale', [100, 100]], ['rotation', 0]]);
  assert.deepEqual(ops[ops.length - 1], { command: 'layer.select', args: { layers: ['$1.layer'] } });
});

test('writing on again clears the previous handwriting layer first', () => {
  const prev = { ...textLayer, id: 9, type: 'Shape', name: 'Title Handwriting', parent: 7 };
  const ops = opsMod.buildOps(textLayer, prev, twoStrokes, settings(), 0);
  assert.deepEqual(ops[0], { command: 'edit.clear', args: { layers: [9] } });
  assert.equal(ops[1].command, 'layer.newShape');
  for (const o of ops.slice(2)) {
    const ref = o.args.layer ?? o.args.layers?.[0];
    if (typeof ref === 'string') assert.equal(ref, '$2.layer');
  }
});

test('each stroke gets its own Pen group with a stroke, a path and a trim', () => {
  const ops = opsMod.buildOps(textLayer, undefined, twoStrokes, settings(), 0);
  const groups = ops
    .map((o: any, i: number) => ({ o, ref: `$${i + 1}.uid` }))
    .filter(({ o }: any) => o.command === 'shape.add' && o.args.kind === 'group');
  assert.equal(groups.length, 2);
  const names = findOps(ops, 'prop.renameGroup').map((o) => o.args.name).sort();
  assert.deepEqual(names, ['Pen 1', 'Pen 2']);
  for (const { ref } of groups) {
    const kinds = ops.filter((o: any) => o.command === 'shape.add' && o.args.group === ref).map((o: any) => o.args.kind);
    assert.deepEqual(kinds, ['stroke', 'path', 'trim']);
    assert.equal(findOps(ops, 'prop.renameGroup').filter((o) => o.args.prop === ref).length, 1);
  }
  const paths = findOps(ops, 'shape.add').filter((o) => o.args.kind === 'path').map((o) => o.args.path.vertices);
  assert.deepEqual(paths.sort((a: any, b: any) => a.length - b.length), [[[0, 0], [0, 5]], [[0, 0], [6, 0], [12, 6]]]);
});

test('the trim end of each pen is keyed from 0 to 100 at the start time plus the stroke times, with clamped ease', () => {
  const ops = opsMod.buildOps(textLayer, undefined, twoStrokes, settings({ ease: 150 }), 2);
  const keys = findOps(ops, 'prop.addKey').map((o) => [o.args.time, o.args.value]).sort((a, b) => a[0] - b[0]);
  assert.equal(keys.length, 4);
  nearSpans(keys, [[2, 0], [3, 100], [3.2, 0], [5, 100]]);
  for (const o of findOps(ops, 'prop.addKey')) assert.match(o.args.path, /\/end$/);
  const eases = findOps(ops, 'keys.setEase');
  assert.equal(eases.length, 4);
  for (const o of eases) assert.equal(o.args.influence, 100);
  assert.equal(eases.filter((o) => o.args.side === 'out').length, 2);
  const low = findOps(opsMod.buildOps(textLayer, undefined, twoStrokes, settings({ ease: 0 }), 2), 'keys.setEase');
  for (const o of low) assert.equal(o.args.influence, 0.1);
});

test('reveal mode draws round capped white strokes and uses them as the alpha matte of the text', () => {
  const ops = opsMod.buildOps(textLayer, undefined, twoStrokes, settings({ mode: 'reveal', ink: '#ff0000' }), 0);
  const sets = findOps(ops, 'prop.set');
  for (const end of ['/cap', '/join']) for (const o of sets.filter((s) => s.args.path.endsWith(end))) assert.equal(o.args.value, 1);
  assert.equal(sets.filter((s) => s.args.path.endsWith('/cap')).length, 2);
  for (const o of sets.filter((s) => s.args.path.endsWith('/color'))) assert.equal(o.args.value, '#ffffff');
  assert.deepEqual(findOps(ops, 'layer.setTrackMatte'), [{ command: 'layer.setTrackMatte', args: { layer: 7, matte: '$1.layer', kind: 'alpha' } }]);
  assert.deepEqual(findOps(ops, 'layer.setSwitch'), [{ command: 'layer.setSwitch', args: { layers: [7], switch: 'video', value: true } }]);
});

test('ink mode draws in the ink colour and hides the text layer', () => {
  const ops = opsMod.buildOps(textLayer, undefined, twoStrokes, settings({ mode: 'ink', ink: '#ff0000' }), 0);
  for (const o of findOps(ops, 'prop.set').filter((s) => s.args.path.endsWith('/color'))) assert.equal(o.args.value, '#ff0000');
  assert.deepEqual(findOps(ops, 'layer.setTrackMatte')[0].args, { layer: 7, matte: null });
  const sw = findOps(ops, 'layer.setSwitch').map((o) => [o.args.layers[0], o.args.value]);
  assert.deepEqual(sw, [[7, false], ['$1.layer', true]]);
});

test('stroke width covers the letter in reveal mode and follows the ink settings in ink mode', () => {
  const t = (halfWidth: number, medianHalf = 2) => ({ stroke: stroke(1, [[0, 0], [1, 0]], { halfWidth, medianHalf }), letter: 0, t0: 0, t1: 1 }) as any;
  assert.equal(opsMod.strokeWidth(t(3), settings({ mode: 'reveal' })), 8);
  assert.equal(opsMod.strokeWidth(t(10), settings({ mode: 'reveal' })), 25);
  assert.equal(opsMod.strokeWidth(t(3), settings({ mode: 'ink', inkWidth: 4 })), 4);
  near(opsMod.strokeWidth(t(3, 2), settings({ mode: 'ink', inkWidth: 0 })), 3.6);
  assert.equal(opsMod.strokeWidth(t(3, 0.2), settings({ mode: 'ink', inkWidth: 0 })), 1);
  const ops = opsMod.buildOps(textLayer, undefined, [t(3.333)], settings({ mode: 'reveal' }), 0);
  const width = findOps(ops, 'prop.set').find((s) => s.args.path.endsWith('/width'));
  assert.equal(width!.args.value, 8.67);
});

test('text layers are picked out and an existing handwriting layer is found only under its own text', () => {
  const rows = [
    textLayer,
    { ...textLayer, id: 8, name: 'Logo', type: 'Shape' },
    { ...textLayer, id: 9, name: 'Title Handwriting', type: 'Shape', parent: 7 },
    { ...textLayer, id: 10, name: 'Title Handwriting', type: 'Shape', parent: 3 },
  ];
  const summary = { revision: 1, comp: null, time: 0, layers: rows, selection: { layers: [] } };
  assert.deepEqual(docMod.textLayers(summary).map((l: any) => l.id), [7]);
  assert.equal(docMod.existingFor(summary, textLayer)?.id, 9);
  assert.equal(docMod.existingFor({ ...summary, layers: rows.slice(0, 2) }, textLayer), undefined);
});

test('glyphs are read from the contents group, spaces are named and empty groups dropped', () => {
  const path = { vertices: [[0, 0], [1, 1]], in: [], out: [], closed: false };
  const nodes = [
    { path: 'transform', name: 'Transform', uid: 1, group: true, children: [] },
    {
      path: 'contents', name: 'Contents', uid: 2, group: true, children: [
        { path: 'a', name: 'H', uid: 3, group: true, children: [{ path: 'b', name: 'Path 1', uid: 4, type: 'path', value: path }] },
        { path: 'c', name: 'Space', uid: 5, group: true, children: [{ path: 'd', name: 'Path 1', uid: 6, type: 'path', value: path }] },
        { path: 'e', name: 'x', uid: 7, children: [{ path: 'f', name: 'Path 1', uid: 8, type: 'path', value: path }] },
        { path: 'g', name: 'e', uid: 9, group: true, children: [{ path: 'h', name: 'Bad', uid: 10, type: 'path', value: { vertices: 'no' } }] },
      ],
    },
  ];
  const glyphs = docMod.glyphsFromTree(nodes as any);
  assert.deepEqual(glyphs.map((x: any) => x.char), ['H', ' ']);
  assert.deepEqual(glyphs[0].paths, [path]);
});

test('spacing marks the glyphs that follow a space but never the first one', () => {
  const glyphs = [...'Hithere'].map((char) => ({ char, paths: [] }));
  assert.deepEqual(docMod.spacing('Hi there', glyphs), [false, false, true, false, false, false, false]);
  assert.deepEqual(docMod.spacing('  ab', [...'ab'].map((char) => ({ char, paths: [] }))), [false, false]);
});

test('the preview fits the view to the letters and its playhead stays within the writing time', () => {
  const els = Array.from({ length: 6 }, fakeEl);
  const pv = new previewMod.Preview(...(els as [any, any, any, any, any, any]));
  const times: number[] = [];
  pv.onTime = (t: number) => times.push(t);
  const timed = [
    { stroke: stroke(10, [[0, 0], [100, 0]]), letter: 0, t0: 0, t1: 1 },
    { stroke: stroke(10, [[0, 0], [0, 50]]), letter: 0, t0: 1.5, t1: 2 },
  ] as any[];
  pv.show([], timed, settings({ mode: 'ink' }));
  assert.equal(pv.total, 2);
  assert.equal(els[0].attrs.viewBox, '-8 -8 116 66');
  assert.equal(els[4].kids.length, 2);
  assert.equal(els[3].kids.length, 0);
  pv.seek(-5);
  assert.equal(times[times.length - 1], 0);
  assert.equal(els[4].kids[0].style.visibility, 'hidden');
  pv.seek(1.25);
  assert.equal(els[4].kids[0].attrs['stroke-dashoffset'], '0.0000');
  assert.equal(els[4].kids[1].style.visibility, 'hidden');
  pv.seek(99);
  assert.equal(times[times.length - 1], 2);
  assert.equal(els[4].kids[1].attrs['stroke-dashoffset'], '0.0000');
});

test('the preview clears itself when there is nothing to show', () => {
  const els = Array.from({ length: 6 }, fakeEl);
  const pv = new previewMod.Preview(...(els as [any, any, any, any, any, any]));
  pv.show([], [], settings());
  assert.equal(pv.total, 0);
  assert.equal(els[1].attrs.d, '');
  assert.equal(pv.isPlaying(), false);
});
