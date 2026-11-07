import { cleanDoi, pageRange, yieldTo, type DateValue, type Item, type ItemType, type Job, type Library, type Name, type Progress } from './model';

const KNOWN = new Set<ItemType>([
  'article-journal', 'article-magazine', 'article-newspaper', 'book', 'chapter', 'paper-conference',
  'thesis', 'report', 'webpage', 'dataset', 'software', 'manuscript', 'document',
]);

const ALIASES: Record<string, ItemType> = {
  article: 'article-journal',
  'post-weblog': 'webpage',
  post: 'webpage',
  'entry-encyclopedia': 'chapter',
  'entry-dictionary': 'chapter',
  entry: 'chapter',
  pamphlet: 'book',
  standard: 'report',
  patent: 'document',
  speech: 'paper-conference',
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() || undefined : typeof v === 'number' ? String(v) : undefined);

function names(v: unknown): Name[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Name[] = [];
  for (const n of v) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    const particle = [str(o['dropping-particle']), str(o['non-dropping-particle'])].filter(Boolean).join(' ') || undefined;
    const name: Name = { family: str(o.family), given: str(o.given), particle, suffix: str(o.suffix), literal: str(o.literal) };
    for (const k of Object.keys(name) as (keyof Name)[]) if (name[k] === undefined) delete name[k];
    if (name.family || name.literal || name.given) out.push(name);
  }
  return out.length ? out : undefined;
}

function date(v: unknown): DateValue | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const parts = Array.isArray(o['date-parts']) ? (o['date-parts'] as unknown[])[0] : undefined;
  if (Array.isArray(parts) && parts.length) {
    const [y, m, d] = parts.map((p) => (typeof p === 'number' ? p : parseInt(String(p), 10)));
    if (Number.isFinite(y)) return { year: y, month: Number.isFinite(m) ? m : undefined, day: Number.isFinite(d) ? d : undefined };
  }
  const raw = str(o.raw) ?? str(o.literal);
  if (!raw) return undefined;
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(raw);
  return m ? { year: +m[1], month: m[2] ? +m[2] : undefined, day: m[3] ? +m[3] : undefined } : { literal: raw };
}

export async function parseCslJson(text: string, source: string, job: Job, progress: Progress): Promise<Library> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : null;
  if (!list) throw new Error(`${source} is not a CSL-JSON list of references.`);
  const items: Item[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let slice = performance.now();
  for (let n = 0; n < list.length; n++) {
    if (performance.now() - slice > 12) {
      progress(n, list.length);
      await yieldTo(job);
      slice = performance.now();
    }
    const raw = list[n];
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Item ${n + 1} is not an object and was skipped.`);
      continue;
    }
    const o = raw as Record<string, unknown>;
    const id = str(o['citation-key']) ?? str(o.id);
    if (!id) {
      warnings.push(`Item ${n + 1} has no id and was skipped.`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`The id ${id} is used twice; the first item was kept.`);
      continue;
    }
    seen.add(id);
    const t = str(o.type) ?? 'document';
    const type: ItemType = KNOWN.has(t as ItemType) ? (t as ItemType) : ALIASES[t] ?? 'document';
    const item: Item = {
      id,
      type,
      title: str(o.title),
      author: names(o.author),
      editor: names(o.editor),
      issued: date(o.issued),
      accessed: date(o.accessed),
      container: str(o['container-title']),
      collection: str(o['collection-title']),
      volume: str(o.volume),
      issue: str(o.issue),
      number: str(o.number),
      page: pageRange(str(o.page)),
      publisher: str(o.publisher),
      place: str(o['publisher-place']) ?? str(o['event-place']),
      edition: str(o.edition),
      genre: str(o.genre),
      doi: cleanDoi(str(o.DOI) ?? str(o.doi)),
      url: str(o.URL) ?? str(o.url),
    };
    for (const k of Object.keys(item) as (keyof Item)[]) if (item[k] === undefined) delete item[k];
    items.push(item);
  }
  progress(list.length, list.length);
  return { source, format: 'csl-json', items, warnings };
}
