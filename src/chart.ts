import { ALT } from './astro';
import { Analysis } from './photos';

export type Palette = Record<'night' | 'astro' | 'nautical' | 'blue' | 'golden' | 'day' | 'high' | 'sun' | 'moon' | 'ink' | 'muted' | 'line' | 'accent' | 'field', string>;

export const SCREEN: Palette = {
  night: 'var(--gh-night)',
  astro: 'var(--gh-astro)',
  nautical: 'var(--gh-nautical)',
  blue: 'var(--gh-blue)',
  golden: 'var(--gh-golden)',
  day: 'var(--gh-day)',
  high: 'var(--gh-high)',
  sun: 'var(--gh-sun)',
  moon: 'var(--gh-moon)',
  ink: 'var(--gh-ink)',
  muted: 'var(--gh-muted)',
  line: 'var(--gh-line-strong)',
  accent: 'var(--gh-accent)',
  field: 'var(--gh-field)',
};

export function resolvedPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const out = {} as Palette;
  for (const key of Object.keys(SCREEN) as (keyof Palette)[]) {
    const name = SCREEN[key].slice(4, -1);
    out[key] = style.getPropertyValue(name).trim() || '#888888';
  }
  return out;
}

const W = 320;
const H = 168;
const X0 = 26;
const X1 = 312;
const Y0 = 8;
const Y1 = 150;
const TOP = 90;
const BOTTOM = -30;

const f = (n: number) => n.toFixed(1);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function y(alt: number) {
  const a = Math.max(BOTTOM, Math.min(TOP, alt));
  return Y0 + ((TOP - a) / (TOP - BOTTOM)) * (Y1 - Y0);
}

function x(t: number, dayStart: number) {
  return X0 + ((t - dayStart) / 86_400_000) * (X1 - X0);
}

export function emptyChart(p: Palette, message: string) {
  return `<rect x="0" y="0" width="${W}" height="${H}" fill="${p.field}"/><text x="${W / 2}" y="${H / 2 + 3}" text-anchor="middle" fill="${p.muted}">${esc(message)}</text>`;
}

export function dayChart(a: Analysis, p: Palette) {
  const e = a.events!;
  const bands: [number, number, string, string][] = [
    [BOTTOM, ALT.astronomical, p.night, 'night'],
    [ALT.astronomical, ALT.nautical, p.astro, 'astronomical'],
    [ALT.nautical, ALT.civil, p.nautical, 'nautical'],
    [ALT.civil, ALT.goldenLow, p.blue, 'blue'],
    [ALT.goldenLow, ALT.goldenTop, p.golden, 'golden'],
    [ALT.goldenTop, ALT.highSun, p.day, 'day'],
    [ALT.highSun, TOP, p.high, ''],
  ];
  let out = `<rect x="0" y="0" width="${W}" height="${H}" fill="${p.field}"/>`;
  for (const [lo, hi, fill, label] of bands) {
    out += `<rect x="${X0}" y="${f(y(hi))}" width="${X1 - X0}" height="${f(y(lo) - y(hi))}" fill="${fill}" opacity="0.55"/>`;
    if (label && y(lo) - y(hi) >= 9) out += `<text class="t-band" x="${X0 + 3}" y="${f((y(lo) + y(hi)) / 2 + 3)}" fill="${p.ink}">${label}</text>`;
  }
  out += `<line x1="${X0}" x2="${X1}" y1="${f(y(0))}" y2="${f(y(0))}" stroke="${p.ink}" stroke-width="0.8" opacity="0.6"/>`;
  for (const alt of [60, 30, 0, -18]) out += `<text x="${X0 - 3}" y="${f(y(alt) + 3)}" text-anchor="end" fill="${p.muted}">${alt}°</text>`;
  for (let h = 0; h <= 24; h += 3) {
    const xx = X0 + (h / 24) * (X1 - X0);
    out += `<line x1="${f(xx)}" x2="${f(xx)}" y1="${Y0}" y2="${Y1}" stroke="${p.ink}" stroke-width="0.4" opacity="0.18"/>`;
    if (h % 6 === 0) out += `<text x="${f(xx)}" y="${Y1 + 12}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}" fill="${p.muted}">${String(h).padStart(2, '0')}:00</text>`;
  }
  const line = (key: 'sun' | 'moon') => e.samples.map((s) => `${f(x(s.t, e.dayStart))},${f(y(s[key].altitude))}`).join(' ');
  out += `<polyline points="${line('moon')}" fill="none" stroke="${p.moon}" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.85"/>`;
  out += `<polyline points="${line('sun')}" fill="none" stroke="${p.sun}" stroke-width="2"/>`;
  const cx = x(a.utc!, e.dayStart);
  out += `<line x1="${f(cx)}" x2="${f(cx)}" y1="${Y0}" y2="${Y1}" stroke="${p.accent}" stroke-width="1.2"/>`;
  out += `<circle cx="${f(cx)}" cy="${f(y(a.sun!.altitude))}" r="4" fill="${p.sun}" stroke="${p.accent}" stroke-width="1.5"/>`;
  out += `<circle cx="${f(cx)}" cy="${f(y(a.moon!.altitude))}" r="3" fill="${p.moon}" stroke="${p.field}" stroke-width="1"/>`;
  return out;
}

