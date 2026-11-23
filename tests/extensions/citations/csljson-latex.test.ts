import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCslJson } from '../../../extensions/citations/src/csljson.ts';
import { latexToText } from '../../../extensions/citations/src/latex.ts';
import { Cancelled } from '../../../extensions/citations/src/model.ts';

const defined = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const parse = async (data: unknown, source = 'refs.json') =>
  defined(await parseCslJson(typeof data === 'string' ? data : JSON.stringify(data), source, { cancelled: false }, () => {}));

const EN_DASH = '–';
const EM_DASH = '—';

test('csl json array maps a full journal article to the item model', async () => {
  const lib = await parse([
    {
      id: 'smith2020',
      type: 'article-journal',
      title: 'A Study of Things',
      author: [
        { family: 'Smith', given: 'Jane' },
        { literal: 'World Health Organization' },
      ],
      issued: { 'date-parts': [[2020, 5, 17]] },
      'container-title': 'Journal of Things',
      volume: '12',
      issue: '3',
      page: '45-67',
      publisher: 'Example Press',
      'publisher-place': 'Berlin',
      DOI: 'https://doi.org/10.1000/xyz123',
      URL: 'https://example.org/a',
    },
  ]);
  assert.equal(lib.source, 'refs.json');
  assert.equal(lib.format, 'csl-json');
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items, [
    {
      id: 'smith2020',
      type: 'article-journal',
      title: 'A Study of Things',
      author: [{ family: 'Smith', given: 'Jane' }, { literal: 'World Health Organization' }],
      issued: { year: 2020, month: 5, day: 17 },
      container: 'Journal of Things',
      volume: '12',
      issue: '3',
      page: `45${EN_DASH}67`,
      publisher: 'Example Press',
      place: 'Berlin',
      doi: '10.1000/xyz123',
      url: 'https://example.org/a',
    },
  ]);
});

test('a single reference object imports as one item', { todo: 'defect: a lone CSL-JSON item object, as returned by DOI content negotiation, is rejected as not a list' }, async () => {
  const lib = await parse({ id: 'solo', type: 'book', title: 'Alone' });
  assert.deepEqual(lib.items, [{ id: 'solo', type: 'book', title: 'Alone' }]);
});

test('an object wrapping an items list is read as that list', async () => {
  const lib = await parse({ items: [{ id: 'w1', type: 'book', title: 'Wrapped' }] });
  assert.deepEqual(lib.items, [{ id: 'w1', type: 'book', title: 'Wrapped' }]);
});

test('names keep particles and suffixes', async () => {
  const lib = await parse([
    {
      id: 'n',
      type: 'book',
      author: [
        { family: 'Beethoven', given: 'Ludwig', 'non-dropping-particle': 'van' },
        { family: 'King', given: 'Martin Luther', suffix: 'Jr.' },
        { family: 'Fontaine', given: 'Jean', 'dropping-particle': 'de', 'non-dropping-particle': 'la' },
      ],
    },
  ]);
  assert.deepEqual(lib.items[0].author, [
    { family: 'Beethoven', given: 'Ludwig', particle: 'van' },
    { family: 'King', given: 'Martin Luther', suffix: 'Jr.' },
    { family: 'Fontaine', given: 'Jean', particle: 'de la' },
  ]);
});

test('editors are read separately from authors', async () => {
  const lib = await parse([
    { id: 'e', type: 'book', editor: [{ family: 'Doe', given: 'John' }] },
  ]);
  assert.equal(lib.items[0].author, undefined);
  assert.deepEqual(lib.items[0].editor, [{ family: 'Doe', given: 'John' }]);
});

test('empty name objects are dropped and an all empty list leaves no author', async () => {
  const lib = await parse([
    { id: 'x', type: 'book', author: [{}, { family: '   ' }, 'not a name'] },
    { id: 'y', type: 'book', author: [{}, { family: 'Real' }] },
  ]);
  assert.equal('author' in lib.items[0], false);
  assert.deepEqual(lib.items[1].author, [{ family: 'Real' }]);
});

test('issued date parts with only a year or year and month', async () => {
  const lib = await parse([
    { id: 'y', type: 'book', issued: { 'date-parts': [[1999]] } },
    { id: 'ym', type: 'book', issued: { 'date-parts': [[2001, 11]] } },
  ]);
  assert.deepEqual(lib.items[0].issued, { year: 1999 });
  assert.deepEqual(lib.items[1].issued, { year: 2001, month: 11 });
});

test('issued date parts given as strings are read as numbers', async () => {
  const lib = await parse([{ id: 's', type: 'book', issued: { 'date-parts': [['2019', '07', '04']] } }]);
  assert.deepEqual(lib.items[0].issued, { year: 2019, month: 7, day: 4 });
});

