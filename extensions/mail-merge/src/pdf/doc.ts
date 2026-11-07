import { Lexer, PdfDict, PdfError, PdfName, PdfRef, PdfStream, type PdfValue, fromLatin1, indexOf, isName, lastIndexOf, latin1 } from './objects';

type Entry = { kind: 1; offset: number } | { kind: 2; stream: number; index: number };

export class Protected extends PdfError {}

async function pump(input: Uint8Array, format: CompressionFormat, compress: boolean): Promise<Uint8Array> {
  const stream = compress ? new CompressionStream(format) : new DecompressionStream(format);
  const writer = stream.writable.getWriter();
  writer.write(input as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
  } catch (err) {
    if (!total) throw err;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  try {
    return await pump(data, 'deflate', false);
  } catch {
    return pump(data.subarray(2), 'deflate-raw', false);
  }
}

export const deflate = (data: Uint8Array) => pump(data, 'deflate', true);

function unpredict(data: Uint8Array, parms: PdfDict | undefined): Uint8Array {
  const predictor = num(parms?.get('Predictor')) ?? 1;
  if (predictor < 10) return data;
  const colors = num(parms?.get('Colors')) ?? 1;
  const bpc = num(parms?.get('BitsPerComponent')) ?? 8;
  const columns = num(parms?.get('Columns')) ?? 1;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const row = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  const prev = new Uint8Array(row);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (row + 1)];
    const line = data.subarray(r * (row + 1) + 1, (r + 1) * (row + 1));
    const cur = out.subarray(r * row, (r + 1) * row);
    for (let i = 0; i < row; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const ul = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (type === 1) v += left;
      else if (type === 2) v += up;
      else if (type === 3) v += (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      cur[i] = v & 0xff;
    }
    prev.set(cur);
  }
  return out;
}

const num = (v: PdfValue | undefined): number | null => (typeof v === 'number' ? v : null);

export class PdfDoc {
  readonly objects = new Map<number, PdfValue>();
  private entries = new Map<number, Entry>();
  trailer = new PdfDict();
  maxNum = 0;

  private constructor(readonly bytes: Uint8Array) {}

  static async load(bytes: Uint8Array): Promise<PdfDoc> {
    if (indexOf(bytes.subarray(0, 1024), fromLatin1('%PDF-')) < 0) throw new PdfError('This file is not a PDF.');
    const doc = new PdfDoc(bytes);
    try {
      await doc.readXrefChain();
    } catch {
      doc.entries.clear();
      doc.trailer = new PdfDict();
    }
    if (!(doc.trailer.get('Root') instanceof PdfRef)) await doc.reconstruct();
    if (doc.trailer.get('Encrypt')) throw new Protected('This PDF is protected with a password. Remove the password in formpdf (Protect) and try again.');
    await doc.loadAll();
    if (!(doc.get(doc.trailer.get('Root')) instanceof PdfDict)) throw new PdfError('The PDF has no document catalog.');
    return doc;
  }

  get(v: PdfValue | undefined): PdfValue | undefined {
    let cur = v;
    for (let i = 0; i < 32 && cur instanceof PdfRef; i++) cur = this.objects.get(cur.num);
    return cur instanceof PdfRef ? undefined : cur;
  }

  dict(v: PdfValue | undefined): PdfDict | undefined {
    const o = this.get(v);
    if (o instanceof PdfDict) return o;
    if (o instanceof PdfStream) return o.dict;
    return undefined;
  }

  array(v: PdfValue | undefined): PdfValue[] {
    const o = this.get(v);
    return Array.isArray(o) ? o : [];
  }

  number(v: PdfValue | undefined): number | null {
    return num(this.get(v));
  }

  get root(): PdfDict {
    return this.dict(this.trailer.get('Root'))!;
  }

