import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, prepare } from '../../../extensions/citations/src/styles.ts';
import { cleanDoi, pageRange } from '../../../extensions/citations/src/model.ts';
import type { Item, Name } from '../../../extensions/citations/src/model.ts';
import { scan, firstUse, build, groupText, citationText, findSection } from '../../../extensions/citations/src/page.ts';
import type { Block } from '../../../extensions/citations/src/page.ts';

const okafor: Name = { family: 'Okafor', given: 'Ngozi' };
const muller: Name = { family: 'Müller', given: 'Anna' };
const berg: Name = { family: 'Berg', particle: 'van der', given: 'Pieter' };
const chen: Name = { family: 'Chen', given: 'Li' };

function article(authors: Name[] | undefined, extra: Partial<Item> = {}): Item {
  return {
    id: 'okafor2019tides',
    type: 'article-journal',
    title: 'Tides of the estuary',
    author: authors,
    issued: { year: 2019 },
    container: 'Journal of Coastal Research',
    volume: '12',
    issue: '3',
    page: '45–67',
    doi: '10.1000/jcr.2019.12',
    ...extra,
  };
}

const book: Item = {
  id: 'lindqvist2021',
  type: 'book',
  title: 'Deep Water',
  author: [{ family: 'Lindqvist', given: 'Sara' }],
  issued: { year: 2021 },
  edition: '2',
  publisher: 'Nordic Press',
  place: 'Stockholm',
};

const chapter: Item = {
  id: 'ito2020chapter',
  type: 'chapter',
  title: 'Salt marshes',
  author: [{ family: 'Ito', given: 'Kenji' }],
  editor: [
    { family: 'Rossi', given: 'Maria' },
    { family: 'Hale', given: 'Tom' },
  ],
  issued: { year: 2020 },
  container: 'Coastal Systems',
  page: '101–120',
  publisher: 'Harbor Press',
  place: 'Boston',
};

const one = { n: 1, suffix: '' };
const DOI = '<https://doi.org/10.1000/jcr.2019.12>';

function many(count: number): Name[] {
  return Array.from({ length: count }, (_, i) => ({ family: `Fam${i + 1}`, given: 'Ann' }));
}

function libOf(...items: Item[]) {
  return new Map(items.map((i) => [i.id, i]));
}

function para(id: string, text: string): Block {
  return { id, type: 'paragraph', text };
}

test('apa journal article with one author', () => {
  assert.equal(
    STYLES.apa.entry(article([okafor]), one),
    `Okafor, N. (2019). Tides of the estuary. *Journal of Coastal Research*, *12*(3), 45–67. ${DOI}`,
  );
});

test('apa lists two and three authors with an ampersand before the last', () => {
  const two = STYLES.apa.entry(article([okafor, muller]), one);
  const three = STYLES.apa.entry(article([okafor, muller, berg]), one);
  assert.ok(two.startsWith('Okafor, N., & Müller, A. (2019). '), two);
  assert.ok(three.startsWith('Okafor, N., Müller, A., & van der Berg, P. (2019). '), three);
});

test('apa shortens twenty one authors to nineteen an ellipsis and the last', () => {
  const out = STYLES.apa.entry(article(many(21)), one);
  const first19 = Array.from({ length: 19 }, (_, i) => `Fam${i + 1}, A.`).join(', ');
  assert.ok(out.startsWith(`${first19}, . . . Fam21, A. (2019). `), out);
  assert.equal(out.includes('Fam20'), false);
});

test('apa book with edition and publisher', () => {
  assert.equal(STYLES.apa.entry(book, one), 'Lindqvist, S. (2021). *Deep Water* (2nd ed.). Nordic Press.');
});

test('apa chapter with editors and page range', () => {
  assert.equal(
    STYLES.apa.entry(chapter, one),
    'Ito, K. (2020). Salt marshes. In M. Rossi & T. Hale (Eds.), *Coastal Systems* (pp. 101–120). Harbor Press.',
  );
});

