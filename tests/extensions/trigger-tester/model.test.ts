import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Index,
  analyse,
  firstSentence,
  judge,
  matchesExpect,
  similarPairs,
  stem,
  terms,
  words,
} from '../../../extensions/trigger-tester/src/model.ts';
import type { Prompt, PromptResult, Ranked, SkillDoc } from '../../../extensions/trigger-tester/src/model.ts';

function skill(key: string, name: string, description: string, folder = name): SkillDoc {
  return { key, app: 'app', appName: 'App', folder, name, description, fromCopy: false };
}

const PDF = skill('app/pdf-merge', 'pdf-merge', 'Merge, split and rotate PDF documents. Use when the user wants to combine pages or fill forms.');
const AUDIO = skill('app/podcast-cleaner', 'podcast-cleaner', 'Clean up podcast audio: remove noise, level loudness and trim silence.');
const PRINT = skill('app/cmyk-export', 'cmyk-export', 'Export artwork as CMYK TIFF files ready for a print shop.');
const BLANK = skill('app/mystery', 'mystery', '');
const ALL = [PDF, AUDIO, PRINT, BLANK];
const SCOPE = new Set(ALL.map((s) => s.key));

function run(index: Index, text: string, expect = ''): PromptResult {
  return judge(index, { text, expect }, index.rank(text));
}

function scoreOf(ranked: Ranked[], key: string): number {
  const r = ranked.find((x) => x.key === key);
  assert.ok(r, `no entry for ${key}`);
  return r.score;
}

function ranked(key: string, score: number, singles = 2): Ranked {
  const list = [];
  for (let i = 0; i < singles; i++) list.push({ term: `word${i}`, weight: score / singles });
  return { key, score, terms: list };
}

function made(top: Ranked[], verdict: PromptResult['verdict'], hit: boolean | null = null): PromptResult {
  const prompt: Prompt = { text: 'x', expect: hit === null ? '' : 'something' };
  return { prompt, top, verdict, share: 0, expected: hit === null ? null : 'something', hit };
}

test('a prompt using the description words scores above an unrelated prompt', () => {
  const index = new Index(ALL);
  const own = scoreOf(index.rank('merge and rotate pdf documents'), PDF.key);
  const other = scoreOf(index.rank('bake a chocolate cake'), PDF.key);
  assert.ok(own > 0);
  assert.equal(other, 0);
  assert.ok(own > other);
});

test('the skill whose description matches the prompt is ranked first', () => {
  const index = new Index(ALL);
  assert.equal(index.rank('clean up a podcast recording')[0].key, AUDIO.key);
  assert.equal(index.rank('export a CMYK TIFF')[0].key, PRINT.key);
  assert.equal(index.rank('split pdf pages')[0].key, PDF.key);
});

test('rank returns one entry per skill sorted from highest score down', () => {
  const index = new Index(ALL);
  const out = index.rank('merge pdf documents and trim podcast silence');
  assert.equal(out.length, ALL.length);
  assert.deepEqual(out.map((r) => r.key).sort(), ALL.map((s) => s.key).sort());
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score);
});

test('matching ignores case and punctuation', () => {
  const index = new Index(ALL);
  const plain = index.rank('export cmyk print');
  const loud = index.rank('EXPORT... a CMYK, print!?');
  assert.deepEqual(loud, plain);
  assert.ok(scoreOf(plain, PRINT.key) > 0);
});

test('words drops common words, single letters and punctuation', () => {
  assert.deepEqual(words('Can you help me with THIS, please?'), ['pleas']);
  assert.deepEqual(words('Merge: the PDF & a doc!'), ['merg', 'pdf', 'doc']);
  assert.deepEqual(words(''), []);
  assert.deepEqual(words('Colour grading'), words('color grading'));
});

test('plural and tense forms of a word reduce to the same stem', () => {
  assert.equal(stem('exports'), stem('export'));
  assert.equal(stem('exported'), stem('export'));
  assert.equal(stem('exporting'), stem('export'));
  assert.equal(stem('libraries'), 'library');
  assert.equal(stem('running'), 'run');
  assert.equal(stem('glass'), 'glass');
});

test('terms lists single words then adjacent pairs', () => {
  assert.deepEqual(terms('export cmyk print'), ['export', 'cmyk', 'print', 'export cmyk', 'cmyk print']);
  assert.deepEqual(terms('export'), ['export']);
});

test('common words alone never trigger any skill', () => {
  const index = new Index(ALL);
  const text = 'Can you help me with this when I need it?';
  for (const r of index.rank(text)) assert.equal(r.score, 0);
  const result = run(index, text);
  assert.equal(result.verdict, 'none');
  assert.equal(result.share, 0);
});

