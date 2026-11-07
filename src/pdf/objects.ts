export class PdfName {
  constructor(readonly name: string) {}
}

export class PdfRef {
  constructor(readonly num: number, readonly gen = 0) {}
}

export class PdfString {
  constructor(readonly bytes: Uint8Array, readonly hex = false) {}
}

export class PdfDict {
  readonly map = new Map<string, PdfValue>();
  get(key: string): PdfValue | undefined {
    return this.map.get(key);
  }
  set(key: string, value: PdfValue): this {
    this.map.set(key, value);
    return this;
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  clone(): PdfDict {
    const d = new PdfDict();
    for (const [k, v] of this.map) d.map.set(k, v);
    return d;
  }
}

export class PdfStream {
  constructor(public dict: PdfDict, public data: Uint8Array) {}
}

export type PdfValue = null | boolean | number | PdfName | PdfRef | PdfString | PdfValue[] | PdfDict | PdfStream;

export class PdfError extends Error {}

export const name = (n: string) => new PdfName(n);
export const isName = (v: unknown, n?: string): v is PdfName => v instanceof PdfName && (n === undefined || v.name === n);
export const dict = (entries: Record<string, PdfValue>) => {
  const d = new PdfDict();
  for (const [k, v] of Object.entries(entries)) d.set(k, v);
  return d;
};

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;

export const latin1 = (bytes: Uint8Array, start = 0, end = bytes.length) => {
  let s = '';
  for (let i = start; i < end; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 0x8000)));
  return s;
};

export const fromLatin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

type LengthOf = (ref: PdfRef) => number | null;

export class Lexer {
  pos: number;
  constructor(readonly b: Uint8Array, pos = 0, private lengthOf: LengthOf = () => null) {
    this.pos = pos;
  }

  skip(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS[c]) this.pos++;
      else if (c === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  word(): string {
    this.skip();
    const start = this.pos;
    while (this.pos < this.b.length && !WS[this.b[this.pos]] && !DELIM[this.b[this.pos]]) this.pos++;
    return latin1(this.b, start, this.pos);
  }

  peekWord(): string {
    const at = this.pos;
    const w = this.word();
    this.pos = at;
    return w;
  }

  value(): PdfValue {
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) throw new PdfError('unexpected end of file');
    const c = b[this.pos];
    if (c === 47) return this.nameToken();
    if (c === 40) return this.literal();
    if (c === 60) {
      if (b[this.pos + 1] === 60) return this.dictOrStream();
      return this.hexString();
    }
    if (c === 91) {
      this.pos++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.pos >= b.length) throw new PdfError('unclosed array');
        if (b[this.pos] === 93) {
          this.pos++;
          return arr;
        }
        arr.push(this.value());
      }
    }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) return this.numberOrRef();
    const w = this.word();
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    if (!w) {
      this.pos++;
      return null;
    }
    throw new PdfError(`unexpected "${w.slice(0, 20)}"`);
  }

  private nameToken(): PdfName {
    this.pos++;
    const start = this.pos;
    while (this.pos < this.b.length && !WS[this.b[this.pos]] && !DELIM[this.b[this.pos]]) this.pos++;
    let raw = latin1(this.b, start, this.pos);
    if (raw.includes('#')) raw = raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return new PdfName(raw);
  }

  private numberOrRef(): PdfValue {
    const n = Number(this.word());
    if (!Number.isFinite(n)) return 0;
    if (Number.isInteger(n) && n >= 0) {
      const at = this.pos;
      this.skip();
      const c = this.b[this.pos];
      if (c >= 48 && c <= 57) {
        const g = this.word();
        if (/^\d+$/.test(g) && this.word() === 'R') return new PdfRef(n, Number(g));
      }
      this.pos = at;
    }
    return n;
  }

  private literal(): PdfString {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      let c = b[this.pos++];
      if (c === 92) {
        c = b[this.pos++];
        if (c === 110) out.push(10);
        else if (c === 114) out.push(13);
        else if (c === 116) out.push(9);
        else if (c === 98) out.push(8);
        else if (c === 102) out.push(12);
        else if (c === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (c === 10) {
        } else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let i = 0; i < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; i++) v = v * 8 + (b[this.pos++] - 48);
          out.push(v & 0xff);
        } else out.push(c);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return new PdfString(Uint8Array.from(out));
  }

  private hexString(): PdfString {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let hi = -1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 62) break;
      const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        out.push(hi * 16 + v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi * 16);
    return new PdfString(Uint8Array.from(out), true);
  }

  private dictOrStream(): PdfDict | PdfStream {
    const b = this.b;
    this.pos += 2;
    const d = new PdfDict();
    for (;;) {
      this.skip();
      if (this.pos >= b.length) throw new PdfError('unclosed dictionary');
      if (b[this.pos] === 62 && b[this.pos + 1] === 62) {
        this.pos += 2;
        break;
      }
      const key = this.value();
      if (!(key instanceof PdfName)) throw new PdfError('dictionary key is not a name');
      d.set(key.name, this.value());
    }
    const at = this.pos;
    if (this.peekWord() !== 'stream') return d;
    this.word();
    if (b[this.pos] === 13) this.pos++;
    if (b[this.pos] === 10) this.pos++;
    const start = this.pos;
    const raw = d.get('Length');
    const declared = typeof raw === 'number' ? raw : raw instanceof PdfRef ? this.lengthOf(raw) : null;
    let end = -1;
    if (declared !== null && declared >= 0 && start + declared <= b.length) {
      const probe = new Lexer(b, start + declared);
      if (probe.word() === 'endstream') {
        end = start + declared;
        this.pos = probe.pos;
      }
    }
    if (end < 0) {
      const found = indexOf(b, ENDSTREAM, start);
      if (found < 0) {
        this.pos = at;
        throw new PdfError('stream without endstream');
      }
      end = found;
      while (end > start && (b[end - 1] === 10 || b[end - 1] === 13)) end--;
      this.pos = found + ENDSTREAM.length;
    }
    return new PdfStream(d, b.slice(start, end));
  }
}

