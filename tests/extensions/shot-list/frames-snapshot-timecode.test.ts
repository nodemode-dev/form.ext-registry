import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { timecode, shortDuration, rateLabel } from '../../../extensions/shot-list/src/timecode.ts';
import { toBoard, numberShots, mediaIndex } from '../../../extensions/shot-list/src/snapshot.ts';

let frames: any;

before(async () => {
  (globalThis as any).window = {
    addEventListener() {},
    parent: { postMessage() {} },
    setTimeout: globalThis.setTimeout,
  };
  frames = await import('../../../extensions/shot-list/src/frames.ts');
});

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

function clip(id: string, start: number, duration: number, over: Record<string, unknown> = {}): any {
  return { id, kind: 'video', start, duration, ...over };
}

function snap(tracks: any[], over: Record<string, unknown> = {}): any {
  return { projectId: 'p1', title: 'Film', timelines: [{ id: 't1', name: 'Main', fps: 24, width: 1920, height: 1080, tracks }], activeTimeline: 0, ...over };
}

function shotOf(over: Record<string, unknown> = {}): any {
  return { key: 'k', clipId: 'c1', number: 1, name: 'A', kind: 'video', track: 'V1', trackIndex: 0, start: 0, duration: 4, sourceIn: 10, speed: 1, mediaId: 'm1', markerNotes: [], ...over };
}

function picked(name: string, type = '', text = 'abc'): any {
  return { name, type, size: text.length, data: btoa(text) };
}

test('timecode counts frames, seconds, minutes and hours at common rates', () => {
  {
  for (const fps of [24, 25, 30]) assert.equal(timecode(0, fps), '00:00:00:00');
  }
  {
  assert.equal(timecode(1, 24), '00:00:01:00');
  }
  {
  assert.equal(timecode(0.04, 25), '00:00:00:01');
  assert.equal(timecode(1.48, 25), '00:00:01:12');
  assert.equal(timecode(0.96, 25), '00:00:00:24');
  }
  {
  assert.equal(timecode(23 / 24, 24), '00:00:00:23');
  assert.equal(timecode(1 - 1 / 30, 30), '00:00:00:29');
  assert.equal(timecode(1, 30), '00:00:01:00');
  }
  {
  for (const fps of [24, 25, 30]) assert.equal(timecode(3600, fps), '01:00:00:00');
  }
  {
  assert.equal(timecode(61.5, 30), '00:01:01:15');
  assert.equal(timecode(3661, 25), '01:01:01:00');
  assert.equal(timecode(7325, 24), '02:02:05:00');
  }
});

test('timecode with fractional rates, negative seconds and odd rates', () => {
  {
  assert.equal(timecode(1, 23.976), '00:00:01:00');
  assert.equal(timecode(10, 23.976), '00:00:10:00');
  assert.equal(timecode(1, 29.97), '00:00:01:00');
  assert.equal(timecode(60, 29.97), '00:00:59:28');
  }
  {
  assert.equal(timecode(-5, 24), '00:00:00:00');
  assert.equal(timecode(-0.001, 25), '00:00:00:00');
  }
  {
  assert.equal(timecode(5, 0), '00:00:00:00');
  assert.equal(timecode(5, -24), '00:00:00:00');
  }
});

test('timecode of NaN seconds is a clean zero timecode', { todo: 'defect: NaN seconds print as NaN:NaN:NaN:NaN' }, () => {
  assert.equal(timecode(NaN, 25), '00:00:00:00');
});

test('timecode of infinite seconds contains no NaN', { todo: 'defect: Infinity seconds print NaN fields' }, () => {
  assert.doesNotMatch(timecode(Infinity, 25), /NaN|Infinity/);
});

test('shortDuration shows short and long forms and clamps negatives', () => {
  {
  assert.equal(shortDuration(0, 25), '0:00');
  assert.equal(shortDuration(2, 25), '2:00');
  assert.equal(shortDuration(1.2, 25), '1:05');
  }
  {
  assert.equal(shortDuration(75, 25), '1:15:00');
  assert.equal(shortDuration(61.04, 25), '1:01:01');
  assert.equal(shortDuration(3600, 25), '60:00:00');
  }
  {
  assert.equal(shortDuration(-3, 24), '0:00');
  }
});

