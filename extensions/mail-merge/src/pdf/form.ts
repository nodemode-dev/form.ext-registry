import type { PdfDoc } from './doc';
import type { RowEdit } from './edit';
import { readText, textString, widthOf, winAnsi } from './font';
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, type PdfValue, fromLatin1, name, numText } from './objects';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'signature' | 'button';

export interface Widget {
  num: number;
  page: number;
  rect: [number, number, number, number];
  on: string | null;
}

export interface Option {
  value: string;
  label: string;
}

export interface Field {
  name: string;
  num: number;
  kind: FieldKind;
  value: string;
  options: Option[];
  maxLen: number;
  multiline: boolean;
  comb: boolean;
  editable: boolean;
  readOnly: boolean;
  widgets: Widget[];
  da: string;
  q: number;
  loose?: boolean;
}

export interface PageBox {
  num: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface FormInfo {
  fields: Field[];
  pages: PageBox[];
  topFields: number[];
  hasForm: boolean;
}

const FF_READONLY = 1;
const FF_MULTILINE = 1 << 12;
const FF_RADIO = 1 << 15;
const FF_PUSH = 1 << 16;
const FF_COMBO = 1 << 17;
const FF_EDIT = 1 << 18;
const FF_COMB = 1 << 24;

export const fillable = (f: Field) => f.kind !== 'signature' && f.kind !== 'button';

function rectOf(doc: PdfDoc, v: PdfValue | undefined): [number, number, number, number] {
  const a = doc.array(v).map((x) => doc.number(x) ?? 0);
  if (a.length < 4) return [0, 0, 0, 0];
  return [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])];
}

function states(doc: PdfDoc, widget: PdfDict): string[] {
  const ap = doc.dict(widget.get('AP'));
  const n = doc.get(ap?.get('N'));
  const out: string[] = [];
  if (n instanceof PdfDict) for (const k of n.map.keys()) if (k !== 'Off') out.push(k);
  if (!out.length) {
    const d = doc.get(ap?.get('D'));
    if (d instanceof PdfDict) for (const k of d.map.keys()) if (k !== 'Off') out.push(k);
  }
  return out;
}

function optionList(doc: PdfDoc, v: PdfValue | undefined): Option[] {
  return doc.array(v).map((o) => {
    const x = doc.get(o);
    if (Array.isArray(x)) {
      const value = readText(doc.get(x[0]) as PdfString);
      const label = readText(doc.get(x[1]) as PdfString);
      return { value, label: label || value };
    }
    const s = readText(x as PdfString);
    return { value: s, label: s };
  });
}

function valueText(doc: PdfDoc, v: PdfValue | undefined): string {
  const x = doc.get(v);
  if (x instanceof PdfName) return x.name;
  if (x instanceof PdfString) return readText(x);
  if (Array.isArray(x)) return x.map((y) => valueText(doc, y)).join(', ');
  return '';
}

