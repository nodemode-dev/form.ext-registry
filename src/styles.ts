import type { DateValue, Item, Name } from './model';

export type StyleId = 'apa' | 'chicago' | 'ieee';

export interface Label {
  n: number;
  suffix: string;
}

export interface Prepared {
  ordered: Item[];
  labels: Map<string, Label>;
}

export interface Style {
  id: StyleId;
  label: string;
  numeric: boolean;
  entry: (item: Item, label: Label) => string;
  cite: (item: Item, label: Label, locator?: string) => string;
  group: (parts: string[]) => string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

export function esc(text: string) {
  return text.replace(/([\\`*_[\]<>#|~$])/g, '\\$1').replace(/^(\d+)\.(\s)/, '$1\\.$2').replace(/^([-+])(\s)/, '\\$1$2');
}

const it = (text: string) => `*${esc(text)}*`;

function link(url: string) {
  return /^[^\s<>]+$/.test(url) ? `<${url}>` : esc(url);
}

function dot(s: string) {
  return /[.?!]["\u201D\u2019*]*$/.test(s.trim()) ? s : `${s}.`;
}

function joinList(xs: string[], and: string, serial: boolean) {
  if (xs.length <= 1) return xs.join('');
  if (xs.length === 2) return serial ? `${xs[0]}, ${and} ${xs[1]}` : `${xs[0]} ${and} ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, ${and} ${xs[xs.length - 1]}`;
}

function initials(given: string | undefined) {
  if (!given) return '';
  return given
    .replace(/\./g, '. ')
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.replace(/\.$/, '').split('-').map((p) => (p ? `${p.charAt(0).toUpperCase()}.` : '')).join('-'))
    .join(' ');
}

const family = (n: Name) => n.literal ?? [n.particle, n.family].filter(Boolean).join(' ');

function ordinal(edition: string) {
  const n = parseInt(edition, 10);
  if (!/^\d+$/.test(edition.trim()) || !Number.isFinite(n)) return `${edition.replace(/\s*ed(ition)?\.?$/i, '')} ed.`;
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s} ed.`;
}

function year(d: DateValue | undefined) {
  if (!d) return 'n.d.';
  return d.year ? String(d.year) : d.literal ?? 'n.d.';
}

function longDate(d: DateValue | undefined) {
  if (!d?.month) return '';
  return d.day ? `${MONTHS[d.month - 1]} ${d.day}` : MONTHS[d.month - 1] ?? '';
}

function shortTitle(item: Item) {
  const t = item.title ?? item.id;
  const words = t.split(/\s+/);
  return words.length > 4 ? `${words.slice(0, 4).join(' ')}\u2026` : t;
}

function link0(item: Item) {
  if (item.doi) return link(`https://doi.org/${item.doi}`);
  if (item.url) return link(item.url);
  return '';
}

function fold(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function sortName(item: Item) {
  const first = item.author?.[0] ?? item.editor?.[0];
  if (first) return fold(first.literal ?? `${first.family ?? ''} ${first.given ?? ''}`);
  return fold((item.title ?? item.id).replace(/^(the|a|an)\s+/i, ''));
}

function citeNames(item: Item, two: string, max: number) {
  const list = item.author?.length ? item.author : item.editor ?? [];
  if (!list.length) return '';
  const fam = list.map(family);
  if (list.length === 1) return item.etAl ? `${fam[0]} et al.` : fam[0];
  if (list.length === 2 && !item.etAl) return `${fam[0]} ${two} ${fam[1]}`;
  if (list.length <= max && !item.etAl) return joinList(fam, two === '&' ? '&' : 'and', true);
  return `${fam[0]} et al.`;
}

export function prepare(style: Style, cited: Item[]): Prepared {
  const labels = new Map<string, Label>();
  if (style.numeric) {
    cited.forEach((it, i) => labels.set(it.id, { n: i + 1, suffix: '' }));
    return { ordered: cited, labels };
  }
  const ordered = [...cited].sort((a, b) => {
    const k = sortName(a).localeCompare(sortName(b));
    if (k) return k;
    const y = year(a.issued).localeCompare(year(b.issued));
    if (y) return y;
    return fold(a.title ?? '').localeCompare(fold(b.title ?? ''));
  });
  const groups = new Map<string, Item[]>();
  for (const it of ordered) {
    const key = `${citeNames(it, 'and', 2)}|${year(it.issued)}`;
    const g = groups.get(key) ?? [];
    g.push(it);
    groups.set(key, g);
  }
  ordered.forEach((it, i) => labels.set(it.id, { n: i + 1, suffix: '' }));
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.forEach((it, i) => labels.set(it.id, { n: labels.get(it.id)!.n, suffix: String.fromCharCode(97 + (i % 26)) }));
  }
  return { ordered, labels };
}

function apaName(n: Name) {
  if (n.literal) return esc(n.literal);
  const ini = initials(n.given);
  return esc([family(n), ini, n.suffix].filter(Boolean).join(', '));
}

function apaEditor(n: Name) {
  if (n.literal) return esc(n.literal);
  return esc([initials(n.given), family(n)].filter(Boolean).join(' ') + (n.suffix ? `, ${n.suffix}` : ''));
}

function apaAuthors(list: Name[], etAl?: boolean) {
  const xs = list.map(apaName);
  if (xs.length > 20) return `${xs.slice(0, 19).join(', ')}, . . . ${xs[xs.length - 1]}`;
  if (etAl) return `${xs.join(', ')}, et al.`;
  return joinList(xs, '&', true);
}

const apa: Style = {
  id: 'apa',
  label: 'APA',
  numeric: false,
  entry(item, label) {
    const out: string[] = [];
    const standalone = !['article-journal', 'article-magazine', 'article-newspaper', 'chapter', 'paper-conference'].includes(item.type);
    const dated = ['article-magazine', 'article-newspaper', 'webpage'].includes(item.type) && item.issued?.month;
    const when = `${year(item.issued)}${label.suffix}${dated ? `, ${longDate(item.issued)}` : ''}`;
    let title = item.title ? (standalone ? it(item.title) : esc(item.title)) : '';
    const extra: string[] = [];
    if (item.edition && standalone) extra.push(ordinal(item.edition));
    if (item.type === 'report' && item.number) extra.push(`Report No. ${esc(item.number)}`);
    if (extra.length) title += ` (${extra.join(', ')})`;
    if (item.type === 'thesis') title += ` [${esc([item.genre ?? 'Thesis', item.publisher].filter(Boolean).join(', '))}]`;
    if (item.author?.length) {
      out.push(dot(apaAuthors(item.author, item.etAl)), `(${when}).`);
      if (title) out.push(dot(title));
    } else if (item.editor?.length && standalone) {
      out.push(`${apaAuthors(item.editor)} (${item.editor.length > 1 ? 'Eds.' : 'Ed.'}).`, `(${when}).`);
      if (title) out.push(dot(title));
    } else {
      out.push(dot(title || esc(item.id)), `(${when}).`);
    }
    const pages = item.page ? `${item.page.includes('\u2013') ? 'pp.' : 'p.'} ${esc(item.page)}` : '';
    if (item.type.startsWith('article-') && item.container) {
      let src = it(item.container);
      if (item.volume) src += `, ${it(item.volume)}${item.issue ? `(${esc(item.issue)})` : ''}`;
      else if (item.issue) src += `, (${esc(item.issue)})`;
      if (item.page) src += `, ${esc(item.page)}`;
      out.push(dot(src));
    } else if ((item.type === 'chapter' || item.type === 'paper-conference') && item.container) {
      const eds = item.editor?.length ? `${joinList(item.editor.map(apaEditor), '&', item.editor.length > 2)} (${item.editor.length > 1 ? 'Eds.' : 'Ed.'}), ` : '';
      out.push(dot(`In ${eds}${it(item.container)}${pages ? ` (${pages})` : ''}`));
      if (item.publisher) out.push(dot(esc(item.publisher)));
    } else if (item.type === 'webpage') {
      if (item.container) out.push(dot(esc(item.container)));
    } else if (item.type !== 'thesis' && item.publisher && !(item.author?.length === 1 && item.author[0].literal === item.publisher)) {
      out.push(dot(esc(item.publisher)));
    } else if (item.type === 'thesis' && !item.publisher && item.container) {
      out.push(dot(esc(item.container)));
    }
    const l = link0(item);
    if (l) out.push(l);
    return out.join(' ');
  },
  cite(item, label, locator) {
    const who = citeNames(item, '&', 2) || `\u201C${shortTitle(item)}\u201D`;
    return [who, `${year(item.issued)}${label.suffix}`, locator].filter(Boolean).join(', ');
  },
  group: (parts) => `(${parts.join('; ')})`,
};

function chiFirst(n: Name) {
  if (n.literal) return esc(n.literal);
  return esc([family(n), n.given, n.suffix].filter(Boolean).join(', '));
}

function chiOther(n: Name) {
  if (n.literal) return esc(n.literal);
  return esc([n.given, family(n)].filter(Boolean).join(' ') + (n.suffix ? `, ${n.suffix}` : ''));
}

function chiAuthors(list: Name[], etAl?: boolean) {
  const xs = list.map((n, i) => (i === 0 ? chiFirst(n) : chiOther(n)));
  if (xs.length > 10) return `${xs.slice(0, 7).join(', ')}, et al.`;
  if (etAl) return `${xs.join(', ')}, et al.`;
  return joinList(xs, 'and', true);
}

function quoted(title: string, close: string) {
  const t = esc(title);
  return /[?!]$/.test(t) ? `\u201C${t}\u201D` : `\u201C${t}${close}\u201D`;
}

function chiGenre(g: string | undefined) {
  if (!g) return 'PhD diss.';
  if (/doctor|ph\.?d/i.test(g)) return 'PhD diss.';
  return g;
}

const chicago: Style = {
  id: 'chicago',
  label: 'Chicago',
  numeric: false,
  entry(item, label) {
    const out: string[] = [];
    const part = ['article-journal', 'article-magazine', 'article-newspaper', 'chapter', 'paper-conference', 'thesis', 'webpage'].includes(item.type);
    const title = item.title ? (part ? quoted(item.title, '.') : dot(it(item.title))) : '';
    const when = `${year(item.issued)}${label.suffix}.`;
    if (item.author?.length) out.push(dot(chiAuthors(item.author, item.etAl)), when, title);
    else if (item.editor?.length && !part) out.push(`${chiAuthors(item.editor)}, ${item.editor.length > 1 ? 'eds.' : 'ed.'}`, when, title);
    else out.push(title || dot(esc(item.id)), when);
    if (item.type.startsWith('article-') && item.container) {
      let src = it(item.container);
      if (item.volume) src += ` ${esc(item.volume)}${item.issue ? ` (${esc(item.issue)})` : ''}`;
      else if (item.issue) src += `, no. ${esc(item.issue)}`;
      if (item.type !== 'article-journal' && item.issued?.month) src += `, ${longDate(item.issued)}`;
      if (item.page) src += `${item.volume ? ':' : ','} ${esc(item.page)}`;
      out.push(dot(src));
    } else if ((item.type === 'chapter' || item.type === 'paper-conference') && item.container) {
      let src = `In ${it(item.container)}`;
      if (item.editor?.length) src += `, edited by ${joinList(item.editor.map(chiOther), 'and', item.editor.length > 2)}`;
      if (item.page) src += `, ${esc(item.page)}`;
      out.push(dot(src));
    } else if (item.type === 'thesis') {
      out.push(dot(esc([chiGenre(item.genre), item.publisher].filter(Boolean).join(', '))));
    } else if (item.type === 'webpage' && item.container) {
      out.push(dot(esc(item.container)));
    }
    if (item.edition && !part) out.push(ordinal(item.edition));
    if (item.type === 'report' && item.number) out.push(dot(esc(`Report ${item.number}`)));
    if (item.type !== 'thesis' && item.type !== 'webpage' && !item.type.startsWith('article-') && item.publisher) {
      out.push(dot(esc(item.place ? `${item.place}: ${item.publisher}` : item.publisher)));
    }
    if (item.type === 'webpage' && item.accessed?.year) out.push(`Accessed ${longDate(item.accessed)}${item.accessed.month ? ', ' : ''}${item.accessed.year}.`);
    const l = link0(item);
    if (l) out.push(`${l}.`);
    return out.filter(Boolean).join(' ');
  },
  cite(item, label, locator) {
    const who = citeNames(item, 'and', 3) || `\u201C${shortTitle(item)}\u201D`;
    return `${who} ${year(item.issued)}${label.suffix}${locator ? `, ${locator.replace(/^pp?\.\s*/, '')}` : ''}`;
  },
  group: (parts) => `(${parts.join('; ')})`,
};

function ieeeName(n: Name) {
  if (n.literal) return esc(n.literal);
  return esc([initials(n.given), family(n)].filter(Boolean).join(' ') + (n.suffix ? `, ${n.suffix}` : ''));
}

function ieeeAuthors(list: Name[], etAl?: boolean) {
  if (list.length > 6 || (etAl && list.length)) return `${ieeeName(list[0])} et al.`;
  return joinList(list.map(ieeeName), 'and', list.length > 2);
}

function ieeeDate(d: DateValue | undefined) {
  if (!d) return 'n.d.';
  if (!d.year) return d.literal ?? 'n.d.';
  if (!d.month) return String(d.year);
  return `${MON[d.month - 1]}${d.day ? ` ${d.day},` : ''} ${d.year}`;
}

function ieeeGenre(g: string | undefined) {
  if (!g || /doctor|ph\.?d/i.test(g)) return 'Ph.D. dissertation';
  if (/master/i.test(g)) return 'M.S. thesis';
  return g;
}

const ieee: Style = {
  id: 'ieee',
  label: 'IEEE',
  numeric: true,
  entry(item, label) {
    const who = item.author?.length ? ieeeAuthors(item.author, item.etAl) : item.editor?.length ? `${ieeeAuthors(item.editor)}, ${item.editor.length > 1 ? 'Eds.' : 'Ed.'}` : '';
    const pages = item.page ? `${item.page.includes('\u2013') ? 'pp.' : 'p.'} ${esc(item.page)}` : '';
    const date = ieeeDate(item.issued);
    const doi = item.doi ? `doi: ${esc(item.doi)}` : '';
    const lead = who ? `${who}, ` : '';
    const q = item.title ? quoted(item.title, ',') : '';
    let body: string;
    switch (item.type) {
      case 'article-journal':
      case 'article-magazine':
      case 'article-newspaper': {
        const bits = [item.container && it(item.container), item.volume && `vol. ${esc(item.volume)}`, item.issue && `no. ${esc(item.issue)}`, pages, date, doi].filter(Boolean);
        body = `${lead}${q} ${bits.join(', ')}.`;
        break;
      }
      case 'chapter':
      case 'paper-conference': {
        const eds = item.editor?.length && item.author?.length ? `, ${joinList(item.editor.map(ieeeName), 'and', item.editor.length > 2)}, ${item.editor.length > 1 ? 'Eds' : 'Ed'}.` : '';
        if (item.type === 'chapter') {
          const pub = [item.place && item.publisher ? `${esc(item.place)}: ${esc(item.publisher)}` : esc(item.publisher ?? item.place ?? ''), date, pages].filter(Boolean).join(', ');
          body = `${lead}${q} in ${item.container ? it(item.container) : ''}${eds}${eds ? ' ' : ', '}${pub}.`;
        } else {
          const bits = [item.place && esc(item.place), date, pages, doi].filter(Boolean).join(', ');
          body = `${lead}${q} in ${item.container ? it(item.container) : ''}${eds ? `${eds.replace(/\.$/, ',')} ` : ', '}${bits}.`;
        }
        break;
      }
      case 'thesis':
        body = `${lead}${q} ${[ieeeGenre(item.genre), item.publisher && esc(item.publisher), item.place && esc(item.place), date].filter(Boolean).join(', ')}.`;
        break;
      case 'report':
        body = `${lead}${q} ${[item.publisher && esc(item.publisher), item.place && esc(item.place), item.number ? `Rep. ${esc(item.number)}` : 'Tech. Rep.', date].filter(Boolean).join(', ')}.`;
        break;
      case 'webpage': {
        const site = item.container ? ` ${dot(esc(item.container))}` : '';
        const acc = item.accessed?.year ? ` Accessed: ${ieeeDate(item.accessed)}.` : '';
        const url = item.url ? ` [Online]. Available: ${link(item.url)}` : '';
        return `\\[${label.n}\\] ${lead}${q.replace(/,\u201D$/, '.\u201D')}${site}${acc}${url}`.trim();
      }
      default: {
        const title = item.title ? it(item.title) : esc(item.id);
        const ed = item.edition ? `, ${ordinal(item.edition)}` : '';
        const pub = item.place && item.publisher ? `${esc(item.place)}: ${esc(item.publisher)}, ` : item.publisher ? `${esc(item.publisher)}, ` : '';
        body = `${lead}${title}${ed}. ${pub}${date}.`;
        if (doi) body = `${body.slice(0, -1)}, ${doi}.`;
      }
    }
    body = body.replace(/\s+,/g, ',').replace(/,\s*\./g, '.').replace(/\.\./g, '.');
    if (!item.doi && item.url) body +=` [Online]. Available: ${link(item.url)}`;
    return `\\[${label.n}\\] ${body}`;
  },
  cite(_item, label, locator) {
    return `[${label.n}${locator ? `, ${locator}` : ''}]`;
  },
  group: (parts) => parts.join(', '),
};

export const STYLES: Record<StyleId, Style> = { apa, chicago, ieee };
