import type { Prompt } from './model';

export const MAX_PROMPTS = 2000;
const ARROW = /\s+=>\s+/;

export function parseLines(text: string): Prompt[] {
  const out: Prompt[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^([-*+]|\d+[.)])\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(ARROW);
    const expect = parts.length > 1 ? parts.pop()!.trim() : '';
    const prompt = parts.join(' => ').trim();
    if (prompt) out.push({ text: prompt, expect });
  }
  return out;
}

export function toLines(prompts: Prompt[]): string {
  return prompts.map((p) => (p.expect ? `${p.text} => ${p.expect}` : p.text)).join('\n');
}

function fromValue(v: unknown): Prompt | null {
  if (typeof v === 'string') return v.trim() ? { text: v.trim(), expect: '' } : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const text = [o.prompt, o.text, o.query, o.input].find((x) => typeof x === 'string') as string | undefined;
    const expect = [o.expect, o.expected, o.skill, o.should_trigger].find((x) => typeof x === 'string') as string | undefined;
    if (text && text.trim()) return { text: text.trim().replace(/\s+/g, ' '), expect: (expect ?? '').trim() };
  }
  return null;
}

function csvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      cells.push(cur);
      cur = '';
    } else cur += c;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

export function parseFile(name: string, text: string): Prompt[] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${name} is not valid JSON`);
    }
    const list = Array.isArray(data) ? data : data && typeof data === 'object' ? ((data as Record<string, unknown>).prompts ?? (data as Record<string, unknown>).queries) : null;
    if (!Array.isArray(list)) throw new Error(`${name} has no list of prompts; use an array of strings or of { prompt, expect }`);
    return list.map(fromValue).filter((p): p is Prompt => !!p);
  }
  if (lower.endsWith('.jsonl')) {
    const out: Prompt[] = [];
    text.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      try {
        const p = fromValue(JSON.parse(line));
        if (p) out.push(p);
      } catch {
        return;
      }
    });
    return out;
  }
  if (lower.endsWith('.csv')) {
    const rows = text.split(/\r?\n/).filter((l) => l.trim()).map(csvRow);
    if (rows.length && /^(prompt|text|query)$/i.test(rows[0][0])) rows.shift();
    return rows.filter((r) => r[0]).map((r) => ({ text: r[0], expect: r[1] ?? '' }));
  }
  return parseLines(text);
}
