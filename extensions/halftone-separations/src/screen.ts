import { bands, type Job } from './separate';

export type DotShape = 'round' | 'ellipse' | 'square' | 'diamond' | 'line' | 'cross';

export const SHAPES: { id: DotShape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'square', label: 'Square' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'line', label: 'Line' },
  { id: 'cross', label: 'Cross' },
];

const T = 64;
const tiles = new Map<DotShape, Float32Array>();

function spot(shape: DotShape, x: number, y: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  switch (shape) {
    case 'round':
      return ax + ay <= 1 ? (x * x + y * y) / 2 : 2 - ((1 - ax) ** 2 + (1 - ay) ** 2) / 2;
    case 'ellipse': {
      const e = x * x + (y / 0.72) ** 2;
      return ax * 0.72 + ay <= 1 ? e : 4 - ((1 - ax) ** 2 + ((1 - ay) / 0.72) ** 2);
    }
    case 'square':
      return Math.max(ax, ay);
    case 'diamond':
      return ax + ay;
    case 'line':
      return ay;
    case 'cross':
      return Math.min(ax, ay);
  }
}

export function tile(shape: DotShape): Float32Array {
  const hit = tiles.get(shape);
  if (hit) return hit;
  const n = T * T;
  const v = new Float32Array(n);
  for (let j = 0; j < T; j++)
    for (let i = 0; i < T; i++) {
      const x = ((i + 0.5) / T) * 2 - 1, y = ((j + 0.5) / T) * 2 - 1;
      v[j * T + i] = spot(shape, x, y) + (x * x + y * y) * 1e-4 + (i * 7 + j * 13) * 1e-9;
    }
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => v[a] - v[b]);
  const out = new Float32Array(n);
  order.forEach((k, rank) => (out[k] = (rank + 0.5) / n));
  tiles.set(shape, out);
  return out;
}

export interface Screen {
  angle: number;
  lpi: number;
  shape: DotShape;
  density: number;
  dx: number;
  dy: number;
}

export interface ScreenOptions {
  ppi: number;
  hard: boolean;
}

export async function screenPlate(cov: Uint8Array, width: number, height: number, s: Screen, o: ScreenOptions, job: Job, from: number, span: number): Promise<Uint8Array> {
  const out = new Uint8Array(width * height);
  const th = tile(s.shape);
  const cell = Math.max(2, o.ppi / Math.max(1, s.lpi));
  const a = (s.angle * Math.PI) / 180;
  const ca = Math.cos(a) / cell, sa = Math.sin(a) / cell;
  const k = Math.max(1, cell);
  const lift = 1 + 1 / k, drop = 0.5 / k;
  const dens = s.density / 100;
  const ox = Math.round(s.dx), oy = Math.round(s.dy);
  await bands(height, job, from, span, (y0, y1) => {
    for (let y = y0; y < y1; y++) {
      const sy = Math.min(height - 1, Math.max(0, y - oy));
      for (let x = 0; x < width; x++) {
        const sx = Math.min(width - 1, Math.max(0, x - ox));
        const c = Math.min(1, (cov[sy * width + sx] / 255) * dens);
        if (c <= 0) continue;
        if (c >= 1) {
          out[y * width + x] = 255;
          continue;
        }
        const px = x + 0.5, py = y + 0.5;
        let u = (px * ca + py * sa) * T;
        let v = (-px * sa + py * ca) * T;
        u -= Math.floor(u / T) * T;
        v -= Math.floor(v / T) * T;
        const u0 = Math.floor(u - 0.5), v0 = Math.floor(v - 0.5);
        const fu = u - 0.5 - u0, fv = v - 0.5 - v0;
        const i0 = (u0 + T) % T, i1 = (u0 + 1) % T, j0 = ((v0 + T) % T) * T, j1 = ((v0 + 1) % T) * T;
        const t = (th[j0 + i0] * (1 - fu) + th[j0 + i1] * fu) * (1 - fv) + (th[j1 + i0] * (1 - fu) + th[j1 + i1] * fu) * fv;
        const ink = o.hard ? (c > t ? 1 : 0) : Math.max(0, Math.min(1, (c * lift - drop - t) * k + 0.5));
        out[y * width + x] = Math.round(ink * 255);
      }
    }
  });
  return out;
}
