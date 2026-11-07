interface Span {
  start: number;
  end: number;
  value: string;
}

function lines(text: string): { list: string[]; close: number } | null {
  const list = text.split('\n');
  if (list[0].replace(/\r$/, '') !== '---') return null;
  const close = list.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---');
  return close > 0 ? { list, close } : null;
}

function unquote(v: string): string {
  if (v.startsWith('"')) {
    const body = v.slice(1, v.endsWith('"') ? -1 : undefined);
    return body.replace(/\\(["\\nt])/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  }
  if (v.startsWith("'")) return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  return v;
}

function span(list: string[], close: number): Span | null {
  const at = list.findIndex((l, i) => i > 0 && i < close && /^description\s*:/.test(l));
  if (at < 0) return null;
  const first = list[at].replace(/\r$/, '').replace(/^description\s*:\s*/, '');
  let end = at + 1;
  if (/^[|>][+-]?\d*\s*$/.test(first)) {
    while (end < close && (/^\s+\S/.test(list[end]) || !list[end].trim())) end++;
    const body = list.slice(at + 1, end).map((l) => l.replace(/\r$/, '').trim());
    const value = first.startsWith('|') ? body.join('\n').trim() : body.join(' ').replace(/\s+/g, ' ').trim();
    return { start: at, end, value };
  }
  const quote = first[0] === '"' || first[0] === "'" ? first[0] : '';
  if (quote && !(first.length > 1 && first.endsWith(quote) && !first.endsWith(`\\${quote}`))) {
    while (end < close && !list[end].replace(/\r$/, '').trimEnd().endsWith(quote)) end++;
    end = Math.min(end + 1, close);
  } else {
    while (end < close && /^\s+\S/.test(list[end]) && !/^\s+[a-z_]+\s*:/.test(list[end])) end++;
  }
  const joined = [first, ...list.slice(at + 1, end).map((l) => l.replace(/\r$/, '').trim())].join(' ').trim();
  return { start: at, end, value: unquote(joined).replace(/\s+/g, ' ').trim() };
}

export function readDescription(text: string): string | null {
  const fm = lines(text);
  if (!fm) return null;
  return span(fm.list, fm.close)?.value ?? '';
}

export function scalar(value: string): string {
  const v = value.replace(/\s+/g, ' ').trim();
  const plain = v && !/^[-?:,[\]{}#&*!|>'"%@`\s]/.test(v) && !/: |\s#|:$/.test(v);
  return plain ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function writeDescription(text: string, value: string): string {
  const fm = lines(text);
  if (!fm) throw new Error('SKILL.md has no front matter to hold a description');
  const { list, close } = fm;
  const cr = list[0].endsWith('\r') ? '\r' : '';
  const line = `description: ${scalar(value)}${cr}`;
  const s = span(list, close);
  if (s) list.splice(s.start, s.end - s.start, line);
  else {
    const name = list.findIndex((l, i) => i > 0 && i < close && /^name\s*:/.test(l));
    list.splice(name > 0 ? name + 1 : 1, 0, line);
  }
  return list.join('\n');
}
