import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBibtex, parseNames } from '../../../extensions/citations/src/bibtex.ts';
import { Cancelled } from '../../../extensions/citations/src/model.ts';

const defined = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const parse = async (text: string, source = 'refs.bib') => defined(await parseBibtex(text, source, { cancelled: false }, () => {}));

const readNames = (raw: string) => defined(parseNames(raw));

const EN_DASH = '–';

test('article entry maps its fields to the item model', async () => {
  const lib = await parse(`@article{knuth1984,
  author = {Knuth, Donald E.},
  title = {Literate Programming},
  journal = {The Computer Journal},
  year = {1984},
  volume = {27},
  number = {2},
  pages = {97--111},
  doi = {10.1093/comjnl/27.2.97}
}`);
  assert.deepEqual(lib.warnings, []);
  assert.equal(lib.items.length, 1);
  assert.deepEqual(lib.items[0], {
    id: 'knuth1984',
    type: 'article-journal',
    title: 'Literate Programming',
    author: [{ family: 'Knuth', given: 'Donald E.' }],
    etAl: false,
    issued: { year: 1984 },
    container: 'The Computer Journal',
    volume: '27',
    issue: '2',
    page: `97${EN_DASH}111`,
    doi: '10.1093/comjnl/27.2.97',
  });
});

test('library records the source name and the bibtex format', async () => {
  const lib = await parse('@misc{a, title = {A}}', 'my library.bib');
  assert.equal(lib.source, 'my library.bib');
  assert.equal(lib.format, 'bibtex');
});

test('book entry with quoted values and an unquoted number', async () => {
  const lib = await parse(`@book{lamport94,
  author = "Leslie Lamport",
  title = "LaTeX: A Document Preparation System",
  publisher = "Addison-Wesley",
  address = "Reading, Massachusetts",
  edition = "2",
  year = 1994
}`);
  assert.deepEqual(lib.warnings, []);
  const item = lib.items[0];
  assert.equal(item.type, 'book');
  assert.equal(item.title, 'LaTeX: A Document Preparation System');
  assert.equal(item.publisher, 'Addison-Wesley');
  assert.equal(item.place, 'Reading, Massachusetts');
  assert.equal(item.edition, '2');
  assert.equal(item.issued?.year, 1994);
  assert.deepEqual(item.author, [{ given: 'Leslie', family: 'Lamport' }]);
});

test('nested braces in a title are removed from the text', async () => {
  const lib = await parse('@article{n, title = {The {DNA} of {N}ested {{deep} things}}, year = 2001}');
  assert.equal(lib.items[0].title, 'The DNA of Nested deep things');
});

test('a double quote inside braces does not end a quoted value', async () => {
  const lib = await parse('@article{q, title = "Say {"}hi{"} now", year = "2001"}');
  assert.deepEqual(lib.warnings, []);
  assert.equal(lib.items[0].title, 'Say "hi" now');
  assert.equal(lib.items[0].issued?.year, 2001);
});

test('escaped braces and percent signs in a value are kept as text', async () => {
  const lib = await parse('@misc{e, title = {Cost of 5\\% and \\{braces\\}}, note = {x}}\n@misc{f, title = {Next}}');
  assert.deepEqual(lib.warnings, []);
  assert.equal(lib.items.length, 2);
  assert.equal(lib.items[0].title, 'Cost of 5% and {braces}');
});

test('latex accents in names and titles become letters', async () => {
  const lib = await parse('@book{m, author = {M{\\"u}ller, J{\\\'e}r{\\^o}me}, title = {Caf\\\'e}}');
  const item = lib.items[0];
  assert.equal(item.author?.[0].family?.normalize('NFC'), 'Müller');
  assert.equal(item.author?.[0].given?.normalize('NFC'), 'Jérôme');
  assert.equal(item.title?.normalize('NFC'), 'Café');
});

test('string macros are substituted and joined with the hash sign', async () => {
  const lib = await parse(`@string{acm = "Association for Computing Machinery"}
@string{cacm = {Communications of the } # "ACM"}
@article{j,
  title = "Part " # {One} # " of " # 3,
  journal = cacm,
  publisher = acm # { Press},
  year = 2010
}`);
  assert.deepEqual(lib.warnings, []);
  assert.equal(lib.items.length, 1);
  assert.equal(lib.items[0].title, 'Part One of 3');
  assert.equal(lib.items[0].container, 'Communications of the ACM');
  assert.equal(lib.items[0].publisher, 'Association for Computing Machinery Press');
});

