import type { PdfDoc } from './doc';
import type { RowEdit } from './edit';
import { textString } from './font';
import type { FormInfo } from './form';
import { ByteWriter, PdfDict, PdfRef, type PdfValue, name, visitRefs, writeValue } from './objects';

const PAGES_NODE = -1;
const ROW_FIELD = -2;
const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
const PRODUCER = 'formpdf Mail Merge';

type Job = { key: string; num: number; row: number; value: PdfValue };

class OutRef extends PdfRef {}

class Out {
  private nums = new Map<string, number>();
  private queue: Job[] = [];
  private next = 1;

  constructor(
    private rows: RowEdit[],
    private shared: Set<number> | null,
    private special: (key: string, row: number) => PdfValue | undefined,
  ) {}

  keyOf(row: number, num: number): string {
    if (this.shared && this.shared.has(num) && !this.rows[row].extra.has(num)) return `s:${num}`;
    return `${row}:${num}`;
  }

  ref(key: string, row: number, value: () => PdfValue | undefined): PdfRef | null {
    const have = this.nums.get(key);
    if (have !== undefined) return new OutRef(have);
    const v = value();
    if (v === undefined) return null;
    const n = this.next++;
    this.nums.set(key, n);
    this.queue.push({ key, num: n, row, value: v });
    return new OutRef(n);
  }

  mapper(row: number) {
    return (r: PdfRef): PdfRef | null => {
      if (r instanceof OutRef) return r;
      if (r.num === PAGES_NODE) return this.ref('pages', 0, () => this.special('pages', 0));
      if (r.num === ROW_FIELD) return this.ref(`${row}:rowfield`, row, () => this.special('rowfield', row));
      const key = this.keyOf(row, r.num);
      return this.ref(key, key.startsWith('s:') ? 0 : row, () => this.rows[row].raw(r.num));
    };
  }

  write(rootRef: PdfRef, infoRef: PdfRef | null): Uint8Array {
    const w = new ByteWriter();
    w.text('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
    const offsets: number[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i];
      offsets[job.num] = w.length;
      w.text(`${job.num} 0 obj\n`);
      writeValue(w, job.value, this.mapper(job.row));
      w.text('\nendobj\n');
    }
    const xref = w.length;
    const size = this.next;
    w.text(`xref\n0 ${size}\n0000000000 65535 f \n`);
    for (let n = 1; n < size; n++) w.text(`${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`);
    const trailer = new PdfDict().set('Size', size).set('Root', rootRef);
    if (infoRef) trailer.set('Info', infoRef);
    w.text('trailer\n');
    writeValue(w, trailer, (r) => r);
    w.text(`\nstartxref\n${xref}\n%%EOF\n`);
    return w.done();
  }
}

export function writeSingle(doc: PdfDoc, edit: RowEdit): Uint8Array {
  const rootRef = doc.trailer.get('Root') as PdfRef;
  const cat = edit.mut(rootRef.num);
  cat.delete('Perms');
  const af = edit.dict(cat.get('AcroForm'));
  if (edit.flattened) cat.delete('AcroForm');
  else if (af) {
    const naf = af.clone();
    if (edit.needAppearances) naf.set('NeedAppearances', true);
    naf.delete('XFA');
    naf.delete('SigFlags');
    cat.set('AcroForm', naf);
  }
  const info = edit.dict(doc.trailer.get('Info'));
  const ninfo = (info ?? new PdfDict()).clone().set('Producer', textString(PRODUCER));
  const infoRef = edit.add(ninfo);
  const out = new Out([edit], null, () => undefined);
  const map = out.mapper(0);
  const r = map(rootRef)!;
  const i = map(infoRef);
  return out.write(r, i);
}