test('apa chapter on a single page uses p and one editor uses Ed', () => {
  const out = STYLES.apa.entry({ ...chapter, page: '7', editor: [{ family: 'Rossi', given: 'Maria' }] }, one);
  assert.equal(out, 'Ito, K. (2020). Salt marshes. In M. Rossi (Ed.), *Coastal Systems* (p. 7). Harbor Press.');
});

test('apa uses n.d. when the year is missing', () => {
  const out = STYLES.apa.entry(article([okafor], { issued: undefined }), one);
  assert.ok(out.startsWith('Okafor, N. (n.d.). Tides of the estuary. '), out);
});

test('apa moves the title to the front when there is no author', () => {
  const out = STYLES.apa.entry(article(undefined), one);
  assert.ok(out.startsWith('Tides of the estuary. (2019). *Journal of Coastal Research*, *12*(3), 45–67.'), out);
});

test('apa does not add a full stop after a title ending in punctuation', () => {
  const q = STYLES.apa.entry(article([okafor], { title: 'Why do tides turn?' }), one);
  const b = STYLES.apa.entry({ ...book, title: 'Run!', edition: undefined }, one);
  assert.ok(q.includes('(2019). Why do tides turn? *Journal of Coastal Research*'), q);
  assert.equal(b, 'Lindqvist, S. (2021). *Run!* Nordic Press.');
});

test('apa ends with the url when there is no doi', () => {
  const out = STYLES.apa.entry(article([okafor], { doi: undefined, url: 'https://example.org/tides' }), one);
  assert.ok(out.endsWith('45–67. <https://example.org/tides>'), out);
});

test('chicago journal article with one author', () => {
  assert.equal(
    STYLES.chicago.entry(article([okafor]), one),
    `Okafor, Ngozi. 2019. “Tides of the estuary.” *Journal of Coastal Research* 12 (3): 45–67. ${DOI}.`,
  );
});

test('chicago inverts only the first author for two and three authors', () => {
  const two = STYLES.chicago.entry(article([okafor, muller]), one);
  const three = STYLES.chicago.entry(article([okafor, muller, berg]), one);
  assert.ok(two.startsWith('Okafor, Ngozi, and Anna Müller. 2019. '), two);
  assert.ok(three.startsWith('Okafor, Ngozi, Anna Müller, and Pieter van der Berg. 2019. '), three);
});

test('chicago shortens eleven authors to seven and et al', () => {
  const out = STYLES.chicago.entry(article(many(11)), one);
  const rest = Array.from({ length: 6 }, (_, i) => `Ann Fam${i + 2}`).join(', ');
  assert.ok(out.startsWith(`Fam1, Ann, ${rest}, et al. 2019. `), out);
  assert.equal(out.includes('Fam8'), false);
});

test('chicago keeps all ten authors', () => {
  const out = STYLES.chicago.entry(article(many(10)), one);
  assert.ok(out.includes('Ann Fam9, and Ann Fam10. 2019. '), out);
});

test('chicago book with edition place and publisher', () => {
  assert.equal(STYLES.chicago.entry(book, one), 'Lindqvist, Sara. 2021. *Deep Water*. 2nd ed. Stockholm: Nordic Press.');
});

test('chicago chapter with editors and page range', () => {
  assert.equal(
    STYLES.chicago.entry(chapter, one),
    'Ito, Kenji. 2020. “Salt marshes.” In *Coastal Systems*, edited by Maria Rossi and Tom Hale, 101–120. Boston: Harbor Press.',
  );
});

test('chicago writes n.d. with a single full stop when the year is missing', { todo: 'defect: chicago entry without a year prints "n.d.." because a full stop is appended after n.d.' }, () => {
  const noYear = STYLES.chicago.entry(article([okafor], { issued: undefined }), one);
  assert.ok(noYear.startsWith('Okafor, Ngozi. n.d. “Tides of the estuary.”'), noYear);
});

test('chicago handles a missing author and a title ending in a question mark', () => {
  const noAuthor = STYLES.chicago.entry(article(undefined), one);
  const q = STYLES.chicago.entry(article([okafor], { title: 'Why do tides turn?' }), one);
  assert.ok(noAuthor.startsWith('“Tides of the estuary.” 2019. *Journal of Coastal Research* 12 (3)'), noAuthor);
  assert.ok(q.includes('2019. “Why do tides turn?” *Journal of Coastal Research*'), q);
});

