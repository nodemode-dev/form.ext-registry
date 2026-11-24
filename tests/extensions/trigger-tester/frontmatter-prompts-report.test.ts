import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDescription, scalar, writeDescription } from '../../../extensions/trigger-tester/src/frontmatter.ts';
import { parseFile, parseLines, toLines } from '../../../extensions/trigger-tester/src/prompts.ts';
import { label, toJson, toMarkdown } from '../../../extensions/trigger-tester/src/report.ts';
import type { Analysis, Loser, Pair, PromptResult, Ranked, SkillDoc } from '../../../extensions/trigger-tester/src/model.ts';

function fm(...lines: string[]): string {
  return ['---', ...lines, '---', 'Body text', ''].join('\n');
}

test('reads a bare description, ignores other keys and leaves the body alone', () => {
  const text = '---\nname: pdf-merge\nlicense: MIT\ndescription: Merge and split PDFs\n---\n# Body\ndescription: not this one\n';
  assert.equal(readDescription(text), 'Merge and split PDFs');
});

test('reads double quoted, single quoted and colon values', () => {
  assert.equal(readDescription(fm('description: "Say \\"hi\\" to the user"')), 'Say "hi" to the user');
  assert.equal(readDescription(fm("description: 'It''s a tool'")), "It's a tool");
  assert.equal(readDescription(fm('description: Use when: the user asks for X')), 'Use when: the user asks for X');
  assert.equal(readDescription(fm('description: "Note: this works"')), 'Note: this works');
});

test('reads folded blocks joined by spaces and literal blocks joined by newlines', () => {
  assert.equal(readDescription(fm('name: a', 'description: >', '  First part', '  second part', 'license: MIT')), 'First part second part');
  assert.equal(readDescription(fm('description: >-', '  alpha', '  beta')), 'alpha beta');
  assert.equal(readDescription(fm('description: |', '  Line one', '  Line two')), 'Line one\nLine two');
  assert.equal(readDescription(fm('description: |', '  A', '', '  B', 'license: MIT')), 'A\n\nB');
});

test('reads plain and quoted values that continue on the next lines', () => {
  assert.equal(readDescription(fm('description: Merge PDFs and', '  fill forms', 'license: MIT')), 'Merge PDFs and fill forms');
  assert.equal(readDescription(fm('description: "Merge PDFs', '  and fill forms"', 'license: MIT')), 'Merge PDFs and fill forms');
});

test('reads files with CRLF line ends', () => {
  assert.equal(readDescription('---\r\nname: a\r\ndescription: Merge PDFs\r\nlicense: MIT\r\n---\r\nBody\r\n'), 'Merge PDFs');
  assert.equal(readDescription('---\r\ndescription: >\r\n  one\r\n  two\r\n---\r\n'), 'one two');
});

test('reads and writes a file that starts with a byte order mark', { todo: 'defect: a leading BOM hides the front matter, so the description is null and writing throws' }, () => {
  const text = '\uFEFF---\nname: a\ndescription: Merge PDFs\n---\nBody\n';
  assert.equal(readDescription(text), 'Merge PDFs');
  assert.equal(writeDescription(text, 'New'), '\uFEFF---\nname: a\ndescription: New\n---\nBody\n');
});

test('returns null when there is no complete front matter', () => {
  assert.equal(readDescription('Just text\ndescription: x\n'), null);
  assert.equal(readDescription('---\nname: a\ndescription: x\n'), null);
  assert.equal(readDescription('---'), null);
  assert.equal(readDescription(''), null);
});

test('returns an empty string when front matter holds no usable description', () => {
  assert.equal(readDescription('---\n---\nBody\n'), '');
  assert.equal(readDescription(fm('name: a', 'license: MIT')), '');
  assert.equal(readDescription('---\nname: a\n---\ndescription: only in the body\n'), '');
  assert.equal(readDescription(fm('metadata:', '  description: nested', 'name: a')), '');
  assert.equal(readDescription(fm('name: a', 'description:')), '');
});

test('writeDescription replaces a plain, folded or multi-line value and keeps the rest', () => {
  const tail = 'license: MIT\n---\n# Body\n\nKeep me.\n';
  const want = `---\nname: a\ndescription: New text here\n${tail}`;
  assert.equal(writeDescription(`---\nname: a\ndescription: Old text\n${tail}`, 'New text here'), want);
  assert.equal(writeDescription(`---\nname: a\ndescription: >\n  one\n  two\n${tail}`, 'New text here'), want);
  assert.equal(writeDescription(`---\nname: a\ndescription: Old\n  more old\n${tail}`, 'New text here'), want);
  assert.equal(writeDescription(`---\nname: a\ndescription: "Old\n  more old"\n${tail}`, 'New text here'), want);
});

