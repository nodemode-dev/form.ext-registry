export interface Picture {
  mime: string;
  data: Uint8Array;
}

export interface TagChapter {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  url?: string;
  picture?: Picture;
  toc: boolean;
}

export interface ParsedTag {
  version: 3 | 4;
  frames: Uint8Array[];
  dropped: number;
  chapters: TagChapter[];
  tocTitle?: string;
  audioStart: number;
}

export class TagError extends Error {}

const latin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

const isLatin1 = (s: string) => [...s].every((c) => c.charCodeAt(0) < 256);

const syncsafe = (n: number) => [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
const readSyncsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const readU32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function encodeText(s: string, version: 3 | 4): { enc: number; bytes: Uint8Array; term: number[] } {
  if (isLatin1(s)) return { enc: 0, bytes: latin1(s), term: [0] };
  if (version === 4) return { enc: 3, bytes: new TextEncoder().encode(s), term: [0] };
  const bytes = new Uint8Array(2 + s.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes[2 + i * 2] = c & 0xff;
    bytes[3 + i * 2] = c >>> 8;
  }
  return { enc: 1, bytes, term: [0, 0] };
}

function frame(id: string, body: Uint8Array, version: 3 | 4): Uint8Array {
  const size = version === 4 ? syncsafe(body.length) : u32(body.length);
  return concat([latin1(id), size, [0, 0], body]);
}

function textFrame(id: string, text: string, version: 3 | 4) {
  const t = encodeText(text, version);
  return frame(id, concat([[t.enc], t.bytes]), version);
}

function urlFrame(url: string, version: 3 | 4) {
  return frame("WXXX", concat([[0], [0], latin1(asciiUrl(url))]), version);
}

function pictureFrame(p: Picture, version: 3 | 4) {
  return frame("APIC", concat([[0], latin1(p.mime), [0], [0], [0], p.data]), version);
}

export function asciiUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return encodeURI(url);
  }
}

export function chapterFrame(c: TagChapter, version: 3 | 4): Uint8Array {
  const sub: Uint8Array[] = [textFrame("TIT2", c.title, version)];
  if (c.url) sub.push(urlFrame(c.url, version));
  if (c.picture) sub.push(pictureFrame(c.picture, version));
  const body = concat([latin1(c.id), [0], u32(Math.round(c.startMs)), u32(Math.round(c.endMs)), u32(0xffffffff), u32(0xffffffff), ...sub]);
  return frame("CHAP", body, version);
}

export function tocFrame(ids: string[], title: string | undefined, version: 3 | 4): Uint8Array {
  const children = ids.flatMap((id) => [...latin1(id), 0]);
  const sub = title ? [textFrame("TIT2", title, version)] : [];
  return frame("CTOC", concat([latin1("toc"), [0], [0x03], [ids.length], children, ...sub]), version);
}

function unsync(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return new Uint8Array(out);
}

function decodeText(enc: number, b: Uint8Array): string {
  if (enc === 0) return String.fromCharCode(...b);
  if (enc === 3) return new TextDecoder("utf-8").decode(b);
  if (enc === 1) {
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
    return new TextDecoder("utf-16le").decode(b);
  }
  return new TextDecoder("utf-16be").decode(b);
}

function stripTerm(s: string) {
  return s.replace(/\u0000+$/, "");
}

function findTerm(b: Uint8Array, from: number, wide: boolean): number {
  if (!wide) {
    const i = b.indexOf(0, from);
    return i < 0 ? b.length : i;
  }
  for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
  return b.length;
}

interface RawFrame {
  id: string;
  body: Uint8Array;
  raw: Uint8Array;
  flags: number;
}

function readFrames(b: Uint8Array, version: 3 | 4): RawFrame[] {
  const out: RawFrame[] = [];
  let o = 0;
  while (o + 10 <= b.length) {
    if (b[o] === 0) break;
    const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? readSyncsafe(b, o + 4) : readU32(b, o + 4);
    if (o + 10 + size > b.length) break;
    out.push({ id, body: b.subarray(o + 10, o + 10 + size), raw: b.subarray(o, o + 10 + size), flags: (b[o + 8] << 8) | b[o + 9] });
    o += 10 + size;
  }
  return out;
}