test('string macro names ignore letter case and may use other macros', async () => {
  const lib = await parse(`@STRING{Base = {Journal of}}
@String(full = base # " Testing")
@article{k, journal = FULL, year = 2000}`);
  assert.deepEqual(lib.warnings, []);
  assert.equal(lib.items[0].container, 'Journal of Testing');
});

test('a string definition does not become an item', async () => {
  const lib = await parse('@string{x = "y"}');
  assert.deepEqual(lib.items, []);
  assert.deepEqual(lib.warnings, []);
});

test('month macros give the month number', async () => {
  const lib = await parse(`@article{a, year = 2020, month = jan}
@article{b, year = 2020, month = DEC}
@article{c, year = 2020, month = {September}}
@article{d, year = 2020, month = 7, day = 4}`);
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items.map((i) => i.issued?.month), [1, 12, 9, 7]);
  assert.equal(lib.items[3].issued?.day, 4);
  assert.equal(lib.items[0].issued?.year, 2020);
});

test('a user string macro wins over a built in month macro', async () => {
  const lib = await parse('@string{mar = "Marine Biology"}\n@article{a, journal = mar, year = 1999}');
  assert.equal(lib.items[0].container, 'Marine Biology');
});

test('biblatex date field gives year month and day', async () => {
  const lib = await parse('@online{w, title = {Page}, date = {2021-03-09}, urldate = {2022-11-30}, url = {https://example.org/a_b}}');
  const item = lib.items[0];
  assert.equal(item.type, 'webpage');
  assert.deepEqual(item.issued, { year: 2021, month: 3, day: 9 });
  assert.deepEqual(item.accessed, { year: 2022, month: 11, day: 30 });
  assert.equal(item.url, 'https://example.org/a_b');
});

test('comment blocks hide the entries inside them', async () => {
  const lib = await parse(`@comment{ @article{hidden, title = {Hidden}, year = 2000} }
@Comment{jabref-meta: databaseType:bibtex;}
@book{shown, title = {Shown}}`);
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items.map((i) => i.id), ['shown']);
});

test('preamble is skipped without a warning', async () => {
  const lib = await parse(`@preamble{ "\\newcommand{\\noop}[1]{}" # "\\providecommand{\\url}[1]{#1}" }
@book{after, title = {After}}`);
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items.map((i) => i.id), ['after']);
});

test('text outside entries is ignored', async () => {
  const lib = await parse(`This file was exported by someone@example.org on Monday.
% a remark line

@book{only, title = {Only}}

trailing words`);
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items.map((i) => i.id), ['only']);
});

test('entry type and field names ignore letter case', async () => {
  const lib = await parse('@ARTICLE{Up:Case-1, TITLE = {Loud}, Journal = {J}, YEAR = {1990}}');
  assert.equal(lib.items[0].id, 'Up:Case-1');
  assert.equal(lib.items[0].type, 'article-journal');
  assert.equal(lib.items[0].title, 'Loud');
  assert.equal(lib.items[0].container, 'J');
});

test('parentheses can delimit an entry', async () => {
  const lib = await parse('@book(paren, title = {Round}, year = 1980)\n@book{next, title = {Curly}}');
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items.map((i) => [i.id, i.title]), [['paren', 'Round'], ['next', 'Curly']]);
});

test('trailing comma and compact spacing are both accepted', async () => {
  const lib = await parse('@book{a,title={A},year=1999,}@book{b,\n\ttitle = "B"\n\t,\n}');
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items.map((i) => [i.id, i.title]), [['a', 'A'], ['b', 'B']]);
});

test('entry with a key and no fields still becomes an item', async () => {
  const lib = await parse('@misc{solo}');
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(lib.items, [{ id: 'solo', type: 'document' }]);
});

test('entry types map to their item types', async () => {
  const lib = await parse(`@inproceedings{a, booktitle = {Proc. of Things}}
@incollection{b, booktitle = {Collected}}
@phdthesis{c, school = {MIT}}
@mastersthesis{d, school = {ETH}}
@techreport{e, institution = {RAND}, number = {TR-7}}
@unpublished{f}
@misc{g}
@somethingnew{h}`);
  assert.deepEqual(lib.warnings, []);
  assert.deepEqual(
    lib.items.map((i) => i.type),
    ['paper-conference', 'chapter', 'thesis', 'thesis', 'report', 'manuscript', 'document', 'document'],
  );
  assert.equal(lib.items[0].container, 'Proc. of Things');
  assert.equal(lib.items[2].publisher, 'MIT');
  assert.equal(lib.items[2].genre, 'Doctoral dissertation');
  assert.equal(lib.items[3].genre, "Master's thesis");
  assert.equal(lib.items[4].number, 'TR-7');
  assert.equal(lib.items[4].issue, undefined);
});