test('chicago ends with the url and a full stop when there is no doi', () => {
  const out = STYLES.chicago.entry(article([okafor], { doi: undefined, url: 'https://example.org/tides' }), one);
  assert.ok(out.endsWith(': 45–67. <https://example.org/tides>.'), out);
});

test('ieee journal article with one author', () => {
  assert.equal(
    STYLES.ieee.entry(article([okafor]), one),
    '\\[1\\] N. Okafor, “Tides of the estuary,” *Journal of Coastal Research*, vol. 12, no. 3, pp. 45–67, 2019, doi: 10.1000/jcr.2019.12.',
  );
});

test('ieee puts initials first for two and three authors', () => {
  const two = STYLES.ieee.entry(article([okafor, muller]), one);
  const three = STYLES.ieee.entry(article([okafor, muller, berg]), { n: 4, suffix: '' });
  assert.ok(two.startsWith('\\[1\\] N. Okafor and A. Müller, “Tides'), two);
  assert.ok(three.startsWith('\\[4\\] N. Okafor, A. Müller, and P. van der Berg, “Tides'), three);
});

test('ieee lists six authors and shortens seven to the first and et al', () => {
  const six = STYLES.ieee.entry(article(many(6)), one);
  const seven = STYLES.ieee.entry(article(many(7)), one);
  assert.ok(six.startsWith('\\[1\\] A. Fam1, A. Fam2, A. Fam3, A. Fam4, A. Fam5, and A. Fam6, “Tides'), six);
  assert.ok(seven.startsWith('\\[1\\] A. Fam1 et al., “Tides'), seven);
});

test('ieee book with edition place and publisher', () => {
  assert.equal(STYLES.ieee.entry(book, one), '\\[1\\] S. Lindqvist, *Deep Water*, 2nd ed. Stockholm: Nordic Press, 2021.');
});

test('ieee chapter with editors and page range', () => {
  assert.equal(
    STYLES.ieee.entry(chapter, one),
    '\\[1\\] K. Ito, “Salt marshes,” in *Coastal Systems*, M. Rossi and T. Hale, Eds. Boston: Harbor Press, 2020, pp. 101–120.',
  );
});

test('ieee handles a missing year a missing author a single page and a title ending in a question mark', () => {
  const noYear = STYLES.ieee.entry(article([okafor], { issued: undefined, doi: undefined }), one);
  const noAuthor = STYLES.ieee.entry(article(undefined, { page: '45' }), one);
  const q = STYLES.ieee.entry(article([okafor], { title: 'Why do tides turn?' }), one);
  assert.ok(noYear.endsWith('vol. 12, no. 3, pp. 45–67, n.d.'), noYear);
  assert.ok(noAuthor.startsWith('\\[1\\] “Tides of the estuary,” *Journal of Coastal Research*, vol. 12, no. 3, p. 45, 2019'), noAuthor);
  assert.ok(q.startsWith('\\[1\\] N. Okafor, “Why do tides turn?” *Journal of Coastal Research*, vol. 12'), q);
});

test('ieee marks a url as online when there is no doi', () => {
  const out = STYLES.ieee.entry(article([okafor], { doi: undefined, url: 'https://example.org/tides' }), one);
  assert.ok(out.endsWith('pp. 45–67, 2019. [Online]. Available: <https://example.org/tides>'), out);
});

test('apa in text citations follow the one two and three author rules', () => {
  const cite = (authors: Name[]) => {
    const item = article(authors);
    return groupText('apa', [{ key: item.id, block: 'b1' }], libOf(item), [item.id]);
  };
  assert.equal(cite([okafor]), '(Okafor, 2019)');
  assert.equal(cite([okafor, muller]), '(Okafor & Müller, 2019)');
  assert.equal(cite([okafor, muller, berg]), '(Okafor et al., 2019)');
});

