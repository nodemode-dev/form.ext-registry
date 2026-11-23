import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, prepare } from '../../../extensions/citations/src/styles.ts';
import { cleanDoi, pageRange } from '../../../extensions/citations/src/model.ts';
import type { Item, Name } from '../../../extensions/citations/src/model.ts';
import { scan, firstUse, build, groupText, citationText } from '../../../extensions/citations/src/page.ts';
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