test('rateLabel prints whole and fractional rates', () => {
  {
  assert.equal(rateLabel(24), '24 fps');
  assert.equal(rateLabel(30), '30 fps');
  }
  {
  assert.equal(rateLabel(23.976), '23.976 fps');
  assert.equal(rateLabel(29.97), '29.97 fps');
  assert.equal(rateLabel(25.5), '25.5 fps');
  assert.equal(rateLabel(23.9764), '23.976 fps');
  }
});

test('shots keep timeline order, get numbered from 1 and numbering leaves the input alone', () => {
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('c', 5, 1), clip('a', 0, 2), clip('b', 2, 3)] }]));
  const numbered = numberShots(board.shots);
  assert.deepEqual(numbered.map((s) => s.clipId), ['a', 'b', 'c']);
  assert.deepEqual(numbered.map((s) => s.number), [1, 2, 3]);
  }
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 0, 1), clip('b', 1, 1)] }]));
  const numbered = numberShots(board.shots);
  assert.deepEqual(board.shots.map((s) => s.number), [0, 0]);
  assert.deepEqual(numbered.map((s) => s.number), [1, 2]);
  assert.notEqual(numbered[0], board.shots[0]);
  }
});

test('shots keep start, duration and end for single, touching, overlapping, gapped and tied clips', () => {
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 1.5, 2.25)] }]));
  const s = board.shots[0];
  assert.equal(s.start, 1.5);
  assert.equal(s.duration, 2.25);
  near(s.start + s.duration, 3.75);
  assert.equal(board.duration, 3.75);
  }
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 0, 2), clip('b', 2, 2)] }]));
  assert.equal(board.shots.length, 2);
  assert.equal(board.shots[0].start + board.shots[0].duration, board.shots[1].start);
  assert.equal(board.duration, 4);
  }
  {
  const board = toBoard(snap([
    { name: 'V1', clips: [clip('a', 0, 3)] },
    { name: 'V2', clips: [clip('b', 2, 3)] },
  ]));
  assert.deepEqual(board.shots.map((s) => s.clipId), ['a', 'b']);
  assert.equal(board.duration, 5);
  }
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 0, 1), clip('b', 3, 1)] }]));
  assert.equal(board.shots.length, 2);
  assert.equal(board.duration, 4);
  }
  {
  const board = toBoard(snap([
    { name: 'V1', clips: [clip('low', 0, 2)] },
    { name: 'V2', clips: [clip('high', 0, 2)] },
  ]));
  assert.deepEqual(board.shots.map((s) => s.clipId), ['low', 'high']);
  assert.deepEqual(board.shots.map((s) => s.trackIndex), [0, 1]);
  }
});

test('an empty timeline and missing input give an empty board with defaults', () => {
  {
  const board = toBoard(snap([]));
  assert.deepEqual(board.shots, []);
  assert.deepEqual(board.tracks, []);
  assert.equal(board.duration, 0);
  assert.equal(board.timeline, 'Main');
  }
  {
  for (const raw of [undefined, null, {}]) {
    const board = toBoard(raw);
    assert.deepEqual(board.shots, []);
    assert.equal(board.fps, 25);
    assert.equal(board.width, 1920);
    assert.equal(board.height, 1080);
    assert.equal(board.title, 'Untitled');
    assert.equal(board.timeline, 'Timeline');
    assert.equal(board.duration, 0);
  }
  }
});

test('a zero length clip stays and a negative duration is clamped to zero', () => {
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 2, 0), clip('b', 3, 1)] }]));
  assert.equal(board.shots.length, 2);
  assert.equal(board.shots[0].duration, 0);
  assert.equal(board.shots[0].start, 2);
  }
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 1, -4)] }]));
  assert.equal(board.shots[0].duration, 0);
  assert.equal(board.duration, 1);
  }
});

test('shot and track names fall back to media name, kind and position', () => {
  {
  const board = toBoard(snap([{ name: 'V1', clips: [
    clip('a', 0, 1, { label: 'Opening', mediaId: 'm1' }),
    clip('b', 1, 1, { mediaId: 'm1' }),
    clip('c', 2, 1, { kind: 'image' }),
    clip('d', 3, 1, { label: '', mediaId: 'missing' }),
  ] }], { media: [{ id: 'm1', name: 'beach.mp4' }] }));
  assert.deepEqual(board.shots.map((s) => s.name), ['Opening', 'beach.mp4', 'image', 'video']);
  }
  {
  const board = toBoard(snap([
    { name: 'Main', clips: [clip('a', 0, 1)] },
    { clips: [clip('b', 1, 1)] },
  ]));
  assert.deepEqual(board.tracks.map((t) => t.name), ['Main', 'Track 2']);
  assert.equal(board.shots[1].track, 'Track 2');
  }
});

