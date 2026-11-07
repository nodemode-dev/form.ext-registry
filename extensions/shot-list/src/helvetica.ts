const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const SPECIAL: Record<number, number> = {
  0x20ac: 128, 0x201a: 130, 0x0192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02c6: 136,
  0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147,
  0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02dc: 152, 0x2122: 153, 0x0161: 154, 0x203a: 155,
  0x0153: 156, 0x017e: 158, 0x0178: 159,
};

const SPECIAL_WIDTH: Record<number, number> = { 133: 1000, 145: 222, 146: 222, 147: 333, 148: 333, 149: 350, 150: 556, 151: 1000, 153: 1000 };

export function winAnsi(ch: string): number {
  const cp = ch.codePointAt(0) ?? 63;
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 160 && cp <= 255) return cp;
  return SPECIAL[cp] ?? 63;
}

export function glyphWidth(code: number, bold: boolean): number {
  if (code >= 32 && code <= 126) return (bold ? BOLD : REGULAR)[code - 32];
  return SPECIAL_WIDTH[code] ?? 556;
}

export function textWidth(text: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of text) w += glyphWidth(winAnsi(ch), bold);
  return (w * size) / 1000;
}

export function fit(text: string, size: number, bold: boolean, max: number): string {
  if (textWidth(text, size, bold) <= max) return text;
  const ell = '…';
  const chars = [...text];
  while (chars.length && textWidth(chars.join('') + ell, size, bold) > max) chars.pop();
  return chars.join('').trimEnd() + ell;
}

export function wrap(text: string, size: number, bold: boolean, max: number, lines: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= max) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = textWidth(word, size, bold) <= max ? word : fit(word, size, bold, max);
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = fit(`${kept[lines - 1]} …`, size, bold, max);
  return kept;
}
