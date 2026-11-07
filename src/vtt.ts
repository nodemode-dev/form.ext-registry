export interface Cue {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function stamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(f, 3)}`;
}

export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${m}:${pad(s, 2)}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function buildVtt(cues: Cue[]): string {
  const blocks = cues.map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.url}#xywh=${c.x},${c.y},${c.w},${c.h}`);
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

const TIME = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/;

function seconds(text: string): number {
  const m = TIME.exec(text.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

export function parseVtt(text: string): Cue[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0]?.replace(/^﻿/, '') ?? '')) throw new Error('the track does not start with WEBVTT');
  const cues: Cue[] = [];
  for (let i = 1; i < lines.length; i++) {
    const arrow = lines[i].indexOf('-->');
    if (arrow < 0) continue;
    const start = seconds(lines[i].slice(0, arrow));
    const end = seconds(lines[i].slice(arrow + 3).trim().split(/\s+/)[0] ?? '');
    const payload = (lines[i + 1] ?? '').trim();
    const hash = payload.lastIndexOf('#xywh=');
    if (!Number.isFinite(start) || !Number.isFinite(end) || hash < 0) continue;
    const [x, y, w, h] = payload.slice(hash + 6).split(',').map(Number);
    if ([x, y, w, h].some((n) => !Number.isFinite(n))) continue;
    cues.push({ start, end, url: payload.slice(0, hash), x, y, w, h });
    i++;
  }
  return cues;
}

export function cueAt(cues: Cue[], t: number): Cue | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c;
  }
  return cues.length && t >= cues[cues.length - 1].end ? cues[cues.length - 1] : null;
}
