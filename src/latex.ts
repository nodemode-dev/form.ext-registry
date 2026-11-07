const ACCENTS: Record<string, string> = {
  "'": '́',
  '`': '̀',
  '^': '̂',
  '"': '̈',
  '~': '̃',
  '=': '̄',
  '.': '̇',
  u: '̆',
  v: '̌',
  H: '̋',
  c: '̧',
  k: '̨',
  r: '̊',
  d: '̣',
  b: '̱',
};

const SYMBOLS: Record<string, string> = {
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  j: 'ȷ',
  dh: 'ð',
  DH: 'Ð',
  th: 'þ',
  TH: 'Þ',
  textendash: '–',
  textemdash: '—',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  textellipsis: '…',
  ldots: '…',
  dots: '…',
  copyright: '©',
  textregistered: '®',
  texttrademark: '™',
  S: '§',
  P: '¶',
  pounds: '£',
  euro: '€',
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  space: ' ',
};

const ESCAPES = new Set(['&', '%', '$', '#', '_', '{', '}', '\\', ' ']);

function readArg(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++;
  if (s[i] === '{') {
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    return [s.slice(i + 1, j), j + 1];
  }
  if (s[i] === '\\') {
    const m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
    if (m) return [m[0], i + m[0].length];
  }
  return [s[i] ?? '', i + 1];
}

function accent(arg: string, mark: string) {
  const base = latexToText(arg).replace(/^ı/, 'i').replace(/^ȷ/, 'j');
  return (base.slice(0, 1) + mark + base.slice(1)).normalize('NFC');
}

export function latexToText(input: string): string {
  const s = input;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const next = s[i + 1] ?? '';
      if (next in ACCENTS && !/[a-zA-Z]/.test(next)) {
        const [arg, end] = readArg(s, i + 2);
        out += accent(arg, ACCENTS[next]);
        i = end;
        continue;
      }
      if (ESCAPES.has(next)) {
        out += next === '\\' ? ' ' : next;
        i += 2;
        continue;
      }
      const m = /^\\([a-zA-Z]+)\s?/.exec(s.slice(i));
      if (m) {
        const name = m[1];
        i += m[0].length;
        if (name in SYMBOLS) {
          if (s[i] === '{' && s[i + 1] === '}') i += 2;
          out += SYMBOLS[name];
          continue;
        }
        if (name.length === 1 && name in ACCENTS) {
          const [arg, end] = readArg(s, i);
          out += accent(arg, ACCENTS[name]);
          i = end;
          continue;
        }
        if (s[i] === '{') {
          const [arg, end] = readArg(s, i);
          out += latexToText(arg);
          i = end;
        }
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{' || ch === '}') {
      i++;
      continue;
    }
    if (ch === '~') {
      out += ' ';
      i++;
      continue;
    }
    if (ch === '-' && s.startsWith('---', i)) {
      out += '—';
      i += 3;
      continue;
    }
    if (ch === '-' && s.startsWith('--', i)) {
      out += '–';
      i += 2;
      continue;
    }
    if (ch === '`' && s[i + 1] === '`') {
      out += '“';
      i += 2;
      continue;
    }
    if (ch === "'" && s[i + 1] === "'") {
      out += '”';
      i += 2;
      continue;
    }
    if (ch === '$') {
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
}
