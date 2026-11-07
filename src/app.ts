import { formext, fromBase64 } from './formext';
import type { Job, Picture } from './separate';
import { Cancelled } from './separate';

export interface DocInfo {
  open: boolean;
  name: string;
  width: number;
  height: number;
  resolution: number;
  mode: string;
}

export const MAX_WORK_PIXELS = 36_000_000;
const TILE = 2048;

export async function readDoc(): Promise<DocInfo> {
  const d = await formext.readDocument<Record<string, unknown> | null>('document');
  if (!d || d.open === false) return { open: false, name: '', width: 0, height: 0, resolution: 72, mode: 'rgb' };
  return {
    open: true,
    name: String(d.name ?? 'Untitled'),
    width: Number(d.width) || 0,
    height: Number(d.height) || 0,
    resolution: Number(d.resolution) || 72,
    mode: String(d.mode ?? 'rgb'),
  };
}

export function workScale(doc: DocInfo): number {
  return Math.min(1, Math.sqrt(MAX_WORK_PIXELS / Math.max(1, doc.width * doc.height)));
}

async function decode(b64: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([fromBase64(b64) as BlobPart], { type: 'image/png' }));
}

export async function readPicture(doc: DocInfo, scale: number, job: Job): Promise<Picture> {
  const w = Math.max(1, Math.round(doc.width * scale)), h = Math.max(1, Math.round(doc.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const span = Math.max(1, Math.floor(TILE / scale));
  const boxes: [number, number, number, number][] = [];
  for (let y = 0; y < doc.height; y += span) for (let x = 0; x < doc.width; x += span) boxes.push([x, y, Math.min(span, doc.width - x), Math.min(span, doc.height - y)]);
  for (let i = 0; i < boxes.length; i++) {
    if (job.cancelled) throw new Cancelled();
    const [x, y, bw, bh] = boxes[i];
    const whole = boxes.length === 1;
    const r = await formext.call<{ data: string; width: number; height: number } | null>('document.read', whole ? { what: 'image', max_size: Math.max(w, h) } : { what: 'image', x, y, width: bw, height: bh, max_size: Math.ceil(Math.max(bw, bh) * scale) });
    if (!r || typeof r.data !== 'string') throw new Error('FormVis did not send the picture.');
    const bmp = await decode(r.data);
    const dx = Math.round(x * scale), dy = Math.round(y * scale);
    g.drawImage(bmp, dx, dy, Math.round((x + bw) * scale) - dx, Math.round((y + bh) * scale) - dy);
    bmp.close();
    job.progress((i + 1) / boxes.length);
  }
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
}

export interface PlateOut {
  name: string;
  png: string;
}

export function layerOps(doc: DocInfo, scale: number, paper: string | null, plates: PlateOut[]) {
  const ops: { command: string; args: Record<string, unknown> }[] = [];
  if (paper) ops.push({ command: 'tool:draw_shape', args: { kind: 'rectangle', x: 0, y: 0, width: doc.width, height: doc.height, fill: paper } }, { command: 'layer.set', args: { name: 'Paper' } });
  for (const p of plates) {
    ops.push({ command: 'tool:place_image', args: { data: p.png, name: p.name, x: 0, y: 0, ...(scale < 1 ? { scale: Math.round((100 / scale) * 1000) / 1000 } : {}) } });
    ops.push({ command: 'layer.set', args: { blend: 'multiply' } });
  }
  return ops;
}
