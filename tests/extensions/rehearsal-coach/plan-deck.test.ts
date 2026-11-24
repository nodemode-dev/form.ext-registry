import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgets,
  dateLabel,
  defaultPlan,
  diff,
  fmt,
  hasLine,
  inPlan,
  mergeNotes,
  notesLine,
  overPinned,
  overSlides,
  pace,
  parseDuration,
  tone,
} from '../../../extensions/rehearsal-coach/src/plan.ts';
import type { Plan, Run, SlideInfo } from '../../../extensions/rehearsal-coach/src/plan.ts';

type Sent = { id: number; method: string; params: any };

const sent: Sent[] = [];
let answer: (method: string, params: any) => unknown = () => null;
const listeners: Array<(event: any) => void> = [];

const standIn: any = {
  addEventListener(type: string, fn: (event: any) => void) {
    if (type === 'message') listeners.push(fn);
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  parent: {
    postMessage(msg: any) {
      sent.push({ id: msg.id, method: msg.method, params: msg.params });
      setImmediate(() => {
        let body: Record<string, unknown>;
        try {
          body = { result: answer(msg.method, msg.params) };
        } catch (e) {
          body = { error: { code: -32003, message: String((e as Error).message) } };
        }
        for (const fn of listeners) fn({ source: standIn.parent, data: { formext: 1, jsonrpc: '2.0', id: msg.id, ...body } });
      });
    },
  },
};
(globalThis as any).window = standIn;

const deckMod = await import('../../../extensions/rehearsal-coach/src/deck.ts');
const { readDeck, currentFrom, goToSlide, writeNotes } = deckMod;

function slide(id: string, n: number, hidden = false): SlideInfo {
  return { id, n, title: `Slide ${n}`, notes: '', hidden };
}

function slides(count: number): SlideInfo[] {
  return Array.from({ length: count }, (_, i) => slide(`s${i + 1}`, i + 1));
}

function plan(over: Partial<Plan> = {}): Plan {
  return { ...defaultPlan(), ...over };
}

function total(map: Map<string, number>): number {
  let sum = 0;
  for (const v of map.values()) sum += v;
  return sum;
}

function lastRun(secs: Record<string, number>): Run {
  return { at: '2026-11-01T10:00:00Z', target: 600, total: 0, slides: secs };
}

test('a 10 minute talk over 5 equal slides gives 2 minutes each', () => {
  const b = budgets(slides(5), plan({ target: 600 }), null);
  assert.deepEqual([...b.values()], [120, 120, 120, 120, 120]);
  assert.deepEqual([...b.keys()], ['s1', 's2', 's3', 's4', 's5']);
});

test('the default plan is 10 minutes, even split, nothing pinned, and each call is a fresh object', () => {
  assert.deepEqual(defaultPlan(), { target: 600, split: 'even', pinned: {}, includeHidden: false });
  const a = defaultPlan();
  a.pinned.x = 5;
  assert.deepEqual(defaultPlan().pinned, {});
});

test('one slide gets the whole target, zero slides gives an empty plan, a zero target gives zeros', () => {
  assert.deepEqual([...budgets(slides(1), plan({ target: 600 }), null).entries()], [['s1', 600]]);
  assert.equal(budgets([], plan({ target: 600 }), null).size, 0);
  assert.deepEqual([...budgets(slides(4), plan({ target: 0 }), null).values()], [0, 0, 0, 0]);
});

test('an uneven split hands the spare seconds out and the total stays exact', () => {
  const b = budgets(slides(3), plan({ target: 100 }), null);
  assert.deepEqual([...b.values()].sort((x, y) => x - y), [33, 33, 34]);
  assert.equal(total(b), 100);
  const seven = budgets(slides(3), plan({ target: 7 }), null);
  assert.deepEqual([...seven.values()].sort((x, y) => x - y), [2, 2, 3]);
});

test('no second is lost or invented for any target up to 60 over 1 to 9 slides', () => {
  for (let count = 1; count <= 9; count++) {
    for (let target = 0; target <= 60; target++) {
      const b = budgets(slides(count), plan({ target }), null);
      assert.equal(total(b), target, `${count} slides, ${target} s`);
      const v = [...b.values()];
      assert.ok(Math.max(...v) - Math.min(...v) <= 1, `${count} slides, ${target} s spread`);
    }
  }
});

test('weighted by the last run, shares follow the old times and add to the target', () => {
  const b = budgets(slides(3), plan({ target: 120, split: 'last' }), lastRun({ s1: 10, s2: 20, s3: 30 }));
  assert.deepEqual([...b.entries()], [['s1', 20], ['s2', 40], ['s3', 60]]);
  const odd = budgets(slides(3), plan({ target: 100, split: 'last' }), lastRun({ s1: 1, s2: 1, s3: 1 }));
  assert.equal(total(odd), 100);
  const ratio = budgets(slides(3), plan({ target: 10, split: 'last' }), lastRun({ s1: 5, s2: 10, s3: 10 }));
  assert.deepEqual([...ratio.values()], [2, 4, 4]);
});

test('last split falls back sensibly for missing slides, zero times, no last run and foreign ids', () => {
  const missing = budgets(slides(3), plan({ target: 60, split: 'last' }), lastRun({ s1: 10, s3: 30 }));
  assert.deepEqual([...missing.entries()], [['s1', 10], ['s2', 20], ['s3', 30]]);
  const zero = budgets(slides(3), plan({ target: 60, split: 'last' }), lastRun({ s1: 10, s2: 0, s3: 30 }));
  assert.deepEqual([...zero.values()], [10, 20, 30]);
  assert.deepEqual([...budgets(slides(4), plan({ target: 100, split: 'last' }), null).values()], [25, 25, 25, 25]);
  assert.deepEqual([...budgets(slides(2), plan({ target: 100, split: 'last' }), lastRun({ other: 90 })).values()], [50, 50]);
});

test('a pinned slide keeps its time and the rest share what is left', () => {
  const b = budgets(slides(5), plan({ target: 600, pinned: { s2: 100 } }), null);
  assert.equal(b.get('s2'), 100);
  for (const id of ['s1', 's3', 's4', 's5']) assert.equal(b.get(id), 125);
  assert.equal(total(b), 600);
});

test('pins larger than the target leave nothing for the others and are flagged, equal pins are not', () => {
  const p = plan({ target: 600, pinned: { s1: 400, s2: 300 } });
  assert.deepEqual([...budgets(slides(4), p, null).values()], [400, 300, 0, 0]);
  assert.equal(overPinned(slides(4), p), true);
  assert.equal(overPinned(slides(2), plan({ target: 600, pinned: { s1: 300, s2: 300 } })), false);
});

test('a pin on a hidden slide is ignored while hidden slides are out of the plan', () => {
  const list = [slide('s1', 1), slide('s2', 2, true), slide('s3', 3)];
  const p = plan({ target: 100, pinned: { s2: 90 } });
  const b = budgets(list, p, null);
  assert.deepEqual([...b.entries()], [['s1', 50], ['s3', 50]]);
  assert.equal(overPinned(list, p), false);
});

test('hidden slides get no share unless the plan includes them', () => {
  const list = [slide('s1', 1), slide('s2', 2, true), slide('s3', 3), slide('s4', 4), slide('s5', 5)];
  const out = budgets(list, plan({ target: 600 }), null);
  assert.equal(out.has('s2'), false);
  assert.deepEqual([...out.values()], [150, 150, 150, 150]);
  const withHidden = budgets(list, plan({ target: 600, includeHidden: true }), null);
  assert.deepEqual([...withHidden.values()], [120, 120, 120, 120, 120]);
  assert.deepEqual(inPlan(list, plan()).map((s) => s.id), ['s1', 's3', 's4', 's5']);
});

test('fmt writes minutes and seconds, and hours only when needed', () => {
  assert.equal(fmt(0), '0:00');
  assert.equal(fmt(65), '1:05');
  assert.equal(fmt(600), '10:00');
  assert.equal(fmt(3599), '59:59');
  assert.equal(fmt(3600), '1:00:00');
  assert.equal(fmt(3725), '1:02:05');
  assert.equal(fmt(-5), '0:00');
  assert.equal(fmt(59.6), '1:00');
});

test('parseDuration reads minutes, clock forms and unit words', () => {
  assert.equal(parseDuration('12'), 720);
  assert.equal(parseDuration('12:30'), 750);
  assert.equal(parseDuration('1:05:00'), 3900);
  assert.equal(parseDuration('45m'), 2700);
  assert.equal(parseDuration('90s'), 90);
  assert.equal(parseDuration('1.5h'), 5400);
  assert.equal(parseDuration('2 min'), 120);
  assert.equal(parseDuration('  7 Minutes '), 420);
  assert.equal(parseDuration('90', 'sec'), 90);
});

test('parseDuration refuses empty text, words and minutes or seconds above 59', () => {
  assert.equal(parseDuration('12'), 720);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('   '), null);
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration('1:75'), null);
  assert.equal(parseDuration('1:05:60'), null);
  assert.equal(parseDuration('-5'), null);
  assert.equal(parseDuration('5 parsecs'), null);
});

