import type { Item } from './model';
import { prepare, STYLES, esc, type StyleId } from './styles';

export interface Block {
  id: string;
  type: string;
  level?: number;
  text: string;
}

export interface Snapshot {
  page: { id: string; title: string } | null;
  writable: boolean;
  mode: string;
  blocks?: Block[];
  selection?: { block: string; from: number; to: number; empty: boolean; text: string } | null;
}

export interface Use {
  key: string;
  block: string;
  locator?: string;
}

export interface Group {
  block: string;
  uses: Use[];
}

const BRACKET = /\[([^[\]\n]*@[^[\]\n]*)\]/g;
const KEY = /^\s*(?:[^@]*\s)?-?@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*?)[.:]?(?:\s*,\s*(.*))?\s*$/u;

export function scan(blocks: Block[], skip: Set<string>): Group[] {
  const groups: Group[] = [];
  for (const b of blocks) {
    if (skip.has(b.id) || b.type === 'code_block' || b.type === 'math_block') continue;
    for (const m of b.text.matchAll(BRACKET)) {
      const uses: Use[] = [];
      for (const part of m[1].split(';')) {
        const k = KEY.exec(part);
        if (k) uses.push({ key: k[1], block: b.id, locator: k[2]?.trim() || undefined });
      }
      if (uses.length) groups.push({ block: b.id, uses });
    }
  }
  return groups;
}

export function firstUse(groups: Group[]) {
  const order: string[] = [];
  const where = new Map<string, string>();
  for (const g of groups)
    for (const u of g.uses)
      if (!where.has(u.key)) {
        where.set(u.key, u.block);
        order.push(u.key);
      }
  return { order, where };
}

export interface Built {
  markdown: string;
  cited: Item[];
  missing: string[];
  inText: Map<string, string>;
}

export function build(style: StyleId, heading: string, level: number, order: string[], lib: Map<string, Item>): Built {
  const s = STYLES[style];
  const cited: Item[] = [];
  const missing: string[] = [];
  for (const k of order) {
    const it = lib.get(k);
    if (it) cited.push(it);
    else missing.push(k);
  }
  const prep = prepare(s, cited);
  const inText = new Map<string, string>();
  for (const it of cited) inText.set(it.id, s.cite(it, prep.labels.get(it.id)!));
  const entries = prep.ordered.map((it) => s.entry(it, prep.labels.get(it.id)!));
  const markdown = `${'#'.repeat(Math.min(Math.max(level, 1), 3))} ${esc(heading.trim() || 'References')}\n\n${entries.join('\n\n')}\n`;
  return { markdown, cited, missing, inText };
}

export function groupText(style: StyleId, uses: Use[], lib: Map<string, Item>, order: string[]) {
  const s = STYLES[style];
  const cited = order.map((k) => lib.get(k)).filter((x): x is Item => !!x);
  const prep = prepare(s, cited);
  const parts = uses.map((u) => {
    const it = lib.get(u.key);
    const label = it && prep.labels.get(it.id);
    return it && label ? s.cite(it, label, u.locator) : `?${u.key}`;
  });
  return s.group(parts);
}

export function findSection(blocks: Block[], stored: string[], heading: string): string[] {
  const present = new Set(blocks.map((b) => b.id));
  const kept = stored.filter((id) => present.has(id));
  if (kept.length) return kept;
  const want = heading.trim().toLowerCase();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type !== 'heading' || b.text.trim().toLowerCase() !== want) continue;
    const ids = [b.id];
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j];
      if (n.type === 'heading' && (n.level ?? 1) <= (b.level ?? 1)) break;
      if (n.type !== 'paragraph' && n.type !== 'ordered_list' && n.type !== 'bullet_list') break;
      ids.push(n.id);
    }
    return ids;
  }
  return [];
}

export function citationText(keys: string[], locator: string) {
  const loc = locator.trim();
  return `[${keys.map((k, i) => `@${k}${i === keys.length - 1 && loc ? `, ${loc}` : ''}`).join('; ')}]`;
}