test('audio clips and clips without an id are left out', () => {
  const board = toBoard(snap([{ name: 'A1', clips: [
    clip('a', 0, 1, { kind: 'audio' }),
    { kind: 'video', start: 1, duration: 1 },
    clip('b', 2, 1, { kind: 'text', label: 'Title' }),
  ] }]));
  assert.deepEqual(board.shots.map((s) => s.clipId), ['b']);
  assert.equal(board.tracks[0].shots, 1);
});

test('marker notes inside a shot are kept with the start inside and the end outside', () => {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 2, 2)] }], {
    timelines: [{ id: 't1', name: 'Main', fps: 24, tracks: [{ name: 'V1', clips: [clip('a', 2, 2)] }], markers: [
      { t: 1.99, note: 'before' },
      { t: 2, note: '  at start  ' },
      { t: 3, note: 'middle' },
      { t: 3.5, note: '   ' },
      { t: 4, note: 'at end' },
    ] }],
  }));
  assert.deepEqual(board.shots[0].markerNotes, ['at start', 'middle']);
});

test('the shot key and text of a shot follow the clip fields', () => {
  {
  const board = toBoard(snap([{ name: 'V1', clips: [
    clip('a', 0, 1, { mediaId: 'm1', sourceIn: 1.23456 }),
    clip('b', 1, 1),
  ] }]));
  assert.equal(board.shots[0].key, 'm1@1.235');
  assert.equal(board.shots[1].key, 'b@0.000');
  }
  {
  const board = toBoard(snap([{ name: 'T', clips: [
    clip('a', 0, 1, { kind: 'text', text: 'one', label: 'x' }),
    clip('b', 1, 1, { kind: 'text', textStyle: { content: 'two' }, label: 'x' }),
    clip('c', 2, 1, { kind: 'text', label: 'three' }),
    clip('d', 3, 1),
  ] }]));
  assert.deepEqual(board.shots.map((s) => s.text), ['one', 'two', 'three', undefined]);
  }
});

