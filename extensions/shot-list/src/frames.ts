import { fromBase64, type PickedFile } from './formext';
import { canvasToBytes } from './render-canvas';
import type { Shot } from './snapshot';

export type Position = 'first' | 'middle' | 'last';

export interface Frame {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  jpeg?: Uint8Array;
}

interface Source {
  name: string;
  url: string;
  blob: Blob;
  kind: 'video' | 'image';
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.');
  }
}

const MAX_W = 640;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|ogv|avi)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export const ACCEPT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

function base(name: string): string {
  return (name.split(/[\\/]/).pop() ?? name).toLowerCase();
}

function stem(name: string): string {
  return base(name).replace(/\.[^.]+$/, '');
}

export function sourceTime(shot: Shot, position: Position, fps: number): number {
  const span = shot.duration * shot.speed;
  const frame = 1 / Math.max(1, fps);
  if (position === 'middle') return shot.sourceIn + span / 2;
  if (position === 'last') return shot.sourceIn + Math.max(0, span - frame);
  return shot.sourceIn + Math.min(frame / 2, span / 2);
}

export function frameKey(shot: Shot, position: Position, fps: number): string {
  if (shot.kind === 'text') return `text:${shot.clipId}:${shot.text ?? ''}`;
  if (shot.kind === 'image') return `img:${shot.mediaId ?? shot.clipId}`;
  return `${shot.mediaId ?? shot.clipId}@${sourceTime(shot, position, fps).toFixed(3)}`;
}

function blank(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function fromImage(img: CanvasImageSource, w: number, h: number): Frame {
  const scale = Math.min(1, MAX_W / w);
  const canvas = blank(w * scale, h * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, w: canvas.width, h: canvas.height };
}

export async function frameFromDataUrl(url: string): Promise<Frame> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return fromImage(img, img.naturalWidth, img.naturalHeight);
}

export function textCard(text: string, aspect: number): Frame {
  const w = MAX_W;
  const h = Math.round(MAX_W * aspect);
  const canvas = blank(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#101012';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f4f4f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.round(h / 6);
  ctx.font = `700 ${size}px Helvetica, Arial, sans-serif`;
  const words = (text || 'Title').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > w * 0.84 && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 4);
  shown.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (shown.length - 1) / 2) * size * 1.2, w * 0.9));
  return { canvas, w, h };
}

export class FrameStore {
  private frames = new Map<string, Frame>();
  private sources = new Map<string, Source>();

  get(key: string): Frame | undefined {
    return this.frames.get(key);
  }

  has(key: string): boolean {
    return this.frames.has(key);
  }

  set(key: string, frame: Frame) {
    this.frames.set(key, frame);
  }

  sizes(): Map<string, { w: number; h: number }> {
    return new Map([...this.frames].map(([k, f]) => [k, { w: f.w, h: f.h }]));
  }

  sourceCount(): number {
    return this.sources.size;
  }

  addFiles(files: PickedFile[]): { added: string[]; skipped: string[] } {
    const added: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const kind = VIDEO.test(file.name) || file.type.startsWith('video/') ? 'video' : IMAGE.test(file.name) || file.type.startsWith('image/') ? 'image' : null;
      if (!kind) {
        skipped.push(file.name);
        continue;
      }
      const bytes = fromBase64(file.data);
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.type || (kind === 'video' ? 'video/mp4' : 'image/png') });
      const url = URL.createObjectURL(blob);
      const old = this.sources.get(base(file.name));
      if (old) URL.revokeObjectURL(old.url);
      this.sources.set(base(file.name), { name: file.name, url, blob, kind });
      added.push(file.name);
    }
    return { added, skipped };
  }

  sourceFor(shot: Shot): Source | undefined {
    const names = [shot.mediaName, shot.name].filter((v): v is string => !!v);
    for (const name of names) {
      const hit = this.sources.get(base(name));
      if (hit) return hit;
    }
    for (const name of names) {
      const s = stem(name);
      for (const [file, src] of this.sources) if (stem(file) === s) return src;
    }
    return undefined;
  }

  async jpeg(key: string): Promise<{ jpeg: Uint8Array; w: number; h: number } | undefined> {
    const f = this.frames.get(key);
    if (!f) return undefined;
    if (!f.jpeg) f.jpeg = await canvasToBytes(f.canvas, 'image/jpeg', 0.88);
    return { jpeg: f.jpeg, w: f.w, h: f.h };
  }

  async extract(jobs: { key: string; shot: Shot; time: number }[], signal: { cancelled: boolean }, progress: (done: number, total: number) => void): Promise<{ made: number; failed: string[] }> {
    const bySource = new Map<Source, { key: string; time: number }[]>();
    for (const job of jobs) {
      if (this.frames.has(job.key)) continue;
      const src = this.sourceFor(job.shot);
      if (!src) continue;
      const list = bySource.get(src) ?? [];
      if (!list.some((j) => j.key === job.key)) list.push({ key: job.key, time: job.time });
      bySource.set(src, list);
    }
    const total = [...bySource.values()].reduce((s, l) => s + l.length, 0);
    let done = 0;
    let made = 0;
    const failed: string[] = [];
    progress(0, total);
    for (const [src, list] of bySource) {
      if (signal.cancelled) throw new Cancelled();
      try {
        if (src.kind === 'image') {
          const bmp = await createImageBitmap(src.blob);
          const frame = fromImage(bmp, bmp.width, bmp.height);
          for (const job of list) this.frames.set(job.key, frame);
          made += list.length;
          done += list.length;
          progress(done, total);
          continue;
        }
        const video = await openVideo(src.url);
        try {
          for (const job of list.sort((a, b) => a.time - b.time)) {
            if (signal.cancelled) throw new Cancelled();
            await seek(video, Math.min(job.time, Math.max(0, video.duration - 0.001)));
            this.frames.set(job.key, fromImage(video, video.videoWidth, video.videoHeight));
            made++;
            done++;
            progress(done, total);
          }
        } finally {
          video.removeAttribute('src');
          video.load();
        }
      } catch (err) {
        if (err instanceof Cancelled) throw err;
        failed.push(src.name);
        done += list.length;
        progress(done, total);
      }
    }
    return { made, failed };
  }
}

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const timer = window.setTimeout(() => reject(new Error('timeout')), 20000);
    video.addEventListener('loadeddata', () => {
      clearTimeout(timer);
      if (!video.videoWidth) reject(new Error('no picture'));
      else resolve(video);
    }, { once: true });
    video.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('cannot decode'));
    }, { once: true });
    video.src = url;
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('seek timeout')), 10000);
    const finish = () => {
      clearTimeout(timer);
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v.requestVideoFrameCallback) {
        const fallback = window.setTimeout(resolve, 120);
        v.requestVideoFrameCallback(() => {
          clearTimeout(fallback);
          resolve();
        });
      } else resolve();
    };
    if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) return finish();
    video.addEventListener('seeked', finish, { once: true });
    video.currentTime = time;
  });
}
