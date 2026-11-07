import type { PdfDoc } from './doc';
import { PdfDict, PdfRef, PdfStream, type PdfValue, name } from './objects';

export class RowEdit {
  readonly overrides = new Map<number, PdfValue>();
  readonly extra = new Map<number, PdfValue>();
  private next: number;
  flattened = false;
  needAppearances = false;
  private font: PdfRef | null = null;

  constructor(readonly doc: PdfDoc) {
    this.next = doc.maxNum + 1;
  }

  raw(num: number): PdfValue | undefined {
    if (this.extra.has(num)) return this.extra.get(num);
    if (this.overrides.has(num)) return this.overrides.get(num);
    return this.doc.objects.get(num);
  }

  get(v: PdfValue | undefined): PdfValue | undefined {
    let cur = v;
    for (let i = 0; i < 32 && cur instanceof PdfRef; i++) cur = this.raw(cur.num);
    return cur instanceof PdfRef ? undefined : cur;
  }

  dict(v: PdfValue | undefined): PdfDict | undefined {
    const o = this.get(v);
    return o instanceof PdfDict ? o : o instanceof PdfStream ? o.dict : undefined;
  }

  mut(num: number): PdfDict {
    const cur = this.overrides.get(num);
    if (cur instanceof PdfDict) return cur;
    const base = this.doc.objects.get(num);
    const d = base instanceof PdfDict ? base.clone() : new PdfDict();
    this.overrides.set(num, d);
    return d;
  }

  add(v: PdfValue): PdfRef {
    const n = this.next++;
    this.extra.set(n, v);
    return new PdfRef(n);
  }

  helvetica(): PdfRef {
    if (!this.font) {
      const d = new PdfDict();
      d.set('Type', name('Font')).set('Subtype', name('Type1')).set('BaseFont', name('Helvetica')).set('Encoding', name('WinAnsiEncoding'));
      this.font = this.add(d);
    }
    return this.font;
  }
}
