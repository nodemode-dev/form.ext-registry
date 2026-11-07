import type { Rgb } from './inks';

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export interface Job {
  cancelled: boolean;
  progress: (fraction: number) => void;
}

const tick = (): Promise<void> => new Promise((ok) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => ok();
  ch.port2.postMessage(0);
});

export async function bands(height: number, job: Job, from: number, span: number, fn: (y0: number, y1: number) => void): Promise<void> {
  const step = 64;
  let last = performance.now();
  for (let y = 0; y < height; y += step) {
    if (job.cancelled) throw new Cancelled();
    fn(y, Math.min(height, y + step));
    if (performance.now() - last > 12) {
      job.progress(from + span * Math.min(1, (y + step) / height));
      await tick();
      last = performance.now();
    }
  }
  job.progress(from + span);
}

export interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const W = [0.45, 0.75, 0.3];

function transmit(inks: Rgb[], paper: Rgb): Float32Array {
  const t = new Float32Array(inks.length * 3);
  inks.forEach((ink, i) => {
    for (let c = 0; c < 3; c++) t[i * 3 + c] = Math.min(1, ink[c] / Math.max(1, paper[c]));
  });
  return t;
}

function solveNode(target: Float32Array, t: Float32Array, p: Float32Array, n: number, cov: Float32Array) {
  const err = (): number => {
    let e = 0;
    for (let c = 0; c < 3; c++) {
      let v = p[c];
      for (let i = 0; i < n; i++) v *= 1 - cov[i] * (1 - t[i * 3 + c]);
      const d = v - target[c];
      e += W[c] * d * d;
    }
    return e;
  };
  cov.fill(0);
  const g = 0.6180339887;
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < n; i++) {
      let a = 0;
      let b = 1;
      let x1 = b - g * (b - a);
      let x2 = a + g * (b - a);
      cov[i] = x1;
      let f1 = err();
      cov[i] = x2;
      let f2 = err();
      for (let k = 0; k < 18; k++) {
        if (f1 < f2) {
          b = x2;
          x2 = x1;
          f2 = f1;
          x1 = b - g * (b - a);
          cov[i] = x1;
          f1 = err();
        } else {
          a = x1;
          x1 = x2;
          f1 = f2;
          x2 = a + g * (b - a);
          cov[i] = x2;
          f2 = err();
        }
      }
      let best = (a + b) / 2;
      cov[i] = best;
      let fb = err();
      for (const edge of [0, 1]) {
        cov[i] = edge;
        const fe = err();
        if (fe < fb) {
          fb = fe;
          best = edge;
        }
      }
      cov[i] = best;
    }
  }
}

const N = 21;

export async function spotLut(inks: Rgb[], paper: Rgb, job: Job, from: number, span: number): Promise<Float32Array> {
  const n = inks.length;
  const t = transmit(inks, paper);
  const p = new Float32Array(paper.map((v) => v / 255));
  const lut = new Float32Array(N * N * N * n);
  const target = new Float32Array(3);
  const cov = new Float32Array(n);
  await bands(N, job, from, span, (r0, r1) => {
    for (let r = r0; r < r1; r++)
      for (let g = 0; g < N; g++)
        for (let b = 0; b < N; b++) {
          target[0] = r / (N - 1);
          target[1] = g / (N - 1);
          target[2] = b / (N - 1);
          solveNode(target, t, p, n, cov);
          lut.set(cov, ((r * N + g) * N + b) * n);
        }
  });
  return lut;
}

function flatten(pic: Picture, paper: Rgb, i: number, out: Float32Array) {
  const d = pic.data;
  const a = d[i + 3] / 255;
  for (let c = 0; c < 3; c++) out[c] = (d[i + c] * a + paper[c] * (1 - a)) / 255;
}

export async function separateSpot(pic: Picture, lut: Float32Array, n: number, paper: Rgb, job: Job, from: number, span: number): Promise<Uint8Array[]> {
  const plates = Array.from({ length: n }, () => new Uint8Array(pic.width * pic.height));
  const px = new Float32Array(3);
  const m = N - 1;
  await bands(pic.height, job, from, span, (y0, y1) => {
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < pic.width; x++) {
        const k = y * pic.width + x;
        flatten(pic, paper, k * 4, px);
        const fr = px[0] * m, fg = px[1] * m, fb = px[2] * m;
        const r0 = Math.min(m - 1, fr | 0), g0 = Math.min(m - 1, fg | 0), b0 = Math.min(m - 1, fb | 0);
        const dr = fr - r0, dg = fg - g0, db = fb - b0;
        for (let i = 0; i < n; i++) {
          const at = (r: number, g: number, b: number) => lut[((r * N + g) * N + b) * n + i];
          const c00 = at(r0, g0, b0) * (1 - db) + at(r0, g0, b0 + 1) * db;
          const c01 = at(r0, g0 + 1, b0) * (1 - db) + at(r0, g0 + 1, b0 + 1) * db;
          const c10 = at(r0 + 1, g0, b0) * (1 - db) + at(r0 + 1, g0, b0 + 1) * db;
          const c11 = at(r0 + 1, g0 + 1, b0) * (1 - db) + at(r0 + 1, g0 + 1, b0 + 1) * db;
          const v = (c00 * (1 - dg) + c01 * dg) * (1 - dr) + (c10 * (1 - dg) + c11 * dg) * dr;
          plates[i][k] = Math.round(Math.max(0, Math.min(1, v)) * 255);
        }
      }
  });
  return plates;
}

export async function separateCmyk(pic: Picture, blackGeneration: number, inkLimit: number, job: Job, from: number, span: number): Promise<Uint8Array[]> {
  const plates = Array.from({ length: 4 }, () => new Uint8Array(pic.width * pic.height));
  const px = new Float32Array(3);
  const white: Rgb = [255, 255, 255];
  const limit = inkLimit / 100;
  await bands(pic.height, job, from, span, (y0, y1) => {
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < pic.width; x++) {
        const k = y * pic.width + x;
        flatten(pic, white, k * 4, px);
        const kFull = 1 - Math.max(px[0], px[1], px[2]);
        const kk = blackGeneration <= 0 ? 0 : Math.pow(kFull, 1 / Math.max(0.05, blackGeneration)) * blackGeneration;
        const kb = Math.min(kFull, kk);
        const d = 1 - kb;
        let c = d > 1e-4 ? (1 - px[0] - kb) / d : 0;
        let mg = d > 1e-4 ? (1 - px[1] - kb) / d : 0;
        let ye = d > 1e-4 ? (1 - px[2] - kb) / d : 0;
        c = Math.max(0, Math.min(1, c));
        mg = Math.max(0, Math.min(1, mg));
        ye = Math.max(0, Math.min(1, ye));
        const total = c + mg + ye + kb;
        if (total > limit && c + mg + ye > 0) {
          const s = Math.max(0, limit - kb) / (c + mg + ye);
          c *= s;
          mg *= s;
          ye *= s;
        }
        plates[0][k] = Math.round(c * 255);
        plates[1][k] = Math.round(mg * 255);
        plates[2][k] = Math.round(ye * 255);
        plates[3][k] = Math.round(kb * 255);
      }
  });
  return plates;
}
