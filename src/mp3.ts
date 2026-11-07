const BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface FrameInfo {
  size: number;
  samples: number;
  rate: number;
  mpeg1: boolean;
  mono: boolean;
}

export function frameAt(b: Uint8Array, o: number): FrameInfo | null {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[o + 1] >> 3) & 3;
  const layerBits = (b[o + 1] >> 1) & 3;
  if (ver === 1 || layerBits === 0) return null;
  const layer = 4 - layerBits;
  const bi = (b[o + 2] >> 4) & 15;
  const ri = (b[o + 2] >> 2) & 3;
  if (bi === 0 || bi === 15 || ri === 3) return null;
  const pad = (b[o + 2] >> 1) & 1;
  const mpeg1 = ver === 3;
  const kbps = BITRATES[`${mpeg1 ? 1 : 2}-${layer}`][bi];
  const rate = RATES[ver][ri];
  const mono = ((b[o + 3] >> 6) & 3) === 3;
  let size: number;
  let samples: number;
  if (layer === 1) {
    size = (Math.floor((12 * kbps * 1000) / rate) + pad) * 4;
    samples = 384;
  } else if (layer === 2 || mpeg1) {
    size = Math.floor((144 * kbps * 1000) / rate) + pad;
    samples = 1152;
  } else {
    size = Math.floor((72 * kbps * 1000) / rate) + pad;
    samples = 576;
  }
  return { size, samples, rate, mpeg1, mono };
}

function firstFrame(b: Uint8Array, from: number): number {
  for (let o = from; o + 4 < b.length && o < from + 65536; o++) {
    const f = frameAt(b, o);
    if (f && frameAt(b, o + f.size)) return o;
  }
  return -1;
}

function infoFrames(b: Uint8Array, o: number, f: FrameInfo): number | null {
  const side = f.mpeg1 ? (f.mono ? 17 : 32) : f.mono ? 9 : 17;
  const x = o + 4 + side;
  const tag = String.fromCharCode(b[x], b[x + 1], b[x + 2], b[x + 3]);
  if ((tag === "Xing" || tag === "Info") && b[x + 7] & 1) return ((b[x + 8] << 24) | (b[x + 9] << 16) | (b[x + 10] << 8) | b[x + 11]) >>> 0;
  const v = o + 36;
  if (String.fromCharCode(b[v], b[v + 1], b[v + 2], b[v + 3]) === "VBRI") return ((b[v + 14] << 24) | (b[v + 15] << 16) | (b[v + 16] << 8) | b[v + 17]) >>> 0;
  return null;
}

export class NotMp3Error extends Error {}

export async function durationMs(b: Uint8Array, audioStart: number, step: (fraction: number) => Promise<void>): Promise<number> {
  const start = firstFrame(b, audioStart);
  if (start < 0) throw new NotMp3Error("No MPEG audio was found in this file. Choose an MP3 exported from FormWav.");
  const first = frameAt(b, start)!;
  const counted = infoFrames(b, start, first);
  if (counted) return (counted * first.samples * 1000) / first.rate;
  let o = start;
  let samples = 0;
  let next = 1 << 20;
  while (o + 4 <= b.length) {
    const f = frameAt(b, o);
    if (!f || f.size <= 0) break;
    samples += f.samples;
    o += f.size;
    if (o > next) {
      next += 1 << 20;
      await step(o / b.length);
    }
  }
  return (samples * 1000) / first.rate;
}
