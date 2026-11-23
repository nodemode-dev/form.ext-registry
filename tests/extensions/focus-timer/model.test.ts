import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catchUp,
  clampSetting,
  elapsed,
  endsAt,
  entriesOn,
  finish,
  focusMinutes,
  fresh,
  idleRun,
  left,
  pause,
  prune,
  reset,
  revive,
  sessions,
  start,
  week,
} from '../../../extensions/focus-timer/src/model.ts';
import type { Entry, State } from '../../../extensions/focus-timer/src/model.ts';
import { chime } from '../../../extensions/focus-timer/src/chime.ts';

const MIN = 60_000;
const T0 = new Date(2026, 10, 23, 9, 0, 0).getTime();

function entry(s: number, mins: number, k: 'f' | 'b', ok = true): Entry {
  return { s, e: s + mins * MIN, m: mins * MIN, k, ok };
}

function runToEnd(s: State, t: number) {
  start(s, t);
  const ended = catchUp(s, t + 24 * 60 * MIN);
  assert.equal(ended.length, 1);
  return ended[0];
}

test('a fresh state uses the documented defaults and waits idle on focus', () => {
  const s = fresh();
  assert.deepEqual(s.settings, { focus: 25, short: 5, long: 15, every: 4, goal: 120, chime: true, auto: false });
  assert.equal(s.run.phase, 'focus');
  assert.equal(s.run.status, 'idle');
  assert.equal(s.run.done, 0);
  assert.deepEqual(s.log, []);
  assert.equal(left(s.run, T0), 25 * MIN);
});

test('start runs the clock from the given time and time left counts down', () => {
  const s = fresh();
  start(s, T0);
  assert.equal(s.run.status, 'running');
  assert.equal(s.run.started, T0);
  assert.equal(elapsed(s.run, T0 + 10 * MIN), 10 * MIN);
  assert.equal(left(s.run, T0 + 10 * MIN), 15 * MIN);
  assert.equal(endsAt(s.run), T0 + 25 * MIN);
  assert.equal(left(s.run, T0 + 25 * MIN), 0);
  assert.equal(left(s.run, T0 + 90 * MIN), 0);
});

test('pause freezes the time left and resume continues from it', () => {
  const s = fresh();
  start(s, T0);
  pause(s, T0 + 10 * MIN);
  assert.equal(s.run.status, 'paused');
  assert.equal(left(s.run, T0 + 60 * MIN), 15 * MIN);
  start(s, T0 + 60 * MIN);
  assert.equal(s.run.status, 'running');
  assert.equal(s.run.started, T0);
  assert.equal(left(s.run, T0 + 65 * MIN), 10 * MIN);
  assert.equal(endsAt(s.run), T0 + 75 * MIN);
});

test('start while running and pause while idle change nothing', () => {
  const s = fresh();
  pause(s, T0);
  assert.equal(s.run.status, 'idle');
  assert.equal(left(s.run, T0 + 5 * MIN), 25 * MIN);
  start(s, T0);
  start(s, T0 + 5 * MIN);
  assert.equal(s.run.started, T0);
  assert.equal(left(s.run, T0 + 10 * MIN), 15 * MIN);
});

test('a tick before the end finishes nothing and a tick at the end finishes the session', () => {
  const s = fresh();
  start(s, T0);
  assert.deepEqual(catchUp(s, T0 + 25 * MIN - 1), []);
  assert.equal(s.run.status, 'running');
  const ended = catchUp(s, T0 + 25 * MIN);
  assert.deepEqual(ended, [{ phase: 'focus', at: T0 + 25 * MIN, next: 'short', started: false }]);
});

test('a late tick logs the session at its real end, not at the time of the tick', () => {
  const s = fresh();
  start(s, T0);
  const ended = catchUp(s, T0 + 40 * MIN);
  assert.deepEqual(ended, [{ phase: 'focus', at: T0 + 25 * MIN, next: 'short', started: false }]);
  assert.deepEqual(s.log, [{ s: T0, e: T0 + 25 * MIN, m: 25 * MIN, k: 'f', ok: true }]);
  assert.equal(s.run.phase, 'short');
  assert.equal(s.run.status, 'idle');
  assert.equal(s.run.length, 5 * MIN);
  assert.equal(s.run.done, 1);
});

