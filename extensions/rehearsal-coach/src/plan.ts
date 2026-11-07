export interface SlideInfo { id: string; n: number; title: string; notes: string; hidden: boolean }

export type Split = 'even' | 'last';

export interface Plan { target: number; split: Split; pinned: Record<string, number>; includeHidden: boolean }

export interface Run { at: string; target: number; total: number; slides: Record<string, number> }

export const MARK = 'Rehearsal Coach:';
export const NEAR = 2;

export function defaultPlan(): Plan {
  return { target: 600, split: 'even', pinned: {}, includeHidden: false };
}

export function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function parseDuration(text: string, bareUnit: 'min' | 'sec' = 'min'): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const parts = /^(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(t);
  if (parts) {
    const nums = [parts[1], parts[2], parts[3]].filter((p) => p !== undefined).map(Number);
    if (nums.length === 1) return bareUnit === 'min' ? nums[0] * 60 : nums[0];
    if (nums.slice(1).some((v) => v > 59)) return null;
    return nums.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2];
  }
  const unit = /^(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)$/.exec(t);
  if (!unit) return null;
  const v = Number(unit[1]);
  const u = unit[2][0];
  return Math.round(u === 'h' ? v * 3600 : u === 'm' ? v * 60 : v);
}

export function inPlan(slides: SlideInfo[], plan: Plan): SlideInfo[] {
  return plan.includeHidden ? slides : slides.filter((s) => !s.hidden);
}

function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  const raw = weights.map((w) => (sum > 0 ? (total * w) / sum : total / weights.length));
  const out = raw.map(Math.floor);
  let left = Math.max(0, Math.round(total) - out.reduce((a, b) => a + b, 0));
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++;
  return out;
}

export function budgets(slides: SlideInfo[], plan: Plan, last: Run | null): Map<string, number> {
  const list = inPlan(slides, plan);
  const out = new Map<string, number>();
  let pinnedSum = 0;
  const free: SlideInfo[] = [];
  for (const s of list) {
    const p = plan.pinned[s.id];
    if (typeof p === 'number') { out.set(s.id, p); pinnedSum += p; } else free.push(s);
  }
  const rest = Math.max(0, plan.target - pinnedSum);
  let weights = free.map(() => 1);
  if (plan.split === 'last' && last) {
    const seen = free.map((s) => last.slides[s.id]).filter((v): v is number => typeof v === 'number' && v > 0);
    const avg = seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : 1;
    weights = free.map((s) => { const v = last.slides[s.id]; return typeof v === 'number' && v > 0 ? v : avg; });
  }
  spread(rest, weights).forEach((v, i) => out.set(free[i].id, v));
  return out;
}

export function overPinned(slides: SlideInfo[], plan: Plan): boolean {
  let sum = 0;
  for (const s of inPlan(slides, plan)) { const p = plan.pinned[s.id]; if (typeof p === 'number') sum += p; }
  return sum > plan.target;
}

export type Tone = 'ok' | 'warn' | 'over' | 'none';

export function tone(spent: number, budget: number): Tone {
  if (!(budget > 0)) return spent > 0 ? 'warn' : 'none';
  const d = spent - budget;
  if (d <= NEAR) return 'ok';
  return d <= Math.max(5, budget * 0.2) ? 'warn' : 'over';
}

export function diff(spent: number, budget: number): string {
  const d = Math.round(spent - budget);
  if (Math.abs(d) <= NEAR) return 'on time';
  return `${fmt(Math.abs(d))} ${d > 0 ? 'over' : 'under'}`;
}

export function pace(elapsed: number, planned: number): string {
  const d = Math.round(elapsed - planned);
  if (Math.abs(d) <= NEAR) return 'On plan';
  return d > 0 ? `${fmt(d)} behind` : `${fmt(-d)} ahead`;
}

export function dateLabel(iso: string, locale = 'en-GB'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function notesLine(spent: number, budget: number | undefined, runNo: number, iso: string, locale?: string): string {
  const plan = typeof budget === 'number' && budget > 0 ? `, plan ${fmt(budget)} (${diff(spent, budget)})` : '';
  return `${MARK} ${fmt(spent)} on this slide${plan}. Run ${runNo}, ${dateLabel(iso, locale)}.`;
}

export function mergeNotes(notes: string, line: string | null): string {
  const lines = (notes ?? '').replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trimStart().startsWith(MARK));
  if (at >= 0) {
    if (line === null) lines.splice(at, 1);
    else lines[at] = line;
  } else if (line !== null) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push('');
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

export function hasLine(notes: string): boolean {
  return (notes ?? '').split(/\r?\n/).some((l) => l.trimStart().startsWith(MARK));
}

export function overSlides(run: Run, b: Map<string, number>): string[] {
  return Object.keys(run.slides).filter((id) => { const t = tone(run.slides[id], b.get(id) ?? 0); return t === 'over' || t === 'warn'; });
}