export function writeCombined(doc: PdfDoc, form: FormInfo, edits: RowEdit[], labels: string[]): Uint8Array {
  const reverse = new Map<number, number[]>();
  for (const [n, v] of doc.objects) {
    visitRefs(v, (r) => {
      const list = reverse.get(r.num);
      if (list) list.push(n);
      else reverse.set(r.num, [n]);
    });
  }
  const dirty = new Set<number>();
  const stack: number[] = [];
  const mark = (n: number) => {
    if (!dirty.has(n)) {
      dirty.add(n);
      stack.push(n);
    }
  };
  for (const p of form.pages) mark(p.num);
  for (const f of form.fields) {
    mark(f.num);
    for (const w of f.widgets) mark(w.num);
  }
  for (const t of form.topFields) mark(t);
  for (const p of form.pages) for (const a of doc.array(doc.dict(new PdfRef(p.num))?.get('Annots'))) if (a instanceof PdfRef) mark(a.num);
  for (const e of edits) for (const n of e.overrides.keys()) if (doc.objects.has(n)) mark(n);
  while (stack.length) {
    const n = stack.pop()!;
    for (const parent of reverse.get(n) ?? []) mark(parent);
  }
  const shared = new Set<number>();
  for (const n of doc.objects.keys()) if (!dirty.has(n)) shared.add(n);

  const af = doc.dict(doc.root.get('AcroForm'));
  const flattened = edits.every((e) => e.flattened);
  for (const e of edits) {
    form.pages.forEach((p) => {
      const pd = e.mut(p.num);
      for (const k of INHERITED) if (!pd.has(k)) {
        const v = doc.inherited(p.num, k);
        if (v !== undefined) pd.set(k, v);
      }
      pd.set('Parent', new PdfRef(PAGES_NODE));
      pd.delete('StructParents');
    });
    if (!flattened) for (const t of form.topFields) e.mut(t).set('Parent', new PdfRef(ROW_FIELD));
  }
  const pagesKids: PdfValue[] = [];
  const pagesNode = new PdfDict().set('Type', name('Pages')).set('Kids', pagesKids);
  const special = (key: string, row: number): PdfValue | undefined => {
    if (key === 'pages') return pagesNode;
    if (key === 'rowfield') return new PdfDict().set('T', textString(labels[row])).set('Kids', form.topFields.map((t) => new PdfRef(t)));
    return undefined;
  };
  const out = new Out(edits, shared, special);
  const pagesRef = out.mapper(0)(new PdfRef(PAGES_NODE))!;
  edits.forEach((_, r) => {
    const map = out.mapper(r);
    for (const p of form.pages) {
      const ref = map(new PdfRef(p.num));
      if (ref) pagesKids.push(ref);
    }
  });
  pagesNode.set('Count', pagesKids.length);
  const cat = new PdfDict().set('Type', name('Catalog')).set('Pages', pagesRef);
  if (!flattened && af) {
    const naf = new PdfDict();
    const rowFields: PdfValue[] = [];
    edits.forEach((_, r) => {
      const ref = out.mapper(r)(new PdfRef(ROW_FIELD));
      if (ref) rowFields.push(ref);
    });
    naf.set('Fields', rowFields);
    const map0 = out.mapper(0);
    const remap = (v: PdfValue | undefined): PdfValue | undefined => (v instanceof PdfRef ? map0(v) : v);
    for (const k of ['DR', 'DA', 'Q']) {
      const v = af.get(k);
      if (v !== undefined) naf.set(k, (remap(v) as PdfValue) ?? null);
    }
    if (edits.some((e) => e.needAppearances)) naf.set('NeedAppearances', true);
    cat.set('AcroForm', naf);
  }
  const info = doc.dict(doc.trailer.get('Info'));
  const ninfo = new PdfDict().set('Producer', textString(PRODUCER));
  const title = info?.get('Title');
  if (title && !(title instanceof PdfRef)) ninfo.set('Title', title);
  const rootRef = out.ref('catalog', 0, () => cat)!;
  const infoRef = out.ref('info', 0, () => ninfo)!;
  return out.write(rootRef, infoRef);
}