test('issued raw date strings are parsed into parts', async () => {
  const lib = await parse([
    { id: 'r1', type: 'book', issued: { raw: '2018-03' } },
    { id: 'r2', type: 'book', issued: { raw: '2015-12-31' } },
  ]);
  assert.deepEqual(lib.items[0].issued, { year: 2018, month: 3 });
  assert.deepEqual(lib.items[1].issued, { year: 2015, month: 12, day: 31 });
});

test('a raw or literal date without a year is kept as literal text', async () => {
  const lib = await parse([
    { id: 'l1', type: 'book', issued: { literal: 'n.d.' } },
    { id: 'l2', type: 'book', issued: { raw: 'Spring term' } },
  ]);
  assert.deepEqual(lib.items[0].issued, { literal: 'n.d.' });
  assert.deepEqual(lib.items[1].issued, { literal: 'Spring term' });
});

test('a missing or empty issued date leaves no issued field', async () => {
  const lib = await parse([
    { id: 'm1', type: 'book', title: 'No date' },
    { id: 'm2', type: 'book', issued: {} },
    { id: 'm3', type: 'book', issued: { 'date-parts': [[]] } },
  ]);
  for (const item of lib.items) assert.equal('issued' in item, false, item.id);
});

test('accessed date is read like issued', async () => {
  const lib = await parse([{ id: 'w', type: 'webpage', URL: 'https://x.org', accessed: { 'date-parts': [[2024, 1, 2]] } }]);
  assert.deepEqual(lib.items[0].accessed, { year: 2024, month: 1, day: 2 });
  assert.equal(lib.items[0].url, 'https://x.org');
});

test('entries without an id are skipped with a warning', async () => {
  const lib = await parse([
    { id: 'ok1', type: 'book' },
    { type: 'book', title: 'Nameless' },
    { id: '   ', type: 'book', title: 'Blank id' },
    { id: 'ok2', type: 'book' },
  ]);
  assert.deepEqual(lib.items.map((i) => i.id), ['ok1', 'ok2']);
  assert.equal(lib.warnings.length, 2);
  assert.match(lib.warnings[0], /\b2\b/);
  assert.match(lib.warnings[1], /\b3\b/);
});

test('numeric ids become strings and citation key wins over id', async () => {
  const lib = await parse([
    { id: 42, type: 'book' },
    { id: 'ITEM-1', 'citation-key': 'doe2001', type: 'book' },
  ]);
  assert.deepEqual(lib.items.map((i) => i.id), ['42', 'doe2001']);
});

test('a repeated id keeps the first entry and warns', async () => {
  const lib = await parse([
    { id: 'dup', type: 'book', title: 'First' },
    { id: 'dup', type: 'book', title: 'Second' },
  ]);
  assert.equal(lib.items.length, 1);
  assert.equal(lib.items[0].title, 'First');
  assert.equal(lib.warnings.length, 1);
  assert.match(lib.warnings[0], /dup/);
});

test('array members that are not objects are skipped with warnings', async () => {
  const lib = await parse([1, null, 'text', { id: 'real', type: 'book' }]);
  assert.deepEqual(lib.items.map((i) => i.id), ['real']);
  assert.equal(lib.warnings.length, 3);
});

test('missing and unknown types fall back to document', async () => {
  const lib = await parse([
    { id: 'none', title: 'No type' },
    { id: 'odd', type: 'motion_picture-ish' },
    { id: 'blog', type: 'post-weblog' },
  ]);
  assert.deepEqual(lib.items.map((i) => i.type), ['document', 'document', 'webpage']);
});

test('numeric volume and issue become strings and text is trimmed', async () => {
  const lib = await parse([
    { id: 'v', type: 'article-journal', title: '  Padded Title  ', volume: 12, issue: 4, page: 7, 'container-title': '   ' },
  ]);
  assert.deepEqual(lib.items[0], { id: 'v', type: 'article-journal', title: 'Padded Title', volume: '12', issue: '4', page: '7' });
});

test('doi prefix forms are removed', async () => {
  const lib = await parse([
    { id: 'd1', type: 'book', DOI: 'doi:10.5555/abc' },
    { id: 'd2', type: 'book', DOI: 'http://dx.doi.org/10.5555/def' },
  ]);
  assert.deepEqual(lib.items.map((i) => i.doi), ['10.5555/abc', '10.5555/def']);
});

test('invalid json rejects with an error naming the source', async () => {
  await assert.rejects(parse('[{"id": "a",', 'broken.json'), (err: Error) => err instanceof Error && /broken\.json/.test(err.message));
});

test('json that is not a list of references is rejected', async () => {
  for (const text of ['42', '"just text"', 'null', '{"title": "no items"}']) {
    await assert.rejects(parse(text, 'odd.json'), /odd\.json/, text);
  }
});

