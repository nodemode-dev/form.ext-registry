import { latexToText } from './latex';
import { cleanDoi, pageRange, yieldTo, type DateValue, type Item, type ItemType, type Job, type Library, type Name, type Progress } from './model';

const MONTHS: Record<string, string> = {
  jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6',
  jul: '7', aug: '8', sep: '9', oct: '10', nov: '11', dec: '12',
};

const TYPES: Record<string, ItemType> = {
  article: 'article-journal',
  book: 'book',
  mvbook: 'book',
  booklet: 'book',
  inbook: 'chapter',
  incollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  proceedings: 'book',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  manual: 'report',
  online: 'webpage',
  electronic: 'webpage',
  www: 'webpage',
  dataset: 'dataset',
  software: 'software',
  unpublished: 'manuscript',
  misc: 'document',
};

class Reader {
  i = 0;
  constructor(public s: string) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  ident() {
    this.ws();
    const m = /^[^\s"#%'(),={}]+/.exec(this.s.slice(this.i, this.i + 200));
    if (!m) return '';
    this.i += m[0].length;
    return m[0];
  }
  braced(): string {
    const start = this.i + 1;
    let depth = 0;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') {
        this.i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          this.i++;
          return this.s.slice(start, this.i - 1);
        }
      }
    }
    throw new Error('a brace is not closed');
  }
  quoted(): string {
    const start = ++this.i;
    let depth = 0;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') {
        this.i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '"' && depth === 0) {
        this.i++;
        return this.s.slice(start, this.i - 1);
      }
    }
    throw new Error('a quote is not closed');
  }
  value(macros: Map<string, string>): string {
    let out = '';
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === '{') out += this.braced();
      else if (c === '"') out += this.quoted();
      else {
        const word = this.ident();
        if (!word) throw new Error('a field has no value');
        const lower = word.toLowerCase();
        out += macros.get(lower) ?? MONTHS[lower] ?? word;
      }
      this.ws();
      if (this.s[this.i] === '#') {
        this.i++;
        continue;
      }
      return out;
    }
  }
}

function splitTop(s: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0) {
      sep.lastIndex = i;
      const m = sep.exec(s);
      if (m && m.index === i) {
        parts.push(s.slice(last, i));
        i += m[0].length - 1;
        last = i + 1;
      }
    }
  }
  parts.push(s.slice(last));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

function startsLower(word: string) {
  if (word.startsWith('{')) return false;
  const ch = latexToText(word).charAt(0);
  return ch !== '' && ch === ch.toLowerCase() && ch !== ch.toUpperCase();
}

function parseName(raw: string): Name {
  const t = raw.trim();
  if (/^\{.*\}$/.test(t) && splitTop(t, /,/y).length === 1 && !/\}\s+\{/.test(t)) return { literal: latexToText(t) };
  const commas = splitTop(t, /,/y);
  const conv = (s: string) => latexToText(s) || undefined;
  const vonLast = (s: string): { particle?: string; family?: string } => {
    const words = splitTop(s, /\s+/y);
    let k = 0;
    while (k < words.length - 1 && startsLower(words[k])) k++;
    return { particle: conv(words.slice(0, k).join(' ')), family: conv(words.slice(k).join(' ')) };
  };
  if (commas.length >= 3) return { ...vonLast(commas[0]), suffix: conv(commas[1]), given: conv(commas.slice(2).join(' ')) };
  if (commas.length === 2) return { ...vonLast(commas[0]), given: conv(commas[1]) };
  const words = splitTop(t, /\s+/y);
  if (words.length === 1) return { family: conv(words[0]) };
  let v = words.findIndex((w, idx) => idx > 0 && idx < words.length - 1 && startsLower(w));
  if (v < 0) return { given: conv(words.slice(0, -1).join(' ')), family: conv(words[words.length - 1]) };
  let e = v;
  while (e < words.length - 1 && startsLower(words[e])) e++;
  return { given: conv(words.slice(0, v).join(' ')), particle: conv(words.slice(v, e).join(' ')), family: conv(words.slice(e).join(' ')) };
}

export function parseNames(raw: string): { names: Name[]; etAl: boolean } {
  const parts = splitTop(raw.replace(/\s+/g, ' '), /\sand\s/iy);
  let etAl = false;
  const names: Name[] = [];
  for (const p of parts) {
    if (p.toLowerCase() === 'others') etAl = true;
    else names.push(parseName(p));
  }
  return { names, etAl };
}

function parseDate(f: Record<string, string>): DateValue | undefined {
  const date = f.date ?? '';
  const m = /^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/.exec(date.trim());
  if (m) return { year: +m[1], month: m[2] ? +m[2] : undefined, day: m[3] ? +m[3] : undefined };
  const y = /(\d{4})/.exec(f.year ?? '');
  if (!y) return f.year ? { literal: latexToText(f.year) } : undefined;
  const mon = (f.month ?? '').trim().toLowerCase();
  const month = /^\d+$/.test(mon) ? +mon : MONTHS[mon.slice(0, 3)] ? +MONTHS[mon.slice(0, 3)] : undefined;
  const day = /^\d+$/.test((f.day ?? '').trim()) ? +f.day.trim() : undefined;
  return { year: +y[1], month, day };
}

