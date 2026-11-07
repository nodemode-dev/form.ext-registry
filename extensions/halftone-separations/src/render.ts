import { hexToRgb, type Rgb } from './inks';
import { bands, separateCmyk, separateSpot, spotLut, type Job, type Picture } from './separate';
import { screenPlate } from './screen';
import { offsetOf, platesOf, type Settings } from './settings';
import { toBase64 } from './formext';

export interface Result {
  width: number;
  height: number;
  scale: number;
  inks: Rgb[];
  paper: Rgb;
  plates: Uint8Array[];
}

export function scaled(pic: Picture, scale: number): Picture {
  if (scale >= 1) return pic;
  const w = Math.max(1, Math.round(pic.width * scale)), h = Math.max(1, Math.round(pic.height * scale));
  const src = document.createElement('canvas');
  src.width = pic.width;
  src.height = pic.height;
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pic.data), pic.width, pic.height), 0, 0);
  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const g = dst.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
}

export class Renderer {
  private pics = new Map<number, Picture>();
  private sepKey = '';
  private sep: Uint8Array[] = [];
  private lutKey = '';
  private lut: Float32Array | null = null;
  private screenKeys: string[] = [];
  private screens: Uint8Array[] = [];

  constructor(private source: Picture) {}

  get width() {
    return this.source.width;
  }
  get height() {
    return this.source.height;
  }

  private picture(scale: number): Picture {
    let p = this.pics.get(scale);
    if (!p) {
      p = scaled(this.source, scale);
      if (this.pics.size > 3) this.pics.clear();
      this.pics.set(scale, p);
    }
    return p;
  }

  async run(s: Settings, scale: number, ppi: number, job: Job): Promise<Result> {
    const pic = this.picture(scale);
    const plates = platesOf(s);
    const inks = plates.map((p) => hexToRgb(p.hex));
    const paper = hexToRgb(s.paper);
    const sepKey = JSON.stringify([scale, s.mode, s.mode === 'cmyk' ? [s.blackGeneration, s.inkLimit] : [plates.map((p) => p.hex), s.paper]]);
    if (sepKey !== this.sepKey) {
      if (s.mode === 'cmyk') {
        this.sep = await separateCmyk(pic, s.blackGeneration / 100, s.inkLimit, job, 0, 0.45);
      } else {
        const lutKey = JSON.stringify([plates.map((p) => p.hex), s.paper]);
        if (lutKey !== this.lutKey || !this.lut) {
          this.lut = await spotLut(inks, paper, job, 0, 0.2);
          this.lutKey = lutKey;
        }
        this.sep = await separateSpot(pic, this.lut, inks.length, paper, job, 0.2, 0.25);
      }
      this.sepKey = sepKey;
      this.screenKeys = [];
    }
    const out: Uint8Array[] = [];
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i];
      const [dx, dy] = offsetOf(i, s.misreg * scale);
      const key = JSON.stringify([sepKey, ppi * scale, s.hard, p.angle, p.lpi, p.shape, p.density, dx, dy]);
      if (this.screenKeys[i] !== key || !this.screens[i]) {
        this.screens[i] = await screenPlate(this.sep[i], pic.width, pic.height, { angle: p.angle, lpi: p.lpi, shape: p.shape, density: p.density, dx, dy }, { ppi: ppi * scale, hard: s.hard }, job, 0.45 + (0.55 * i) / plates.length, 0.55 / plates.length);
        this.screenKeys[i] = key;
      }
      out.push(this.screens[i]);
    }
    this.screens.length = plates.length;
    this.screenKeys.length = plates.length;
    return { width: pic.width, height: pic.height, scale, inks, paper, plates: out };
  }
}

export async function composite(r: Result, visible: boolean[], job: Job): Promise<ImageData> {
  const img = new ImageData(r.width, r.height);
  const d = img.data;
  const n = r.plates.length;
  const t = new Float32Array(n * 3);
  r.inks.forEach((ink, i) => {
    for (let c = 0; c < 3; c++) t[i * 3 + c] = 1 - Math.min(1, ink[c] / Math.max(1, r.paper[c]));
  });
  const on = r.plates.map((_, i) => visible[i] !== false);
  await bands(r.height, job, 0, 1, (y0, y1) => {
    for (let k = y0 * r.width; k < y1 * r.width; k++) {
      let cr = r.paper[0], cg = r.paper[1], cb = r.paper[2];
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        const a = r.plates[i][k];
        if (!a) continue;
        const f = a / 255;
        cr *= 1 - f * t[i * 3];
        cg *= 1 - f * t[i * 3 + 1];
        cb *= 1 - f * t[i * 3 + 2];
      }
      const o = k * 4;
      d[o] = cr;
      d[o + 1] = cg;
      d[o + 2] = cb;
      d[o + 3] = 255;
    }
  });
  return img;
}

async function encode(img: ImageData): Promise<string> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

export function plateLayer(r: Result, i: number): Promise<string> {
  const img = new ImageData(r.width, r.height);
  const [ir, ig, ib] = r.inks[i];
  const p = r.plates[i];
  for (let k = 0, o = 0; k < p.length; k++, o += 4) {
    img.data[o] = ir;
    img.data[o + 1] = ig;
    img.data[o + 2] = ib;
    img.data[o + 3] = p[k];
  }
  return encode(img);
}

export function plateFilm(r: Result, i: number): Promise<string> {
  const img = new ImageData(r.width, r.height);
  const p = r.plates[i];
  for (let k = 0, o = 0; k < p.length; k++, o += 4) {
    const v = 255 - p[k];
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  return encode(img);
}

export function pngOf(img: ImageData): Promise<string> {
  return encode(img);
}
