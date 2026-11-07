import { fit, textWidth, wrap } from './helvetica';
import type { Board, Shot } from './snapshot';
import { rateLabel, shortDuration, timecode } from './timecode';

export type Op =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; lw: number }
  | { t: 'text'; x: number; y: number; s: string; size: number; bold: boolean; color: string }
  | { t: 'image'; x: number; y: number; w: number; h: number; key: string };

export interface Page {
  w: number;
  h: number;
  ops: Op[];
}

export interface SheetOptions {
  paper: 'a4' | 'letter';
  orientation: 'landscape' | 'portrait';
  columns: number;
  noteLines: number;
  continuous: boolean;
  date: string;
}

export interface FrameSize {
  w: number;
  h: number;
}

const PAPER = { a4: [841.89, 595.28], letter: [792, 612] } as const;
const INK = '#16161a';
const SOFT = '#55555c';
const FAINT = '#8e8e95';
const RULE = '#d4d4d9';
const PLATE = '#ececef';
const SCREEN = '#101012';
const MARGIN = 30;
const GAP = 14;
const HEAD = 50;
const FOOT = 18;

export function paperSize(opts: SheetOptions): [number, number] {
  const [long, short] = PAPER[opts.paper];
  return opts.orientation === 'landscape' ? [long, short] : [short, long];
}