export function readForm(doc: PdfDoc): FormInfo {
  const pageNums = doc.pages();
  const pages: PageBox[] = pageNums.map((num) => {
    const box = rectOf(doc, doc.inherited(num, 'CropBox') ?? doc.inherited(num, 'MediaBox'));
    const r = box[2] - box[0] > 0 ? box : [0, 0, 612, 792];
    return { num, x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] };
  });
  const annotPage = new Map<number, number>();
  pageNums.forEach((num, i) => {
    for (const a of doc.array(doc.dict(new PdfRef(num))?.get('Annots'))) if (a instanceof PdfRef && !annotPage.has(a.num)) annotPage.set(a.num, i);
  });
  const af = doc.dict(doc.root.get('AcroForm'));
  const fields: Field[] = [];
  const topFields: number[] = [];
  if (!af) return { fields, pages, topFields, hasForm: false };
  const afDa = valueText(doc, af.get('DA'));
  const seen = new Set<number>();
  type Inh = { FT?: PdfValue; Ff?: PdfValue; V?: PdfValue; DA?: PdfValue; Q?: PdfValue; Opt?: PdfValue; MaxLen?: PdfValue };
  const walk = (ref: PdfValue, prefix: string, inh: Inh, depth: number) => {
    if (!(ref instanceof PdfRef) || seen.has(ref.num) || depth > 32) return;
    seen.add(ref.num);
    const d = doc.dict(ref);
    if (!d) return;
    const t = d.get('T');
    const part = t ? readText(doc.get(t) as PdfString) : '';
    const full = part ? (prefix ? `${prefix}.${part}` : part) : prefix;
    const own: Inh = {};
    for (const k of ['FT', 'Ff', 'V', 'DA', 'Q', 'Opt', 'MaxLen'] as const) own[k] = d.has(k) ? d.get(k) : inh[k];
    const kids = doc.array(d.get('Kids'));
    const fieldKids = kids.filter((k) => doc.dict(k)?.has('T'));
    if (fieldKids.length) {
      for (const k of fieldKids) walk(k, full, own, depth + 1);
      return;
    }
    const ft = doc.get(own.FT);
    const ff = doc.number(own.Ff) ?? 0;
    let kind: FieldKind = 'text';
    if (ft instanceof PdfName) {
      if (ft.name === 'Btn') kind = ff & FF_PUSH ? 'button' : ff & FF_RADIO ? 'radio' : 'checkbox';
      else if (ft.name === 'Ch') kind = ff & FF_COMBO ? 'combo' : 'list';
      else if (ft.name === 'Sig') kind = 'signature';
    }
    const widgetRefs = kids.length ? kids : [ref];
    const widgets: Widget[] = [];
    for (const w of widgetRefs) {
      if (!(w instanceof PdfRef)) continue;
      const wd = doc.dict(w);
      if (!wd) continue;
      const on = kind === 'checkbox' || kind === 'radio' ? states(doc, wd)[0] ?? null : null;
      widgets.push({ num: w.num, page: annotPage.get(w.num) ?? -1, rect: rectOf(doc, wd.get('Rect')), on });
    }
    let options: Option[] = [];
    let value = valueText(doc, own.V);
    if (kind === 'combo' || kind === 'list') options = optionList(doc, own.Opt);
    if (kind === 'radio' || kind === 'checkbox') {
      const exports = doc.array(own.Opt).map((o) => readText(doc.get(o) as PdfString));
      const pairs: Option[] = [];
      widgets.forEach((w, i) => {
        if (w.on && !pairs.some((p) => p.value === w.on)) pairs.push({ value: w.on, label: exports[i] || w.on });
      });
      options = pairs;
      const hit = pairs.find((p) => p.value === value);
      value = !value || value === 'Off' ? '' : hit ? hit.label : value;
    }
    fields.push({
      name: full || `field ${ref.num}`,
      num: ref.num,
      kind,
      value,
      options,
      maxLen: doc.number(own.MaxLen) ?? 0,
      multiline: !!(ff & FF_MULTILINE),
      comb: !!(ff & FF_COMB),
      editable: !!(ff & FF_EDIT),
      readOnly: !!(ff & FF_READONLY),
      widgets,
      da: valueText(doc, own.DA) || afDa,
      q: doc.number(own.Q) ?? doc.number(af.get('Q')) ?? 0,
    });
  };
  for (const f of doc.array(af.get('Fields'))) {
    if (f instanceof PdfRef) topFields.push(f.num);
    walk(f, '', {}, 0);
  }
  return { fields, pages, topFields, hasForm: true };
}

const TRUE = new Set(['y', 'yes', 'true', '1', 'x', 'on', 'checked', 'check', 'ja', 'oui', 'si', 'sí']);
const FALSE = new Set(['', 'n', 'no', 'false', '0', 'off', 'unchecked', 'nein', 'non']);

const norm = (s: string) => s.trim().toLowerCase();

export function matchOption(f: Field, input: string): Option | null {
  const v = norm(input);
  return f.options.find((o) => norm(o.value) === v) ?? f.options.find((o) => norm(o.label) === v) ?? null;
}

export interface Check {
  value: string;
  shown: string;
  problem: string;
}