test('paused time does not count toward the end of the session', () => {
  const s = fresh();
  start(s, T0);
  pause(s, T0 + 10 * MIN);
  start(s, T0 + 30 * MIN);
  const ended = catchUp(s, T0 + 60 * MIN);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].at, T0 + 45 * MIN);
  assert.deepEqual(s.log, [{ s: T0, e: T0 + 45 * MIN, m: 25 * MIN, k: 'f', ok: true }]);
});

test('a clock that goes backwards neither adds nor removes time', () => {
  const s = fresh();
  start(s, T0 + 60 * MIN);
  assert.equal(elapsed(s.run, T0), 0);
  assert.equal(left(s.run, T0), 25 * MIN);
  assert.deepEqual(catchUp(s, T0), []);
  pause(s, T0);
  assert.equal(s.run.spent, 0);
  assert.equal(left(s.run, T0 + 120 * MIN), 25 * MIN);
});

test('the long break comes after the fourth finished focus with default settings', () => {
  const s = fresh();
  let t = T0;
  const steps: string[] = [];
  const counts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const e = runToEnd(s, t);
    steps.push(`${e.phase}>${e.next}`);
    counts.push(s.run.done);
    t = e.at;
  }
  assert.deepEqual(steps, [
    'focus>short', 'short>focus', 'focus>short', 'short>focus',
    'focus>short', 'short>focus', 'focus>long', 'long>focus',
  ]);
  assert.deepEqual(counts, [1, 1, 2, 2, 3, 3, 4, 0]);
  assert.equal(t, T0 + (4 * 25 + 3 * 5 + 15) * MIN);
});

test('every set to two brings the long break after the second focus', () => {
  const s = fresh();
  s.settings.every = 2;
  let t = T0;
  const next: string[] = [];
  for (let i = 0; i < 6; i++) {
    const e = runToEnd(s, t);
    next.push(e.next);
    t = e.at;
  }
  assert.deepEqual(next, ['short', 'focus', 'long', 'focus', 'short', 'focus']);
});

test('every set to one gives a long break after each focus', () => {
  const s = fresh();
  s.settings.every = 1;
  let t = T0;
  const next: string[] = [];
  for (let i = 0; i < 4; i++) {
    const e = runToEnd(s, t);
    next.push(e.next);
    t = e.at;
  }
  assert.deepEqual(next, ['long', 'focus', 'long', 'focus']);
});

test('skip moves from focus to a short break without counting the session or auto starting', () => {
  const s = fresh();
  s.settings.auto = true;
  start(s, T0);
  const e = finish(s, T0 + 10 * MIN, false);
  assert.deepEqual(e, { phase: 'focus', at: T0 + 10 * MIN, next: 'short', started: false });
  assert.equal(s.run.done, 0);
  assert.equal(s.run.status, 'idle');
  assert.deepEqual(s.log, [{ s: T0, e: T0 + 10 * MIN, m: 10 * MIN, k: 'f', ok: false }]);
});

test('skipping the fourth focus does not bring the long break', () => {
  const s = fresh();
  s.run.done = 3;
  start(s, T0);
  const e = finish(s, T0 + 5 * MIN, false);
  assert.equal(e.next, 'short');
  assert.equal(s.run.done, 3);
});

test('skip from a short break keeps the count and from a long break starts a new round', () => {
  const s = fresh();
  s.run = idleRun(s.settings, 'short', 2);
  assert.equal(finish(s, T0, false).next, 'focus');
  assert.equal(s.run.done, 2);
  s.run = idleRun(s.settings, 'long', 4);
  assert.equal(finish(s, T0, false).next, 'focus');
  assert.equal(s.run.done, 0);
  assert.equal(s.run.length, 25 * MIN);
});

test('skip while idle logs nothing and does not start the next session even with auto start', () => {
  const s = fresh();
  s.settings.auto = true;
  const e = finish(s, T0, false);
  assert.equal(e.started, false);
  assert.equal(s.run.status, 'idle');
  assert.deepEqual(s.log, []);
});