function toItem(type: string, key: string, raw: Record<string, string>): Item {
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) f[k] = v;
  const t = (s: string | undefined) => (s === undefined ? undefined : latexToText(s) || undefined);
  const kind = TYPES[type] ?? 'document';
  const item: Item = { id: key, type: kind };
  item.title = t(f.title);
  if (f.author) {
    const a = parseNames(f.author);
    item.author = a.names;
    item.etAl = a.etAl;
  }
  if (f.editor) item.editor = parseNames(f.editor).names;
  item.issued = parseDate(f);
  if (f.urldate) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(f.urldate.trim());
    if (m) item.accessed = { year: +m[1], month: +m[2], day: +m[3] };
  }
  const journal = f.journaltitle ?? f.journal;
  item.container = t(kind === 'article-journal' ? journal : f.booktitle ?? journal);
  item.collection = t(f.series);
  item.volume = t(f.volume);
  if (kind === 'report') item.number = t(f.number);
  else item.issue = t(f.number ?? f.issue);
  item.page = pageRange(t(f.pages));
  item.publisher = t(f.publisher ?? f.school ?? f.institution ?? f.organization);
  if (kind === 'webpage' && !item.container) item.container = item.publisher;
  item.place = t(f.location ?? f.address);
  item.edition = t(f.edition);
  item.doi = cleanDoi(f.doi);
  item.url = f.url?.trim() || (/^\\url\{(.*)\}$/.exec((f.howpublished ?? '').trim())?.[1] ?? undefined);
  if (type === 'phdthesis') item.genre = 'Doctoral dissertation';
  else if (type === 'mastersthesis') item.genre = "Master's thesis";
  else item.genre = t(f.type);
  for (const k of Object.keys(item) as (keyof Item)[]) if (item[k] === undefined) delete item[k];
  return item;
}

export async function parseBibtex(text: string, source: string, job: Job, progress: Progress): Promise<Library> {
  const r = new Reader(text);
  const macros = new Map<string, string>();
  const items: Item[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let slice = performance.now();
  let line = 1;
  let counted = 0;
  for (;;) {
    const at = text.indexOf('@', r.i);
    if (at < 0) break;
    r.i = at + 1;
    for (; counted < at; counted++) if (text.charCodeAt(counted) === 10) line++;
    if (performance.now() - slice > 12) {
      progress(at, text.length);
      await yieldTo(job);
      slice = performance.now();
    }
    const type = r.ident().toLowerCase();
    r.ws();
    const open = text[r.i];
    if (!type || (open !== '{' && open !== '(')) continue;
    try {
      if (type === 'comment' || type === 'preamble') {
        if (open === '{') r.braced();
        else r.i = text.indexOf(')', r.i) + 1 || text.length;
        continue;
      }
      r.i++;
      if (type === 'string') {
        const name = r.ident().toLowerCase();
        r.ws();
        if (text[r.i] !== '=') throw new Error('@string has no =');
        r.i++;
        macros.set(name, r.value(macros));
        r.ws();
        r.i++;
        continue;
      }
      r.ws();
      const keyEnd = text.slice(r.i).search(/[,\s}]/);
      const key = text.slice(r.i, r.i + (keyEnd < 0 ? 0 : keyEnd)).trim();
      r.i += keyEnd < 0 ? 0 : keyEnd;
      const fields: Record<string, string> = {};
      const close = open === '{' ? '}' : ')';
      for (;;) {
        r.ws();
        if (text[r.i] === ',') {
          r.i++;
          r.ws();
        }
        if (text[r.i] === close) {
          r.i++;
          break;
        }
        if (r.i >= text.length) throw new Error('the entry is not closed');
        const name = r.ident().toLowerCase();
        r.ws();
        if (!name || text[r.i] !== '=') throw new Error(`a field near "${text.slice(r.i, r.i + 20).trim()}" has no =`);
        r.i++;
        fields[name] = r.value(macros);
      }
      if (!key) {
        warnings.push(`Line ${line}: an @${type} entry has no key and was skipped.`);
        continue;
      }
      if (seen.has(key)) {
        warnings.push(`Line ${line}: the key ${key} is used twice; the first entry was kept.`);
        continue;
      }
      seen.add(key);
      items.push(toItem(type, key, fields));
    } catch (err) {
      warnings.push(`Line ${line}: ${(err as Error).message}; that entry was skipped.`);
      const nextAt = text.indexOf('\n@', at + 1);
      r.i = nextAt < 0 ? text.length : nextAt + 1;
    }
  }
  progress(text.length, text.length);
  return { source, format: 'bibtex', items, warnings };
}
