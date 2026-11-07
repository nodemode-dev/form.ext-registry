import { ERR, FormExtError, formext } from './formext';
import * as M from './model';
import { chime, primeAudio } from './chime';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const root = $('ft');
const ring = $<HTMLButtonElement>('ring');
const prog = document.getElementById('prog') as unknown as SVGCircleElement;
const time = $('time');
const mini = $('mini');
const phaseEl = $('phase');
const count = $('count');
const note = $<HTMLInputElement>('note');
const go = $<HTMLButtonElement>('go');
const goText = $('goText');
const sum = $('sum');
const goalEl = $('goal');
const bars = $('bars');
const line = $('line');
const days = [...bars.querySelectorAll<HTMLButtonElement>('.ft-day')];
const daySheet = $('daySheet');
const dayTitle = $('dayTitle');
const dayMeta = $('dayMeta');
const dayList = $<HTMLOListElement>('dayList');
const dayEmpty = $('dayEmpty');
const setSheet = $('setSheet');
const msg = $('msg');
const fields = {
  focus: $<HTMLInputElement>('sFocus'),
  short: $<HTMLInputElement>('sShort'),
  long: $<HTMLInputElement>('sLong'),
  every: $<HTMLInputElement>('sEvery'),
  goal: $<HTMLInputElement>('sGoal'),
};
const sChime = $<HTMLInputElement>('sChime');
const sAuto = $<HTMLInputElement>('sAuto');
const sClear = $<HTMLButtonElement>('sClear');

const PHASE: Record<M.Phase, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const MINI: Record<M.Phase, string> = { focus: 'Focus', short: 'Break', long: 'Break' };
const LABEL: Record<M.Phase, string> = { focus: 'Focus', short: 'Break', long: 'Long break' };

let state = M.fresh();
let locale = navigator.language || 'en';
let timer = 0;
let msgTimer = 0;
let noteTimer = 0;
let clearTimer = 0;
let lastTitle = '';
let lastDay = '';
let shownDay: number | null = null;
let saving: Promise<void> = Promise.resolve();
let loaded = false;

const put = (el: Element, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};

const pad = (n: number) => String(n).padStart(2, '0');

