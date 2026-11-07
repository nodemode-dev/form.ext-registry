import type { Stroke } from './skeleton';

export interface Letter {
  char: string;
  spaceBefore: boolean;
  strokes: Stroke[];
}

export interface Settings {
  duration: number;
  lift: number;
  letterGap: number;
  ease: number;
  mode: 'reveal' | 'ink';
  ink: string;
  inkWidth: number;
  start: 'now' | 'in';
}

export const DEFAULTS: Settings = { duration: 3, lift: 0.06, letterGap: 0.1, ease: 45, mode: 'reveal', ink: '#ffffff', inkWidth: 0, start: 'now' };

export interface Timed {
  stroke: Stroke;
  letter: number;
  t0: number;
  t1: number;
}

export function schedule(letters: Letter[], s: Settings, fps: number): Timed[] {
  const flat: { stroke: Stroke; letter: number; gap: number }[] = [];
  letters.forEach((l, li) => {
    l.strokes.forEach((st, si) => {
      const gap = flat.length === 0 ? 0 : si === 0 ? s.letterGap * (l.spaceBefore ? 2 : 1) : s.lift;
      flat.push({ stroke: st, letter: li, gap });
    });
  });
  if (!flat.length) return [];
  const frame = 1 / Math.max(1, fps);
  const total = Math.max(frame * flat.length, s.duration);
  let gaps = flat.reduce((a, f) => a + f.gap, 0);
  const minDraw = frame * 2 * flat.length;
  const gapScale = gaps > 0 && total - gaps < Math.max(minDraw, total * 0.35) ? Math.max(0, total - Math.max(minDraw, total * 0.35)) / gaps : 1;
  gaps *= gapScale;
  const draw = Math.max(total - gaps, frame * flat.length);
  const weights = flat.map((f) => Math.max(f.stroke.length, 1e-6) ** 0.85);
  const sum = weights.reduce((a, b) => a + b, 0);
  const snap = (t: number) => Math.round(t / frame) * frame;
  const out: Timed[] = [];
  let t = 0;
  for (let i = 0; i < flat.length; i++) {
    t += flat[i].gap * gapScale;
    const d = Math.max(frame, (draw * weights[i]) / sum);
    const t0 = snap(t);
    let t1 = snap(t + d);
    if (t1 <= t0) t1 = t0 + frame;
    out.push({ stroke: flat[i].stroke, letter: flat[i].letter, t0, t1 });
    t += d;
  }
  return out;
}

export function progressAt(timed: Timed, t: number, ease: number): number {
  if (t <= timed.t0) return 0;
  if (t >= timed.t1) return 1;
  const u = (t - timed.t0) / (timed.t1 - timed.t0);
  const k = Math.min(1, (Math.max(0, Math.min(100, ease)) / 100) * 1.4);
  const smooth = u * u * (3 - 2 * u);
  return Math.max(0, Math.min(1, u + (smooth - u) * k));
}