test('an empty array gives an empty library and reports full progress', async () => {
  const calls: [number, number][] = [];
  const lib = await parseCslJson('[]', 'empty.json', { cancelled: false }, (d, t) => calls.push([d, t]));
  assert.deepEqual(lib.items, []);
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(calls.at(-1), [0, 0]);
});

test('progress finishes at the total entry count', async () => {
  const calls: [number, number][] = [];
  await parseCslJson(JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 'p.json', { cancelled: false }, (d, t) => calls.push([d, t]));
  assert.deepEqual(calls.at(-1), [3, 3]);
});

test('cancelling during a large import rejects with Cancelled', async () => {
  const big = JSON.stringify(Array.from({ length: 150000 }, (_, n) => ({ id: `k${n}`, type: 'book', title: `Title ${n}`, author: [{ family: 'F', given: 'G' }], issued: { 'date-parts': [[2000, 1, 1]] } })));
  await assert.rejects(parseCslJson(big, 'big.json', { cancelled: true }, () => {}), (err: unknown) => err instanceof Cancelled);
});

test('latex umlaut acute and tilde accents become composed letters', () => {
  assert.equal(latexToText(String.raw`M{\"u}ller`), 'Müller');
  assert.equal(latexToText(String.raw`Andr\'e`), 'André');
  assert.equal(latexToText(String.raw`Espa\~na`), 'España');
  assert.equal(latexToText(String.raw`\"{O}sterreich`), 'Österreich');
});

test('latex letter accents with braces such as cedilla caron and breve', () => {
  assert.equal(latexToText(String.raw`Fran\c{c}ois`), 'François');
  assert.equal(latexToText(String.raw`\v{S}koda`), 'Škoda');
  assert.equal(latexToText(String.raw`Erdo\u{g}an`), 'Erdoğan');
  assert.equal(latexToText(String.raw`Erd\H{o}s`), 'Erdős');
});

test('latex accent on dotless i gives a normal accented i', () => {
  assert.equal(latexToText(String.raw`Mart\'{\i}n`), 'Martín');
  assert.equal(latexToText(String.raw`na\"{\i}ve`), 'naïve');
});

test('latex special letters such as sharp s and slashed o', () => {
  assert.equal(latexToText(String.raw`Stra{\ss}e`), 'Straße');
  assert.equal(latexToText(String.raw`Gr{\o}nbech`), 'Grønbech');
  assert.equal(latexToText(String.raw`{\L}{\'o}d{\'z}`), 'Łódź');
  assert.equal(latexToText(String.raw`{\AA}ngstr{\"o}m`), 'Ångström');
});

test('latex double and triple hyphens become en and em dashes', () => {
  assert.equal(latexToText('pages 10--20'), `pages 10${EN_DASH}20`);
  assert.equal(latexToText('yes---no'), `yes${EM_DASH}no`);
  assert.equal(latexToText('well-known'), 'well-known');
});

test('latex escaped specials become the plain characters', () => {
  assert.equal(latexToText(String.raw`Smith \& Sons`), 'Smith & Sons');
  assert.equal(latexToText(String.raw`50\% off`), '50% off');
  assert.equal(latexToText(String.raw`costs \$5`), 'costs $5');
  assert.equal(latexToText(String.raw`snake\_case`), 'snake_case');
  assert.equal(latexToText(String.raw`issue \#3`), 'issue #3');
  assert.equal(latexToText(String.raw`\{set\}`), '{set}');
});

test('latex nested braces are removed while the text stays', () => {
  assert.equal(latexToText('{{The {GNU} Project}}'), 'The GNU Project');
  assert.equal(latexToText(String.raw`\textbf{bold {nested} text}`), 'bold nested text');
});

test('latex unknown commands drop away and keep their argument text', () => {
  assert.equal(latexToText(String.raw`\emph{Nature} reviews`), 'Nature reviews');
  assert.equal(latexToText(String.raw`before \foo after`), 'before after');
});

test('latex quotes ties and control space become plain punctuation and spaces', () => {
  assert.equal(latexToText("``quoted''"), '“quoted”');
  assert.match(latexToText('Fig.~1'), /^Fig\.\s1$/);
  assert.equal(latexToText(String.raw`\LaTeX\ is fine`), 'LaTeX is fine');
  assert.equal(latexToText(String.raw`\ldots`), '…');
});

test('latex thin space and hyphenation hint leave no stray punctuation', { todo: 'defect: backslash followed by a non letter such as comma or hyphen drops only the backslash, so 10\\,000 gives 10,000 and infor\\-mation keeps a hyphen' }, () => {
  assert.match(latexToText(String.raw`10\,000`), /^10\s?000$/);
  assert.equal(latexToText(String.raw`infor\-mation`), 'information');
});

test('latex empty string and extra whitespace', () => {
  assert.equal(latexToText(''), '');
  assert.equal(latexToText('   a \n\t  b   '), 'a b');
  assert.equal(latexToText('{}'), '');
});