export function check(f: Field, input: string): Check {
  if (f.kind === 'text') {
    if (f.maxLen && input.length > f.maxLen) return { value: input, shown: input.slice(0, f.maxLen), problem: `longer than ${f.maxLen} characters; cut to fit` };
    if (winAnsi(input).lossy) return { value: input, shown: input, problem: 'has characters the standard font cannot draw; viewers redraw it' };
    return { value: input, shown: input, problem: '' };
  }
  if (f.kind === 'checkbox') {
    const v = norm(input);
    if (TRUE.has(v) || (f.options.length && matchOption(f, input))) return { value: 'on', shown: 'Checked', problem: '' };
    if (FALSE.has(v)) return { value: '', shown: 'Not checked', problem: '' };
    return { value: '', shown: 'Not checked', problem: `"${input}" is not yes or no; left unchecked` };
  }
  if (f.kind === 'radio' || ((f.kind === 'combo' || f.kind === 'list') && !f.editable)) {
    if (!input.trim()) return { value: '', shown: 'None', problem: '' };
    const o = matchOption(f, input);
    if (o) return { value: o.value, shown: o.label, problem: '' };
    if (f.loose) return { value: '', shown: input, problem: '' };
    return { value: '', shown: 'None', problem: `"${input}" is not one of ${f.options.map((x) => x.label).join(', ')}` };
  }
  if (f.kind === 'combo') {
    const o = matchOption(f, input);
    return { value: o ? o.value : input, shown: o ? o.label : input, problem: '' };
  }
  return { value: input, shown: input, problem: 'cannot be filled' };
}

function color(da: string): string {
  const t = da.trim().split(/\s+/);
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === 'g' && i >= 1) return `${t[i - 1]} g`;
    if (t[i] === 'rg' && i >= 3) return `${t.slice(i - 3, i).join(' ')} rg`;
    if (t[i] === 'k' && i >= 4) return `${t.slice(i - 4, i).join(' ')} k`;
  }
  return '0 g';
}

function daSize(da: string): number {
  const m = /(\S+)\s+Tf/.exec(da);
  const v = m ? Number(m[1]) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function colorOp(edit: RowEdit, v: PdfValue | undefined, stroke: boolean): string | null {
  const a = edit.doc.array(v).map((x) => edit.doc.number(x) ?? 0);
  const c = a.map(numText).join(' ');
  if (a.length === 1) return `${c} ${stroke ? 'G' : 'g'}`;
  if (a.length === 3) return `${c} ${stroke ? 'RG' : 'rg'}`;
  if (a.length === 4) return `${c} ${stroke ? 'K' : 'k'}`;
  return null;
}

const hex = (bytes: number[]) => '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';

function wrap(text: string, size: number, width: number): number[][] {
  const lines: number[][] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = para.split(/(\s+)/);
    let line: number[] = [];
    for (const word of words) {
      const wb = winAnsi(word).bytes;
      if (line.length && widthOf([...line, ...wb], size) > width && word.trim()) {
        lines.push(line);
        line = [];
        if (!word.trim()) continue;
      }
      if (!line.length && !word.trim()) continue;
      line.push(...wb);
    }
    lines.push(line);
  }
  return lines;
}