test('an empty prompt gives zero scores and no failure', () => {
  const index = new Index(ALL);
  for (const text of ['', '   ', '?!,.']) {
    const out = index.rank(text);
    assert.equal(out.length, ALL.length);
    for (const r of out) {
      assert.equal(r.score, 0);
      assert.deepEqual(r.terms, []);
    }
    assert.equal(run(index, text).verdict, 'none');
  }
});

test('a skill with an empty description scores zero unless its name is used', () => {
  const index = new Index(ALL);
  assert.equal(scoreOf(index.rank('merge pdf documents and export cmyk'), BLANK.key), 0);
  const named = index.rank('solve the mystery');
  assert.equal(named[0].key, BLANK.key);
  assert.ok(named[0].score > 0);
});

test('an index with no skills ranks and judges without failing', () => {
  const index = new Index([]);
  assert.deepEqual(index.rank('merge pdf'), []);
  const result = run(index, 'merge pdf', 'pdf-merge');
  assert.equal(result.verdict, 'none');
  assert.equal(result.hit, false);
  assert.equal(result.expected, 'pdf-merge');
  assert.deepEqual(analyse(index, new Set(), [result]).losers, []);
});

test('skills with equal scores are ordered by key', () => {
  const index = new Index([BLANK, PRINT, AUDIO, PDF]);
  const out = index.rank('bake a chocolate cake');
  assert.deepEqual(out.map((r) => r.key), ['app/cmyk-export', 'app/mystery', 'app/pdf-merge', 'app/podcast-cleaner']);
});

test('scoring is deterministic and does not depend on the order of skills', () => {
  const text = 'trim silence and remove noise from a podcast, then merge pdf pages';
  const forward = new Index(ALL);
  const backward = new Index(ALL.slice().reverse());
  assert.deepEqual(forward.rank(text), forward.rank(text));
  const a = forward.rank(text);
  const b = backward.rank(text);
  assert.deepEqual(a.map((r) => r.key), b.map((r) => r.key));
  for (const s of ALL) assert.ok(Math.abs(scoreOf(a, s.key) - scoreOf(b, s.key)) < 1e-9);
});

test('judging prompts in a different order gives the same result for each prompt', () => {
  const index = new Index(ALL);
  const texts = ['merge two pdf documents', 'clean up a podcast', 'export a CMYK TIFF', 'bake a chocolate cake'];
  const forward = texts.map((t) => run(index, t));
  const backward = texts.slice().reverse().map((t) => run(index, t)).reverse();
  assert.deepEqual(backward, forward);
});

test('a word used by one skill weighs more than a word used by every skill', () => {
  const a = skill('a', 'alpha', 'convert files quickly with vectors');
  const b = skill('b', 'beta', 'convert files quickly with rasters');
  const c = skill('c', 'gamma', 'convert files quickly with fonts');
  const index = new Index([a, b, c]);
  assert.ok(Math.abs(index.idf('vector') - Math.log(1 + 2.5 / 1.5)) < 1e-12);
  assert.ok(Math.abs(index.idf('convert') - Math.log(1 + 0.5 / 3.5)) < 1e-12);
  assert.ok(Math.abs(index.idf('unseen') - Math.log(8)) < 1e-12);
  const rare = index.rank('vectors').find((r) => r.key === 'a')!.score;
  const common = index.rank('convert').find((r) => r.key === 'a')!.score;
  assert.ok(rare > common);
});

test('a top score exactly at the floor counts as a match and just below does not', () => {
  const index = new Index(ALL);
  const at = judge(index, { text: 'x', expect: '' }, [ranked(PDF.key, 0.5), ranked(AUDIO.key, 0)]);
  const below = judge(index, { text: 'x', expect: '' }, [ranked(PDF.key, 0.499), ranked(AUDIO.key, 0)]);
  assert.equal(at.verdict, 'clear');
  assert.equal(below.verdict, 'none');
  assert.equal(below.share, 0);
});

test('a runner up at exactly 80 percent of the winner is contested and just below is clear', () => {
  const index = new Index(ALL);
  const at = judge(index, { text: 'x', expect: '' }, [ranked(PDF.key, 5), ranked(AUDIO.key, 4)]);
  const below = judge(index, { text: 'x', expect: '' }, [ranked(PDF.key, 5), ranked(AUDIO.key, 3.9)]);
  assert.equal(at.verdict, 'contested');
  assert.equal(at.share, 0.8);
  assert.equal(below.verdict, 'clear');
  assert.equal(below.share, 0.78);
});