test('chicago in text citations name up to three authors and use et al for four', () => {
  const cite = (authors: Name[]) => {
    const item = article(authors);
    return groupText('chicago', [{ key: item.id, block: 'b1' }], libOf(item), [item.id]);
  };
  assert.equal(cite([okafor]), '(Okafor 2019)');
  assert.equal(cite([okafor, muller]), '(Okafor and Müller 2019)');
  assert.equal(cite([okafor, muller, berg]), '(Okafor, Müller, and van der Berg 2019)');
  assert.equal(cite([okafor, muller, berg, chen]), '(Okafor et al. 2019)');
});

test('in text citations carry a locator and join several sources', () => {
  const a = article([okafor]);
  const lib = libOf(a, book);
  const order = [a.id, book.id];
  const uses = [
    { key: a.id, block: 'b1' },
    { key: book.id, block: 'b1', locator: 'p. 12' },
  ];
  assert.equal(groupText('apa', uses, lib, order), '(Okafor, 2019; Lindqvist, 2021, p. 12)');
  assert.equal(groupText('chicago', uses, lib, order), '(Okafor 2019; Lindqvist 2021, 12)');
  assert.equal(groupText('ieee', uses, lib, order), '[1], [2, p. 12]');
});

test('in text citations without a year say n.d.', () => {
  const a = article([okafor], { issued: undefined });
  const uses = [{ key: a.id, block: 'b1' }];
  assert.equal(groupText('apa', uses, libOf(a), [a.id]), '(Okafor, n.d.)');
  assert.equal(groupText('chicago', uses, libOf(a), [a.id]), '(Okafor n.d.)');
});

test('apa in text citation without an author uses the quoted title with the comma inside the quotes', { todo: 'defect: apa no-author citation puts the comma after the closing quote instead of inside it' }, () => {
  const a = article(undefined, { title: 'Tides at night' });
  assert.equal(groupText('apa', [{ key: a.id, block: 'b1' }], libOf(a), [a.id]), '(“Tides at night,” 2019)');
});

test('same authors and year get letter suffixes in citations and entries', () => {
  const a = article([okafor, muller, berg], { id: 'a', title: 'Alpha tides' });
  const b = article([okafor, muller, berg], { id: 'b', title: 'Beta tides' });
  const lib = libOf(a, b);
  const built = build('apa', 'References', 2, ['b', 'a'], lib);
  assert.equal(built.inText.get('a'), 'Okafor et al., 2019a');
  assert.equal(built.inText.get('b'), 'Okafor et al., 2019b');
  assert.ok(built.markdown.includes('(2019a). Alpha tides.'), built.markdown);
  assert.ok(built.markdown.includes('(2019b). Beta tides.'), built.markdown);
  assert.equal(groupText('chicago', [{ key: 'a', block: 'x' }], lib, ['b', 'a']), '(Okafor, Müller, and van der Berg 2019a)');
});

test('apa and chicago bibliographies are alphabetical whatever the citation order', () => {
  const m = article([muller], { id: 'muller' });
  const o = article([okafor], { id: 'okafor' });
  const atlas = article(undefined, { id: 'atlas', title: 'The Atlas of Tides' });
  const lib = libOf(m, o, atlas, book);
  for (const style of ['apa', 'chicago'] as const) {
    const md = build(style, 'References', 2, ['okafor', 'muller', 'lindqvist2021', 'atlas'], lib).markdown;
    const at = ['Atlas of Tides', 'Lindqvist, S', 'Müller, A', 'Okafor, N'].map((s) => md.indexOf(s));
    assert.ok(at.every((p) => p > 0), md);
    assert.deepEqual([...at].sort((x, y) => x - y), at, md);
  }
});

test('ieee bibliography is numbered in order of first citation', () => {
  const o = article([okafor], { id: 'okafor' });
  const built = build('ieee', 'References', 2, ['okafor', 'lindqvist2021', 'ito2020chapter'], libOf(book, chapter, o));
  const entries = built.markdown.trim().split('\n\n').slice(1);
  assert.equal(entries.length, 3);
  assert.ok(entries[0].startsWith('\\[1\\] N. Okafor'), entries[0]);
  assert.ok(entries[1].startsWith('\\[2\\] S. Lindqvist'), entries[1]);
  assert.ok(entries[2].startsWith('\\[3\\] K. Ito'), entries[2]);
  assert.equal(built.inText.get('ito2020chapter'), '[3]');
});

