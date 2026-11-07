export interface Table {
  columns: string[];
  rows: string[][];
  delimiter: string;
}

const CANDIDATES = [',', ';', '\t', '|'];

function sniff(text: string): string {
  const firstLines = text.split(/\r\n|\n|\r/).slice(0, 5);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = firstLines.filter((l) => l.length).map((l) => {
      let n = 0;
      let quoted = false;
      for (const ch of l) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      return n;
    });
    if (!counts.length || counts[0] === 0) continue;
    const steady = counts.filter((c) => c === counts[0]).length;
    const score = steady * 100 + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function parseCsv(input: string): Table {
  const text = input.replace(/^﻿/, '');
  const d = sniff(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
      i++;
      continue;
    }
    if (ch === d) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { columns: [], rows: [], delimiter: d };
  const seen = new Map<string, number>();
  const columns = nonEmpty[0].map((h, k) => {
    const base = h.trim() || `Column ${k + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = nonEmpty.slice(1).map((r) => columns.map((_, k) => r[k] ?? ''));
  return { columns, rows, delimiter: d };
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parseRanges(text: string, count: number): number[] | string {
  const t = text.trim();
  if (!t) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of t.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)?\s*-\s*(\d+)?$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!m) return `"${part}" is not a row number or range`;
    const a = Number(m[1] ?? 1);
    const b = part.includes('-') ? Number(m[2] ?? count) : a;
    if (a > count) return `row ${a} is past the last row (${count})`;
    if (a < 1 || b < a) return `"${part}" is not a valid range`;
    for (let r = a; r <= Math.min(b, count); r++) if (!seen.has(r)) {
      seen.add(r);
      out.push(r - 1);
    }
  }
  return out;
}