  private async readXrefChain(): Promise<void> {
    const b = this.bytes;
    const at = lastIndexOf(b, fromLatin1('startxref'));
    if (at < 0) throw new PdfError('no startxref');
    const lx = new Lexer(b, at + 9);
    let offset = Number(lx.word());
    const seen = new Set<number>();
    while (Number.isFinite(offset) && offset > 0 && offset < b.length && !seen.has(offset)) {
      seen.add(offset);
      const trailer = await this.readXref(offset);
      for (const [k, v] of trailer.map) if (!this.trailer.has(k)) this.trailer.set(k, v);
      const stm = num(trailer.get('XRefStm'));
      if (stm !== null && !seen.has(stm)) {
        seen.add(stm);
        await this.readXref(stm);
      }
      offset = num(trailer.get('Prev')) ?? -1;
    }
  }

  private async readXref(offset: number): Promise<PdfDict> {
    const lx = new Lexer(this.bytes, offset);
    if (lx.peekWord() === 'xref') {
      lx.word();
      for (;;) {
        const w = lx.word();
        if (w === 'trailer') break;
        const first = Number(w);
        const count = Number(lx.word());
        if (!Number.isInteger(first) || !Number.isInteger(count)) throw new PdfError('bad xref table');
        for (let i = 0; i < count; i++) {
          const off = Number(lx.word());
          lx.word();
          const type = lx.word();
          const n = first + i;
          if (type === 'n' && off > 0 && !this.entries.has(n)) this.entries.set(n, { kind: 1, offset: off });
        }
      }
      const t = lx.value();
      if (!(t instanceof PdfDict)) throw new PdfError('bad trailer');
      return t;
    }
    lx.word();
    lx.word();
    if (lx.word() !== 'obj') throw new PdfError('xref offset is not an object');
    const s = lx.value();
    if (!(s instanceof PdfStream) || !isName(s.dict.get('Type'), 'XRef')) throw new PdfError('bad xref stream');
    const data = await this.decode(s);
    const W = (s.dict.get('W') as number[]) ?? [1, 2, 1];
    const size = num(s.dict.get('Size')) ?? 0;
    const index = (s.dict.get('Index') as number[] | undefined) ?? [0, size];
    const width = W[0] + W[1] + W[2];
    let p = 0;
    const field = (w: number, def: number) => {
      if (!w) return def;
      let v = 0;
      for (let i = 0; i < w; i++) v = v * 256 + data[p++];
      return v;
    };
    for (let k = 0; k + 1 < index.length; k += 2) {
      for (let i = 0; i < index[k + 1] && p + width <= data.length; i++) {
        const n = index[k] + i;
        const type = field(W[0], 1);
        const a = field(W[1], 0);
        const c = field(W[2], 0);
        if (this.entries.has(n)) continue;
        if (type === 1) this.entries.set(n, { kind: 1, offset: a });
        else if (type === 2) this.entries.set(n, { kind: 2, stream: a, index: c });
        else this.entries.set(n, { kind: 1, offset: 0 });
      }
    }
    return s.dict;
  }

  private async reconstruct(): Promise<void> {
    const text = latin1(this.bytes);
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    this.entries.clear();
    for (let m = re.exec(text); m; m = re.exec(text)) this.entries.set(Number(m[1]), { kind: 1, offset: m.index });
    let tpos = text.lastIndexOf('trailer');
    while (tpos >= 0) {
      try {
        const t = new Lexer(this.bytes, tpos + 7).value();
        if (t instanceof PdfDict && t.get('Root') instanceof PdfRef) {
          this.trailer = t;
          return;
        }
      } catch {}
      tpos = text.lastIndexOf('trailer', tpos - 1);
    }
    for (const [n, e] of this.entries) {
      if (e.kind !== 1) continue;
      const o = this.parseAt(e.offset, n);
      if (o instanceof PdfStream && isName(o.dict.get('Type'), 'XRef') && o.dict.get('Root')) {
        this.trailer = o.dict;
        await this.unpackObjectStreams();
        return;
      }
      if (o instanceof PdfDict && isName(o.get('Type'), 'Catalog')) this.trailer.set('Root', new PdfRef(n));
    }
    if (!this.trailer.get('Root')) throw new PdfError('This PDF is damaged and could not be read.');
  }

