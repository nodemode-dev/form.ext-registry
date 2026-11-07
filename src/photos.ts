import { FormExt } from './formext';
import { ALT, angleBetween, dayEvents, DayEvents, isRising, LightKind, lightKind, MoonInfo, moonPosition, Position, sunPosition } from './astro';

export interface PhotoRecord {
  id: number;
  file: string;
  captureTime: string | null;
  lat: number | null;
  lon: number | null;
  heading: number | null;
  keywords: string[];
}

export interface Options {
  parent: string;
  timeOfDay: boolean;
  direction: boolean;
  moonlit: boolean;
  zone: 'auto' | number;
}

export const DEFAULT_OPTIONS: Options = { parent: 'Light', timeOfDay: true, direction: true, moonlit: true, zone: 'auto' };

export interface Analysis {
  photo: PhotoRecord;
  ok: boolean;
  reason?: string;
  utc?: number;
  offsetMin?: number;
  zoneSource?: 'photo' | 'estimated' | 'chosen';
  sun?: Position;
  moon?: MoonInfo;
  kind?: LightKind;
  rising?: boolean;
  lighting?: 'backlit' | 'side-lit' | 'front-lit';
  events?: DayEvents;
  keywords: string[];
}

export const ALL_LEAVES = ['night', 'astronomical-twilight', 'nautical-twilight', 'blue-hour', 'golden-hour', 'daylight', 'high-sun', 'morning', 'evening', 'backlit', 'side-lit', 'front-lit', 'moonlit'];

const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function toRecord(raw: any): PhotoRecord {
  const gps = raw?.gps && typeof raw.gps === 'object' ? raw.gps : null;
  const time = typeof raw?.captureTime === 'string' ? raw.captureTime : null;
  const offset = typeof raw?.offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(raw.offset) ? raw.offset : '';
  return {
    id: Number(raw?.id),
    file: String(raw?.file ?? `Photo ${raw?.id}`),
    captureTime: time ? time + (/(Z|[+-]\d{2}:?\d{2})$/.test(time) ? '' : offset) : null,
    lat: num(gps?.lat),
    lon: num(gps?.lon),
    heading: num(gps?.dir),
    keywords: Array.isArray(raw?.keywords) ? raw.keywords.map(String) : [],
  };
}

export interface Selection {
  photos: PhotoRecord[];
  count: number;
  truncated: boolean;
}

export async function readSelection(ext: FormExt): Promise<Selection> {
  const s = await ext.readDocument<{ photos?: unknown[]; count?: number; truncated?: boolean }>('selection');
  const photos = (Array.isArray(s?.photos) ? s.photos : []).map(toRecord).filter((p) => Number.isFinite(p.id));
  return { photos, count: Number(s?.count ?? photos.length), truncated: Boolean(s?.truncated) };
}

export function parseStamp(text: string) {
  const m = STAMP.exec(text.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const day = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  let offset: number | null = null;
  if (m[7] === 'Z') offset = 0;
  else if (m[7]) {
    const digits = m[7].replace(':', '');
    offset = (digits[0] === '-' ? -1 : 1) * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
  }
  return { wall, day, offset };
}

export function estimateOffset(lon: number) {
  return Math.round(lon / 15) * 60;
}

const cache = new Map<string, DayEvents>();

function eventsFor(dayStart: number, lat: number, lon: number) {
  const key = `${dayStart}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
  let e = cache.get(key);
  if (!e) {
    e = dayEvents(dayStart, lat, lon);
    if (cache.size > 200) cache.clear();
    cache.set(key, e);
  }
  return e;
}

export function leafPath(parent: string, leaf: string) {
  const p = parent.trim();
  return p ? `${p}|${leaf}` : leaf;
}

export function analyse(photo: PhotoRecord, options: Options): Analysis {
  if (photo.lat === null || photo.lon === null) return { photo, ok: false, reason: 'No location', keywords: [] };
  if (!photo.captureTime) return { photo, ok: false, reason: 'No capture time', keywords: [] };
  const stamp = parseStamp(photo.captureTime);
  if (!stamp) return { photo, ok: false, reason: 'Capture time not readable', keywords: [] };
  const { lat, lon } = photo;
  let offsetMin: number;
  let zoneSource: Analysis['zoneSource'];
  if (options.zone !== 'auto') {
    offsetMin = options.zone;
    zoneSource = 'chosen';
  } else if (stamp.offset !== null) {
    offsetMin = stamp.offset;
    zoneSource = 'photo';
  } else {
    offsetMin = estimateOffset(lon);
    zoneSource = 'estimated';
  }
  const utc = stamp.wall - offsetMin * 60_000;
  const sun = sunPosition(utc, lat, lon);
  const moon = moonPosition(utc, lat, lon);
  const kind = lightKind(sun.altitude);
  const rising = isRising(utc, lat, lon);
  const events = eventsFor(stamp.day - offsetMin * 60_000, lat, lon);
  let lighting: Analysis['lighting'];
  if (photo.heading !== null && sun.altitude > ALT.goldenLow) {
    const off = angleBetween(photo.heading, sun.azimuth);
    lighting = off <= 50 ? 'backlit' : off >= 130 ? 'front-lit' : 'side-lit';
  }
  const leaves: string[] = [kind];
  if (options.timeOfDay && kind !== 'daylight' && kind !== 'high-sun' && kind !== 'night') leaves.push(rising ? 'morning' : 'evening');
  if (options.direction && lighting) leaves.push(lighting);
  if (options.moonlit && sun.altitude < ALT.civil && moon.altitude > 0 && moon.fraction >= 0.25) leaves.push('moonlit');
  return { photo, ok: true, utc, offsetMin, zoneSource, sun, moon, kind, rising, lighting, events, keywords: leaves.map((l) => leafPath(options.parent, l)) };
}

export function keywordOps(list: Analysis[], options: Options) {
  const ours = new Set(ALL_LEAVES.map((l) => leafPath(options.parent, l).toLowerCase()));
  const removals = new Map<string, number[]>();
  const additions = new Map<string, number[]>();
  for (const a of list) {
    if (!a.ok) continue;
    const want = new Set(a.keywords.map((k) => k.toLowerCase()));
    for (const k of a.photo.keywords) {
      if (ours.has(k.toLowerCase()) && !want.has(k.toLowerCase())) removals.set(k, [...(removals.get(k) ?? []), a.photo.id]);
    }
    const have = new Set(a.photo.keywords.map((k) => k.toLowerCase()));
    for (const k of a.keywords) if (!have.has(k.toLowerCase())) additions.set(k, [...(additions.get(k) ?? []), a.photo.id]);
  }
  const ops: { command: string; args: unknown }[] = [];
  for (const [k, ids] of removals) ops.push({ command: 'photo.removeKeywords', args: { ids, keywords: [k] } });
  for (const [k, ids] of additions) ops.push({ command: 'photo.addKeywords', args: { ids, keywords: [k] } });
  return ops;
}
