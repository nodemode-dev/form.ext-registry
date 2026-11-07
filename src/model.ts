export interface SkillDoc {
  key: string;
  app: string;
  appName: string;
  folder: string;
  name: string;
  description: string;
  fromCopy: boolean;
}

export interface Prompt {
  text: string;
  expect: string;
}

export interface Term {
  term: string;
  weight: number;
}

export interface Ranked {
  key: string;
  score: number;
  terms: Term[];
}

export interface PromptResult {
  prompt: Prompt;
  top: Ranked[];
  verdict: 'clear' | 'contested' | 'weak' | 'none';
  share: number;
  expected: string | null;
  hit: boolean | null;
}

export interface Pair {
  a: string;
  b: string;
  prompts: number[];
  similarity: number;
  shared: string[];
}

export interface Loser {
  key: string;
  bestRank: number;
  bestPrompt: number;
  distinctive: string[];
  reason: 'no-description' | 'never-top' | 'never-matched';
}

export interface Analysis {
  results: PromptResult[];
  pairs: Pair[];
  losers: Loser[];
  wins: Map<string, number>;
  expected: number;
  hits: number;
}

const STOP = new Set(
  'a an and are as at be been but by can could do does for from has have how i if in into is it its me my of on or our so than that the their them then there these they this to too use used uses using via was we what when where which while who why will with would you your yours also any all each etc eg ie only just like such other more most many very well even may might must should shall get gets make makes made want wants need needs help helps whenever user users ask asks asked mention mentions mentioned say says said trigger triggers even not no'.split(' '),
);

const CONTESTED = 0.8;
const FLOOR = 0.5;
const WEAK = 4;
const NAME_BOOST = 2;
const SIMILAR = 0.3;
const K1 = 1.2;
const B = 0.75;

export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) w = w.slice(0, -2);
  else if (w.length > 4 && /(ches|shes|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
  return w;
}

export function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/colour/g, 'color').split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export function terms(text: string): string[] {
  const w = words(text);
  const out = w.slice();
  for (let i = 0; i + 1 < w.length; i++) out.push(`${w[i]} ${w[i + 1]}`);
  return out;
}

function docTerms(s: SkillDoc): string[] {
  const nameTerms = terms(`${s.name.replace(/[-_]/g, ' ')} ${s.folder === s.name ? '' : s.folder.replace(/[-_]/g, ' ')}`);
  const out = terms(s.description);
  for (let i = 0; i < NAME_BOOST; i++) out.push(...nameTerms);
  return out;
}

function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export class Index {
  readonly skills: SkillDoc[];
  private tf: Map<string, number>[];
  private len: number[];
  private avg: number;
  private df = new Map<string, number>();

  constructor(skills: SkillDoc[]) {
    this.skills = skills;
    this.tf = skills.map((s) => counts(docTerms(s)));
    this.len = this.tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length) || 1;
    for (const m of this.tf) for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }

  idf(term: string): number {
    const n = this.skills.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  rank(text: string, tf?: Map<string, number>[]): Ranked[] {
    const tfs = tf ?? this.tf;
    const q = [...new Set(terms(text))];
    const out: Ranked[] = [];
    tfs.forEach((m, i) => {
      let score = 0;
      const hit: Term[] = [];
      const norm = K1 * (1 - B + (B * this.len[i]) / this.avg);
      for (const t of q) {
        const f = m.get(t);
        if (!f) continue;
        const weight = (this.idf(t) * f * (K1 + 1)) / (f + norm);
        score += weight;
        hit.push({ term: t, weight });
      }
      hit.sort((x, y) => y.weight - x.weight);
      out.push({ key: this.skills[i].key, score, terms: hit });
    });
    out.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
    return out;
  }

  rankWith(text: string, key: string, description: string): Ranked[] {
    const i = this.skills.findIndex((s) => s.key === key);
    if (i < 0) return this.rank(text);
    const tf = this.tf.slice();
    tf[i] = counts(docTerms({ ...this.skills[i], description }));
    return this.rank(text, tf);
  }

  vector(i: number): Map<string, number> {
    const v = new Map<string, number>();
    let sum = 0;
    for (const [t, f] of this.tf[i]) {
      if (t.includes(' ')) continue;
      const w = (1 + Math.log(f)) * this.idf(t);
      v.set(t, w);
      sum += w * w;
    }
    const n = Math.sqrt(sum) || 1;
    for (const [t, w] of v) v.set(t, w / n);
    return v;
  }

  distinctive(i: number, most = 5): string[] {
    return [...this.tf[i].keys()]
      .filter((t) => !t.includes(' ') && (this.df.get(t) ?? 0) === 1)
      .sort((a, b) => (this.tf[i].get(b) ?? 0) - (this.tf[i].get(a) ?? 0) || a.localeCompare(b))
      .slice(0, most);
  }
}