  private parseAt(offset: number, expect: number): PdfValue | undefined {
    try {
      const lx = new Lexer(this.bytes, offset, (r) => this.lengthOf(r));
      const n = Number(lx.word());
      lx.word();
      if (lx.word() !== 'obj' || n !== expect) return undefined;
      return lx.value();
    } catch {
      return undefined;
    }
  }

  private lengthOf(r: PdfRef): number | null {
    const known = this.objects.get(r.num);
    if (typeof known === 'number') return known;
    const e = this.entries.get(r.num);
    if (!e || e.kind !== 1 || !e.offset) return null;
    const lx = new Lexer(this.bytes, e.offset);
    lx.word();
    lx.word();
    if (lx.word() !== 'obj') return null;
    const v = Number(lx.word());
    return Number.isFinite(v) ? v : null;
  }

  private async unpackObjectStreams(): Promise<void> {
    const streams = new Set<number>();
    for (const e of this.entries.values()) if (e.kind === 2) streams.add(e.stream);
    for (const sn of streams) {
      const e = this.entries.get(sn);
      if (!e || e.kind !== 1 || !e.offset) continue;
      const s = this.parseAt(e.offset, sn);
      if (!(s instanceof PdfStream)) continue;
      let data: Uint8Array;
      try {
        data = await this.decode(s);
      } catch {
        continue;
      }
      const n = num(s.dict.get('N')) ?? 0;
      const first = num(s.dict.get('First')) ?? 0;
      const lx = new Lexer(data, 0);
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) pairs.push([Number(lx.word()), Number(lx.word())]);
      for (const [objNum, off] of pairs) {
        const want = this.entries.get(objNum);
        if (want && want.kind === 2 && want.stream !== sn) continue;
        if (this.objects.has(objNum)) continue;
        try {
          const ol = new Lexer(data, first + off);
          this.objects.set(objNum, ol.value());
        } catch {}
      }
    }
  }

  private async loadAll(): Promise<void> {
    await this.unpackObjectStreams();
    for (const [n, e] of this.entries) {
      if (e.kind !== 1 || !e.offset || this.objects.has(n)) continue;
      const o = this.parseAt(e.offset, n);
      if (o !== undefined) this.objects.set(n, o);
    }
    for (const n of this.objects.keys()) if (n > this.maxNum) this.maxNum = n;
    const size = num(this.trailer.get('Size')) ?? 0;
    this.maxNum = Math.max(this.maxNum, size - 1);
  }

  async decode(s: PdfStream): Promise<Uint8Array> {
    let filters = s.dict.get('Filter');
    let parms = s.dict.get('DecodeParms');
    if (filters instanceof PdfRef) filters = this.get(filters);
    if (parms instanceof PdfRef) parms = this.get(parms);
    const fl = Array.isArray(filters) ? filters : filters ? [filters] : [];
    const pl = Array.isArray(parms) ? parms : [parms];
    let data = s.data;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      if (!(f instanceof PdfName)) continue;
      if (f.name === 'FlateDecode' || f.name === 'Fl') data = unpredict(await inflate(data), (this.get(pl[i] ?? undefined) as PdfDict) ?? undefined);
      else throw new PdfError(`unsupported stream filter ${f.name}`);
    }
    return data;
  }

  pages(): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    const walk = (v: PdfValue | undefined, depth: number) => {
      if (!(v instanceof PdfRef) || seen.has(v.num) || depth > 64) return;
      seen.add(v.num);
      const d = this.dict(v);
      if (!d) return;
      if (isName(d.get('Type'), 'Pages') || d.has('Kids')) for (const k of this.array(d.get('Kids'))) walk(k, depth + 1);
      else out.push(v.num);
    };
    walk(this.root.get('Pages'), 0);
    return out;
  }

  inherited(pageNum: number, key: string): PdfValue | undefined {
    let d = this.dict(new PdfRef(pageNum));
    for (let i = 0; d && i < 64; i++) {
      if (d.has(key)) return d.get(key);
      d = this.dict(d.get('Parent'));
    }
    return undefined;
  }
}
