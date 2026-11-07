import type { PdfDoc } from './pdf/doc';
import { type Field, type FieldKind, type FormInfo, readForm } from './pdf/form';

export interface Shape {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  on: string | null;
}

export interface Template {
  source: 'open' | 'file';
  name: string;
  pages: { w: number; h: number }[];
  fields: Field[];
  shapes: Map<string, Shape[]>;
  doc: PdfDoc | null;
  form: FormInfo | null;
}

export interface HostField {
  name: string;
  type: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value?: string;
  readonly?: boolean;
  multiline?: boolean;
  on?: string;
  options?: string[];
  maxLen?: number;
}

export interface Summary {
  open: boolean;
  id?: string;
  key?: string;
  name?: string;
  path?: string;
  pages?: number;
  page?: number;
  dirty?: boolean;
  info?: { sizes?: { w: number; h: number; rotate?: number }[]; fields?: number; encrypted?: boolean };
}

const KINDS: Record<string, FieldKind> = { text: 'text', checkbox: 'checkbox', radio: 'radio', choice: 'combo', signature: 'signature', button: 'button' };

export function fromHost(summary: Summary, items: HostField[]): Template {
  const sizes = summary.info?.sizes ?? [];
  const pageCount = Math.max(summary.pages ?? 0, sizes.length, ...items.map((i) => i.page));
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const s = sizes[i] ?? sizes[sizes.length - 1] ?? { w: 612, h: 792, rotate: 0 };
    const turned = s.rotate === 90 || s.rotate === 270;
    return { w: turned ? s.h : s.w, h: turned ? s.w : s.h };
  });
  const byName = new Map<string, Field>();
  const shapes = new Map<string, Shape[]>();
  for (const it of items) {
    const kind = KINDS[it.type] ?? 'text';
    let f = byName.get(it.name);
    if (!f) {
      f = {
        name: it.name,
        num: -1,
        kind,
        value: it.value ?? '',
        options: (it.options ?? []).map((o) => ({ value: o, label: o })),
        maxLen: it.maxLen ?? 0,
        multiline: !!it.multiline,
        comb: false,
        editable: false,
        readOnly: !!it.readonly,
        widgets: [],
        da: '',
        q: 0,
        loose: kind === 'radio',
      };
      byName.set(it.name, f);
      shapes.set(it.name, []);
    }
    if ((kind === 'checkbox' || kind === 'radio') && it.on && !f.options.some((o) => o.value === it.on)) f.options.push({ value: it.on, label: it.on });
    if ((kind === 'checkbox' || kind === 'radio') && (f.value === 'Off')) f.value = '';
    shapes.get(it.name)!.push({ page: it.page - 1, x: it.x, y: it.y, w: it.w, h: it.h, on: it.on ?? null });
  }
  return { source: 'open', name: summary.name ?? 'Open PDF', pages, fields: [...byName.values()], shapes, doc: null, form: null };
}

export function fromFile(name: string, doc: PdfDoc): Template {
  const form = readForm(doc);
  const shapes = new Map<string, Shape[]>();
  for (const f of form.fields) {
    shapes.set(
      f.name,
      f.widgets.filter((w) => w.page >= 0).map((w) => {
        const p = form.pages[w.page];
        return { page: w.page, x: w.rect[0] - p.x, y: p.y + p.height - w.rect[3], w: w.rect[2] - w.rect[0], h: w.rect[3] - w.rect[1], on: w.on };
      }),
    );
  }
  return { source: 'file', name, pages: form.pages.map((p) => ({ w: p.width, h: p.height })), fields: form.fields, shapes, doc, form };
}

export const signature = (t: Template) => t.fields.map((f) => f.name).sort().join('\n');
