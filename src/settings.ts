import { PROCESS, PROCESS_ANGLES, SPOT_ANGLES, SPOT_PRESETS, inkByName } from './inks';
import type { DotShape } from './screen';

export interface PlateSetting {
  name: string;
  hex: string;
  angle: number;
  lpi: number;
  shape: DotShape;
  density: number;
  visible: boolean;
}

export interface Settings {
  version: 1;
  mode: 'cmyk' | 'spot';
  preset: string;
  paper: string;
  cmyk: PlateSetting[];
  spot: PlateSetting[];
  ppi: number | null;
  hard: boolean;
  misreg: number;
  blackGeneration: number;
  inkLimit: number;
}

const plate = (name: string, hex: string, angle: number, lpi: number, shape: DotShape = 'round'): PlateSetting => ({ name, hex, angle, lpi, shape, density: 100, visible: true });

export function spotPlates(presetId: string, lpi = 45): PlateSetting[] {
  const preset = SPOT_PRESETS.find((p) => p.id === presetId) ?? SPOT_PRESETS[0];
  const angles = SPOT_ANGLES[preset.inks.length - 2];
  return preset.inks.map((n, i) => {
    const ink = inkByName(n);
    return plate(ink.name, ink.hex, angles[i], lpi);
  });
}

export function defaults(): Settings {
  return {
    version: 1,
    mode: 'cmyk',
    preset: SPOT_PRESETS[0].id,
    paper: '#f6f3ec',
    cmyk: PROCESS.map((ink, i) => plate(ink.name, ink.hex, PROCESS_ANGLES[i], 60)),
    spot: spotPlates(SPOT_PRESETS[0].id),
    ppi: null,
    hard: false,
    misreg: 0,
    blackGeneration: 60,
    inkLimit: 300,
  };
}

const SHAPE_IDS: DotShape[] = ['round', 'ellipse', 'square', 'diamond', 'line', 'cross'];
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function cleanPlate(p: unknown, d: PlateSetting): PlateSetting {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  return {
    name: typeof o.name === 'string' ? o.name.slice(0, 40) : d.name,
    hex: typeof o.hex === 'string' && /^#[0-9a-f]{6}$/i.test(o.hex) ? o.hex.toLowerCase() : d.hex,
    angle: num(o.angle, 0, 179, d.angle),
    lpi: num(o.lpi, 5, 300, d.lpi),
    shape: SHAPE_IDS.includes(o.shape as DotShape) ? (o.shape as DotShape) : d.shape,
    density: num(o.density, 0, 150, d.density),
    visible: typeof o.visible === 'boolean' ? o.visible : true,
  };
}

export function clean(raw: unknown): Settings {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const spot = Array.isArray(o.spot) && o.spot.length >= 2 && o.spot.length <= 4 ? o.spot.map((p, i) => cleanPlate(p, d.spot[i] ?? d.spot[0])) : d.spot;
  const cmyk = Array.isArray(o.cmyk) && o.cmyk.length === 4 ? o.cmyk.map((p, i) => ({ ...cleanPlate(p, d.cmyk[i]), name: d.cmyk[i].name, hex: d.cmyk[i].hex })) : d.cmyk;
  return {
    version: 1,
    mode: o.mode === 'spot' ? 'spot' : 'cmyk',
    preset: typeof o.preset === 'string' ? o.preset : d.preset,
    paper: typeof o.paper === 'string' && /^#[0-9a-f]{6}$/i.test(o.paper) ? o.paper.toLowerCase() : d.paper,
    cmyk,
    spot,
    ppi: o.ppi === null || o.ppi === undefined ? null : num(o.ppi, 36, 2400, 300),
    hard: o.hard === true,
    misreg: num(o.misreg, 0, 24, 0),
    blackGeneration: num(o.blackGeneration, 0, 100, 60),
    inkLimit: num(o.inkLimit, 200, 400, 300),
  };
}

export function platesOf(s: Settings): PlateSetting[] {
  return s.mode === 'cmyk' ? s.cmyk : s.spot;
}

const DIRS = [0, 2.2, 4.1, 5.4];
const AMPS = [0, 1, 0.75, 0.6];

export function offsetOf(i: number, amount: number): [number, number] {
  return [Math.cos(DIRS[i]) * amount * AMPS[i], Math.sin(DIRS[i]) * amount * AMPS[i]];
}
