export type Phase = 'focus' | 'short' | 'long';
export type Status = 'idle' | 'running' | 'paused';

export interface Settings {
  focus: number;
  short: number;
  long: number;
  every: number;
  goal: number;
  chime: boolean;
  auto: boolean;
}

export interface Run {
  phase: Phase;
  status: Status;
  length: number;
  spent: number;
  resumed: number;
  started: number;
  done: number;
  note: string;
}

export interface Entry {
  s: number;
  e: number;
  m: number;
  k: 'f' | 'b';
  ok: boolean;
  n?: string;
}

export interface State {
  v: 1;
  settings: Settings;
  run: Run;
  log: Entry[];
}

export interface Ended {
  phase: Phase;
  at: number;
  next: Phase;
  started: boolean;
}

const MIN = 60_000;
const KEEP_DAYS = 60;
const KEEP_ENTRIES = 1500;

export const DEFAULTS: Settings = { focus: 25, short: 5, long: 15, every: 4, goal: 120, chime: true, auto: false };

export const LIMITS: Record<'focus' | 'short' | 'long' | 'every' | 'goal', [number, number]> = {
  focus: [1, 180],
  short: [1, 60],
  long: [1, 90],
  every: [1, 12],
  goal: [0, 720],
};

export function clampSetting(key: keyof typeof LIMITS, value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  const [lo, hi] = LIMITS[key];
  return Math.min(hi, Math.max(lo, n));
}

export function lengthOf(settings: Settings, phase: Phase): number {
  return settings[phase] * MIN;
}

export function idleRun(settings: Settings, phase: Phase, done: number, note = ''): Run {
  return { phase, status: 'idle', length: lengthOf(settings, phase), spent: 0, resumed: 0, started: 0, done, note };
}

export function fresh(): State {
  return { v: 1, settings: { ...DEFAULTS }, run: idleRun(DEFAULTS, 'focus', 0), log: [] };
}

export function revive(raw: unknown): State {
  const base = fresh();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<State>;
  const s = (r.settings ?? {}) as Partial<Settings>;
  const settings: Settings = {
    focus: clampSetting('focus', s.focus, DEFAULTS.focus),
    short: clampSetting('short', s.short, DEFAULTS.short),
    long: clampSetting('long', s.long, DEFAULTS.long),
    every: clampSetting('every', s.every, DEFAULTS.every),
    goal: clampSetting('goal', s.goal, DEFAULTS.goal),
    chime: s.chime !== false,
    auto: s.auto === true,
  };
  const log = Array.isArray(r.log)
    ? r.log.filter((e): e is Entry => !!e && typeof e === 'object' && Number.isFinite(e.s) && Number.isFinite(e.e) && Number.isFinite(e.m) && (e.k === 'f' || e.k === 'b'))
    : [];
  const u = (r.run ?? {}) as Partial<Run>;
  const phase: Phase = u.phase === 'short' || u.phase === 'long' ? u.phase : 'focus';
  const status: Status = u.status === 'running' || u.status === 'paused' ? u.status : 'idle';
  const run: Run = {
    phase,
    status,
    length: status === 'idle' ? lengthOf(settings, phase) : Math.max(MIN / 60, Number(u.length) || lengthOf(settings, phase)),
    spent: Math.max(0, Number(u.spent) || 0),
    resumed: Number(u.resumed) || 0,
    started: Number(u.started) || 0,
    done: Math.max(0, Math.floor(Number(u.done) || 0)),
    note: typeof u.note === 'string' ? u.note.slice(0, 80) : '',
  };
  return { v: 1, settings, run, log };
}

export function elapsed(run: Run, now: number): number {
  return run.spent + (run.status === 'running' ? Math.max(0, now - run.resumed) : 0);
}

export function left(run: Run, now: number): number {
  return Math.max(0, run.length - elapsed(run, now));
}

export function endsAt(run: Run): number {
  return run.resumed + run.length - run.spent;
}

export function start(state: State, now: number) {
  const run = state.run;
  if (run.status === 'running') return;
  if (run.status === 'idle') {
    run.length = lengthOf(state.settings, run.phase);
    run.spent = 0;
    run.started = now;
  }
  run.resumed = now;
  run.status = 'running';
}

export function pause(state: State, now: number) {
  const run = state.run;
  if (run.status !== 'running') return;
  run.spent = elapsed(run, now);
  run.status = 'paused';
}

function record(state: State, at: number, complete: boolean) {
  const run = state.run;
  if (run.status === 'idle') return;
  const m = Math.min(run.length, elapsed(run, at));
  const focus = run.phase === 'focus';
  if (!complete && m < MIN) return;
  const entry: Entry = { s: run.started, e: at, m: Math.round(m / 1000) * 1000, k: focus ? 'f' : 'b', ok: complete };
  if (focus && run.note.trim()) entry.n = run.note.trim();
  state.log.push(entry);
}

function following(state: State, complete: boolean): { phase: Phase; done: number } {
  const run = state.run;
  if (run.phase !== 'focus') return { phase: 'focus', done: run.phase === 'long' ? 0 : run.done };
  const done = complete ? run.done + 1 : run.done;
  if (complete && done >= state.settings.every) return { phase: 'long', done };
  return { phase: 'short', done };
}

export function finish(state: State, at: number, complete: boolean): Ended {
  const from = state.run.phase;
  const wasRunning = state.run.status !== 'idle';
  record(state, at, complete);
  const next = following(state, complete);
  state.run = idleRun(state.settings, next.phase, next.done, state.run.note);
  const auto = complete && wasRunning && state.settings.auto;
  if (auto) start(state, at);
  return { phase: from, at, next: next.phase, started: auto };
}

export function reset(state: State, now: number) {
  record(state, now, false);
  state.run = idleRun(state.settings, state.run.phase, state.run.done, state.run.note);
}

export function catchUp(state: State, now: number): Ended[] {
  const out: Ended[] = [];
  for (let i = 0; i < 64 && state.run.status === 'running' && endsAt(state.run) <= now; i++) out.push(finish(state, endsAt(state.run), true));
  return out;
}

export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayStart(t: number, offset = 0): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
}

export function entriesOn(state: State, day: number): Entry[] {
  const key = dayKey(day);
  return state.log.filter((e) => dayKey(e.s) === key).sort((a, b) => a.s - b.s);
}

export function focusMinutes(entries: Entry[]): number {
  return Math.round(entries.reduce((n, e) => n + (e.k === 'f' ? e.m : 0), 0) / MIN);
}

export function sessions(entries: Entry[]): number {
  return entries.filter((e) => e.k === 'f' && e.ok).length;
}

export function week(state: State, now: number): { day: number; minutes: number }[] {
  const out: { day: number; minutes: number }[] = [];
  for (let i = -6; i <= 0; i++) {
    const day = dayStart(now, i);
    out.push({ day, minutes: focusMinutes(entriesOn(state, day)) });
  }
  return out;
}

export function prune(state: State, now: number, keepDays = KEEP_DAYS) {
  const oldest = dayStart(now, -keepDays);
  state.log = state.log.filter((e) => e.s >= oldest);
  if (state.log.length > KEEP_ENTRIES) state.log = state.log.slice(-KEEP_ENTRIES);
}