test('prepare numbers ieee items as given and sorts author date styles', () => {
  const o = article([okafor], { id: 'okafor' });
  assert.deepEqual(prepare(STYLES.ieee, [o, book]).ordered.map((i) => i.id), ['okafor', 'lindqvist2021']);
  assert.deepEqual(prepare(STYLES.apa, [o, book]).ordered.map((i) => i.id), ['lindqvist2021', 'okafor']);
});

test('build writes the heading at the asked level and falls back to References', () => {
  const lib = libOf(book);
  assert.ok(build('apa', 'Sources', 3, [book.id], lib).markdown.startsWith('### Sources\n\nLindqvist, S.'));
  assert.ok(build('apa', '  ', 2, [book.id], lib).markdown.startsWith('## References\n\n'));
});

test('build reports keys that are not in the library and leaves them out', () => {
  const built = build('apa', 'References', 2, ['nokey', book.id, 'other'], libOf(book));
  assert.deepEqual(built.missing, ['nokey', 'other']);
  assert.deepEqual(built.cited.map((i) => i.id), [book.id]);
  assert.equal(built.markdown.includes('nokey'), false);
});

test('an unknown key is flagged in the in text form', () => {
  const out = groupText('apa', [{ key: 'nokey', block: 'b1' }, { key: book.id, block: 'b1' }], libOf(book), [book.id]);
  assert.equal(out, '(?nokey; Lindqvist, 2021)');
});

test('scan finds single grouped and repeated keys with locators', () => {
  const blocks = [
    para('b1', 'Tides rise [@okafor2019tides] and fall.'),
    para('b2', 'See [@ito2020chapter; @lindqvist2021, p. 12] and again [@okafor2019tides].'),
  ];
  const groups = scan(blocks, new Set());
  assert.deepEqual(groups, [
    { block: 'b1', uses: [{ key: 'okafor2019tides', block: 'b1', locator: undefined }] },
    {
      block: 'b2',
      uses: [
        { key: 'ito2020chapter', block: 'b2', locator: undefined },
        { key: 'lindqvist2021', block: 'b2', locator: 'p. 12' },
      ],
    },
    { block: 'b2', uses: [{ key: 'okafor2019tides', block: 'b2', locator: undefined }] },
  ]);
});

test('first use lists each key once in order of first appearance', () => {
  const groups = scan(
    [para('b1', '[@zed] then [@adams; @zed]'), para('b2', '[@adams] and [@miles]')],
    new Set(),
  );
  const first = firstUse(groups);
  assert.deepEqual(first.order, ['zed', 'adams', 'miles']);
  assert.equal(first.where.get('adams'), 'b1');
  assert.equal(first.where.get('miles'), 'b2');
});

test('scan ignores keys inside code and math blocks and skipped blocks', () => {
  const blocks: Block[] = [
    { id: 'c1', type: 'code_block', text: 'cite with [@incode]' },
    { id: 'm1', type: 'math_block', text: '[@inmath]' },
    para('refs', 'Old list [@inrefs]'),
    para('b1', 'Real [@kept]'),
  ];
  const groups = scan(blocks, new Set(['refs']));
  assert.deepEqual(groups.flatMap((g) => g.uses.map((u) => u.key)), ['kept']);
});

test('a page with no citations yields nothing to cite', () => {
  const blocks = [para('b1', 'Plain text with [a link] and [mail me at ann@example.org].'), para('b2', 'No brackets @here either.')];
  const groups = scan(blocks, new Set());
  assert.deepEqual(groups, []);
  assert.deepEqual(firstUse(groups).order, []);
  const built = build('apa', 'References', 2, [], new Map());
  assert.deepEqual(built.cited, []);
  assert.deepEqual(built.missing, []);
  assert.equal(built.inText.size, 0);
  assert.equal(built.markdown.trim(), '## References');
});