test('tone grades the time spent against the budget', () => {
  assert.equal(tone(0, 0), 'none');
  assert.equal(tone(5, 0), 'warn');
  assert.equal(tone(62, 60), 'ok');
  assert.equal(tone(0, 60), 'ok');
  assert.equal(tone(63, 60), 'warn');
  assert.equal(tone(72, 60), 'warn');
  assert.equal(tone(73, 60), 'over');
  assert.equal(tone(15, 10), 'warn');
  assert.equal(tone(16, 10), 'over');
});

test('diff names how far over or under, and calls 2 seconds either way on time', () => {
  assert.equal(diff(42, 35), '0:07 over');
  assert.equal(diff(30, 35), '0:05 under');
  assert.equal(diff(37, 35), 'on time');
  assert.equal(diff(33, 35), 'on time');
  assert.equal(diff(38, 35), '0:03 over');
  assert.equal(diff(100, 35), '1:05 over');
});

test('pace says behind when elapsed is more than planned and ahead when less', () => {
  assert.equal(pace(130, 100), '0:30 behind');
  assert.equal(pace(70, 100), '0:30 ahead');
  assert.equal(pace(100, 100), 'On plan');
  assert.equal(pace(102, 100), 'On plan');
  assert.equal(pace(103, 100), '0:03 behind');
  assert.equal(pace(97, 100), '0:03 ahead');
});