test('a low score from a single matched word is weak', () => {
  const index = new Index(ALL);
  const oneWord = judge(index, { text: 'x', expect: '' }, [ranked(PDF.key, 3.9, 1), ranked(AUDIO.key, 0)]);
  const twoWords = judge(index, { text: 'x', expect: '' }, [ranked(PDF.key, 3.9, 2), ranked(AUDIO.key, 0)]);
  const strongOne = judge(index, { text: 'x', expect: '' }, [ranked(PDF.key, 4, 1), ranked(AUDIO.key, 0)]);
  assert.equal(oneWord.verdict, 'weak');
  assert.equal(twoWords.verdict, 'clear');
  assert.equal(strongOne.verdict, 'clear');
});

test('judge keeps only the three best skills', () => {
  const index = new Index(ALL);
  const result = run(index, 'merge pdf documents');
  assert.equal(result.top.length, 3);
  assert.equal(result.top[0].key, PDF.key);
});

test('a lone skill that matches is clear with no runner up share', () => {
  const index = new Index([PDF]);
  const result = run(index, 'merge and rotate pdf documents');
  assert.equal(result.verdict, 'clear');
  assert.equal(result.share, 0);
});

test('an expected skill that wins is a hit', () => {
  const index = new Index(ALL);
  const result = run(index, 'clean up a podcast', 'podcast-cleaner');
  assert.equal(result.verdict, 'clear');
  assert.equal(result.expected, AUDIO.key);
  assert.equal(result.hit, true);
});

test('an expected skill that loses to another skill is a miss', () => {
  const index = new Index(ALL);
  const result = run(index, 'rotate pdf pages', 'podcast-cleaner');
  assert.equal(result.top[0].key, PDF.key);
  assert.equal(result.expected, AUDIO.key);
  assert.equal(result.hit, false);
});

test('an expected skill is a miss when nothing matches the prompt', () => {
  const index = new Index(ALL);
  const result = run(index, 'bake a chocolate cake', 'pdf-merge');
  assert.equal(result.verdict, 'none');
  assert.equal(result.hit, false);
});

test('an expectation naming an unknown skill is a miss and keeps the given name', () => {
  const index = new Index(ALL);
  const result = run(index, 'merge pdf documents', 'no-such-skill');
  assert.equal(result.expected, 'no-such-skill');
  assert.equal(result.hit, false);
});

test('a prompt without an expectation has no hit or miss', () => {
  const index = new Index(ALL);
  const result = run(index, 'merge pdf documents');
  assert.equal(result.expected, null);
  assert.equal(result.hit, null);
});

test('an expectation matches key, folder or name in any case with spaces around it', () => {
  const s = skill('formvis/Print-Kit', 'cmyk-export', 'x', 'print-folder');
  assert.equal(matchesExpect(s, '  FORMVIS/print-kit '), true);
  assert.equal(matchesExpect(s, 'CMYK-Export'), true);
  assert.equal(matchesExpect(s, 'Print-Folder'), true);
  assert.equal(matchesExpect(s, 'cmyk'), false);
  assert.equal(matchesExpect(s, ''), false);
});

test('totals count expectations, hits and wins for a small table', () => {
  const index = new Index(ALL);
  const results = [
    run(index, 'merge two pdf documents', 'pdf-merge'),
    run(index, 'clean up a podcast', 'podcast-cleaner'),
    run(index, 'export a CMYK TIFF', 'CMYK-EXPORT'),
    run(index, 'rotate pdf pages', 'podcast-cleaner'),
    run(index, 'bake a chocolate cake', 'pdf-merge'),
    run(index, 'trim silence from audio'),
  ];
  const a = analyse(index, SCOPE, results);
  assert.equal(a.expected, 5);
  assert.equal(a.hits, 3);
  assert.equal(a.results.length, 6);
  assert.equal(a.wins.get(PDF.key), 2);
  assert.equal(a.wins.get(AUDIO.key), 2);
  assert.equal(a.wins.get(PRINT.key), 1);
  assert.equal(a.wins.get(BLANK.key), 0);
  assert.deepEqual(a.losers.map((l) => [l.key, l.reason]), [[BLANK.key, 'no-description']]);
});

test('totals do not depend on the order of the prompts', () => {
  const index = new Index(ALL);
  const results = [
    run(index, 'merge two pdf documents', 'pdf-merge'),
    run(index, 'rotate pdf pages', 'podcast-cleaner'),
    run(index, 'export a CMYK TIFF', 'cmyk-export'),
    run(index, 'bake a chocolate cake'),
  ];
  const a = analyse(index, SCOPE, results);
  const b = analyse(index, SCOPE, results.slice().reverse());
  assert.equal(a.expected, 3);
  assert.equal(a.hits, 2);
  assert.equal(b.expected, a.expected);
  assert.equal(b.hits, a.hits);
  assert.deepEqual([...b.wins].sort(), [...a.wins].sort());
});