test('writeDescription adds a missing description after name, or first when there is no name', () => {
  assert.equal(writeDescription('---\nname: a\nlicense: MIT\n---\nBody', 'Added'), '---\nname: a\ndescription: Added\nlicense: MIT\n---\nBody');
  assert.equal(writeDescription('---\nlicense: MIT\n---\nBody', 'Added'), '---\ndescription: Added\nlicense: MIT\n---\nBody');
});

test('writeDescription refuses text without complete front matter', () => {
  assert.throws(() => writeDescription('No front matter here', 'x'), /no front matter/);
  assert.throws(() => writeDescription('---\nname: a\n', 'x'), /no front matter/);
  assert.throws(() => writeDescription('', 'x'), /no front matter/);
});

test('writeDescription keeps CRLF line ends', () => {
  assert.equal(writeDescription('---\r\nname: a\r\ndescription: Old\r\n---\r\nBody\r\n', 'New'), '---\r\nname: a\r\ndescription: New\r\n---\r\nBody\r\n');
  assert.equal(writeDescription('---\r\nname: a\r\n---\r\nBody\r\n', 'New'), '---\r\nname: a\r\ndescription: New\r\n---\r\nBody\r\n');
});

test('scalar quotes only the values YAML would misread', () => {
  assert.equal(scalar('Merge PDFs'), 'Merge PDFs');
  assert.equal(scalar('say "hi"'), 'say "hi"');
  assert.equal(scalar('Use when: asked'), '"Use when: asked"');
  assert.equal(scalar('Note:'), '"Note:"');
  assert.equal(scalar('- item'), '"- item"');
  assert.equal(scalar('@home'), '"@home"');
  assert.equal(scalar('text # tail'), '"text # tail"');
  assert.equal(scalar('"quoted" start'), '"\\"quoted\\" start"');
  assert.equal(scalar('a\\b: c'), '"a\\\\b: c"');
  assert.equal(scalar('  spaced \n  out  '), 'spaced out');
  assert.equal(scalar(''), '""');
});

test('a written description reads back unchanged and neighbours survive', () => {
  const base = '---\nname: a\ndescription: old\nlicense: MIT\n---\nBody\n';
  const values = [
    'Use when: the user asks',
    'He said "go" # now',
    "It's 'quoted'",
    '- starts with dash',
    'ends with colon:',
    '[brackets] and {braces}',
    'back\\slash inside',
    'Caf\u00e9 r\u00e9sum\u00e9',
  ];
  for (const v of values) {
    const out = writeDescription(base, v);
    assert.equal(readDescription(out), v, v);
    assert.ok(out.includes('\nlicense: MIT\n---\nBody\n'), v);
    assert.ok(out.startsWith('---\nname: a\n'), v);
  }
});

test('a description ending in a backslash inside quotes reads back whole', { todo: 'defect: a quoted value ending in an escaped backslash is taken as unclosed and swallows the keys after it' }, () => {
  const base = '---\nname: a\ndescription: old\nlicense: MIT\n---\nBody\n';
  const v = 'path: C:\\dir\\';
  const out = writeDescription(base, v);
  assert.equal(readDescription(out), v);
  assert.equal(writeDescription(out, v), out);
});

test('scalar quotes words YAML reads as booleans, null or numbers', { todo: 'defect: scalar writes true, null and 123 bare, so YAML reads a boolean, null or number instead of text' }, () => {
  for (const v of ['true', 'null', '123']) {
    assert.notEqual(scalar(v), v, v);
  }
});

test('parseLines skips blanks, headings and comments and trims each line', () => {
  const text = 'export a CMYK TIFF\n\n# a heading\n// a note\n  clean up a podcast  \n\n';
  assert.deepEqual(parseLines(text), [
    { text: 'export a CMYK TIFF', expect: '' },
    { text: 'clean up a podcast', expect: '' },
  ]);
  assert.deepEqual(parseLines(''), []);
  assert.deepEqual(parseLines('\n  \n# only a heading\n'), []);
});

