const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J2000 = 2451545.0;
const EARTH_RADIUS_KM = 6378.14;
const SUN_DIST_KM = 149_598_000;

export const ALT = { goldenTop: 6, sunrise: -0.833, goldenLow: -4, civil: -6, nautical: -12, astronomical: -18, highSun: 50 } as const;

export interface Position {
  altitude: number;
  azimuth: number;
}

export interface MoonInfo extends Position {
  fraction: number;
  phase: number;
  phaseName: string;
  distanceKm: number;
}

function days(ms: number) {
  return ms / DAY_MS + 2440587.5 - J2000;
}

function norm(deg: number) {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

function obliquity(d: number) {
  return (23.439 - 0.00000036 * d) * RAD;
}

function sunEquatorial(d: number) {
  const g = norm(357.529 + 0.98560028 * d) * RAD;
  const q = norm(280.459 + 0.98564736 * d);
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = obliquity(d);
  return { ra: Math.atan2(Math.cos(e) * Math.sin(lambda), Math.cos(lambda)), dec: Math.asin(Math.sin(e) * Math.sin(lambda)) };
}

function moonEquatorial(d: number) {
  const L = norm(218.316 + 13.176396 * d) * RAD;
  const M = norm(134.963 + 13.064993 * d) * RAD;
  const F = norm(93.272 + 13.22935 * d) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M);
  const b = 5.128 * RAD * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M);
  const e = obliquity(d);
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)),
    dist,
  };
}

function siderealRad(d: number, lon: number) {
  return norm(280.46061837 + 360.98564736629 * d + lon) * RAD;
}

function horizontal(ra: number, dec: number, d: number, lat: number, lon: number): Position {
  const phi = lat * RAD;
  const H = siderealRad(d, lon) - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H));
  return { altitude: alt / RAD, azimuth: norm(az / RAD) };
}

export function sunPosition(ms: number, lat: number, lon: number): Position {
  const d = days(ms);
  const s = sunEquatorial(d);
  return horizontal(s.ra, s.dec, d, lat, lon);
}

export function moonPosition(ms: number, lat: number, lon: number): MoonInfo {
  const d = days(ms);
  const m = moonEquatorial(d);
  const p = horizontal(m.ra, m.dec, d, lat, lon);
  const parallax = Math.asin(EARTH_RADIUS_KM / m.dist);
  const altitude = p.altitude - (parallax * Math.cos(p.altitude * RAD)) / RAD;
  const s = sunEquatorial(d);
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(SUN_DIST_KM * Math.sin(phi), m.dist - SUN_DIST_KM * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  const fraction = (1 + Math.cos(inc)) / 2;
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  return { altitude, azimuth: p.azimuth, fraction, phase, phaseName: phaseName(phase), distanceKm: m.dist };
}

export function phaseName(phase: number) {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.floor(((phase % 1) + 1 / 16) * 8) % 8];
}

export interface Span {
  start: number | null;
  end: number | null;
}

export interface DayEvents {
  dayStart: number;
  noon: number;
  noonAltitude: number;
  sunrise: number | null;
  sunset: number | null;
  goldenMorning: Span;
  goldenEvening: Span;
  blueMorning: Span;
  blueEvening: Span;
  civilDawn: number | null;
  civilDusk: number | null;
  nauticalDawn: number | null;
  nauticalDusk: number | null;
  astroDawn: number | null;
  astroDusk: number | null;
  moonrise: number | null;
  moonset: number | null;
  polar: 'day' | 'night' | null;
  samples: { t: number; sun: Position; moon: Position }[];
}

const STEP_MS = 5 * 60_000;

function crossings(t0: number, alt: (t: number) => number, values: number[], level: number) {
  const up: number[] = [];
  const down: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1] - level;
    const b = values[i] - level;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      let lo = t0 + (i - 1) * STEP_MS;
      let hi = t0 + i * STEP_MS;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if ((alt(mid) - level < 0) === a < 0) lo = mid;
        else hi = mid;
      }
      (a < 0 ? up : down).push(Math.round((lo + hi) / 2));
    }
  }
  return { up, down };
}