function readSub(frames: RawFrame[]): { title?: string; url?: string; picture?: Picture } {
  const out: { title?: string; url?: string; picture?: Picture } = {};
  for (const f of frames) {
    const enc = f.body[0];
    const wide = enc === 1 || enc === 2;
    if (f.id === "TIT2") out.title = stripTerm(decodeText(enc, f.body.subarray(1)));
    else if (f.id === "WXXX") {
      const end = findTerm(f.body, 1, wide);
      out.url = stripTerm(String.fromCharCode(...f.body.subarray(end + (wide ? 2 : 1))));
    } else if (f.id === "APIC") {
      const mimeEnd = findTerm(f.body, 1, false);
      const mime = String.fromCharCode(...f.body.subarray(1, mimeEnd));
      const descEnd = findTerm(f.body, mimeEnd + 2, wide);
      out.picture = { mime: mime || "image/jpeg", data: f.body.slice(descEnd + (wide ? 2 : 1)) };
    }
  }
  return out;
}

function splitTerm(body: Uint8Array, from: number, enc: number): [Uint8Array, number] {
  const wide = enc === 1 || enc === 2;
  const end = findTerm(body, from, wide);
  return [body.subarray(from, end), Math.min(body.length, end + (wide ? 2 : 1))];
}

function bodyTo23(id: string, body: Uint8Array): Uint8Array {
  const enc = body[0];
  if (enc !== 2 && enc !== 3) return body;
  if (id === "TXXX") {
    const [desc, at] = splitTerm(body, 1, enc);
    const ds = decodeText(enc, desc);
    const vs = stripTerm(decodeText(enc, body.subarray(at)));
    const wide = !isLatin1(ds + vs);
    const d = wide ? forceWide(ds) : encodeText(ds, 3);
    const v = wide ? forceWide(vs) : encodeText(vs, 3);
    return concat([[wide ? 1 : 0], d.bytes, d.term, v.bytes]);
  }
  if (id[0] === "T") {
    const t = encodeText(stripTerm(decodeText(enc, body.subarray(1))).split("\u0000").join("/"), 3);
    return concat([[t.enc], t.bytes]);
  }
  if (id === "WXXX") {
    const [desc, at] = splitTerm(body, 1, enc);
    const d = encodeText(decodeText(enc, desc), 3);
    return concat([[d.enc], d.bytes, d.term, body.subarray(at)]);
  }
  if (id === "COMM" || id === "USLT") {
    const lang = body.subarray(1, 4);
    const [desc, at] = splitTerm(body, 4, enc);
    const ds = decodeText(enc, desc);
    const ts = decodeText(enc, body.subarray(at));
    const wide = !isLatin1(ds + ts);
    const d = wide ? forceWide(ds) : encodeText(ds, 3);
    const t = wide ? forceWide(ts) : encodeText(ts, 3);
    return concat([[wide ? 1 : 0], lang, d.bytes, d.term, t.bytes]);
  }
  if (id === "APIC") {
    const mimeEnd = findTerm(body, 1, false);
    const [desc, at] = splitTerm(body, mimeEnd + 2, enc);
    const d = encodeText(decodeText(enc, desc), 3);
    return concat([[d.enc], body.subarray(1, mimeEnd + 2), d.bytes, d.term, body.subarray(at)]);
  }
  return body;
}

function forceWide(s: string) {
  const t = encodeText(s, 3);
  if (t.enc === 1) return t;
  const bytes = new Uint8Array(2 + s.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < s.length; i++) bytes[2 + i * 2] = s.charCodeAt(i);
  return { enc: 1, bytes, term: [0, 0] };
}