test('citation text writes pandoc keys with the locator on the last key', () => {
  assert.equal(citationText(['okafor2019tides'], ''), '[@okafor2019tides]');
  assert.equal(citationText(['ito2020chapter', 'lindqvist2021'], ' p. 12 '), '[@ito2020chapter; @lindqvist2021, p. 12]');
});

test('inserted citation text is read back by scan', () => {
  const groups = scan([para('b1', citationText(['ito2020chapter', 'lindqvist2021'], 'ch. 3'))], new Set());
  assert.deepEqual(groups[0].uses.map((u) => [u.key, u.locator]), [
    ['ito2020chapter', undefined],
    ['lindqvist2021', 'ch. 3'],
  ]);
});

test('page ranges are normalised to an en dash and doi prefixes are removed', () => {
  assert.equal(pageRange('45-67'), '45–67');
  assert.equal(pageRange(' 45 -- 67 '), '45–67');
  assert.equal(pageRange('45–67'), '45–67');
  assert.equal(pageRange(undefined), undefined);
  assert.equal(cleanDoi('https://doi.org/10.1000/jcr.2019.12'), '10.1000/jcr.2019.12');
  assert.equal(cleanDoi('doi: 10.1000/jcr.2019.12'), '10.1000/jcr.2019.12');
  assert.equal(cleanDoi('   '), undefined);
});

const dated = (type: Item['type'], issued: Item['issued'], extra: Partial<Item> = {}): Item => ({
  id: 'okafor2019tides',
  type,
  title: 'Tides of the estuary',
  author: [okafor],
  issued,
  container: 'Coastal Weekly',
  ...extra,
});

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

test('apa magazine and newspaper articles show the month name and day', () => {
  assert.equal(
    STYLES.apa.entry(dated('article-magazine', { year: 2019, month: 1, day: 5 }), one),
    'Okafor, N. (2019, January 5). Tides of the estuary. *Coastal Weekly*.',
  );
  assert.equal(
    STYLES.apa.entry(dated('article-newspaper', { year: 2019, month: 12, day: 31 }), one),
    'Okafor, N. (2019, December 31). Tides of the estuary. *Coastal Weekly*.',
  );
});

test('apa shows only the month name when the date has no day', () => {
  assert.equal(
    STYLES.apa.entry(dated('article-magazine', { year: 2019, month: 12 }), one),
    'Okafor, N. (2019, December). Tides of the estuary. *Coastal Weekly*.',
  );
  assert.equal(
    STYLES.apa.entry(dated('article-newspaper', { year: 2019, month: 1 }), one),
    'Okafor, N. (2019, January). Tides of the estuary. *Coastal Weekly*.',
  );
});

test('apa shows only the year when the date has no month', () => {
  assert.equal(
    STYLES.apa.entry(dated('article-magazine', { year: 2019 }), one),
    'Okafor, N. (2019). Tides of the estuary. *Coastal Weekly*.',
  );
});

test('apa web page shows the month name and day of its date', () => {
  assert.equal(
    STYLES.apa.entry(dated('webpage', { year: 2019, month: 1, day: 5 }), one),
    'Okafor, N. (2019, January 5). *Tides of the estuary*. Coastal Weekly.',
  );
  assert.equal(
    STYLES.apa.entry(dated('webpage', { year: 2019, month: 12, day: 31 }), one),
    'Okafor, N. (2019, December 31). *Tides of the estuary*. Coastal Weekly.',
  );
  assert.equal(
    STYLES.apa.entry(dated('webpage', { year: 2019, month: 12 }), one),
    'Okafor, N. (2019, December). *Tides of the estuary*. Coastal Weekly.',
  );
});

test('apa names each of the twelve months in a dated magazine entry', () => {
  MONTH_NAMES.forEach((name, i) => {
    assert.equal(
      STYLES.apa.entry(dated('article-magazine', { year: 2019, month: i + 1, day: 15 }), one),
      `Okafor, N. (2019, ${name} 15). Tides of the estuary. *Coastal Weekly*.`,
    );
  });
});