test('skills that never win are listed with the reason and where they came closest', () => {
  const index = new Index(ALL);
  const results = [
    made([ranked(PDF.key, 6), ranked(PRINT.key, 0.2), ranked(AUDIO.key, 0)], 'clear'),
    made([ranked(PDF.key, 6), ranked(PRINT.key, 2), ranked(AUDIO.key, 0)], 'clear'),
  ];
  const a = analyse(index, SCOPE, results);
  const byKey = new Map(a.losers.map((l) => [l.key, l]));
  assert.equal(byKey.has(PDF.key), false);
  assert.equal(byKey.get(PRINT.key)!.reason, 'never-top');
  assert.equal(byKey.get(PRINT.key)!.bestRank, 2);
  assert.equal(byKey.get(PRINT.key)!.bestPrompt, 1);
  assert.equal(byKey.get(AUDIO.key)!.reason, 'never-matched');
  assert.equal(byKey.get(AUDIO.key)!.bestRank, 0);
  assert.equal(byKey.get(AUDIO.key)!.bestPrompt, -1);
  assert.equal(byKey.get(BLANK.key)!.reason, 'no-description');
  assert.ok(byKey.get(AUDIO.key)!.distinctive.includes('podcast'));
  assert.equal(byKey.get(AUDIO.key)!.distinctive.includes('pdf'), false);
});

test('skills outside the scope are never listed as losers and no prompts means no losers', () => {
  const index = new Index(ALL);
  const results = [made([ranked(PDF.key, 6), ranked(PRINT.key, 0)], 'clear')];
  const narrow = analyse(index, new Set([PDF.key, AUDIO.key]), results);
  assert.deepEqual(narrow.losers.map((l) => l.key), [AUDIO.key]);
  assert.deepEqual([...narrow.wins.keys()].sort(), [PDF.key, AUDIO.key].sort());
  assert.deepEqual(analyse(index, SCOPE, []).losers, []);
});

test('a contested prompt is recorded against the pair of skills that fought for it', () => {
  const index = new Index(ALL);
  const results = [
    made([ranked(PDF.key, 6), ranked(AUDIO.key, 0)], 'clear'),
    made([ranked(PRINT.key, 5), ranked(AUDIO.key, 4.5)], 'contested'),
    made([ranked(AUDIO.key, 5), ranked(PRINT.key, 4.5)], 'contested'),
  ];
  const a = analyse(index, SCOPE, results);
  assert.equal(a.pairs.length, 1);
  assert.equal(a.pairs[0].a, PRINT.key);
  assert.equal(a.pairs[0].b, AUDIO.key);
  assert.deepEqual(a.pairs[0].prompts, [1, 2]);
  assert.deepEqual(a.pairs[0].shared, ['word0', 'word1']);
});

test('skills with the same wording are reported as similar and unrelated ones are not', () => {
  const twin = skill('other/pdf-merge', 'pdf-merge', PDF.description);
  const index = new Index([PDF, twin, AUDIO, PRINT, BLANK]);
  const scope = new Set([...SCOPE, twin.key]);
  const pairs = similarPairs(index, scope);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b].sort(), [PDF.key, twin.key].sort());
  assert.ok(Math.abs(pairs[0].similarity - 1) < 1e-9);
  assert.ok(pairs[0].shared.length > 0 && pairs[0].shared.length <= 6);
  assert.deepEqual(similarPairs(index, new Set([PDF.key, AUDIO.key, PRINT.key, BLANK.key])), []);
});

test('trying a new description changes the ranking without changing the index', () => {
  const index = new Index(ALL);
  const text = 'bake a chocolate cake';
  const before = index.rank(text);
  const tried = index.rankWith(text, BLANK.key, 'Bake a chocolate cake from a recipe.');
  assert.equal(tried[0].key, BLANK.key);
  assert.ok(tried[0].score > 0);
  assert.equal(scoreOf(before, BLANK.key), 0);
  assert.deepEqual(index.rank(text), before);
  assert.equal(BLANK.description, '');
});

test('trying a description for an unknown skill ranks as usual', () => {
  const index = new Index(ALL);
  const text = 'merge pdf documents';
  assert.deepEqual(index.rankWith(text, 'no/such', 'merge pdf documents'), index.rank(text));
});

test('first sentence stops at the first full stop and tidies white space', () => {
  assert.equal(firstSentence('Export artwork as CMYK TIFF files.  Use it for print shops.'), 'Export artwork as CMYK TIFF files.');
  assert.equal(firstSentence('  Merge   and\nsplit PDF documents  '), 'Merge and split PDF documents');
  assert.equal(firstSentence(''), '');
  assert.equal(firstSentence('x'.repeat(500)).length, 200);
});
