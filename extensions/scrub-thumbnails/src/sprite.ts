import type { Cue } from './vtt';

export interface Settings {
  interval: number;
  width: number;
  cols: number;
  rows: number;
  type: 'image/jpeg' | 'image/webp';
  quality: number;
  base: string;
  prefix: string;
}

export interface Source {
  duration: number;
  width: number;
  height: number;
}

export interface SheetPlan {
  name: string;
  first: number;
  count: number;
  width: number;
  height: number;
}

export interface Plan {
  count: number;
  tileW: number;
  tileH: number;
  times: number[];
  sheets: SheetPlan[];
  ext: string;
}

export interface Sheet extends SheetPlan {
  blob: Blob;
  url: string;
}

export const MAX_SIDE = 8192;
export const MAX_TILES = 5000;

export function tileHeight(s: Settings, src: Source | null): number {
  const aspect = src && src.width > 0 && src.height > 0 ? src.height / src.width : 9 / 16;
  return Math.max(2, Math.round((s.width * aspect) / 2) * 2);
}

export function extFor(type: string): string {
  return type === 'image/webp' ? 'webp' : 'jpg';
}

export function plan(s: Settings, src: Source): Plan | string {
  if (!(s.interval >= 0.5 && s.interval <= 600)) return 'Set an interval from 0.5 to 600 seconds.';
  if (!(s.width >= 32 && s.width <= 640)) return 'Set a width from 32 to 640 pixels.';
  if (!(Number.isInteger(s.cols) && s.cols >= 1 && s.cols <= 50)) return 'Set from 1 to 50 columns.';
  if (!(Number.isInteger(s.rows) && s.rows >= 1 && s.rows <= 50)) return 'Set from 1 to 50 rows per sheet.';
  if (!s.base) return 'Give the files a name.';
  if (!(src.duration > 0)) return 'This video has no length the window can read.';
  const tileW = Math.round(s.width / 2) * 2;
  const tileH = tileHeight(s, src);
  const count = Math.max(1, Math.ceil(src.duration / s.interval - 1e-9));
  if (count > MAX_TILES) return `That makes ${count.toLocaleString('en')} thumbnails. Raise the interval to ${Math.ceil(src.duration / MAX_TILES)} s or more; most players use one every 2 to 10 seconds.`;
  if (s.cols * tileW > MAX_SIDE) return `A sheet would be ${s.cols * tileW} px wide, more than the ${MAX_SIDE} px a web view draws reliably. Use fewer columns or a smaller width.`;
  if (s.rows * tileH > MAX_SIDE) return `A sheet would be ${s.rows * tileH} px tall, more than the ${MAX_SIDE} px a web view draws reliably. Use fewer rows or a smaller width.`;
  const perSheet = s.cols * s.rows;
  const ext = extFor(s.type);
  const sheets: SheetPlan[] = [];
  for (let first = 0, n = 1; first < count; first += perSheet, n++) {
    const c = Math.min(perSheet, count - first);
    sheets.push({ name: `${s.base}-${n}.${ext}`, first, count: c, width: Math.min(c, s.cols) * tileW, height: Math.ceil(c / s.cols) * tileH });
  }
  const end = Math.max(0, src.duration - 0.04);
  const times = Array.from({ length: count }, (_, i) => Math.min(i * s.interval, end));
  return { count, tileW, tileH, times, sheets, ext };
}

export function cues(p: Plan, s: Settings, duration: number, names?: string[]): Cue[] {
  const out: Cue[] = [];
  p.sheets.forEach((sheet, si) => {
    const url = `${s.prefix}${names?.[si] ?? sheet.name}`;
    for (let k = 0; k < sheet.count; k++) {
      const i = sheet.first + k;
      out.push({
        start: i * s.interval,
        end: Math.min((i + 1) * s.interval, duration),
        url,
        x: (k % s.cols) * p.tileW,
        y: Math.floor(k / s.cols) * p.tileH,
        w: p.tileW,
        h: p.tileH,
      });
    }
  });
  return out;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

function seek(video: HTMLVideoElement, t: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Cancelled());
    if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2) return resolve();
    const done = (fn: () => void) => {
      clearTimeout(timer);
      video.removeEventListener('seeked', ok);
      video.removeEventListener('error', bad);
      signal.removeEventListener('abort', stop);
      fn();
    };
    const ok = () => done(resolve);
    const bad = () => done(() => reject(new Error(`the video stopped decoding at ${t.toFixed(2)} s`)));
    const stop = () => done(() => reject(new Cancelled()));
    const timer = window.setTimeout(() => done(() => reject(new Error(`the video did not reach ${t.toFixed(2)} s within 15 seconds`))), 15_000);
    video.addEventListener('seeked', ok);
    video.addEventListener('error', bad);
    signal.addEventListener('abort', stop);
    video.currentTime = t;
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the window could not write the sheet image'))), type, quality);
  });
}

export async function grab(video: HTMLVideoElement, p: Plan, s: Settings, signal: AbortSignal, progress: (done: number) => void): Promise<Sheet[]> {
  const out: Sheet[] = [];
  let done = 0;
  try {
    for (const sp of p.sheets) {
      const canvas = document.createElement('canvas');
      canvas.width = sp.width;
      canvas.height = sp.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('the window could not make a drawing surface for the sheet');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, sp.width, sp.height);
      for (let k = 0; k < sp.count; k++) {
        await seek(video, p.times[sp.first + k], signal);
        ctx.drawImage(video, (k % s.cols) * p.tileW, Math.floor(k / s.cols) * p.tileH, p.tileW, p.tileH);
        progress(++done);
      }
      const blob = await encode(canvas, s.type, s.quality / 100);
      if (blob.type !== s.type) throw new Error(`this window cannot write ${s.type === 'image/webp' ? 'WebP' : 'JPEG'} images; choose the other image type`);
      if (signal.aborted) throw new Cancelled();
      out.push({ ...sp, blob, url: URL.createObjectURL(blob) });
    }
  } catch (e) {
    for (const sh of out) URL.revokeObjectURL(sh.url);
    throw e;
  }
  return out;
}