function frameTo23(f: RawFrame): Uint8Array | null {
  const format = f.flags & 0xff;
  if (format & 0x0c) return null;
  let body = f.body;
  if (format & 0x40) body = body.subarray(1);
  if (format & 0x01) body = body.subarray(4);
  if (format & 0x02) body = unsync(body);
  return frame(f.id, bodyTo23(f.id, body), 3);
}

export function parseTag(file: Uint8Array): ParsedTag {
  if (file.length < 10 || file[0] !== 0x49 || file[1] !== 0x44 || file[2] !== 0x33) return { version: 3, frames: [], dropped: 0, chapters: [], audioStart: 0 };
  const major = file[3];
  if (major === 2) throw new TagError("This MP3's tag is in the old ID3 2.2 form, which cannot carry chapters. Export the episode from FormWav again and tag the new file.");
  if (major !== 3 && major !== 4) throw new TagError(`This MP3's tag is ID3 2.${major}, which this extension does not know how to rewrite safely.`);
  const version = major as 3 | 4;
  const flags = file[5];
  const size = readSyncsafe(file, 6);
  const footer = version === 4 && flags & 0x10 ? 10 : 0;
  const audioStart = 10 + size + footer;
  if (audioStart > file.length) throw new TagError("This MP3's tag says it is longer than the file. The file may be damaged.");
  let body = file.subarray(10, 10 + size);
  if (version === 3 && flags & 0x80) body = unsync(body);
  if (flags & 0x40) {
    const ext = version === 4 ? readSyncsafe(body, 0) : readU32(body, 0) + 4;
    body = body.subarray(ext);
  }
  const frames = readFrames(body, version);
  const chapters: TagChapter[] = [];
  let toc: string[] | null = null;
  let tocTitle: string | undefined;
  for (const f of frames) {
    if (f.id === "CHAP") {
      const end = findTerm(f.body, 0, false);
      const id = String.fromCharCode(...f.body.subarray(0, end));
      const o = end + 1;
      const sub = readSub(readFrames(f.body.subarray(o + 16), version));
      chapters.push({ id, startMs: readU32(f.body, o), endMs: readU32(f.body, o + 4), title: sub.title ?? id, url: sub.url, picture: sub.picture, toc: true });
    } else if (f.id === "CTOC" && toc === null) {
      const end = findTerm(f.body, 0, false);
      let o = end + 1;
      const tocFlags = f.body[o];
      const count = f.body[o + 1];
      o += 2;
      const ids: string[] = [];
      for (let i = 0; i < count && o < f.body.length; i++) {
        const e = findTerm(f.body, o, false);
        ids.push(String.fromCharCode(...f.body.subarray(o, e)));
        o = e + 1;
      }
      if (tocFlags & 0x02 || toc === null) {
        toc = ids;
        tocTitle = readSub(readFrames(f.body.subarray(o), version)).title;
      }
    }
  }
  if (toc) for (const c of chapters) c.toc = toc.includes(c.id);
  chapters.sort((a, b) => a.startMs - b.startMs);
  const kept = frames.filter((f) => f.id !== "CHAP" && f.id !== "CTOC").map((f) => (version === 3 ? f.raw : frameTo23(f)));
  return {
    version,
    frames: kept.filter((f): f is Uint8Array => f !== null),
    dropped: kept.filter((f) => f === null).length,
    chapters,
    tocTitle,
    audioStart,
  };
}

export function writeTag(file: Uint8Array, chapters: TagChapter[], tocTitle?: string): { bytes: Uint8Array; from: ParsedTag } {
  const parsed = parseTag(file);
  if (chapters.length > 255) throw new TagError("ID3 can list at most 255 chapters in its table of contents.");
  const own = chapters.map((c) => chapterFrame(c, 3));
  const listed = chapters.filter((c) => c.toc).map((c) => c.id);
  const frames = concat([tocFrame(listed, tocTitle, 3), ...own, ...parsed.frames]);
  const header = concat([[0x49, 0x44, 0x33, 3, 0, 0], syncsafe(frames.length)]);
  return { bytes: concat([header, frames, file.subarray(parsed.audioStart)]), from: parsed };
}