const ENDSTREAM = fromLatin1('endstream');

export function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  const last = hay.length - needle.length;
  outer: for (let i = hay.indexOf(first, from); i >= 0 && i <= last; i = hay.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function lastIndexOf(hay: Uint8Array, needle: Uint8Array, from = hay.length - needle.length): number {
  for (let i = Math.min(from, hay.length - needle.length); i >= 0; i--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

export class ByteWriter {
  private chunks: Uint8Array[] = [];
  private buf = new Uint8Array(1 << 16);
  private used = 0;
  length = 0;

  text(s: string): void {
    for (let i = 0; i < s.length; i++) {
      if (this.used === this.buf.length) this.flush();
      this.buf[this.used++] = s.charCodeAt(i) & 0xff;
    }
    this.length += s.length;
  }

  bytes(b: Uint8Array): void {
    this.flush();
    this.chunks.push(b);
    this.length += b.length;
  }

  private flush(): void {
    if (!this.used) return;
    this.chunks.push(this.buf.slice(0, this.used));
    this.used = 0;
  }

  done(): Uint8Array {
    this.flush();
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

const REGULAR = /^[!-~]$/;

export function nameText(n: string): string {
  let out = '/';
  for (const ch of n) {
    const c = ch.charCodeAt(0);
    if (c > 126 || !REGULAR.test(ch) || '()<>[]{}/%#'.includes(ch)) out += '#' + (c & 0xff).toString(16).padStart(2, '0');
    else out += ch;
  }
  return out;
}

export function numText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

export function stringText(s: PdfString): string {
  const b = s.bytes;
  let printable = !s.hex;
  if (printable) for (const c of b) if (c < 32 || c > 126) { printable = false; break; }
  if (!printable) {
    let h = '<';
    for (const c of b) h += c.toString(16).padStart(2, '0');
    return h + '>';
  }
  let out = '(';
  for (const c of b) {
    if (c === 40 || c === 41 || c === 92) out += '\\';
    out += String.fromCharCode(c);
  }
  return out + ')';
}

export function writeValue(w: ByteWriter, v: PdfValue, ref: (r: PdfRef) => PdfRef | null): void {
  if (v === null || v === undefined) w.text('null');
  else if (typeof v === 'boolean') w.text(v ? 'true' : 'false');
  else if (typeof v === 'number') w.text(numText(v));
  else if (v instanceof PdfName) w.text(nameText(v.name));
  else if (v instanceof PdfString) w.text(stringText(v));
  else if (v instanceof PdfRef) {
    const r = ref(v);
    w.text(r ? `${r.num} ${r.gen} R` : 'null');
  } else if (Array.isArray(v)) {
    w.text('[');
    v.forEach((x, i) => {
      if (i) w.text(' ');
      writeValue(w, x, ref);
    });
    w.text(']');
  } else if (v instanceof PdfDict) {
    w.text('<<');
    for (const [k, x] of v.map) {
      w.text(nameText(k));
      w.text(' ');
      writeValue(w, x, ref);
    }
    w.text('>>');
  } else if (v instanceof PdfStream) {
    const d = v.dict.clone();
    d.set('Length', v.data.length);
    writeValue(w, d, ref);
    w.text('\nstream\n');
    w.bytes(v.data);
    w.text('\nendstream');
  }
}

export function visitRefs(v: PdfValue | undefined, fn: (r: PdfRef) => void): void {
  if (v instanceof PdfRef) fn(v);
  else if (Array.isArray(v)) for (const x of v) visitRefs(x, fn);
  else if (v instanceof PdfDict) for (const x of v.map.values()) visitRefs(x, fn);
  else if (v instanceof PdfStream) for (const x of v.dict.map.values()) visitRefs(x, fn);
}