test('parseLines strips list markers but not bold marks or a glued dash', () => {
  const text = '- one\n* two\n+ three\n1. four\n2) five\n**bold** six\n-seven\n';
  assert.deepEqual(parseLines(text).map((p) => p.text), ['one', 'two', 'three', 'four', 'five', '**bold** six', '-seven']);
});

test('parseLines reads the expected skill after an arrow with spaces around it', () => {
  const text = 'export a CMYK TIFF => cmyk-export\n- clean up a podcast =>   podcast-cleaner  \na => b => c\nno spaces=>here\n';
  assert.deepEqual(parseLines(text), [
    { text: 'export a CMYK TIFF', expect: 'cmyk-export' },
    { text: 'clean up a podcast', expect: 'podcast-cleaner' },
    { text: 'a => b', expect: 'c' },
    { text: 'no spaces=>here', expect: '' },
  ]);
});

test('parseLines keeps duplicate prompts and handles CRLF', () => {
  assert.deepEqual(parseLines('same prompt\r\nsame prompt\r\n\r\nsame prompt => s\r\n'), [
    { text: 'same prompt', expect: '' },
    { text: 'same prompt', expect: '' },
    { text: 'same prompt', expect: 's' },
  ]);
});

test('toLines writes the arrow only when a skill is expected and parseLines reads it back', () => {
  const list = [
    { text: 'a', expect: '' },
    { text: 'b', expect: 's' },
  ];
  assert.equal(toLines(list), 'a\nb => s');
  assert.equal(toLines([]), '');
  assert.deepEqual(parseLines(toLines(list)), list);
});

test('parseFile reads JSON arrays of strings and of objects', () => {
  assert.deepEqual(parseFile('p.json', JSON.stringify(['  export TIFF  ', '', '   ', 5, null])), [{ text: 'export TIFF', expect: '' }]);
  const objects = [
    { prompt: 'clean   up\n a podcast', expect: ' podcast-cleaner ' },
    { text: 't1', expected: 'e1' },
    { query: 'q1', skill: 's1' },
    { input: 'i1' },
    { prompt: '  ' },
    { nothing: 1 },
  ];
  assert.deepEqual(parseFile('p.json', JSON.stringify(objects)), [
    { text: 'clean up a podcast', expect: 'podcast-cleaner' },
    { text: 't1', expect: 'e1' },
    { text: 'q1', expect: 's1' },
    { text: 'i1', expect: '' },
  ]);
  assert.deepEqual(parseFile('LIST.JSON', '{"prompts":["x"]}'), [{ text: 'x', expect: '' }]);
  assert.deepEqual(parseFile('p.json', '{"queries":[{"prompt":"y","expect":"s"}]}'), [{ text: 'y', expect: 's' }]);
});

test('parseFile names the file when JSON is broken or holds no list', () => {
  assert.throws(() => parseFile('bad.json', '{oops'), /bad\.json is not valid JSON/);
  assert.throws(() => parseFile('o.json', '{"a":1}'), /o\.json has no list of prompts/);
  assert.throws(() => parseFile('s.json', '"text"'), /s\.json has no list of prompts/);
  assert.throws(() => parseFile('n.json', 'null'), /n\.json has no list of prompts/);
});

test('parseFile reads JSON lines and skips blank and broken lines', () => {
  const text = '{"prompt":"one","expect":"s1"}\n\n"two"\nnot json\r\n{"text":"three"}\n{"x":1}\n';
  assert.deepEqual(parseFile('x.jsonl', text), [
    { text: 'one', expect: 's1' },
    { text: 'two', expect: '' },
    { text: 'three', expect: '' },
  ]);
});

test('parseFile reads CSV with a header, quoted commas, doubled quotes and empty rows', () => {
  const text = 'prompt,expect\r\n"export a CMYK TIFF, please",cmyk-export\n"say ""hi""",\n\nclean up a podcast\n,orphan\n';
  assert.deepEqual(parseFile('x.csv', text), [
    { text: 'export a CMYK TIFF, please', expect: 'cmyk-export' },
    { text: 'say "hi"', expect: '' },
    { text: 'clean up a podcast', expect: '' },
  ]);
  assert.deepEqual(parseFile('x.csv', 'merge PDFs,pdf-merge'), [{ text: 'merge PDFs', expect: 'pdf-merge' }]);
  assert.deepEqual(parseFile('x.csv', 'Text,Skill\nmerge PDFs,pdf-merge'), [{ text: 'merge PDFs', expect: 'pdf-merge' }]);
});