export function skyChart(a: Analysis, p: Palette) {
  const e = a.events!;
  const cx = W / 2;
  const cy = 82;
  const R = 64;
  const pt = (alt: number, az: number) => {
    const r = (R * (90 - Math.max(0, alt))) / 90;
    const rad = (az * Math.PI) / 180;
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
  };
  let out = `<rect x="0" y="0" width="${W}" height="${H}" fill="${p.field}"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${p.day}" opacity="0.18" stroke="${p.line}" stroke-width="1"/>`;
  for (const alt of [30, 60]) out += `<circle cx="${cx}" cy="${cy}" r="${f((R * (90 - alt)) / 90)}" fill="none" stroke="${p.line}" stroke-width="0.6" stroke-dasharray="2 3"/>`;
  for (const [label, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [string, number][]) {
    const [lx, ly] = [cx + (R + 9) * Math.sin((az * Math.PI) / 180), cy - (R + 9) * Math.cos((az * Math.PI) / 180)];
    out += `<text x="${f(lx)}" y="${f(ly + 3)}" text-anchor="middle" fill="${p.muted}">${label}</text>`;
  }
  let seg: string[] = [];
  let gold: string[] = [];
  const paths: string[] = [];
  const golds: string[] = [];
  for (const s of e.samples) {
    const alt = s.sun.altitude;
    if (alt >= 0) {
      const [px, py] = pt(alt, s.sun.azimuth);
      seg.push(`${f(px)},${f(py)}`);
      if (alt < ALT.goldenTop) gold.push(`${f(px)},${f(py)}`);
      else if (gold.length) (golds.push(gold.join(' ')), (gold = []));
    } else {
      if (seg.length) (paths.push(seg.join(' ')), (seg = []));
      if (gold.length) (golds.push(gold.join(' ')), (gold = []));
    }
  }
  if (seg.length) paths.push(seg.join(' '));
  if (gold.length) golds.push(gold.join(' '));
  for (const d of paths) out += `<polyline points="${d}" fill="none" stroke="${p.sun}" stroke-width="1.6" opacity="0.9"/>`;
  for (const d of golds) out += `<polyline points="${d}" fill="none" stroke="${p.golden}" stroke-width="3.2" stroke-linecap="round"/>`;
  if (a.photo.heading !== null) {
    const [hx, hy] = pt(0, a.photo.heading);
    out += `<line x1="${cx}" y1="${cy}" x2="${f(hx)}" y2="${f(hy)}" stroke="${p.accent}" stroke-width="1.4" stroke-dasharray="4 2"/>`;
    out += `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${p.accent}"/>`;
  }
  const moon = a.moon!;
  if (moon.altitude >= 0) {
    const [mx, my] = pt(moon.altitude, moon.azimuth);
    out += `<circle cx="${f(mx)}" cy="${f(my)}" r="4" fill="${p.moon}" stroke="${p.field}" stroke-width="1"/>`;
  }
  const sun = a.sun!;
  const [sx, sy] = pt(sun.altitude, sun.azimuth);
  out += sun.altitude >= 0
    ? `<circle cx="${f(sx)}" cy="${f(sy)}" r="5" fill="${p.sun}" stroke="${p.accent}" stroke-width="1.5"/>`
    : `<circle cx="${f(sx)}" cy="${f(sy)}" r="4" fill="none" stroke="${p.sun}" stroke-width="1.5" stroke-dasharray="2 2"/>`;
  const note = sun.altitude >= 0 ? '' : 'Sun below the horizon';
  out += `<text x="6" y="14" fill="${p.muted}">${note}</text>`;
  if (a.photo.heading !== null) out += `<text x="${W - 6}" y="14" text-anchor="end" fill="${p.accent}">camera ${Math.round(a.photo.heading)}°</text>`;
  return out;
}

export function standalone(inner: string, title: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}" font-family="system-ui, sans-serif" font-size="9"><title>${esc(title)}</title>${inner}</svg>\n`;
}