export function cellMetrics(board: Board, opts: SheetOptions, pageW: number) {
  const cols = Math.max(1, Math.min(6, Math.round(opts.columns)));
  const cellW = (pageW - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const aspect = board.height / board.width;
  const frameH = Math.min(cellW * aspect, cellW * 1.25);
  const noteH = opts.noteLines * 10.5;
  const cellH = frameH + 8 + 11 + 11 + 10 + noteH + 4;
  return { cols, cellW, frameH, cellH, noteH };
}

export function layout(board: Board, shots: Shot[], notes: Record<string, string>, frames: Map<string, FrameSize>, opts: SheetOptions): Page[] {
  const [pageW, paperH] = paperSize(opts);
  const m = cellMetrics(board, opts, pageW);
  const top = MARGIN + HEAD;
  const usable = paperH - top - MARGIN - FOOT;
  const rowsPerPage = Math.max(1, Math.floor((usable + GAP) / (m.cellH + GAP)));
  const perPage = opts.continuous ? Math.max(1, shots.length) : rowsPerPage * m.cols;
  const pageCount = Math.max(1, Math.ceil(shots.length / perPage));
  const pages: Page[] = [];
  for (let p = 0; p < pageCount; p++) {
    const slice = shots.slice(p * perPage, (p + 1) * perPage);
    const rows = Math.max(1, Math.ceil(slice.length / m.cols));
    const pageH = opts.continuous ? top + rows * m.cellH + (rows - 1) * GAP + FOOT + MARGIN : paperH;
    const ops: Op[] = [{ t: 'rect', x: 0, y: 0, w: pageW, h: pageH, fill: '#ffffff' }];
    header(ops, board, shots.length, opts, pageW, p, pageCount);
    slice.forEach((shot, i) => {
      const col = i % m.cols;
      const row = Math.floor(i / m.cols);
      const x = MARGIN + col * (m.cellW + GAP);
      const y = top + row * (m.cellH + GAP);
      cell(ops, board, shot, notes[shot.clipId] ?? '', frames.get(shot.key), x, y, m, opts.noteLines);
    });
    if (!shots.length) ops.push({ t: 'text', x: MARGIN, y: top + 20, s: 'This timeline has no picture clips yet.', size: 10, bold: false, color: SOFT });
    ops.push({ t: 'text', x: MARGIN, y: pageH - MARGIN + 6, s: 'FormCut Shot List', size: 7, bold: false, color: FAINT });
    pages.push({ w: pageW, h: pageH, ops });
  }
  return pages;
}

function header(ops: Op[], board: Board, count: number, opts: SheetOptions, pageW: number, page: number, pages: number) {
  const right = pageW - MARGIN;
  const meta = `${opts.date}${pages > 1 ? `   Page ${page + 1} of ${pages}` : ''}`;
  const metaW = textWidth(meta, 8.5, false);
  ops.push({ t: 'text', x: MARGIN, y: MARGIN + 14, s: fit(board.title, 15, true, right - MARGIN - metaW - 20), size: 15, bold: true, color: INK });
  ops.push({ t: 'text', x: right - metaW, y: MARGIN + 14, s: meta, size: 8.5, bold: false, color: SOFT });
  const sub = `${board.timeline}  ·  ${count} ${count === 1 ? 'shot' : 'shots'}  ·  ${timecode(board.duration, board.fps)}  ·  ${rateLabel(board.fps)}  ·  ${board.width} x ${board.height}`;
  ops.push({ t: 'text', x: MARGIN, y: MARGIN + 30, s: fit(sub, 8.5, false, right - MARGIN), size: 8.5, bold: false, color: SOFT });
  ops.push({ t: 'line', x1: MARGIN, y1: MARGIN + 40, x2: right, y2: MARGIN + 40, color: RULE, lw: 0.75 });
}

function cell(ops: Op[], board: Board, shot: Shot, note: string, frame: FrameSize | undefined, x: number, y: number, m: ReturnType<typeof cellMetrics>, noteLines: number) {
  const { cellW, frameH } = m;
  if (frame && frame.w > 0 && frame.h > 0) {
    ops.push({ t: 'rect', x, y, w: cellW, h: frameH, fill: SCREEN });
    const scale = Math.min(cellW / frame.w, frameH / frame.h);
    const w = frame.w * scale;
    const h = frame.h * scale;
    ops.push({ t: 'image', x: x + (cellW - w) / 2, y: y + (frameH - h) / 2, w, h, key: shot.key });
  } else {
    ops.push({ t: 'rect', x, y, w: cellW, h: frameH, fill: PLATE });
    const label = shot.kind === 'video' ? 'No frame yet' : shot.kind;
    const lw = textWidth(label, 8, false);
    ops.push({ t: 'text', x: x + (cellW - lw) / 2, y: y + frameH / 2 + 3, s: label, size: 8, bold: false, color: FAINT });
  }
  let cy = y + frameH + 8 + 8;
  const num = `${shot.number}`;
  const numW = textWidth(num, 9.5, true);
  ops.push({ t: 'text', x, y: cy, s: num, size: 9.5, bold: true, color: INK });
  ops.push({ t: 'text', x: x + numW + 6, y: cy, s: fit(shot.name, 9.5, true, cellW - numW - 6), size: 9.5, bold: true, color: INK });
  cy += 11;
  const tc = `${timecode(shot.start, board.fps)} – ${timecode(shot.start + shot.duration, board.fps)}`;
  const dur = shortDuration(shot.duration, board.fps);
  const durW = textWidth(dur, 8, true);
  ops.push({ t: 'text', x, y: cy, s: fit(tc, 8, false, cellW - durW - 6), size: 8, bold: false, color: SOFT });
  ops.push({ t: 'text', x: x + cellW - durW, y: cy, s: dur, size: 8, bold: true, color: SOFT });
  cy += 10;
  const src = shot.mediaName ? `${shot.track}  ·  ${shot.mediaName} @ ${timecode(shot.sourceIn, board.fps)}` : shot.track;
  ops.push({ t: 'text', x, y: cy, s: fit(src, 7, false, cellW), size: 7, bold: false, color: FAINT });
  cy += 4;
  const text = [note.trim(), ...shot.markerNotes].filter(Boolean).join('\n');
  if (noteLines > 0) {
    const lines = text ? wrap(text, 8, false, cellW, noteLines) : [];
    for (let i = 0; i < noteLines; i++) {
      const base = cy + 10.5 * (i + 1);
      if (lines[i]) ops.push({ t: 'text', x, y: base - 2, s: lines[i], size: 8, bold: false, color: INK });
      ops.push({ t: 'line', x1: x, y1: base + 0.5, x2: x + cellW, y2: base + 0.5, color: RULE, lw: 0.5 });
    }
  }
}