function appearance(edit: RowEdit, f: Field, widgetNum: number, text: string): PdfStream {
  const wd = edit.dict(new PdfRef(widgetNum)) ?? new PdfDict();
  const r = rectOf(edit.doc, wd.get('Rect'));
  const mk = edit.dict(wd.get('MK'));
  const rot = ((edit.doc.number(mk?.get('R')) ?? 0) % 360 + 360) % 360;
  let w = r[2] - r[0];
  let h = r[3] - r[1];
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  const bs = edit.dict(wd.get('BS'));
  const bc = colorOp(edit, mk?.get('BC'), true);
  const bg = colorOp(edit, mk?.get('BG'), false);
  const bw = bc ? edit.doc.number(bs?.get('W')) ?? 1 : 0;
  const da = valueText(edit.doc, wd.get('DA')) || f.da;
  const ops: string[] = [];
  if (bg) ops.push(`q ${bg} 0 0 ${numText(w)} ${numText(h)} re f Q`);
  if (bc && bw > 0) {
    const style = edit.doc.get(bs?.get('S'));
    if (style instanceof PdfName && style.name === 'U') ops.push(`q ${bc} ${numText(bw)} w 0 ${numText(bw / 2)} m ${numText(w)} ${numText(bw / 2)} l S Q`);
    else ops.push(`q ${bc} ${numText(bw)} w ${numText(bw / 2)} ${numText(bw / 2)} ${numText(w - bw)} ${numText(h - bw)} re S Q`);
  }
  const pad = bw + 2;
  const inner = Math.max(1, w - 2 * pad);
  const body: string[] = [];
  const fixed = daSize(da);
  const col = color(da);
  if (f.kind === 'list') {
    const size = fixed || 12;
    const lh = size * 1.13;
    let y = h - bw - lh;
    for (const o of f.options) {
      if (y < bw - lh) break;
      const sel = o.value === text;
      if (sel) body.push(`0.6 0.757 0.855 rg ${numText(bw)} ${numText(y)} ${numText(w - 2 * bw)} ${numText(lh)} re f`);
      body.push(`BT /FMHelv ${numText(size)} Tf ${sel ? '1 g' : col} ${numText(pad)} ${numText(y + size * 0.25)} Td ${hex(winAnsi(o.label).bytes)} Tj ET`);
      y -= lh;
    }
  } else if (f.comb && f.maxLen > 0) {
    const cell = w / f.maxLen;
    const chars = [...text].slice(0, f.maxLen);
    const size = fixed || Math.max(4, Math.min(12, (h - 2 * bw) * 0.7));
    const y = (h - size * 0.718) / 2;
    chars.forEach((ch, i) => {
      const b = winAnsi(ch).bytes;
      const x = i * cell + (cell - widthOf(b, size)) / 2;
      body.push(`BT /FMHelv ${numText(size)} Tf ${col} ${numText(x)} ${numText(y)} Td ${hex(b)} Tj ET`);
    });
  } else if (f.multiline) {
    const size = fixed || 10;
    const lines = wrap(text, size, inner);
    const lh = size * 1.15;
    let y = h - pad - size * 0.8;
    for (const line of lines) {
      if (y < pad - size * 0.3) break;
      const tw = widthOf(line, size);
      const x = f.q === 1 ? (w - tw) / 2 : f.q === 2 ? w - pad - tw : pad;
      body.push(`BT /FMHelv ${numText(size)} Tf ${col} ${numText(x)} ${numText(y)} Td ${hex(line)} Tj ET`);
      y -= lh;
    }
  } else {
    const shown = f.maxLen ? [...text].slice(0, f.maxLen).join('') : text;
    const b = winAnsi(shown.replace(/[\r\n]+/g, ' ')).bytes;
    let size = fixed;
    if (!size) {
      size = Math.max(4, Math.min(12, (h - 2 * bw - 2) * 0.72));
      const unit = widthOf(b, 1);
      if (unit > 0 && unit * size > inner) size = Math.max(4, inner / unit);
    }
    const tw = widthOf(b, size);
    const x = f.q === 1 ? (w - tw) / 2 : f.q === 2 ? w - pad - tw : pad;
    const y = (h - size * 0.925) / 2 + size * 0.207;
    body.push(`BT /FMHelv ${numText(size)} Tf ${col} ${numText(x)} ${numText(y)} Td ${hex(b)} Tj ET`);
  }
  ops.push('/Tx BMC', 'q', `${numText(bw)} ${numText(bw)} ${numText(Math.max(0, w - 2 * bw))} ${numText(Math.max(0, h - 2 * bw))} re W n`, ...body, 'Q', 'EMC');
  const d = new PdfDict();
  d.set('Type', name('XObject')).set('Subtype', name('Form')).set('BBox', [0, 0, w, h]);
  if (rot === 90) d.set('Matrix', [0, 1, -1, 0, h, 0]);
  else if (rot === 180) d.set('Matrix', [-1, 0, 0, -1, w, h]);
  else if (rot === 270) d.set('Matrix', [0, -1, 1, 0, 0, w]);
  const font = new PdfDict().set('FMHelv', edit.helvetica());
  d.set('Resources', new PdfDict().set('Font', font));
  return new PdfStream(d, fromLatin1(ops.join('\n')));
}

export function setValue(edit: RowEdit, f: Field, input: string): string {
  const c = check(f, input);
  if (f.kind === 'signature' || f.kind === 'button') return c.problem;
  const fd = edit.mut(f.num);
  if (f.kind === 'text' || f.kind === 'combo' || f.kind === 'list') {
    fd.set('V', textString(c.value));
    if (f.kind === 'list') {
      const i = f.options.findIndex((o) => o.value === c.value);
      if (i >= 0) fd.set('I', [i]);
      else fd.delete('I');
    }
    const shown = f.kind === 'combo' && c.value ? c.shown : c.value;
    if (winAnsi(shown).lossy) edit.needAppearances = true;
    for (const w of f.widgets) {
      const ap = edit.add(appearance(edit, f, w.num, f.kind === 'list' ? c.value : shown));
      const wd = edit.mut(w.num);
      wd.set('AP', new PdfDict().set('N', ap));
    }
    return c.problem;
  }
  let state = 'Off';
  if (f.kind === 'checkbox' && c.value === 'on') state = f.widgets.find((w) => w.on)?.on ?? 'Yes';
  if (f.kind === 'radio' && c.value) state = c.value;
  fd.set('V', name(state));
  for (const w of f.widgets) {
    const wd = edit.mut(w.num);
    wd.set('AS', name(w.on === state ? state : 'Off'));
  }
  return c.problem;
}