function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(s % 60)}`;
  return `${m}:${pad(s % 60)}`;
}

const hm = (t: number) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(t);

function mins(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

function showMsg(text: string, ms = 4200) {
  put(msg, text);
  msg.hidden = false;
  window.clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (msg.hidden = true), ms);
}

function plain(err: unknown): string {
  const text = String((err as { message?: string })?.message ?? err);
  return text.endsWith('.') ? text : `${text}.`;
}

function save(): Promise<void> {
  saving = saving.then(async () => {
    M.prune(state, Date.now());
    try {
      await formext.storageSet('state', state);
    } catch (err) {
      if (err instanceof FormExtError && err.code === ERR.REFUSED) {
        M.prune(state, Date.now(), 14);
        try {
          await formext.storageSet('state', state);
          showMsg('Storage was full, so only the last two weeks of the log are kept.');
          return;
        } catch (again) {
          showMsg(`Could not save the timer: ${plain(again)}`);
          return;
        }
      }
      showMsg(`Could not save the timer: ${plain(err)}`);
    }
  });
  return saving;
}

function setTitle(text: string) {
  if (text === lastTitle) return;
  lastTitle = text;
  formext.setTitle(text).catch(() => undefined);
}

function titleFor(now: number): string {
  const run = state.run;
  if (run.status === 'running') return `${PHASE[run.phase]}, ${Math.ceil(M.left(run, now) / 60_000)} min left`;
  if (run.status === 'paused') return `Paused, ${clock(M.left(run, now))} left`;
  return '';
}

function renderTimer(now: number) {
  const run = state.run;
  const rest = run.status === 'idle' ? M.lengthOf(state.settings, run.phase) : M.left(run, now);
  const total = run.status === 'idle' ? rest : run.length;
  if (root.dataset.phase !== run.phase) root.dataset.phase = run.phase;
  if (root.dataset.status !== run.status) root.dataset.status = run.status;
  put(time, clock(rest));
  put(mini, run.status === 'paused' ? 'Paused' : MINI[run.phase]);
  put(phaseEl, LABEL[run.phase]);
  const every = state.settings.every;
  put(count, run.phase === 'focus' ? `${Math.min(run.done + 1, every)} of ${every}` : `${Math.min(run.done, every)} of ${every}`);
  const offset = String(Math.round(1000 * (1 - rest / Math.max(1, total))));
  if (prog.style.strokeDashoffset !== offset) prog.style.strokeDashoffset = offset;
  const word = run.status === 'running' ? 'Pause' : run.status === 'paused' ? 'Resume' : 'Start';
  put(goText, word);
  const label = `${word} ${run.phase === 'focus' ? 'focus' : 'break'}`;
  if (ring.getAttribute('aria-label') !== label) ring.setAttribute('aria-label', label);
  if (go.getAttribute('aria-label') !== label) go.setAttribute('aria-label', label);
  if (document.activeElement !== note && note.value !== run.note) note.value = run.note;
  setTitle(titleFor(now));
}

function renderWeek(now: number) {
  const data = M.week(state, now);
  const goal = state.settings.goal;
  const top = Math.max(goal, ...data.map((d) => d.minutes), 1);
  const narrow = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  const long = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  data.forEach((d, i) => {
    const btn = days[i];
    const fill = btn.querySelector<HTMLElement>('.ft-fill')!;
    const h = `${Math.round((100 * d.minutes) / top)}%`;
    if (fill.style.getPropertyValue('--h') !== h) fill.style.setProperty('--h', h);
    put(btn.querySelector('.ft-dl')!, narrow.format(d.day));
    const label = `${long.format(d.day)}: ${d.minutes} min of focus`;
    if (btn.title !== label) {
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    btn.dataset.day = String(d.day);
  });
  const g = String(goal / top);
  if (bars.style.getPropertyValue('--goal') !== g) bars.style.setProperty('--goal', g);
  line.hidden = goal === 0;
  const today = M.entriesOn(state, now);
  const n = M.sessions(today);
  put(sum, `Today, ${M.focusMinutes(today)} min${n ? `, ${n} done` : ''}`);
  put(goalEl, goal ? `goal ${goal} min` : '');
}

function fillDay(day: number) {
  const now = Date.now();
  const entries = M.entriesOn(state, day);
  const isToday = M.dayKey(day) === M.dayKey(now);
  put(dayTitle, isToday ? 'Today' : new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(day));
  const n = M.sessions(entries);
  put(dayMeta, `${M.focusMinutes(entries)} min, ${n} ${n === 1 ? 'session' : 'sessions'}`);
  const items = entries.map((e) => {
    const li = document.createElement('li');
    if (e.k === 'b') li.className = 'is-break';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = `${hm(e.s)}–${hm(e.e)}`;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = e.k === 'b' ? `Break, ${mins(e.m)} min` : e.ok ? `Focus, ${mins(e.m)} min` : `Stopped at ${mins(e.m)} min`;
    const nn = document.createElement('span');
    nn.className = 'n';
    nn.textContent = e.n ?? '';
    li.append(t, k, nn);
    return li;
  });
  dayList.replaceChildren(...items);
  dayEmpty.hidden = items.length > 0;
}

function render() {
  const now = Date.now();
  renderTimer(now);
  const key = M.dayKey(now);
  renderWeek(now);
  if (shownDay !== null && (lastDay !== key || M.dayKey(shownDay) === key)) fillDay(shownDay);
  lastDay = key;
}

function announce(ended: M.Ended, live: boolean) {
  let text: string;
  if (!live) {
    text = ended.phase === 'focus' ? `Your focus session ended at ${hm(ended.at)}.` : `Your break ended at ${hm(ended.at)}.`;
  } else if (ended.phase === 'focus') {
    const kind = ended.next === 'long' ? 'long' : 'short';
    text = ended.started ? `Focus session done. Your ${kind} break has started.` : `Focus session done. Time for a ${kind} break.`;
  } else {
    text = ended.started ? 'Break over. Focus has started.' : 'Break over. Ready when you are.';
  }
  formext.notify(text, 'success').catch(() => showMsg(text));
  if (live && state.settings.chime) chime(ended.phase === 'focus' ? 'focus' : 'break');
}

function settle() {
  const now = Date.now();
  const ended = M.catchUp(state, now);
  if (ended.length) {
    const last = ended[ended.length - 1];
    announce(last, now - last.at < 15_000);
    save();
  }
  render();
  schedule();
}

function schedule() {
  window.clearTimeout(timer);
  if (state.run.status !== 'running') return;
  const rest = M.left(state.run, Date.now());
  const wait = rest <= 0 ? 0 : (rest % 1000 || 1000) + 15;
  timer = window.setTimeout(settle, wait);
}

function toggle() {
  if (!loaded) return;
  const now = Date.now();
  if (state.run.status === 'running') M.pause(state, now);
  else M.start(state, now);
  save();
  render();
  schedule();
}

function skip() {
  if (!loaded) return;
  const now = Date.now();
  const was = state.run.status === 'running';
  M.finish(state, now, false);
  if (was) M.start(state, now);
  save();
  render();
  schedule();
}

function resetRun() {
  if (!loaded) return;
  M.reset(state, Date.now());
  save();
  render();
  schedule();
}

function openDay(day: number) {
  shownDay = day;
  setSheet.hidden = true;
  fillDay(day);
  daySheet.hidden = false;
}

function closeSheets() {
  shownDay = null;
  daySheet.hidden = true;
  setSheet.hidden = true;
  disarmClear();
}

function openSettings() {
  shownDay = null;
  daySheet.hidden = true;
  const s = state.settings;
  for (const [k, input] of Object.entries(fields)) input.value = String(s[k as keyof typeof fields]);
  sChime.checked = s.chime;
  sAuto.checked = s.auto;
  setSheet.hidden = false;
}

function disarmClear() {
  window.clearTimeout(clearTimer);
  delete sClear.dataset.armed;
  put(sClear, 'Clear log');
}

function status() {
  const now = Date.now();
  const run = state.run;
  return {
    phase: run.phase,
    status: run.status,
    left_seconds: Math.ceil((run.status === 'idle' ? M.lengthOf(state.settings, run.phase) : M.left(run, now)) / 1000),
    today_minutes: M.focusMinutes(M.entriesOn(state, now)),
  };
}

document.addEventListener('pointerdown', () => primeAudio(), { capture: true });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheets();
});
document.addEventListener('visibilitychange', () => settle());
ring.addEventListener('click', toggle);
go.addEventListener('click', toggle);
$('skip').addEventListener('click', skip);
$('reset').addEventListener('click', resetRun);
$('gear').addEventListener('click', openSettings);
$('dayBack').addEventListener('click', closeSheets);
$('setBack').addEventListener('click', closeSheets);
for (const d of days) d.addEventListener('click', () => openDay(Number(d.dataset.day) || M.dayStart(Date.now())));

note.addEventListener('input', () => {
  state.run.note = note.value.slice(0, 80);
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(save, 600);
});
note.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') note.blur();
});

for (const [k, input] of Object.entries(fields)) {
  input.addEventListener('change', () => {
    const key = k as keyof typeof fields;
    const v = M.clampSetting(key, input.value, state.settings[key]);
    input.value = String(v);
    state.settings[key] = v;
    if (state.run.status === 'idle') state.run.length = M.lengthOf(state.settings, state.run.phase);
    save();
    render();
  });
}
sChime.addEventListener('change', () => {
  state.settings.chime = sChime.checked;
  save();
});
sAuto.addEventListener('change', () => {
  state.settings.auto = sAuto.checked;
  save();
});
$('sTest').addEventListener('click', () => {
  if (!chime('focus')) showMsg('This window cannot play sound right now.');
});
sClear.addEventListener('click', () => {
  if (!sClear.dataset.armed) {
    sClear.dataset.armed = '1';
    put(sClear, 'Click again to clear');
    clearTimer = window.setTimeout(disarmClear, 3500);
    return;
  }
  disarmClear();
  state.log = [];
  save();
  render();
  showMsg('The session log is cleared.');
});

const ready = (async () => {
  try {
    const hello = await formext.hello();
    if (hello.locale) locale = hello.locale;
  } catch {
    showMsg('Focus Timer runs inside FormTray. Add it to the Widgets board from the Extensions panel.', 12_000);
  }
  try {
    state = M.revive(await formext.storageGet('state'));
  } catch (err) {
    showMsg(`Could not read your saved sessions: ${plain(err)}`, 8000);
  }
  loaded = true;
  settle();
  requestAnimationFrame(() => requestAnimationFrame(() => (root.dataset.live = '1')));
})();

formext.onActivate(async (a) => {
  await ready;
  if (a.reason === 'command') {
    if (a.command === 'toggle') toggle();
    else if (a.command === 'skip') skip();
    else if (a.command === 'today') openDay(M.dayStart(Date.now()));
    else throw new FormExtError(ERR.INVALID, `Focus Timer has no command ${a.command}`);
  }
  return status();
});

formext.on('ext.deactivate', () => {
  window.clearTimeout(timer);
  save();
});

window.setInterval(() => {
  if (M.dayKey(Date.now()) !== lastDay) render();
}, 30_000);
