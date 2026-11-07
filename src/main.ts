import { ERR, FormExtError, formext, type Hello } from './formext';
import { readDeck, goToSlide, writeNotes, currentFrom, type DeckView } from './deck';
import {
  budgets, defaultPlan, diff, fmt, hasLine, inPlan, mergeNotes, notesLine, overPinned, overSlides, pace, parseDuration, tone,
  type Plan, type Run, type SlideInfo, type Split,
} from './plan';

type State = 'idle' | 'running' | 'paused' | 'review';
interface Saved { plan: Plan; runs: Run[] }

const KEEP_RUNS = 5;
const TICK_MS = 250;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const n = document.querySelector<T>(sel);
  if (!n) throw new Error(`missing ${sel}`);
  return n;
};

const ui = {
  root: $('.rc'),
  target: $<HTMLInputElement>('#target'),
  split: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-split]')),
  planNote: $('#plan-note'),
  hidden: $<HTMLInputElement>('#hidden'),
  where: $('#where'),
  slideTime: $('#slide-time'),
  slidePlan: $('#slide-plan'),
  slideDiff: $('#slide-diff'),
  meter: $('.rc-meter'),
  meterFill: $('#slide-meter'),
  elapsed: $('#elapsed'),
  left: $('#left'),
  pace: $('#pace'),
  goLabel: $('#go-label'),
  summary: $('#summary'),
  rows: $<HTMLOListElement>('#rows'),
  empty: $('#empty'),
  runs: $('#runs'),
  status: $('#status'),
  btn: (act: string) => $<HTMLButtonElement>(`[data-act="${act}"]`),
};

let hello: Hello | null = null;
let deck: DeckView | null = null;
let saved: Saved = { plan: defaultPlan(), runs: [] };
let state: State = 'idle';
let times = new Map<string, number>();
let cur: string | null = null;
let segAt = 0;
let runStart = 0;
let runPaused = 0;
let pausedAt = 0;
let timer = 0;
let busy = false;
let plan = new Map<string, number>();
const rowEls = new Map<string, HTMLLIElement>();

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function setStyle(node: HTMLElement, prop: 'width' | 'left', value: string): void {
  if (node.style[prop] !== value) node.style[prop] = value;
}

function status(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  setText(ui.status, text || ' ');
  ui.status.classList.toggle('is-ok', kind === 'ok');
  ui.status.classList.toggle('is-error', kind === 'error');
}

function plain(err: unknown): string {
  if (err instanceof FormExtError) {
    if (err.code === ERR.PERMISSION) return 'Rehearsal Coach needs permission to read and change the deck. Allow it in the Extensions panel.';
    if (err.code === ERR.CANCELLED) return 'Cancelled.';
    if (err.code === ERR.UNAVAILABLE) return 'FormDeck did not answer in time. Try again.';
    return err.message || 'FormDeck refused the change.';
  }
  return err instanceof Error ? err.message : String(err);
}

function storeKey(): string {
  return `deck:${deck?.key ?? 'untitled'}`;
}

async function loadSaved(): Promise<void> {
  try {
    const v = await formext.storageGet<Saved>(storeKey());
    saved = v && v.plan ? { plan: { ...defaultPlan(), ...v.plan }, runs: Array.isArray(v.runs) ? v.runs : [] } : { plan: defaultPlan(), runs: [] };
  } catch {
    saved = { plan: defaultPlan(), runs: [] };
  }
}

async function persist(): Promise<void> {
  try {
    await formext.storageSet(storeKey(), saved);
  } catch (err) {
    status(`Could not keep the plan: ${plain(err)}`, 'error');
  }
}

function slides(): SlideInfo[] {
  return deck?.slides ?? [];
}

function planned(): SlideInfo[] {
  return inPlan(slides(), saved.plan);
}

function lastRun(): Run | null {
  return saved.runs[saved.runs.length - 1] ?? null;
}

function shownRun(): Run | null {
  if (state === 'review') return lastRun();
  return null;
}

function previousRun(): Run | null {
  const n = saved.runs.length;
  return state === 'review' ? saved.runs[n - 2] ?? null : saved.runs[n - 1] ?? null;
}

function recompute(): void {
  const basis = state === 'review' ? saved.runs[saved.runs.length - 2] ?? null : lastRun();
  plan = budgets(slides(), saved.plan, basis);
}