test('doi resolver prefix is removed and page ranges use an en dash', async () => {
  const lib = await parse('@article{d, doi = {https://doi.org/10.1000/xyz123}, pages = {10-20}}\n@article{e, doi = {doi:10.5/abc}, pages = {5}}');
  assert.equal(lib.items[0].doi, '10.1000/xyz123');
  assert.equal(lib.items[0].page, `10${EN_DASH}20`);
  assert.equal(lib.items[1].doi, '10.5/abc');
  assert.equal(lib.items[1].page, '5');
});

test('duplicate key keeps the first entry and warns', async () => {
  const lib = await parse(`@book{dup, title = {First}}
@book{other, title = {Other}}
@article{dup, title = {Second}}`);
  assert.deepEqual(lib.items.map((i) => [i.id, i.title]), [['dup', 'First'], ['other', 'Other']]);
  assert.equal(lib.warnings.length, 1);
  assert.match(lib.warnings[0], /dup/);
  assert.match(lib.warnings[0], /Line 3\b/);
});

test('entry without a key is skipped with a warning', async () => {
  const lib = await parse('@book{, title = {Nameless}}\n@book{named, title = {Named}}');
  assert.deepEqual(lib.items.map((i) => i.id), ['named']);
  assert.equal(lib.warnings.length, 1);
  assert.match(lib.warnings[0], /Line 1\b/);
});

test('unterminated entry at the end of the file is skipped with a warning', async () => {
  const lib = await parse(`@book{good, title = {Good}}

@article{bad,
  title = {Never closed,
  year = 2000
`);
  assert.deepEqual(lib.items.map((i) => i.id), ['good']);
  assert.equal(lib.warnings.length, 1);
  assert.match(lib.warnings[0], /Line 3\b/);
});

test('entry missing its closing brace at the end of the file is skipped', async () => {
  const lib = await parse('@article{open, title = {Fine}, year = 2000');
  assert.deepEqual(lib.items, []);
  assert.equal(lib.warnings.length, 1);
});

test('parsing resumes at the next entry after a broken one', async () => {
  const lib = await parse(`@article{broken,
  title {No equals sign},
  year = 2000
}
@book{fine, title = {Fine}, year = 2001}`);
  assert.deepEqual(lib.items.map((i) => i.id), ['fine']);
  assert.equal(lib.items[0].issued?.year, 2001);
  assert.equal(lib.warnings.length, 1);
  assert.match(lib.warnings[0], /Line 1\b/);
});

test('empty file gives an empty library and reports completion', async () => {
  const calls: [number, number][] = [];
  const lib = await parseBibtex('', 'empty.bib', { cancelled: false }, (d, t) => calls.push([d, t]));
  assert.deepEqual(lib, { source: 'empty.bib', format: 'bibtex', items: [], warnings: [] });
  assert.deepEqual(calls, [[0, 0]]);
});

test('file with only white space and prose gives no items and no warnings', async () => {
  const lib = await parse('  \n\n just some notes, nothing else \n');
  assert.deepEqual(lib.items, []);
  assert.deepEqual(lib.warnings, []);
});

const bigFile = (count: number) => {
  const parts: string[] = [];
  for (let n = 0; n < count; n++) {
    parts.push(`@article{key${n},\n  author = {Author${n}, Given and Other, Person},\n  title = {Title number ${n}},\n  journal = {Journal},\n  year = ${1900 + (n % 120)},\n  pages = {1--9}\n}\n`);
  }
  return parts.join('\n');
};

test('very large file parses every entry and reports rising progress', async () => {
  const count = 20000;
  const text = bigFile(count);
  const calls: [number, number][] = [];
  const lib = await parseBibtex(text, 'big.bib', { cancelled: false }, (d, t) => calls.push([d, t]));
  assert.deepEqual(lib.warnings, []);
  assert.equal(lib.items.length, count);
  assert.equal(lib.items[0].id, 'key0');
  assert.equal(lib.items[count - 1].id, `key${count - 1}`);
  assert.equal(lib.items[count - 1].title, `Title number ${count - 1}`);
  assert.equal(lib.items[count - 1].author?.length, 2);
  assert.ok(calls.length >= 2);
  for (let n = 0; n < calls.length; n++) {
    assert.equal(calls[n][1], text.length);
    assert.ok(calls[n][0] >= 0 && calls[n][0] <= text.length);
    if (n > 0) assert.ok(calls[n][0] >= calls[n - 1][0]);
  }
  assert.deepEqual(calls[calls.length - 1], [text.length, text.length]);
});