test('parseFile treats text, markdown and unknown extensions as one prompt per line', () => {
  const text = '- one => s\n# note\ntwo\n';
  const want = [
    { text: 'one', expect: 's' },
    { text: 'two', expect: '' },
  ];
  assert.deepEqual(parseFile('a.txt', text), want);
  assert.deepEqual(parseFile('A.MD', text), want);
  assert.deepEqual(parseFile('a.prompts', text), want);
});

function sk(key: string, name: string, appName: string, app: string, folder = name): SkillDoc {
  return { key, app, appName, folder, name, description: 'x', fromCopy: false };
}

const A = sk('docs/pdf-merge', 'pdf-merge', 'Docs', 'docs');
const B = sk('audio/podcast-cleaner', 'Podcast Cleaner', 'Audio', 'audio', 'podcast-cleaner');
const C = sk('print/cmyk-export', 'cmyk-export', 'Print', 'print');
const D = sk('misc/mystery', 'mystery', 'Misc', 'misc');
const SKILLS = new Map([A, B, C, D].map((s) => [s.key, s]));
const META = { appVersion: '0.9.1', scope: 'all', copies: false, when: '2026-03-04' };

function rk(key: string, score: number, terms: string[] = []): Ranked {
  return { key, score, terms: terms.map((term) => ({ term, weight: 1 })) };
}

function result(text: string, expect: string, top: Ranked[], verdict: PromptResult['verdict'], share: number, expected: string | null, hit: boolean | null): PromptResult {
  return { prompt: { text, expect }, top, verdict, share, expected, hit };
}

const R0 = result('merge two PDFs', '', [rk(A.key, 6.5, ['merge', 'pdf']), rk(B.key, 1, ['two'])], 'clear', 0.15384615, null, null);
const R1 = result('clean | noise', 'podcast-cleaner', [rk(B.key, 5, ['clean', 'noise']), rk(A.key, 4.5, ['clean'])], 'contested', 0.9, B.key, true);
const R2 = result('make it so', 'ghost-skill', [rk(C.key, 3.25, ['make']), rk(A.key, 0)], 'weak', 0, 'ghost-skill', false);
const R3 = result('zzz', '', [], 'none', 0, null, null);

function analysis(results: PromptResult[], extra: Partial<Analysis> = {}): Analysis {
  return { results, pairs: [], losers: [], wins: new Map(), expected: 0, hits: 0, ...extra };
}

function lineAfter(md: string, header: string, offset: number): string {
  const lines = md.split('\n');
  return lines[lines.indexOf(header) + offset];
}

test('markdown report opens with scope, counts and a closing newline', () => {
  const md = toMarkdown(analysis([R0, R1, R2, R3], { expected: 2, hits: 1 }), SKILLS, META);
  const lines = md.split('\n');
  assert.equal(lines[0], '# Trigger report');
  assert.ok(lines[2].startsWith('Made 2026-03-04 with Trigger Tester in formskills 0.9.1. Scope: all, 4 skills. Model: BM25'));
  for (const want of [
    '- Prompts: 4',
    '- Clear winner: 1',
    '- Contested (runner-up at 80% or more of the winner): 1',
    '- Weak (the winner matched one word and scored under 4): 1',
    '- No skill matched: 1',
    '- Expected skill won: 1 of 2',
  ]) {
    assert.ok(lines.includes(want), want);
  }
  assert.ok(md.endsWith('\n'));
  const withCopies = toMarkdown(analysis([R0]), SKILLS, { ...META, copies: true });
  assert.ok(withCopies.includes("4 skills, your copies' descriptions where you have them. Model"));
});

test('markdown prompt table has one row per prompt with winner, runner-up, verdict and expectation', () => {
  const md = toMarkdown(analysis([R0, R1, R2, R3], { expected: 2, hits: 1 }), SKILLS, META);
  const lines = md.split('\n');
  const at = lines.indexOf('| # | Prompt | Winner | Runner-up | Verdict | Expected |');
  assert.ok(at > 0);
  assert.equal(lines[at + 1], '|---|---|---|---|---|---|');
  assert.deepEqual(lines.slice(at + 2, at + 6), [
    '| 1 | merge two PDFs | pdf-merge (Docs) 6.50 | Podcast Cleaner (Audio) 1.00 | clear |  |',
    '| 2 | clean \\| noise | Podcast Cleaner (Audio) 5.00 | pdf-merge (Docs) 4.50 | contested | yes: Podcast Cleaner (Audio) |',
    '| 3 | make it so | cmyk-export (Print) 3.25 |  | weak | no: ghost-skill |',
    '| 4 | zzz |  |  | no match |  |',
  ]);
  assert.equal(lines[at + 6], '');
});