test('stopping before one minute leaves no log entry and at one minute it is logged', () => {
  const s = fresh();
  start(s, T0);
  reset(s, T0 + MIN - 1);
  assert.deepEqual(s.log, []);
  start(s, T0 + 10 * MIN);
  reset(s, T0 + 11 * MIN);
  assert.deepEqual(s.log, [{ s: T0 + 10 * MIN, e: T0 + 11 * MIN, m: MIN, k: 'f', ok: false }]);
});

test('reset keeps the phase and the count and gives back the full length', () => {
  const s = fresh();
  s.run = idleRun(s.settings, 'short', 2);
  start(s, T0);
  reset(s, T0 + 3 * MIN);
  assert.equal(s.run.phase, 'short');
  assert.equal(s.run.done, 2);
  assert.equal(s.run.status, 'idle');
  assert.equal(left(s.run, T0 + 10 * MIN), 5 * MIN);
  assert.deepEqual(s.log, [{ s: T0, e: T0 + 3 * MIN, m: 3 * MIN, k: 'b', ok: false }]);
});

test('the note is saved trimmed with focus entries and not with breaks', () => {
  const s = fresh();
  s.run.note = '  write report  ';
  const first = runToEnd(s, T0);
  runToEnd(s, first.at);
  assert.equal(s.log.length, 2);
  assert.equal(s.log[0].n, 'write report');
  assert.equal(s.log[1].k, 'b');
  assert.equal('n' in s.log[1], false);
});

test('a new focus length applies at the next start, not to a paused session', () => {
  const s = fresh();
  start(s, T0);
  pause(s, T0 + 5 * MIN);
  s.settings.focus = 50;
  start(s, T0 + 10 * MIN);
  assert.equal(left(s.run, T0 + 10 * MIN), 20 * MIN);
  reset(s, T0 + 11 * MIN);
  start(s, T0 + 12 * MIN);
  assert.equal(left(s.run, T0 + 12 * MIN), 50 * MIN);
});

test('with auto start a late tick chains the following sessions from their real ends', () => {
  const s = fresh();
  s.settings.auto = true;
  start(s, T0);
  const ended = catchUp(s, T0 + 31 * MIN);
  assert.deepEqual(ended, [
    { phase: 'focus', at: T0 + 25 * MIN, next: 'short', started: true },
    { phase: 'short', at: T0 + 30 * MIN, next: 'focus', started: true },
  ]);
  assert.deepEqual(s.log, [
    { s: T0, e: T0 + 25 * MIN, m: 25 * MIN, k: 'f', ok: true },
    { s: T0 + 25 * MIN, e: T0 + 30 * MIN, m: 5 * MIN, k: 'b', ok: true },
  ]);
  assert.equal(s.run.phase, 'focus');
  assert.equal(s.run.status, 'running');
  assert.equal(s.run.started, T0 + 30 * MIN);
  assert.equal(left(s.run, T0 + 31 * MIN), 24 * MIN);
});

test('a long absence with auto start is caught up in batches until the present session', () => {
  const s = fresh();
  s.settings = { ...s.settings, focus: 1, short: 1, long: 1, auto: true };
  start(s, T0);
  const now = T0 + 1000 * MIN + 30_000;
  const first = catchUp(s, now);
  assert.equal(first.length, 64);
  let total = first.length;
  for (let i = 0; i < 100; i++) {
    const more = catchUp(s, now);
    if (!more.length) break;
    total += more.length;
  }
  assert.equal(total, 1000);
  assert.equal(s.log.length, 1000);
  assert.equal(sessions(s.log), 500);
  assert.equal(s.run.phase, 'focus');
  assert.equal(s.run.status, 'running');
  assert.equal(s.run.done, 0);
  assert.equal(left(s.run, now), 30_000);
});