test('apa does not print the month for a journal article', () => {
  assert.ok(STYLES.apa.entry(article([okafor], { issued: { year: 2019, month: 3, day: 7 } }), one).startsWith('Okafor, N. (2019). '));
});

test('chicago magazine and newspaper articles put the month name and day after the title of the periodical', () => {
  assert.equal(
    STYLES.chicago.entry(dated('article-magazine', { year: 2019, month: 1, day: 5 }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” *Coastal Weekly*, January 5.',
  );
  assert.equal(
    STYLES.chicago.entry(dated('article-newspaper', { year: 2019, month: 12, day: 31 }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” *Coastal Weekly*, December 31.',
  );
  assert.equal(
    STYLES.chicago.entry(dated('article-magazine', { year: 2019, month: 12 }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” *Coastal Weekly*, December.',
  );
});

test('chicago names each of the twelve months in a dated newspaper entry', () => {
  MONTH_NAMES.forEach((name, i) => {
    assert.equal(
      STYLES.chicago.entry(dated('article-newspaper', { year: 2019, month: i + 1, day: 9 }), one),
      `Okafor, Ngozi. 2019. “Tides of the estuary.” *Coastal Weekly*, ${name} 9.`,
    );
  });
});

test('chicago leaves the month out of a journal article', () => {
  assert.equal(
    STYLES.chicago.entry(dated('article-journal', { year: 2019, month: 3, day: 7 }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” *Coastal Weekly*.',
  );
});

test('chicago web page prints the access date with the month name and day', () => {
  assert.equal(
    STYLES.chicago.entry(dated('webpage', { year: 2019 }, { accessed: { year: 2021, month: 1, day: 5 } }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” Coastal Weekly. Accessed January 5, 2021.',
  );
  assert.equal(
    STYLES.chicago.entry(dated('webpage', { year: 2019 }, { accessed: { year: 2021, month: 12, day: 31 } }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” Coastal Weekly. Accessed December 31, 2021.',
  );
});

test('chicago web page access date without a day shows the month name and year', () => {
  assert.equal(
    STYLES.chicago.entry(dated('webpage', { year: 2019 }, { accessed: { year: 2021, month: 12 } }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” Coastal Weekly. Accessed December, 2021.',
  );
});

test('chicago web page access date with only a year shows just the year', () => {
  assert.equal(
    STYLES.chicago.entry(dated('webpage', { year: 2019 }, { accessed: { year: 2021 } }), one),
    'Okafor, Ngozi. 2019. “Tides of the estuary.” Coastal Weekly. Accessed 2021.',
  );
});

test('ieee magazine and newspaper articles show the short month and day', () => {
  assert.equal(
    STYLES.ieee.entry(dated('article-magazine', { year: 2019, month: 1, day: 5 }), one),
    '\\[1\\] N. Okafor, “Tides of the estuary,” *Coastal Weekly*, Jan. 5, 2019.',
  );
  assert.equal(
    STYLES.ieee.entry(dated('article-newspaper', { year: 2019, month: 12, day: 31 }), one),
    '\\[1\\] N. Okafor, “Tides of the estuary,” *Coastal Weekly*, Dec. 31, 2019.',
  );
  assert.equal(
    STYLES.ieee.entry(dated('article-magazine', { year: 2019, month: 12 }), one),
    '\\[1\\] N. Okafor, “Tides of the estuary,” *Coastal Weekly*, Dec. 2019.',
  );
});

test('ieee web page prints the access date with the short month and day', () => {
  assert.equal(
    STYLES.ieee.entry(dated('webpage', { year: 2019 }, { accessed: { year: 2021, month: 1, day: 5 } }), one),
    '\\[1\\] N. Okafor, “Tides of the estuary.” Coastal Weekly. Accessed: Jan. 5, 2021.',
  );
  assert.equal(
    STYLES.ieee.entry(dated('webpage', { year: 2019 }, { accessed: { year: 2021, month: 12 } }), one),
    '\\[1\\] N. Okafor, “Tides of the estuary.” Coastal Weekly. Accessed: Dec. 2021.',
  );
});

function heading(id: string, level: number | undefined, text: string): Block {
  return { id, type: 'heading', level, text };
}

test('findSection finds the bibliography by its heading text ignoring case and spaces', () => {
  const blocks = [heading('h1', 1, 'Intro'), para('p1', 'x'), heading('h2', 2, 'References'), para('p2', 'a'), para('p3', 'b')];
  assert.deepEqual(findSection(blocks, [], 'References'), ['h2', 'p2', 'p3']);
  assert.deepEqual(findSection(blocks, [], '  references '), ['h2', 'p2', 'p3']);
});

test('findSection ignores paragraphs with the heading text and non matching headings', () => {
  const blocks = [para('p1', 'References'), heading('h1', 2, 'Reference list'), para('p2', 'a')];
  assert.deepEqual(findSection(blocks, [], 'References'), []);
});

test('findSection ends the section at the next heading of the same level', () => {
  const blocks = [heading('h1', 2, 'References'), para('p1', 'a'), heading('h2', 2, 'Appendix'), para('p2', 'b')];
  assert.deepEqual(findSection(blocks, [], 'References'), ['h1', 'p1']);
});

test('findSection ends the section at the next heading of a higher level', () => {
  const blocks = [heading('h1', 2, 'References'), para('p1', 'a'), heading('h2', 1, 'Part Two'), para('p2', 'b')];
  assert.deepEqual(findSection(blocks, [], 'References'), ['h1', 'p1']);
});

test('findSection treats a heading without a level as level one', () => {
  const blocks = [heading('h1', undefined, 'References'), para('p1', 'a'), heading('h2', 1, 'Next'), para('p2', 'b')];
  assert.deepEqual(findSection(blocks, [], 'References'), ['h1', 'p1']);
  const lower = [heading('h1', 2, 'References'), para('p1', 'a'), heading('h2', undefined, 'Next')];
  assert.deepEqual(findSection(lower, [], 'References'), ['h1', 'p1']);
});

test('findSection keeps a lower level heading and its text inside the section', { todo: 'defect: findSection stops at a lower level heading inside the bibliography because only paragraph and list blocks are accepted' }, () => {
  const blocks = [heading('h1', 2, 'References'), para('p1', 'a'), heading('h2', 3, 'Primary'), para('p2', 'b'), heading('h3', 2, 'Appendix'), para('p3', 'c')];
  assert.deepEqual(findSection(blocks, [], 'References'), ['h1', 'p1', 'h2', 'p2']);
});

test('findSection runs to the end of the page when no heading follows', () => {
  const blocks = [heading('h1', 1, 'Intro'), para('p1', 'x'), heading('h2', 2, 'References'), para('p2', 'a'), para('p3', 'b'), para('p4', 'c')];
  assert.deepEqual(findSection(blocks, [], 'References'), ['h2', 'p2', 'p3', 'p4']);
});

test('findSection returns just the heading when it is the last block', () => {
  assert.deepEqual(findSection([para('p1', 'x'), heading('h1', 2, 'References')], [], 'References'), ['h1']);
});

test('findSection takes the last matching heading on the page', () => {
  const blocks = [heading('h1', 2, 'References'), para('p1', 'a'), heading('h2', 1, 'Notes'), heading('h3', 2, 'References'), para('p2', 'b')];
  assert.deepEqual(findSection(blocks, [], 'References'), ['h3', 'p2']);
});

test('findSection reports none when the page has no such heading', () => {
  const blocks = [heading('h1', 1, 'Intro'), para('p1', 'x'), heading('h2', 2, 'Bibliography')];
  assert.deepEqual(findSection(blocks, [], 'References'), []);
  assert.deepEqual(findSection([], [], 'References'), []);
});

test('findSection prefers stored ids that are still on the page', () => {
  const blocks = [heading('h1', 2, 'References'), para('p1', 'a'), para('p2', 'b')];
  assert.deepEqual(findSection(blocks, ['p1', 'gone', 'p2'], 'Other'), ['p1', 'p2']);
});