test('markdown counts add up and a repeated prompt gets its own row', () => {
  const rows = [
    result('same', '', [rk(A.key, 6, ['x'])], 'clear', 0.1, null, null),
    result('same', '', [rk(A.key, 6, ['x'])], 'clear', 0.1, null, null),
    result('b', '', [rk(B.key, 5, ['y']), rk(A.key, 4.5)], 'contested', 0.9, null, null),
    result('c', '', [rk(C.key, 2, ['z'])], 'weak', 0, null, null),
    result('d', '', [rk(C.key, 3, ['z'])], 'weak', 0, null, null),
  ];
  const md = toMarkdown(analysis(rows), SKILLS, META);
  const num = (prefix: string) => Number(md.split('\n').find((l) => l.startsWith(prefix))!.split(': ').pop());
  assert.equal(num('- Prompts'), 5);
  assert.equal(num('- Clear'), 2);
  assert.equal(num('- Contested'), 1);
  assert.equal(num('- Weak'), 2);
  assert.equal(num('- No skill'), 0);
  assert.equal(md.split('\n').filter((l) => /^\| \d+ \|/.test(l)).length, 5);
  assert.equal(md.split('\n').filter((l) => /^\| \d+ \| same \|/.test(l)).length, 2);
  assert.ok(!md.includes('Expected skill won'));
});

test('markdown lists overlapping pairs with contested prompts, similarity and shared words', () => {
  const pairs: Pair[] = [
    { a: A.key, b: B.key, prompts: [0, 1], similarity: 0.42, shared: ['pdf', 'merge'] },
    { a: A.key, b: C.key, prompts: [1], similarity: 0, shared: [] },
    { a: B.key, b: C.key, prompts: [], similarity: 0.3, shared: ['audio'] },
  ];
  const md = toMarkdown(analysis([R0, R1], { pairs }), SKILLS, META);
  const head = '## Skills that fight for the same prompts';
  assert.deepEqual(md.split('\n').slice(md.split('\n').indexOf(head) + 2, md.split('\n').indexOf(head) + 5), [
    '- pdf-merge (Docs) and Podcast Cleaner (Audio): 2 contested prompts, descriptions 42% alike; shared words: pdf, merge',
    '- pdf-merge (Docs) and cmyk-export (Print): 1 contested prompt',
    '- Podcast Cleaner (Audio) and cmyk-export (Print): descriptions 30% alike; shared words: audio',
  ]);
  assert.equal(lineAfter(toMarkdown(analysis([R0]), SKILLS, META), head, 2), 'None found.');
});

test('markdown explains why each skill never wins and names unknown skills by key', () => {
  const losers: Loser[] = [
    { key: D.key, bestRank: 0, bestPrompt: -1, distinctive: [], reason: 'no-description' },
    { key: C.key, bestRank: 0, bestPrompt: -1, distinctive: ['cmyk', 'tiff'], reason: 'never-matched' },
    { key: B.key, bestRank: 2, bestPrompt: 1, distinctive: ['noise'], reason: 'never-top' },
    { key: 'x/gone', bestRank: 0, bestPrompt: -1, distinctive: [], reason: 'no-description' },
  ];
  const md = toMarkdown(analysis([R0, R1], { losers }), SKILLS, META);
  const lines = md.split('\n');
  const at = lines.indexOf('## Skills that never win');
  assert.deepEqual(lines.slice(at + 2, at + 6), [
    '- mystery (Misc): it has no description',
    '- cmyk-export (Print): no prompt shared a word with it; words only it uses: cmyk, tiff',
    '- Podcast Cleaner (Audio): best place was 2 for "clean \\| noise"; words only it uses: noise',
    '- x/gone: it has no description',
  ]);
  assert.equal(lineAfter(toMarkdown(analysis([R0]), SKILLS, META), '## Skills that never win', 2), 'Every skill won at least one prompt.');
  assert.equal(label(SKILLS, A.key), 'pdf-merge (Docs)');
  assert.equal(label(SKILLS, 'x/gone'), 'x/gone');
});

