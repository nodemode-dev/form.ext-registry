export interface Name {
  family?: string;
  given?: string;
  particle?: string;
  suffix?: string;
  literal?: string;
}

export interface DateValue {
  year?: number;
  month?: number;
  day?: number;
  literal?: string;
}

export type ItemType =
  | 'article-journal'
  | 'article-magazine'
  | 'article-newspaper'
  | 'book'
  | 'chapter'
  | 'paper-conference'
  | 'thesis'
  | 'report'
  | 'webpage'
  | 'dataset'
  | 'software'
  | 'manuscript'
  | 'document';

export interface Item {
  id: string;
  type: ItemType;
  title?: string;
  author?: Name[];
  editor?: Name[];
  etAl?: boolean;
  issued?: DateValue;
  accessed?: DateValue;
  container?: string;
  collection?: string;
  volume?: string;
  issue?: string;
  number?: string;
  page?: string;
  publisher?: string;
  place?: string;
  edition?: string;
  genre?: string;
  doi?: string;
  url?: string;
}

export interface Library {
  source: string;
  format: 'bibtex' | 'csl-json';
  items: Item[];
  warnings: string[];
}

export interface Progress {
  (done: number, total: number): void;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export interface Job {
  cancelled: boolean;
}

export async function yieldTo(job: Job) {
  await new Promise((r) => setTimeout(r, 0));
  if (job.cancelled) throw new Cancelled();
}

export function cleanDoi(doi: string | undefined) {
  if (!doi) return undefined;
  const d = doi.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, '');
  return d || undefined;
}

export function pageRange(p: string | undefined) {
  if (!p) return undefined;
  return p.trim().replace(/\s*-{1,3}\s*|\s*–\s*/g, '–');
}