export function flatten(edit: RowEdit, form: FormInfo): void {
  const doc = edit.doc;
  const byPage = new Map<number, Field['widgets']>();
  const all = new Set<number>();
  for (const f of form.fields) for (const w of f.widgets) {
    all.add(w.num);
    if (w.page < 0) continue;
    const list = byPage.get(w.page) ?? [];
    list.push(w);
    byPage.set(w.page, list);
  }
  form.pages.forEach((p, i) => {
    const pd = edit.mut(p.num);
    const annots = edit.doc.array(pd.get('Annots'));
    const kept = annots.filter((a) => !(a instanceof PdfRef && all.has(a.num)));
    if (kept.length) pd.set('Annots', kept);
    else pd.delete('Annots');
    const widgets = byPage.get(i);
    if (!widgets?.length) return;
    const draws: string[] = [];
    const xo = new PdfDict();
    let k = 0;
    for (const w of widgets) {
      const wd = edit.dict(new PdfRef(w.num));
      if (!wd) continue;
      const flags = doc.number(wd.get('F')) ?? 0;
      if (flags & 2 || flags & 32) continue;
      const ap = edit.dict(wd.get('AP'));
      let n = ap?.get('N');
      const nd = edit.get(n);
      if (nd instanceof PdfDict) {
        const as = edit.get(wd.get('AS'));
        n = as instanceof PdfName ? nd.get(as.name) : undefined;
      }
      const s = edit.get(n);
      if (!(n instanceof PdfRef) || !(s instanceof PdfStream)) continue;
      const bbox = rectOf(doc, s.dict.get('BBox'));
      const m = doc.array(s.dict.get('Matrix')).map((x) => doc.number(x) ?? 0);
      const [a, b, c, d, e, ff] = m.length === 6 ? m : [1, 0, 0, 1, 0, 0];
      const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + ff]);
      const tx0 = Math.min(...pts.map((q) => q[0])), tx1 = Math.max(...pts.map((q) => q[0]));
      const ty0 = Math.min(...pts.map((q) => q[1])), ty1 = Math.max(...pts.map((q) => q[1]));
      if (tx1 - tx0 <= 0 || ty1 - ty0 <= 0) continue;
      const sx = (w.rect[2] - w.rect[0]) / (tx1 - tx0);
      const sy = (w.rect[3] - w.rect[1]) / (ty1 - ty0);
      const key = `FMf${k++}`;
      if (!isName(s.dict.get('Subtype'), 'Form')) {
        const nd2 = s.dict.clone().set('Type', name('XObject')).set('Subtype', name('Form'));
        edit.overrides.set(n.num, new PdfStream(nd2, s.data));
      }
      xo.set(key, n);
      draws.push(`q ${numText(sx)} 0 0 ${numText(sy)} ${numText(w.rect[0] - tx0 * sx)} ${numText(w.rect[1] - ty0 * sy)} cm /${key} Do Q`);
    }
    if (!draws.length) return;
    const res = (edit.dict(pd.get('Resources') ?? doc.inherited(p.num, 'Resources')) ?? new PdfDict()).clone();
    const old = edit.dict(res.get('XObject'));
    const merged = old ? old.clone() : new PdfDict();
    for (const [kk, v] of xo.map) merged.set(kk, v);
    res.set('XObject', merged);
    pd.set('Resources', res);
    const contents = pd.get('Contents');
    const cv = edit.get(contents);
    const list = Array.isArray(cv) ? cv : contents ? [contents] : [];
    const head = edit.add(new PdfStream(new PdfDict(), fromLatin1('q\n')));
    const tail = edit.add(new PdfStream(new PdfDict(), fromLatin1('\nQ\n' + draws.join('\n') + '\n')));
    pd.set('Contents', [head, ...list, tail]);
  });
  edit.flattened = true;
}

const isName = (v: PdfValue | undefined, n: string) => v instanceof PdfName && v.name === n;
