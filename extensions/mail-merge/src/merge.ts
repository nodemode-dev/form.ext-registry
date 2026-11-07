import type { Table } from './csv';
import type { PdfDoc } from './pdf/doc';
import { RowEdit } from './pdf/edit';
import { type Check, type Field, type FormInfo, check, fillable, flatten, setValue } from './pdf/form';
import { writeCombined, writeSingle } from './pdf/write';
import { zip } from './zip';

export const KEEP = '';
export const CLEAR = '\u0000clear';

export type Mapping = Record<string, string>;

const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const words = (s: string) => s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/).filter(Boolean);

function score(field: string, column: string): number {
  const leaf = field.split('.').pop() ?? field;
  const a = squash(leaf);
  const b = squash(column);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (squash(field) === b) return 95;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return 60 + Math.min(a.length, b.length);
  const wa = new Set(words(leaf.replace(/([a-z])([A-Z])/g, '$1 $2')));
  const wb = words(column);
  const common = wb.filter((w) => wa.has(w)).length;
  if (!common) return 0;
  return 20 + (40 * common) / Math.max(wa.size, wb.length);
}

export function autoMap(fields: Field[], columns: string[]): Mapping {
  const pairs: Array<[number, string, string]> = [];
  for (const f of fields.filter(fillable)) for (const c of columns) {
    const s = score(f.name, c);
    if (s >= 40) pairs.push([s, f.name, c]);
  }
  pairs.sort((x, y) => y[0] - x[0]);
  const out: Mapping = {};
  const used = new Set<string>();
  for (const [, f, c] of pairs) {
    if (out[f] !== undefined || used.has(c)) continue;
    out[f] = c;
    used.add(c);
  }
  for (const f of fields.filter(fillable)) if (out[f.name] === undefined) out[f.name] = KEEP;
  return out;
}

export interface Cell {
  field: Field;
  source: string;
  input: string | null;
  check: Check | null;
}

export function rowCells(form: Pick<FormInfo, 'fields'>, table: Table, mapping: Mapping, row: number): Cell[] {
  const r = table.rows[row] ?? [];
  return form.fields.filter(fillable).map((field) => {
    const source = mapping[field.name] ?? KEEP;
    if (source === KEEP) return { field, source, input: null, check: null };
    const input = source === CLEAR ? '' : r[table.columns.indexOf(source)] ?? '';
    return { field, source, input, check: check(field, input) };
  });
}

export function buildRow(doc: PdfDoc, form: FormInfo, table: Table, mapping: Mapping, row: number, flat: boolean): RowEdit {
  const edit = new RowEdit(doc);
  for (const c of rowCells(form, table, mapping, row)) if (c.input !== null && !c.field.readOnly) setValue(edit, c.field, c.input);
  if (flat) flatten(edit, form);
  return edit;
}

const BAD = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g;

export function fileName(pattern: string, table: Table, row: number, stem: string): string {
  const r = table.rows[row] ?? [];
  const filled = pattern.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const k = key.trim();
    if (k.toLowerCase() === 'row') return String(row + 1);
    if (k.toLowerCase() === 'file') return stem;
    const i = table.columns.findIndex((c) => c.toLowerCase() === k.toLowerCase());
    return i >= 0 ? (r[i] ?? '').trim() : '';
  });
  const clean = filled.replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120).trim();
  return clean || `${stem} ${row + 1}`;
}

export function unknownTokens(pattern: string, table: Table): string[] {
  const out: string[] = [];
  for (const m of pattern.matchAll(/\{([^{}]+)\}/g)) {
    const k = m[1].trim().toLowerCase();
    if (k === 'row' || k === 'file') continue;
    if (!table.columns.some((c) => c.toLowerCase() === k)) out.push(m[1].trim());
  }
  return out;
}

export class Cancelled extends Error {}

export interface Job {
  doc: PdfDoc;
  form: FormInfo;
  table: Table;
  mapping: Mapping;
  rows: number[];
  flatten: boolean;
  mode: 'zip' | 'combined';
  pattern: string;
  stem: string;
}

export interface Output {
  name: string;
  type: string;
  bytes: Uint8Array;
  problems: number;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function runJob(job: Job, progress: (done: number, total: number) => void, signal: AbortSignal): Promise<Output> {
  const total = job.rows.length;
  let problems = 0;
  for (const i of job.rows) problems += rowCells(job.form, job.table, job.mapping, i).filter((c) => c.check?.problem).length;
  let last = 0;
  const step = async (done: number) => {
    if (signal.aborted) throw new Cancelled('Cancelled');
    const now = performance.now();
    if (now - last > 40 || done === total) {
      last = now;
      progress(done, total);
      await tick();
      if (signal.aborted) throw new Cancelled('Cancelled');
    }
  };
  if (job.mode === 'combined') {
    const edits: RowEdit[] = [];
    for (let k = 0; k < total; k++) {
      edits.push(buildRow(job.doc, job.form, job.table, job.mapping, job.rows[k], job.flatten));
      await step(k + 1);
    }
    const labels = job.rows.map((i) => `row${i + 1}`);
    const bytes = writeCombined(job.doc, job.form, edits, labels);
    return { name: `${job.stem} merged.pdf`, type: 'application/pdf', bytes, problems };
  }
  const entries: { name: string; data: Uint8Array }[] = [];
  const taken = new Set<string>();
  for (let k = 0; k < total; k++) {
    const i = job.rows[k];
    const edit = buildRow(job.doc, job.form, job.table, job.mapping, i, job.flatten);
    const base = fileName(job.pattern, job.table, i, job.stem);
    let n = `${base}.pdf`;
    for (let d = 2; taken.has(n.toLowerCase()); d++) n = `${base} (${d}).pdf`;
    taken.add(n.toLowerCase());
    entries.push({ name: n, data: writeSingle(job.doc, edit) });
    await step(k + 1);
  }
  if (entries.length === 1) return { name: entries[0].name, type: 'application/pdf', bytes: entries[0].data, problems };
  return { name: `${job.stem} merged.zip`, type: 'application/zip', bytes: zip(entries), problems };
}