function spent(id: string): number {
  let v = times.get(id) ?? 0;
  if (state === 'running' && id === cur) v += (performance.now() - segAt) / 1000;
  return v;
}

function elapsed(): number {
  if (state === 'idle' || state === 'review') return 0;
  const end = state === 'paused' ? pausedAt : performance.now();
  return (end - runStart - runPaused) / 1000;
}

function plannedUntilNow(): number {
  const list = planned();
  let sum = 0;
  for (const s of list) {
    if (s.id === cur) { sum += Math.min(spent(s.id), plan.get(s.id) ?? 0); break; }
    sum += plan.get(s.id) ?? 0;
  }
  return sum;
}

function renderPlan(): void {
  const list = planned();
  const t = saved.plan.target;
  if (document.activeElement !== ui.target) ui.target.value = fmt(t);
  for (const b of ui.split) {
    setAttr(b, 'aria-checked', String(b.dataset.split === saved.plan.split));
    b.disabled = state === 'running' || state === 'paused' || (b.dataset.split === 'last' && !lastRun());
  }
  ui.target.disabled = state === 'running' || state === 'paused';
  ui.hidden.disabled = ui.target.disabled;
  ui.hidden.checked = saved.plan.includeHidden;
  const hiddenCount = slides().filter((s) => s.hidden).length;
  let note = '';
  let warn = false;
  if (!deck) note = 'Reading the deck';
  else if (!list.length) { note = 'This deck has no slides to rehearse.'; warn = true; }
  else if (overPinned(slides(), saved.plan)) { note = 'The slides you set add up to more than the target.'; warn = true; }
  else {
    const each = list.length ? t / list.length : 0;
    note = `${list.length} slide${list.length === 1 ? '' : 's'}${saved.plan.split === 'even' && !Object.keys(saved.plan.pinned).length ? `, ${fmt(each)} each` : ''}${hiddenCount && !saved.plan.includeHidden ? `, ${hiddenCount} hidden skipped` : ''}`;
  }
  setAttr(ui.hidden.parentElement as HTMLElement, 'title', hiddenCount ? `Include the ${hiddenCount} hidden slide${hiddenCount === 1 ? '' : 's'} in the plan` : 'This deck has no hidden slides');
  setText(ui.planNote, note);
  ui.planNote.classList.toggle('is-warn', warn);
}

function makeRow(s: SlideInfo): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'rc-row';
  li.tabIndex = -1;
  li.dataset.id = s.id;
  li.innerHTML = '<span class="rc-r-n"></span><span class="rc-r-title"></span><input class="rc-input rc-r-plan" type="text" inputmode="numeric" spellcheck="false" autocomplete="off"><span class="rc-r-run"></span><span class="rc-r-last"></span><span class="rc-r-bar"><span></span></span>';
  const input = li.querySelector<HTMLInputElement>('.rc-r-plan')!;
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = fmt(plan.get(s.id) ?? 0); input.blur(); }
  });
  input.addEventListener('change', () => pin(s.id, input));
  return li;
}

function renderRows(): void {
  const list = planned();
  const keep = new Set(list.map((s) => s.id));
  for (const [id, li] of rowEls) if (!keep.has(id)) { li.remove(); rowEls.delete(id); }
  let prev: HTMLLIElement | null = null;
  for (const s of list) {
    let li = rowEls.get(s.id);
    if (!li) { li = makeRow(s); rowEls.set(s.id, li); }
    const want: Element | null = prev ? prev.nextElementSibling : ui.rows.firstElementChild;
    if (want !== li) ui.rows.insertBefore(li, want);
    prev = li;
    fillRow(li, s);
  }
  ui.empty.hidden = list.length > 0;
  if (!list.length) setText(ui.empty, deck ? 'This deck has no slides to rehearse.' : 'Reading the deck');
}