test('markdown for an empty run says so plainly', () => {
  const md = toMarkdown(analysis([]), SKILLS, META);
  const lines = md.split('\n');
  for (const want of ['- Prompts: 0', '- Clear winner: 0', '- No skill matched: 0', 'None found.', 'Run some prompts to find them.']) {
    assert.ok(lines.includes(want), want);
  }
  assert.ok(!md.includes('Expected skill won'));
  assert.ok(!md.includes('Every skill won'));
  assert.equal(lines.filter((l) => /^\| \d+ \|/.test(l)).length, 0);
});

test('json report states format, scope, counts and the expectation tally', () => {
  const json = toJson(analysis([R0, R1, R2, R3], { expected: 2, hits: 1 }), SKILLS, { ...META, copies: true }) as Record<string, unknown>;
  assert.equal(json.format, 'trigger-tester-report');
  assert.equal(json.format_version, 1);
  assert.equal(json.formskills, '0.9.1');
  assert.equal(json.scope, 'all');
  assert.equal(json.copies, true);
  assert.equal(json.made, '2026-03-04');
  assert.equal(json.skills, 4);
  assert.deepEqual(json.summary, { prompts: 4, clear: 1, contested: 1, weak: 1, none: 1, expected: 2, hits: 1 });
  const empty = toJson(analysis([]), SKILLS, META) as { summary: unknown; prompts: unknown[] };
  assert.deepEqual(empty.summary, { prompts: 0, clear: 0, contested: 0, weak: 0, none: 0, expected: 0, hits: 0 });
  assert.deepEqual(empty.prompts, []);
});

test('json report lists every prompt with rounded numbers, six terms at most and unknown keys kept', () => {
  const many = result('many words', '', [rk(A.key, 1.23456, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), rk('x/gone', 1, ['z'])], 'weak', 0.8, null, null);
  const json = toJson(analysis([R0, R1, many]), SKILLS, META) as { prompts: Record<string, unknown>[] };
  assert.equal(json.prompts.length, 3);
  assert.deepEqual(json.prompts[0], {
    prompt: 'merge two PDFs',
    expect: null,
    verdict: 'clear',
    runner_up_share: 0.154,
    hit: null,
    top: [
      { app: 'docs', skill: 'pdf-merge', name: 'pdf-merge', score: 6.5, terms: ['merge', 'pdf'] },
      { app: 'audio', skill: 'podcast-cleaner', name: 'Podcast Cleaner', score: 1, terms: ['two'] },
    ],
  });
  assert.equal(json.prompts[1].expect, 'podcast-cleaner');
  assert.equal(json.prompts[1].hit, true);
  assert.equal(json.prompts[1].prompt, 'clean | noise');
  const top = json.prompts[2].top as Record<string, unknown>[];
  assert.equal(top[0].score, 1.235);
  assert.deepEqual(top[0].terms, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(top[1], { app: '', skill: 'x/gone', name: 'x/gone', score: 1, terms: ['z'] });
});

test('json report carries overlaps and never-wins with nulls where nothing is known', () => {
  const pairs: Pair[] = [{ a: A.key, b: B.key, prompts: [0, 1], similarity: 0.4212, shared: ['pdf'] }];
  const losers: Loser[] = [
    { key: D.key, bestRank: 0, bestPrompt: -1, distinctive: [], reason: 'no-description' },
    { key: B.key, bestRank: 2, bestPrompt: 1, distinctive: ['noise'], reason: 'never-top' },
  ];
  const json = toJson(analysis([R0, R1], { pairs, losers }), SKILLS, META) as { overlaps: unknown[]; never_wins: unknown[] };
  assert.deepEqual(json.overlaps, [
    {
      a: { app: 'docs', skill: 'pdf-merge', name: 'pdf-merge' },
      b: { app: 'audio', skill: 'podcast-cleaner', name: 'Podcast Cleaner' },
      contested_prompts: 2,
      description_similarity: 0.421,
      shared: ['pdf'],
    },
  ]);
  assert.deepEqual(json.never_wins, [
    { app: 'misc', skill: 'mystery', name: 'mystery', reason: 'no-description', best_rank: null, best_prompt: null, distinctive: [] },
    { app: 'audio', skill: 'podcast-cleaner', name: 'Podcast Cleaner', reason: 'never-top', best_rank: 2, best_prompt: 'clean | noise', distinctive: ['noise'] },
  ]);
});
