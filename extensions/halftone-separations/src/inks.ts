export type Rgb = [number, number, number];

export interface InkDef {
  name: string;
  hex: string;
}

export const PROCESS: InkDef[] = [
  { name: 'Cyan', hex: '#00a3e0' },
  { name: 'Magenta', hex: '#e2007a' },
  { name: 'Yellow', hex: '#ffe500' },
  { name: 'Black', hex: '#1d1d1b' },
];

export const PROCESS_ANGLES = [15, 75, 0, 45];

export const SPOT_INKS: InkDef[] = [
  { name: 'Black', hex: '#232323' },
  { name: 'Blue', hex: '#1f5fae' },
  { name: 'Fluorescent Pink', hex: '#ff4fa3' },
  { name: 'Yellow', hex: '#ffd400' },
  { name: 'Red', hex: '#e53b3b' },
  { name: 'Teal', hex: '#00838a' },
  { name: 'Green', hex: '#00a95c' },
  { name: 'Orange', hex: '#ff7a1a' },
  { name: 'Purple', hex: '#765ba7' },
  { name: 'Burgundy', hex: '#8f2b4c' },
  { name: 'Sky', hex: '#4fb3e8' },
  { name: 'Mint', hex: '#7fd1ae' },
];

export interface SpotPreset {
  id: string;
  label: string;
  inks: string[];
}

export const SPOT_PRESETS: SpotPreset[] = [
  { id: 'blue-pink', label: 'Blue and Fluorescent Pink', inks: ['Blue', 'Fluorescent Pink'] },
  { id: 'black-red', label: 'Black and Red', inks: ['Black', 'Red'] },
  { id: 'teal-orange', label: 'Teal and Orange', inks: ['Teal', 'Orange'] },
  { id: 'pink-yellow-blue', label: 'Pink, Yellow and Blue', inks: ['Fluorescent Pink', 'Yellow', 'Blue'] },
  { id: 'green-orange-purple', label: 'Green, Orange and Purple', inks: ['Green', 'Orange', 'Purple'] },
  { id: 'four-bright', label: 'Yellow, Pink, Sky and Black', inks: ['Yellow', 'Fluorescent Pink', 'Sky', 'Black'] },
];

export const SPOT_ANGLES = [[45, 75], [15, 75, 45], [15, 75, 0, 45]];

export function inkByName(name: string): InkDef {
  return SPOT_INKS.find((i) => i.name === name) ?? SPOT_INKS[0];
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

export function nameForHex(hex: string): string {
  const lower = hex.toLowerCase();
  return SPOT_INKS.find((i) => i.hex === lower)?.name ?? PROCESS.find((i) => i.hex === lower)?.name ?? `Ink ${lower}`;
}