function fillRow(li: HTMLLIElement, s: SlideInfo): void {
  const b = plan.get(s.id) ?? 0;
  const run = shownRun();
  const live = state === 'running' || state === 'paused';
  const t = live ? spent(s.id) : run ? run.slides[s.id] ?? 0 : 0;
  const has = live ? times.has(s.id) || s.id === cur : !!run && run.slides[s.id] !== undefined;
  const prev = previousRun();
  setText(li.querySelector<HTMLElement>('.rc-r-n')!, String(s.n));
  const title = li.querySelector<HTMLElement>('.rc-r-title')!;
  setText(title, s.title);
  setAttr(title, 'title', s.title);
  const input = li.querySelector<HTMLInputElement>('.rc-r-plan')!;
  if (document.activeElement !== input && !input.classList.contains('is-bad')) input.value = fmt(b);
  input.classList.toggle('is-pinned', typeof saved.plan.pinned[s.id] === 'number');
  input.disabled = live;
  setAttr(input, 'aria-label', `Plan for slide ${s.n}`);
  setAttr(input, 'title', typeof saved.plan.pinned[s.id] === 'number' ? 'Set by you. Clear it to share the target again.' : 'Type a time to set this slide yourself');
  const runEl = li.querySelector<HTMLElement>('.rc-r-run')!;
  setText(runEl, has ? fmt(t) : '');
  const tn = has ? tone(t, b) : 'none';
  setAttr(runEl, 'data-tone', tn);
  setText(li.querySelector<HTMLElement>('.rc-r-last')!, prev && prev.slides[s.id] !== undefined ? fmt(prev.slides[s.id]) : '');
  const bar = li.querySelector<HTMLElement>('.rc-r-bar')!;
  setAttr(bar, 'data-tone', tn);
  setStyle(bar.firstElementChild as HTMLElement, 'width', has && b > 0 ? `${Math.min(100, (t / b) * 100).toFixed(1)}%` : '0%');
  li.classList.toggle('is-current', s.id === cur);
  li.classList.toggle('is-hidden', s.hidden);
  setAttr(li, 'aria-current', String(s.id === cur));
}

function renderClock(): void {
  const list = planned();
  const idx = cur ? list.findIndex((s) => s.id === cur) : -1;
  const s = cur ? slides().find((x) => x.id === cur) ?? null : null;
  const live = state === 'running' || state === 'paused';
  const run = shownRun();
  const target = saved.plan.target;
  if (live && s) {
    const t = spent(s.id);
    const b = plan.get(s.id) ?? 0;
    setText(ui.where, `Slide ${s.n}${idx >= 0 ? ` (${idx + 1} of ${list.length})` : ''}: ${s.title}`);
    setText(ui.slideTime, fmt(t));
    setText(ui.slidePlan, fmt(b));
    const tn = tone(t, b);
    setText(ui.slideDiff, state === 'paused' ? 'paused' : b > 0 ? diff(t, b) : 'not in plan');
    setAttr(ui.slideDiff, 'data-tone', state === 'paused' ? 'none' : tn);
    setAttr(ui.meter, 'data-tone', tn);
    setStyle(ui.meterFill, 'width', b > 0 ? `${Math.min(100, (t / b) * 80).toFixed(1)}%` : '0%');
    const e = elapsed();
    setText(ui.elapsed, fmt(e));
    setText(ui.left, e > target ? `-${fmt(e - target)}` : fmt(target - e));
    setText(ui.pace, pace(e, plannedUntilNow()));
  } else if (run) {
    setText(ui.where, `Run ${saved.runs.length} kept`);
    setText(ui.slideTime, fmt(run.total));
    setText(ui.slidePlan, fmt(run.target));
    const tn = tone(run.total, run.target);
    setText(ui.slideDiff, diff(run.total, run.target));
    setAttr(ui.slideDiff, 'data-tone', tn);
    setAttr(ui.meter, 'data-tone', tn);
    setStyle(ui.meterFill, 'width', run.target > 0 ? `${Math.min(100, (run.total / run.target) * 80).toFixed(1)}%` : '0%');
    setText(ui.elapsed, fmt(run.total));
    setText(ui.left, run.total > run.target ? `-${fmt(run.total - run.target)}` : fmt(run.target - run.total));
    setText(ui.pace, run.total > run.target + 2 ? 'Over' : run.total < run.target - 2 ? 'Under' : 'On target');
  } else {
    setText(ui.where, deck ? (deck.title ? `Ready: ${deck.title}` : 'Ready') : 'No run yet');
    setText(ui.slideTime, '0:00');
    setText(ui.slidePlan, fmt(list[0] ? plan.get(list[0].id) ?? 0 : 0));
    setText(ui.slideDiff, 'ready');
    setAttr(ui.slideDiff, 'data-tone', 'none');
    setAttr(ui.meter, 'data-tone', 'none');
    setStyle(ui.meterFill, 'width', '0%');
    setText(ui.elapsed, '0:00');
    setText(ui.left, fmt(target));
    setText(ui.pace, 'Not yet');
  }
}