test('cancelling during a large import rejects with Cancelled', async () => {
  const text = bigFile(20000);
  const job = { cancelled: false };
  let calls = 0;
  let lastDone = 0;
  await assert.rejects(
    parseBibtex(text, 'big.bib', job, (d) => {
      calls++;
      lastDone = d;
      job.cancelled = true;
    }),
    (err: unknown) => err instanceof Cancelled,
  );
  assert.equal(calls, 1);
  assert.ok(lastDone < text.length);
});

test('names in Last, First form', () => {
  assert.deepEqual(readNames('Knuth, Donald Ervin'), { names: [{ family: 'Knuth', given: 'Donald Ervin' }], etAl: false });
  assert.deepEqual(readNames('Brinch Hansen, Per').names, [{ family: 'Brinch Hansen', given: 'Per' }]);
});

test('names in First Last form', () => {
  assert.deepEqual(readNames('Donald Ervin Knuth').names, [{ given: 'Donald Ervin', family: 'Knuth' }]);
  assert.deepEqual(readNames('Per {Brinch Hansen}').names, [{ given: 'Per', family: 'Brinch Hansen' }]);
});

test('names in First von Last form', () => {
  assert.deepEqual(readNames('Ludwig van Beethoven').names, [{ given: 'Ludwig', particle: 'van', family: 'Beethoven' }]);
  const n = readNames("Charles Louis Xavier Joseph de la Vall{\\'e}e Poussin").names;
  assert.equal(n.length, 1);
  assert.equal(n[0].given, 'Charles Louis Xavier Joseph');
  assert.equal(n[0].particle, 'de la');
  assert.equal(n[0].family?.normalize('NFC'), 'Vallée Poussin');
});

test('names in von Last, First form', () => {
  assert.deepEqual(readNames('van der Berg, Jan').names, [{ particle: 'van der', family: 'Berg', given: 'Jan' }]);
  assert.deepEqual(readNames('{van Gogh}, Vincent').names, [{ family: 'van Gogh', given: 'Vincent' }]);
});

test('names in Last, Jr, First form', () => {
  assert.deepEqual(readNames('King, Jr., Martin Luther').names, [{ family: 'King', suffix: 'Jr.', given: 'Martin Luther' }]);
  assert.deepEqual(readNames('de la Cruz, III, Juan').names, [{ particle: 'de la', family: 'Cruz', suffix: 'III', given: 'Juan' }]);
});

test('single word name is a family name', () => {
  assert.deepEqual(readNames('Aristotle').names, [{ family: 'Aristotle' }]);
});

test('and others sets et al and is not a name', () => {
  assert.deepEqual(readNames('Smith, John and Doe, Jane and others'), {
    names: [
      { family: 'Smith', given: 'John' },
      { family: 'Doe', given: 'Jane' },
    ],
    etAl: true,
  });
});

test('names are split on and across line breaks but not inside words', () => {
  const r = readNames('Anderson, Sandy\n   and Alexander Brand\tand\nRandall, Andy');
  assert.equal(r.etAl, false);
  assert.deepEqual(r.names, [
    { family: 'Anderson', given: 'Sandy' },
    { given: 'Alexander', family: 'Brand' },
    { family: 'Randall', given: 'Andy' },
  ]);
});

test('corporate name in braces is kept whole', () => {
  assert.deepEqual(readNames('{World Health Organization}').names, [{ literal: 'World Health Organization' }]);
  assert.deepEqual(readNames('{Barnes and Noble, Inc.} and Smith, John').names, [
    { literal: 'Barnes and Noble, Inc.' },
    { family: 'Smith', given: 'John' },
  ]);
});

test('empty name list gives no names', () => {
  assert.deepEqual(readNames(''), { names: [], etAl: false });
  assert.deepEqual(readNames('   '), { names: [], etAl: false });
});

test('authors and editors of an entry are parsed with et al', async () => {
  const lib = await parse(`@incollection{c,
  author = {Jean-Paul Sartre and {NASA} and others},
  editor = "de Beauvoir, Simone and Albert Camus",
  booktitle = {Essays}
}`);
  const item = lib.items[0];
  assert.deepEqual(item.author, [{ given: 'Jean-Paul', family: 'Sartre' }, { literal: 'NASA' }]);
  assert.equal(item.etAl, true);
  assert.deepEqual(item.editor, [
    { particle: 'de', family: 'Beauvoir', given: 'Simone' },
    { given: 'Albert', family: 'Camus' },
  ]);
  assert.equal(item.container, 'Essays');
});