test('settings at their limits are kept and values outside are clamped', () => {
  const limits: [Parameters<typeof clampSetting>[0], number, number][] = [
    ['focus', 1, 180], ['short', 1, 60], ['long', 1, 90], ['every', 1, 12], ['goal', 0, 720],
  ];
  for (const [key, lo, hi] of limits) {
    assert.equal(clampSetting(key, lo, -1), lo, key);
    assert.equal(clampSetting(key, hi, -1), hi, key);
    assert.equal(clampSetting(key, lo - 1, -1), lo, key);
    assert.equal(clampSetting(key, hi + 1, -1), hi, key);
    assert.equal(clampSetting(key, -1e6, -1), lo, key);
  }
});

test('settings that are not numbers fall back and fractions are rounded', () => {
  assert.equal(clampSetting('focus', 'abc', 25), 25);
  assert.equal(clampSetting('focus', undefined, 25), 25);
  assert.equal(clampSetting('focus', NaN, 25), 25);
  assert.equal(clampSetting('focus', '30', 25), 30);
  assert.equal(clampSetting('focus', 24.6, 1), 25);
  assert.equal(clampSetting('focus', 24.4, 1), 24);
  assert.equal(clampSetting('focus', 0.4, 25), 1);
});

test('saved state loaded back is the same state', () => {
  const s = fresh();
  s.settings = { focus: 40, short: 7, long: 20, every: 3, goal: 200, chime: false, auto: true };
  s.run.note = 'draft chapter';
  start(s, T0);
  assert.equal(catchUp(s, T0 + 41 * MIN).length, 1);
  pause(s, T0 + 43 * MIN);
  const loaded = revive(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(loaded, s);
  assert.equal(loaded.log[0].n, 'draft chapter');
  assert.equal(left(loaded.run, T0 + 50 * MIN), 4 * MIN);
});

test('a running session saved and loaded back ends at the same time', () => {
  const s = fresh();
  start(s, T0);
  pause(s, T0 + 5 * MIN);
  start(s, T0 + 8 * MIN);
  const loaded = revive(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(loaded, s);
  assert.equal(endsAt(loaded.run), T0 + 28 * MIN);
  const ended = catchUp(loaded, T0 + 60 * MIN);
  assert.equal(ended[0].at, T0 + 28 * MIN);
});

test('a saved state that is not an object loads as a fresh state', () => {
  for (const raw of [null, undefined, 42, 'text', true]) {
    assert.deepEqual(revive(raw), fresh());
  }
});

test('corrupted settings in saved state are clamped or replaced by defaults', () => {
  const s = revive({ settings: { focus: 'abc', short: -5, long: 1000, every: 0, goal: 9999, chime: 'no', auto: 'yes' } });
  assert.deepEqual(s.settings, { focus: 25, short: 1, long: 90, every: 1, goal: 720, chime: true, auto: false });
});

test('a null setting in saved state falls back to the default', { todo: 'defect: clampSetting reads null as 0, so a null focus loads as 1 minute and a null goal as 0 instead of the defaults' }, () => {
  const s = revive({ settings: { focus: null, short: null, long: null, every: null, goal: null } });
  assert.deepEqual([s.settings.focus, s.settings.short, s.settings.long, s.settings.every, s.settings.goal], [25, 5, 15, 4, 120]);
});

test('a corrupted run loads as an idle focus run with the full length', () => {
  const s = revive({
    settings: { focus: 30 },
    run: { phase: 'lunch', status: 'sleeping', length: 5, spent: -100, resumed: 'x', started: null, done: -3, note: 42 },
  });
  assert.deepEqual(s.run, { phase: 'focus', status: 'idle', length: 30 * MIN, spent: 0, resumed: 0, started: 0, done: 0, note: '' });
});

test('a running run with a missing length takes it from the settings and the note is cut to eighty characters', () => {
  const s = revive({
    settings: { short: 8 },
    run: { phase: 'short', status: 'running', length: 0, spent: 0, resumed: T0, started: T0, done: 2.9, note: 'x'.repeat(200) },
  });
  assert.equal(s.run.status, 'running');
  assert.equal(s.run.length, 8 * MIN);
  assert.equal(s.run.done, 2);
  assert.equal(s.run.note, 'x'.repeat(80));
  assert.equal(left(s.run, T0 + 3 * MIN), 5 * MIN);
});

test('a corrupted log keeps only well formed entries', () => {
  const good = entry(T0, 25, 'f');
  const brk = entry(T0 + 25 * MIN, 5, 'b');
  const s = revive({ log: [good, null, { s: '1', e: 2, m: 3, k: 'f' }, { s: 1, e: 2, m: 3, k: 'x' }, { s: 1, e: 2, k: 'f' }, brk, 'junk'] });
  assert.deepEqual(s.log, [good, brk]);
  assert.deepEqual(revive({ log: 'not a list' }).log, []);
});

test('the entries of a day are those started that day in time order and the week sums focus minutes', () => {
  const s = fresh();
  const a = entry(new Date(2026, 10, 23, 9, 0).getTime(), 25, 'f');
  const b = entry(new Date(2026, 10, 23, 8, 0).getTime(), 25, 'f');
  const c = entry(new Date(2026, 10, 23, 10, 0).getTime(), 5, 'b');
  const d = entry(new Date(2026, 10, 22, 14, 0).getTime(), 50, 'f', false);
  const g = entry(new Date(2026, 10, 17, 23, 50).getTime(), 20, 'f');
  const old = entry(new Date(2026, 10, 15, 9, 0).getTime(), 30, 'f');
  s.log = [a, d, b, c, g, old];
  const today = entriesOn(s, new Date(2026, 10, 23, 15, 0).getTime());
  assert.deepEqual(today, [b, a, c]);
  assert.equal(focusMinutes(today), 50);
  assert.equal(sessions(today), 2);
  const days = week(s, new Date(2026, 10, 23, 12, 0).getTime());
  assert.deepEqual(days.map((x) => x.day), [17, 18, 19, 20, 21, 22, 23].map((n) => new Date(2026, 10, n).getTime()));
  assert.deepEqual(days.map((x) => x.minutes), [20, 0, 0, 0, 0, 50, 50]);
});

test('prune drops entries older than the kept days and keeps only the newest when there are too many', () => {
  const now = new Date(2026, 10, 23, 12, 0).getTime();
  const edge = new Date(2026, 10, 23 - 60).getTime();
  const s = fresh();
  const keep1 = entry(edge, 25, 'f');
  const keep2 = entry(new Date(2026, 10, 22, 9, 0).getTime(), 25, 'f');
  s.log = [entry(edge - 1, 25, 'f'), keep1, entry(new Date(2026, 10, 23 - 61, 9).getTime(), 25, 'f'), keep2];
  prune(s, now);
  assert.deepEqual(s.log, [keep1, keep2]);
  prune(s, now, 14);
  assert.deepEqual(s.log, [keep2]);
  s.log = Array.from({ length: 1600 }, (_, i) => entry(now - (1600 - i) * MIN, 1, 'f'));
  const expected = s.log.slice(100);
  prune(s, now);
  assert.equal(s.log.length, 1500);
  assert.deepEqual(s.log, expected);
});

test('chime reports no sound where there is no audio context', () => {
  assert.equal(typeof (globalThis as { AudioContext?: unknown }).AudioContext, 'undefined');
  assert.equal(chime('focus'), false);
  assert.equal(chime('break'), false);
});

test('chime plays two bells, rising for focus and falling for a break', () => {
  const freqs: number[] = [];
  const node = () => ({ connect: (n: unknown) => n, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  class FakeAudio {
    state = 'running';
    currentTime = 0;
    destination = {};
    createGain() { return node(); }
    createOscillator() { return { ...node(), type: '', frequency: { set value(v: number) { freqs.push(v); } }, start() {}, stop() {} }; }
  }
  const g = globalThis as { AudioContext?: unknown };
  g.AudioContext = FakeAudio;
  try {
    assert.equal(chime('focus'), true);
    assert.equal(freqs.length, 6);
    assert.deepEqual([freqs[0], freqs[3]], [784, 1047]);
    freqs.length = 0;
    assert.equal(chime('break'), true);
    assert.deepEqual([freqs[0], freqs[3]], [1047, 784]);
  } finally {
    delete g.AudioContext;
  }
});