function renderControls(): void {
  ui.root.dataset.state = state;
  const live = state === 'running' || state === 'paused';
  const any = planned().length > 0;
  ui.btn('back').disabled = !live || busy;
  ui.btn('next').disabled = !live || busy;
  ui.btn('finish').disabled = !live || busy;
  ui.btn('cancel').disabled = !live;
  const go = ui.btn('go');
  go.disabled = !any || busy;
  setText(ui.goLabel, state === 'running' ? 'Pause' : state === 'paused' ? 'Resume' : state === 'review' ? 'Run again' : 'Start');
  setAttr(go, 'title', state === 'running' ? 'Pause the clock (Space or P)' : state === 'paused' ? 'Carry on timing (Space or P)' : 'Start the run from the first slide (Space)');
  const latest = lastRun();
  ui.btn('write').disabled = live || busy || !latest;
  ui.btn('unwrite').disabled = live || busy || !slides().some((s) => hasLine(s.notes));
  ui.btn('clear').disabled = live || busy || !saved.runs.length;
  const runs = saved.runs.slice(-3);
  const first = saved.runs.length - runs.length;
  setText(ui.runs, runs.length ? runs.map((r, i) => `Run ${first + i + 1}: ${fmt(r.total)}`).join(', ') + ` (target ${fmt(saved.plan.target)})` : 'No runs kept for this deck yet.');
}

function render(): void {
  recompute();
  renderPlan();
  renderRows();
  renderClock();
  renderControls();
}

function tick(): void {
  renderClock();
  const li = cur ? rowEls.get(cur) : undefined;
  const s = cur ? slides().find((x) => x.id === cur) : undefined;
  if (li && s) fillRow(li, s);
}

function summary(text: string, error = false): void {
  setText(ui.summary, text);
  ui.summary.classList.toggle('is-error', error);
}

function moveTo(id: string | null): void {
  if (id === cur) return;
  const now = performance.now();
  if (state === 'running' && cur) times.set(cur, (times.get(cur) ?? 0) + (now - segAt) / 1000);
  segAt = now;
  const before = cur;
  cur = id;
  if (cur && (state === 'running' || state === 'paused') && !times.has(cur)) times.set(cur, 0);
  for (const key of [before, cur]) {
    const li = key ? rowEls.get(key) : undefined;
    const s = key ? slides().find((x) => x.id === key) : undefined;
    if (li && s) fillRow(li, s);
  }
  const li = cur ? rowEls.get(cur) : undefined;
  li?.scrollIntoView({ block: 'nearest' });
  renderClock();
}

async function show(id: string): Promise<void> {
  const s = slides().find((x) => x.id === id);
  if (!s) return;
  try {
    await goToSlide(s);
  } catch (err) {
    status(`Could not show slide ${s.n}: ${plain(err)}`, 'error');
  }
}

async function start(): Promise<void> {
  const list = planned();
  if (!list.length) return;
  times = new Map();
  cur = null;
  state = 'running';
  runStart = performance.now();
  runPaused = 0;
  segAt = runStart;
  moveTo(list[0].id);
  summary('Timing. Move on with Next or Space, or change slides in FormDeck. Finish keeps the run; Esc cancels it.');
  status('');
  render();
  window.clearInterval(timer);
  timer = window.setInterval(tick, TICK_MS);
  document.body.focus();
  await show(list[0].id);
}

function pause(): void {
  if (state === 'running') {
    if (cur) times.set(cur, (times.get(cur) ?? 0) + (performance.now() - segAt) / 1000);
    pausedAt = performance.now();
    state = 'paused';
    summary('Paused. The clock is stopped; Resume carries on from here.');
  } else if (state === 'paused') {
    const now = performance.now();
    runPaused += now - pausedAt;
    segAt = now;
    state = 'running';
    summary('Timing. Move on with Next or Space, or change slides in FormDeck. Finish keeps the run; Esc cancels it.');
  }
  render();
}