test('dateLabel gives a short day, month and year, and passes bad dates through', () => {
  assert.equal(dateLabel('2026-11-07T12:00:00Z', 'en-GB'), '7 Nov 2026');
  assert.equal(dateLabel('not a date'), 'not a date');
});

test('notesLine matches the README example', () => {
  assert.equal(notesLine(42, 35, 3, '2026-11-07T12:00:00Z', 'en-GB'), 'Rehearsal Coach: 0:42 on this slide, plan 0:35 (0:07 over). Run 3, 7 Nov 2026.');
});

test('notesLine leaves out the plan when there is no budget or it is zero, and says under when short', () => {
  const expected = 'Rehearsal Coach: 0:42 on this slide. Run 1, 7 Nov 2026.';
  assert.equal(notesLine(42, undefined, 1, '2026-11-07T12:00:00Z', 'en-GB'), expected);
  assert.equal(notesLine(42, 0, 1, '2026-11-07T12:00:00Z', 'en-GB'), expected);
  assert.equal(notesLine(20, 35, 2, '2026-11-07T12:00:00Z', 'en-GB'), 'Rehearsal Coach: 0:20 on this slide, plan 0:35 (0:15 under). Run 2, 7 Nov 2026.');
});

test('mergeNotes adds the line alone to empty notes or after a blank line below existing notes', () => {
  assert.equal(mergeNotes('', 'Rehearsal Coach: A'), 'Rehearsal Coach: A');
  assert.equal(mergeNotes('A\r\nB', 'Rehearsal Coach: X'), 'A\nB\n\nRehearsal Coach: X');
  assert.equal(mergeNotes('Say hello.\nThen the demo.\n\n\n', 'Rehearsal Coach: A'), 'Say hello.\nThen the demo.\n\nRehearsal Coach: A');
});