export function matchesExpect(s: SkillDoc, expect: string): boolean {
  const e = expect.trim().toLowerCase();
  return e === s.key.toLowerCase() || e === s.folder.toLowerCase() || e === s.name.toLowerCase();
}

export function judge(index: Index, prompt: Prompt, ranked: Ranked[]): PromptResult {
  const top = ranked.slice(0, 3);
  const first = top[0];
  const second = top[1];
  let verdict: PromptResult['verdict'] = 'none';
  let share = 0;
  if (first && first.score >= FLOOR) {
    share = second ? second.score / first.score : 0;
    verdict = share >= CONTESTED ? 'contested' : 'clear';
    if (first.score < WEAK && first.terms.filter((t) => !t.term.includes(' ')).length < 2) verdict = 'weak';
  }
  let expected: string | null = null;
  let hit: boolean | null = null;
  if (prompt.expect) {
    const want = index.skills.find((s) => matchesExpect(s, prompt.expect));
    expected = want ? want.key : prompt.expect;
    hit = !!want && verdict !== 'none' && first.key === want.key;
  }
  return { prompt, top, verdict, share, expected, hit };
}

export function similarPairs(index: Index, scope: Set<string>): Pair[] {
  const idx = index.skills.map((s, i) => (scope.has(s.key) && s.description.trim() ? i : -1)).filter((i) => i >= 0);
  const vecs = new Map(idx.map((i) => [i, index.vector(i)]));
  const out: Pair[] = [];
  for (let x = 0; x < idx.length; x++) {
    for (let y = x + 1; y < idx.length; y++) {
      const va = vecs.get(idx[x])!;
      const vb = vecs.get(idx[y])!;
      let dot = 0;
      const shared: Term[] = [];
      for (const [t, w] of va) {
        const o = vb.get(t);
        if (o) {
          dot += w * o;
          shared.push({ term: t, weight: w * o });
        }
      }
      if (dot < SIMILAR) continue;
      shared.sort((p, q) => q.weight - p.weight);
      out.push({ a: index.skills[idx[x]].key, b: index.skills[idx[y]].key, prompts: [], similarity: dot, shared: shared.slice(0, 6).map((s) => s.term) });
    }
  }
  return out;
}

export function analyse(index: Index, scope: Set<string>, results: PromptResult[]): Analysis {
  const wins = new Map<string, number>();
  for (const k of scope) wins.set(k, 0);
  const pairMap = new Map<string, Pair>();
  for (const p of similarPairs(index, scope)) pairMap.set(`${p.a}|${p.b}`, p);
  const best = new Map<string, { rank: number; prompt: number }>();
  results.forEach((r, n) => {
    if (r.verdict !== 'none') wins.set(r.top[0].key, (wins.get(r.top[0].key) ?? 0) + 1);
    r.top.forEach((t, rank) => {
      if (t.score < FLOOR) return;
      const had = best.get(t.key);
      if (!had || rank < had.rank) best.set(t.key, { rank, prompt: n });
    });
    if (r.verdict === 'contested') {
      const [a, b] = [r.top[0].key, r.top[1].key].sort();
      const id = `${a}|${b}`;
      const pair = pairMap.get(id) ?? { a, b, prompts: [], similarity: 0, shared: [] };
      pair.prompts.push(n);
      if (!pair.shared.length) {
        const bt = new Set(r.top[1].terms.map((t) => t.term));
        pair.shared = r.top[0].terms.filter((t) => bt.has(t.term)).map((t) => t.term).slice(0, 6);
      }
      pairMap.set(id, pair);
    }
  });
  const pairs = [...pairMap.values()].sort((p, q) => q.prompts.length - p.prompts.length || q.similarity - p.similarity);
  const losers: Loser[] = [];
  if (results.length) {
    index.skills.forEach((s, i) => {
      if (!scope.has(s.key) || (wins.get(s.key) ?? 0) > 0) return;
      const b = best.get(s.key);
      const reason: Loser['reason'] = !s.description.trim() ? 'no-description' : b ? 'never-top' : 'never-matched';
      losers.push({ key: s.key, bestRank: b ? b.rank + 1 : 0, bestPrompt: b ? b.prompt : -1, distinctive: index.distinctive(i), reason });
    });
  }
  const withExpect = results.filter((r) => r.hit !== null);
  return { results, pairs, losers, wins, expected: withExpect.length, hits: withExpect.filter((r) => r.hit).length };
}

export function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,220}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 200)).trim();
}