async function step(by: 1 | -1): Promise<void> {
  if (state !== 'running' && state !== 'paused') return;
  const list = planned();
  const idx = cur ? list.findIndex((s) => s.id === cur) : -1;
  const nextIdx = idx < 0 ? 0 : idx + by;
  if (nextIdx >= list.length) { await finish(); return; }
  if (nextIdx < 0) return;
  const id = list[nextIdx].id;
  moveTo(id);
  await show(id);
}

async function finish(): Promise<void> {
  if (state !== 'running' && state !== 'paused') return;
  if (state === 'running' && cur) times.set(cur, (times.get(cur) ?? 0) + (performance.now() - segAt) / 1000);
  window.clearInterval(timer);
  const slidesOut: Record<string, number> = {};
  let total = 0;
  for (const [id, v] of times) { const r = Math.round(v * 10) / 10; if (r > 0) { slidesOut[id] = r; total += r; } }
  if (!total) { cancel('Nothing was timed, so no run was kept.'); return; }
  const usedPlan = new Map(plan);
  const run: Run = { at: new Date().toISOString(), target: saved.plan.target, total: Math.round(total * 10) / 10, slides: slidesOut };
  saved.runs = [...saved.runs, run].slice(-KEEP_RUNS);
  state = 'review';
  cur = null;
  times = new Map();
  await persist();
  const over = overSlides(run, usedPlan).map((id) => slides().find((s) => s.id === id)?.n).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b);
  const prev = saved.runs[saved.runs.length - 2];
  const vsPrev = prev ? ` Last run was ${fmt(prev.total)}.` : '';
  const overText = over.length ? ` Over plan on slide${over.length === 1 ? '' : 's'} ${over.join(', ')}.` : ' Every slide was within its plan.';
  summary(`${fmt(run.total)} for a ${fmt(run.target)} target, ${diff(run.total, run.target)}.${overText}${vsPrev}`);
  render();
}

function cancel(message = 'Run cancelled. Nothing was kept.'): void {
  window.clearInterval(timer);
  state = 'idle';
  cur = deck ? currentFrom(deck) : null;
  times = new Map();
  summary(message);
  render();
  void refresh();
}

async function refresh(quiet = true): Promise<void> {
  try {
    const next = await readDeck();
    const keyChanged = next.key !== deck?.key;
    deck = next;
    if (keyChanged && state !== 'running' && state !== 'paused') {
      await loadSaved();
      state = 'idle';
      cur = currentFrom(deck);
    }
    if ((state === 'running' || state === 'paused') && cur && !deck.slides.some((s) => s.id === cur)) moveTo(currentFrom(deck));
    if (state === 'idle' || state === 'review') cur = currentFrom(deck);
    render();
    if (!quiet) status('');
  } catch (err) {
    deck = deck ?? null;
    render();
    const msg = plain(err);
    setText(ui.planNote, msg);
    ui.planNote.classList.add('is-warn');
    status(msg, 'error');
  }
}

async function write(remove: boolean): Promise<void> {
  if (busy) return;
  const run = lastRun();
  if (!remove && !run) return;
  busy = true;
  renderControls();
  status(remove ? 'Taking the timings out of the notes' : 'Writing the timings into the notes');
  try {
    const fresh = await readDeck();
    deck = fresh;
    const runNo = saved.runs.length;
    const used = budgets(fresh.slides, saved.plan, saved.runs[saved.runs.length - 2] ?? null);
    const changes: { slide: SlideInfo; notes: string }[] = [];
    for (const s of fresh.slides) {
      let next: string;
      if (remove) next = mergeNotes(s.notes, null);
      else if (run && run.slides[s.id] !== undefined) next = mergeNotes(s.notes, notesLine(run.slides[s.id], used.get(s.id), runNo, run.at, hello?.locale));
      else continue;
      if (next !== s.notes) changes.push({ slide: s, notes: next });
    }
    if (!changes.length) {
      status(remove ? 'No Rehearsal Coach lines in the notes.' : 'The notes already have these timings.');
    } else {
      await writeNotes(changes, remove ? 'Remove rehearsal timings' : 'Rehearsal timings');
      for (const c of changes) c.slide.notes = c.notes;
      const n = changes.length;
      status(remove ? `Took the timings out of ${n} slide${n === 1 ? '' : 's'}.` : `Wrote timings into ${n} slide${n === 1 ? '' : 's'}. Undo takes them all out at once.`, 'ok');
      void formext.notify(remove ? `Rehearsal Coach: removed timings from ${n} slide${n === 1 ? "'s notes" : "s' notes"}` : `Rehearsal Coach: wrote timings into ${n} slide${n === 1 ? "'s notes" : "s' notes"}`, 'success').catch(() => undefined);
    }
  } catch (err) {
    status(plain(err), 'error');
  } finally {
    busy = false;
    render();
  }
}