test('mergeNotes replaces an old line in place, keeps the rest, and is the same applied twice', () => {
  assert.equal(mergeNotes('Top\nRehearsal Coach: old\nBottom', 'Rehearsal Coach: new'), 'Top\nRehearsal Coach: new\nBottom');
  assert.equal(mergeNotes('Top\n  Rehearsal Coach: old', 'Rehearsal Coach: new'), 'Top\nRehearsal Coach: new');
  const once = mergeNotes('Intro', 'Rehearsal Coach: A');
  assert.equal(mergeNotes(once, 'Rehearsal Coach: A'), once);
});

test('mergeNotes with null removes the line and gives back the original notes', () => {
  const original = 'Intro\nMore';
  const added = mergeNotes(original, 'Rehearsal Coach: A');
  assert.equal(mergeNotes(added, null), original);
  assert.equal(mergeNotes('Rehearsal Coach: A', null), '');
  assert.equal(mergeNotes('Top\nRehearsal Coach: old\nBottom', null), 'Top\nBottom');
  assert.equal(mergeNotes('Just notes\n\n', null), 'Just notes');
});

test('hasLine finds the marker at the start of any line, indented or not', () => {
  assert.equal(hasLine('A\nRehearsal Coach: x'), true);
  assert.equal(hasLine('A\r\n   Rehearsal Coach: x'), true);
  assert.equal(hasLine('I used Rehearsal Coach: here'), false);
  assert.equal(hasLine(''), false);
});

test('overSlides lists slides that ran in the warn or over band only', () => {
  const run = lastRun({ s1: 50, s2: 30, s3: 10, s4: 35 });
  const b = new Map([['s1', 30], ['s2', 30], ['s3', 30], ['s4', 30]]);
  assert.deepEqual(overSlides(run, b), ['s1', 's4']);
  assert.deepEqual(overSlides(lastRun({ s1: 10, s2: 0 }), new Map()), ['s1']);
});

function snapshot(value: unknown) {
  answer = () => value;
  sent.length = 0;
}

test('readDeck asks the host for the deck and reads titles, notes, hidden flags and numbers', async () => {
  snapshot({
    deck: { id: 'd1', title: 'Quarterly' },
    current: { slide: 's2', n: 2 },
    slides: [
      { id: 's1', n: 1, title: 'Intro', notes: 'hello', hidden: false },
      { id: 's2', n: 2, title: 'Numbers', notes: '', hidden: true },
    ],
  });
  const d = await readDeck();
  assert.equal(sent[0].method, 'document.read');
  assert.deepEqual(sent[0].params, { what: 'deck' });
  assert.equal(d.key, 'd1');
  assert.equal(d.title, 'Quarterly');
  assert.equal(d.current, 's2');
  assert.deepEqual(d.slides, [
    { id: 's1', n: 1, title: 'Intro', notes: 'hello', hidden: false },
    { id: 's2', n: 2, title: 'Numbers', notes: '', hidden: true },
  ]);
});