test('a clip frame wins over the media frame and plain strings are ignored', () => {
  const board = toBoard(snap([{ name: 'V1', clips: [
    clip('a', 0, 1, { mediaId: 'm1', frame: 'data:image/png;base64,AAA' }),
    clip('b', 1, 1, { mediaId: 'm1' }),
    clip('c', 2, 1, { mediaId: 'm2', frame: 'http://x/y.png' }),
  ] }], { media: [{ id: 'm1', name: 'a.mp4', thumbnail: 'data:image/jpeg;base64,BBB' }, { id: 'm2', name: 'b.mp4' }] }));
  assert.deepEqual(board.shots.map((s) => s.frame), ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB', undefined]);
});

test('speed of zero falls back to one and a rate of zero falls back to 25', () => {
  const raw = snap([{ name: 'V1', clips: [clip('a', 0, 1, { speed: 0 }), clip('b', 1, 1, { speed: 2 })] }]);
  raw.timelines[0].fps = 0;
  const board = toBoard(raw);
  assert.deepEqual(board.shots.map((s) => s.speed), [1, 2]);
  assert.equal(board.fps, 25);
});

test('the active timeline is found by index, by id and by activeTimelineId', () => {
  const timelines = [
    { id: 'x', name: 'First', tracks: [{ clips: [clip('a', 0, 1)] }] },
    { id: 'y', name: 'Second', tracks: [{ clips: [clip('b', 0, 1)] }] },
  ];
  assert.equal(toBoard({ timelines, activeTimeline: 1 }).timeline, 'Second');
  assert.equal(toBoard({ timelines, activeTimeline: 'y' }).timeline, 'Second');
  assert.equal(toBoard({ timelines, activeTimelineId: 'y' }).timeline, 'Second');
  assert.equal(toBoard({ timelines }).timeline, 'First');
});

test('selection, project duration and media index are read from the snapshot', () => {
  {
  const base = snap([{ name: 'V1', clips: [clip('a', 0, 1), clip('b', 1, 1)] }]);
  assert.deepEqual(toBoard({ ...base, selection: ['a', 7, 'b'] }).selected, ['a', 'b']);
  assert.deepEqual(toBoard({ ...base, selection: { clipIds: ['a'], clipId: 'a' } }).selected, ['a']);
  assert.deepEqual(toBoard({ ...base, selection: { clipIds: ['a'], clipId: 'b' } }).selected, ['a', 'b']);
  }
  {
  const board = toBoard(snap([{ name: 'V1', clips: [clip('a', 0, 2)] }], { duration: 10 }));
  assert.equal(board.duration, 10);
  }
  {
  const index = mediaIndex({ media: [{ id: 'm1', name: 'a.mp4', width: 1280 }, { id: 'm2' }, { name: 'no id' }, null] });
  assert.deepEqual([...index.keys()], ['m1', 'm2']);
  assert.equal(index.get('m1')!.width, 1280);
  assert.equal(index.get('m2')!.name, 'm2');
  assert.equal(index.get('m2')!.kind, 'video');
  }
});

test('the source time follows the position, speed, zero length and short shots', () => {
  {
  near(frames.sourceTime(shotOf(), 'middle', 25), 12);
  near(frames.sourceTime(shotOf({ speed: 2 }), 'middle', 25), 14);
  near(frames.sourceTime(shotOf({ speed: 0.5 }), 'middle', 25), 11);
  }
  {
  near(frames.sourceTime(shotOf(), 'first', 25), 10.02);
  near(frames.sourceTime(shotOf(), 'last', 25), 13.96);
  near(frames.sourceTime(shotOf({ speed: 2 }), 'last', 25), 17.96);
  }
  {
  for (const position of ['first', 'middle', 'last']) near(frames.sourceTime(shotOf({ duration: 0 }), position, 25), 10);
  }
  {
  near(frames.sourceTime(shotOf({ duration: 0.01 }), 'first', 25), 10.005);
  near(frames.sourceTime(shotOf({ duration: 0.01 }), 'last', 25), 10);
  }
  {
  near(frames.sourceTime(shotOf(), 'last', 0), 13);
  }
});

test('the frame chosen for each shot of a snapshot lies inside the shot', () => {
  const board = toBoard(snap([{ name: 'V1', clips: [
    clip('a', 0, 2, { mediaId: 'm1', sourceIn: 5 }),
    clip('b', 2, 0.02, { mediaId: 'm1', sourceIn: 0 }),
    clip('c', 3, 6, { mediaId: 'm2', sourceIn: 1.5, speed: 2 }),
    clip('d', 9, 0, { mediaId: 'm2', sourceIn: 3 }),
  ] }]));
  for (const s of numberShots(board.shots)) {
    const end = s.sourceIn + s.duration * s.speed;
    for (const position of ['first', 'middle', 'last']) {
      const t = frames.sourceTime(s, position, board.fps);
      assert.ok(t >= s.sourceIn - 1e-9 && t <= end + 1e-9, `${s.clipId} ${position} ${t} outside ${s.sourceIn}..${end}`);
    }
    if (s.duration > 0) assert.ok(frames.sourceTime(s, 'last', board.fps) < end);
  }
});

test('frameKey follows the kind, the position and the source start', () => {
  {
  assert.equal(frames.frameKey(shotOf({ kind: 'text', text: 'Hello' }), 'middle', 25), 'text:c1:Hello');
  assert.equal(frames.frameKey(shotOf({ kind: 'text' }), 'middle', 25), 'text:c1:');
  }
  {
  const s = shotOf({ kind: 'image' });
  assert.equal(frames.frameKey(s, 'first', 25), 'img:m1');
  assert.equal(frames.frameKey(s, 'last', 25), 'img:m1');
  assert.equal(frames.frameKey(shotOf({ kind: 'image', mediaId: undefined }), 'first', 25), 'img:c1');
  }
  {
  assert.equal(frames.frameKey(shotOf(), 'middle', 25), 'm1@12.000');
  assert.equal(frames.frameKey(shotOf(), 'last', 25), 'm1@13.960');
  assert.equal(frames.frameKey(shotOf({ mediaId: undefined }), 'middle', 25), 'c1@12.000');
  }
  {
  const a = frames.frameKey(shotOf(), 'first', 25);
  const b = frames.frameKey(shotOf(), 'last', 25);
  const c = frames.frameKey(shotOf({ sourceIn: 20 }), 'first', 25);
  assert.equal(new Set([a, b, c]).size, 3);
  }
});

test('addFiles sorts files by extension or type and replaces a file added twice', () => {
  {
  const store = new frames.FrameStore();
  const result = store.addFiles([picked('a.MP4'), picked('b.png'), picked('c.bin', 'video/webm'), picked('d.bin', 'image/jpeg'), picked('e.txt', 'text/plain')]);
  assert.deepEqual(result.added, ['a.MP4', 'b.png', 'c.bin', 'd.bin']);
  assert.deepEqual(result.skipped, ['e.txt']);
  assert.equal(store.sourceCount(), 4);
  }
  {
  const store = new frames.FrameStore();
  store.addFiles([picked('clip.mp4')]);
  store.addFiles([picked('CLIP.mp4')]);
  assert.equal(store.sourceCount(), 1);
  }
});

test('sourceFor matches by name, then by stem, and finds nothing for unknown names', () => {
  {
  const store = new frames.FrameStore();
  store.addFiles([picked('Beach.MP4')]);
  assert.equal(store.sourceFor(shotOf({ mediaName: 'C:\\media\\beach.mp4', name: 'x' }))?.name, 'Beach.MP4');
  assert.equal(store.sourceFor(shotOf({ mediaName: 'a/b/BEACH.mp4', name: 'x' }))?.name, 'Beach.MP4');
  }
  {
  const store = new frames.FrameStore();
  store.addFiles([picked('beach.mp4'), picked('city.mov')]);
  assert.equal(store.sourceFor(shotOf({ mediaName: undefined, name: 'beach.mp4' }))?.name, 'beach.mp4');
  assert.equal(store.sourceFor(shotOf({ mediaName: 'city.webm', name: 'x' }))?.name, 'city.mov');
  }
  {
  const store = new frames.FrameStore();
  store.addFiles([picked('beach.mp4')]);
  assert.equal(store.sourceFor(shotOf({ mediaName: 'forest.mp4', name: 'forest' })), undefined);
  assert.equal(store.sourceFor(shotOf({ mediaName: undefined, name: '' })), undefined);
  }
});

test('the store hands back stored frames and sizes and has no jpeg for an unknown key', async () => {
  {
  const store = new frames.FrameStore();
  const frame = { canvas: {}, w: 640, h: 360 };
  assert.equal(store.has('k'), false);
  assert.equal(store.get('k'), undefined);
  store.set('k', frame);
  assert.equal(store.has('k'), true);
  assert.equal(store.get('k'), frame);
  assert.deepEqual([...store.sizes()], [['k', { w: 640, h: 360 }]]);
  }
  {
  const store = new frames.FrameStore();
  assert.equal(await store.jpeg('nope'), undefined);
  }
});

test('extract with a cancelled signal reports zero progress and throws Cancelled', async () => {
  const store = new frames.FrameStore();
  store.addFiles([picked('beach.png')]);
  const calls: number[][] = [];
  const jobs = [
    { key: 'k1', shot: shotOf({ mediaName: 'beach.png' }), time: 1 },
    { key: 'k1', shot: shotOf({ mediaName: 'beach.png' }), time: 1 },
    { key: 'k2', shot: shotOf({ mediaName: 'beach.png' }), time: 2 },
  ];
  await assert.rejects(store.extract(jobs, { cancelled: true }, (d: number, t: number) => calls.push([d, t])), frames.Cancelled);
  assert.deepEqual(calls, [[0, 2]]);
});

test('extract skips keys already stored and shots without a source', async () => {
  const store = new frames.FrameStore();
  store.addFiles([picked('beach.png')]);
  store.set('have', { canvas: {}, w: 1, h: 1 });
  const calls: number[][] = [];
  const result = await store.extract([
    { key: 'have', shot: shotOf({ mediaName: 'beach.png' }), time: 1 },
    { key: 'lost', shot: shotOf({ mediaName: 'gone.png', name: 'gone' }), time: 1 },
  ], { cancelled: true }, (d: number, t: number) => calls.push([d, t]));
  assert.deepEqual(result, { made: 0, failed: [] });
  assert.deepEqual(calls, [[0, 0]]);
});