export function dayEvents(dayStart: number, lat: number, lon: number): DayEvents {
  const n = DAY_MS / STEP_MS;
  const samples: DayEvents['samples'] = [];
  for (let i = 0; i <= n; i++) {
    const t = dayStart + i * STEP_MS;
    samples.push({ t, sun: sunPosition(t, lat, lon), moon: moonPosition(t, lat, lon) });
  }
  const sunAlt = (t: number) => sunPosition(t, lat, lon).altitude;
  const moonAlt = (t: number) => moonPosition(t, lat, lon).altitude;
  const sv = samples.map((s) => s.sun.altitude);
  const mv = samples.map((s) => s.moon.altitude);
  const at = (level: number) => crossings(dayStart, sunAlt, sv, level);
  const first = (list: number[]) => (list.length ? list[0] : null);
  const last = (list: number[]) => (list.length ? list[list.length - 1] : null);
  const top = at(ALT.goldenTop);
  const rise = at(ALT.sunrise);
  const low = at(ALT.goldenLow);
  const civil = at(ALT.civil);
  const naut = at(ALT.nautical);
  const astro = at(ALT.astronomical);
  const moon = crossings(dayStart, moonAlt, mv, ALT.sunrise);
  let best = 0;
  for (let i = 1; i < sv.length; i++) if (sv[i] > sv[best]) best = i;
  let lo = dayStart + Math.max(0, best - 1) * STEP_MS;
  let hi = dayStart + Math.min(n, best + 1) * STEP_MS;
  for (let k = 0; k < 30; k++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (sunAlt(a) < sunAlt(b)) lo = a;
    else hi = b;
  }
  const noon = Math.round((lo + hi) / 2);
  const noonAltitude = sunAlt(noon);
  const minAlt = Math.min(...sv);
  const polar = minAlt > ALT.sunrise ? 'day' : noonAltitude < ALT.sunrise ? 'night' : null;
  const morningSpan = (from: number[], to: number[]): Span => {
    const s = first(from);
    const e = to.find((t) => s === null || t > s) ?? null;
    return { start: s, end: e };
  };
  const eveningSpan = (from: number[], to: number[]): Span => {
    const e = last(to);
    const before = from.filter((t) => e === null || t < e);
    return { start: before.length ? before[before.length - 1] : null, end: e };
  };
  return {
    dayStart,
    noon,
    noonAltitude,
    sunrise: first(rise.up),
    sunset: last(rise.down),
    goldenMorning: morningSpan(low.up, top.up),
    goldenEvening: eveningSpan(top.down, low.down),
    blueMorning: morningSpan(civil.up, low.up),
    blueEvening: eveningSpan(low.down, civil.down),
    civilDawn: first(civil.up),
    civilDusk: last(civil.down),
    nauticalDawn: first(naut.up),
    nauticalDusk: last(naut.down),
    astroDawn: first(astro.up),
    astroDusk: last(astro.down),
    moonrise: first(moon.up),
    moonset: first(moon.down),
    polar,
    samples,
  };
}

export type LightKind = 'night' | 'astronomical-twilight' | 'nautical-twilight' | 'blue-hour' | 'golden-hour' | 'daylight' | 'high-sun';

export const LIGHT_NAMES: Record<LightKind, string> = {
  night: 'Night',
  'astronomical-twilight': 'Astronomical twilight',
  'nautical-twilight': 'Nautical twilight',
  'blue-hour': 'Blue hour',
  'golden-hour': 'Golden hour',
  daylight: 'Daylight',
  'high-sun': 'High sun',
};

export function lightKind(altitude: number): LightKind {
  if (altitude < ALT.astronomical) return 'night';
  if (altitude < ALT.nautical) return 'astronomical-twilight';
  if (altitude < ALT.civil) return 'nautical-twilight';
  if (altitude < ALT.goldenLow) return 'blue-hour';
  if (altitude < ALT.goldenTop) return 'golden-hour';
  if (altitude < ALT.highSun) return 'daylight';
  return 'high-sun';
}

export function isRising(ms: number, lat: number, lon: number) {
  return sunPosition(ms + 60_000, lat, lon).altitude > sunPosition(ms - 60_000, lat, lon).altitude;
}

export function angleBetween(a: number, b: number) {
  const d = Math.abs(norm(a) - norm(b)) % 360;
  return d > 180 ? 360 - d : d;
}

export function compass(az: number) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(norm(az) / 22.5) % 16];
}