test('readDeck fills missing titles, notes and numbers and drops slides with no id', async () => {
  snapshot({
    deck: { title: 'Untitled talk' },
    slides: [
      { id: 'a', n: 1, title: '   ' },
      { n: 2, title: 'Ghost' },
      { id: 'b', title: null },
      { id: 'c', n: 7, notes: 42, hidden: 1 },
    ],
  });
  const d = await readDeck();
  assert.deepEqual(d.slides.map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(d.slides.map((s) => s.title), ['Slide 1', 'Slide 2', 'Slide 7']);
  assert.deepEqual(d.slides.map((s) => s.n), [1, 2, 7]);
  assert.deepEqual(d.slides.map((s) => s.notes), ['', '', '']);
  assert.deepEqual(d.slides.map((s) => s.hidden), [false, false, true]);
  snapshot({ slides: [{ id: 'a', n: 1, title: '  Spaced out  ' }] });
  assert.equal((await readDeck()).slides[0].title, 'Spaced out');
});

test('readDeck names the deck by id, then title, then untitled, and finds the current slide', async () => {
  snapshot({ deck: { id: 'x', title: 'T' }, slides: [] });
  assert.equal((await readDeck()).key, 'x');
  snapshot({ deck: { title: 'T' }, slides: [] });
  assert.equal((await readDeck()).key, 'T');
  snapshot({ slides: [] });
  const d = await readDeck();
  assert.equal(d.key, 'untitled');
  assert.equal(d.title, '');
  snapshot({ selection: { slide: 's9' }, slides: [{ id: 's9', n: 1 }] });
  assert.equal((await readDeck()).current, 's9');
  snapshot({ slides: [{ id: 's9', n: 1 }] });
  assert.equal((await readDeck()).current, null);
});

test('readDeck copes with an empty or odd host reply and passes on a host refusal', async () => {
  for (const reply of [null, {}, { slides: 'nope' }]) {
    snapshot(reply);
    const d = await readDeck();
    assert.deepEqual(d.slides, []);
    assert.equal(d.key, 'untitled');
    assert.equal(d.current, null);
  }
  answer = () => { throw new Error('denied'); };
  await assert.rejects(readDeck(), /denied/);
});

const view = {
  key: 'k',
  title: 't',
  current: 's2' as string | null,
  slides: [slide('s1', 1), slide('s2', 2), slide('s3', 3)],
};

test('currentFrom follows an event by slide id or number, and gives null when it names no slide', () => {
  assert.equal(currentFrom(view, { slide: 's3' }), 's3');
  assert.equal(currentFrom(view, { n: 1 }), 's1');
  assert.equal(currentFrom(view, { n: 99 }), null);
  assert.equal(currentFrom(view, {}), null);
  assert.equal(currentFrom(view, null), null);
});

test('currentFrom with no event uses the deck current slide, else the first slide, else null', () => {
  assert.equal(currentFrom(view), 's2');
  assert.equal(currentFrom({ ...view, current: 'gone' }), 's1');
  assert.equal(currentFrom({ ...view, current: null }), 's1');
  assert.equal(currentFrom({ ...view, current: null, slides: [] }), null);
});

test('goToSlide asks the host to go to the slide number', async () => {
  answer = () => null;
  sent.length = 0;
  await goToSlide(slide('s4', 4));
  assert.equal(sent[0].method, 'app.run');
  assert.deepEqual(sent[0].params, { command: 'go-to-slide', args: { number: 4 } });
});

test('writeNotes sends one undo step with a set operation per slide', async () => {
  answer = () => ({ applied: 1, results: [] });
  sent.length = 0;
  await writeNotes([{ slide: slide('s1', 1), notes: 'A' }, { slide: slide('s3', 3), notes: 'B' }], 'Rehearsal timings');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'document.apply');
  assert.deepEqual(sent[0].params, {
    label: 'Rehearsal timings',
    ops: [
      {
        command: 'apply-ops',
        args: {
          ops: [
            { op: 'set', path: ['slides', { id: 's1' }, 'notes'], value: 'A' },
            { op: 'set', path: ['slides', { id: 's3' }, 'notes'], value: 'B' },
          ],
        },
      },
    ],
  });
});