function pin(id: string, input: HTMLInputElement): void {
  const text = input.value.trim();
  if (!text) {
    delete saved.plan.pinned[id];
    input.classList.remove('is-bad');
  } else {
    const v = parseDuration(text, 'sec');
    if (v === null) { input.classList.add('is-bad'); status('Type a time such as 45, 1:30 or 2m.', 'error'); return; }
    input.classList.remove('is-bad');
    saved.plan.pinned[id] = v;
  }
  status('');
  void persist();
  render();
}

function wire(): void {
  ui.target.addEventListener('change', () => {
    const v = parseDuration(ui.target.value, 'min');
    if (v === null || v <= 0) { ui.target.classList.add('is-bad'); status('Type the talk length as minutes, such as 12 or 12:30.', 'error'); return; }
    ui.target.classList.remove('is-bad');
    saved.plan.target = v;
    status('');
    void persist();
    render();
  });
  ui.target.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ui.target.blur(); });
  for (const b of ui.split) {
    b.addEventListener('click', () => {
      const v = b.dataset.split as Split;
      if (v === saved.plan.split) return;
      saved.plan.split = v;
      void persist();
      render();
    });
  }
  ui.hidden.addEventListener('change', () => {
    saved.plan.includeHidden = ui.hidden.checked;
    void persist();
    render();
  });
  ui.rows.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('.rc-row');
    if (!li?.dataset.id) return;
    if (state === 'running' || state === 'paused') moveTo(li.dataset.id);
    else cur = li.dataset.id;
    render();
    void show(li.dataset.id);
  });
  document.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'go') { if (state === 'running' || state === 'paused') pause(); else void start(); }
    else if (act === 'next') void step(1);
    else if (act === 'back') void step(-1);
    else if (act === 'finish') void finish();
    else if (act === 'cancel') cancel();
    else if (act === 'write') void write(false);
    else if (act === 'unwrite') void write(true);
    else if (act === 'clear') { saved.runs = []; state = 'idle'; void persist(); summary('Runs forgotten for this deck. The notes are unchanged.'); render(); }
  });
  document.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const live = state === 'running' || state === 'paused';
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!live) void start(); else if (state === 'paused') pause(); else void step(1);
    } else if (live && (e.key === 'ArrowRight' || e.key === 'PageDown')) { e.preventDefault(); void step(1); }
    else if (live && (e.key === 'ArrowLeft' || e.key === 'PageUp')) { e.preventDefault(); void step(-1); }
    else if (live && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); pause(); }
    else if (live && e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (live && e.key === 'Enter') { e.preventDefault(); void finish(); }
  });
}

let pendingRead = 0;
function scheduleRead(): void {
  window.clearTimeout(pendingRead);
  pendingRead = window.setTimeout(() => void refresh(), 300);
}

formext.onEvent((ev) => {
  if (ev.name === 'selection.changed') {
    const id = deck ? currentFrom(deck, ev.data) : null;
    if (id && slides().some((s) => s.id === id)) {
      if (state === 'running' || state === 'paused') moveTo(id);
      else { cur = id; render(); }
      return;
    }
    scheduleRead();
  } else if (ev.name === 'document.changed' || ev.name === 'deck.opened') {
    scheduleRead();
  }
});

formext.onActivate(() => {
  void refresh();
});

formext.on('ext.deactivate', () => {
  if (state === 'running') pause();
});

async function boot(): Promise<void> {
  wire();
  render();
  try {
    hello = await formext.hello();
  } catch (err) {
    summary(`FormDeck did not answer: ${plain(err)}`, true);
    return;
  }
  await refresh(false);
}

void boot();
