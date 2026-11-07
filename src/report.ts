import type { Analysis, SkillDoc } from './model';

export interface ReportMeta {
  appVersion: string;
  scope: string;
  copies: boolean;
  when: string;
}

const VERDICT = { clear: 'clear', contested: 'contested', weak: 'weak', none: 'no match' } as const;

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

export function label(skills: Map<string, SkillDoc>, key: string): string {
  const s = skills.get(key);
  return s ? `${s.name} (${s.appName})` : key;
}

export function toJson(a: Analysis, skills: Map<string, SkillDoc>, meta: ReportMeta): unknown {
  const ref = (key: string) => {
    const s = skills.get(key);
    return s ? { app: s.app, skill: s.folder, name: s.name } : { app: '', skill: key, name: key };
  };
  return {
    format: 'trigger-tester-report',
    format_version: 1,
    model: { kind: 'bm25', k1: 1.2, b: 0.75, fields: ['name x2', 'description'], bigrams: true },
    formskills: meta.appVersion,
    scope: meta.scope,
    copies: meta.copies,
    made: meta.when,
    skills: skills.size,
    summary: {
      prompts: a.results.length,
      clear: a.results.filter((r) => r.verdict === 'clear').length,
      contested: a.results.filter((r) => r.verdict === 'contested').length,
      weak: a.results.filter((r) => r.verdict === 'weak').length,
      none: a.results.filter((r) => r.verdict === 'none').length,
      expected: a.expected,
      hits: a.hits,
    },
    prompts: a.results.map((r) => ({
      prompt: r.prompt.text,
      expect: r.prompt.expect || null,
      verdict: r.verdict,
      runner_up_share: Number(r.share.toFixed(3)),
      hit: r.hit,
      top: r.top.map((t) => ({ ...ref(t.key), score: Number(t.score.toFixed(3)), terms: t.terms.slice(0, 6).map((x) => x.term) })),
    })),
    overlaps: a.pairs.map((p) => ({ a: ref(p.a), b: ref(p.b), contested_prompts: p.prompts.length, description_similarity: Number(p.similarity.toFixed(3)), shared: p.shared })),
    never_wins: a.losers.map((l) => ({ ...ref(l.key), reason: l.reason, best_rank: l.bestRank || null, best_prompt: l.bestPrompt >= 0 ? a.results[l.bestPrompt].prompt.text : null, distinctive: l.distinctive })),
  };
}

export function toMarkdown(a: Analysis, skills: Map<string, SkillDoc>, meta: ReportMeta): string {
  const name = (k: string) => label(skills, k);
  const out: string[] = [];
  const count = (v: string) => a.results.filter((r) => r.verdict === v).length;
  out.push('# Trigger report', '');
  out.push(`Made ${meta.when} with Trigger Tester in formskills ${meta.appVersion}. Scope: ${meta.scope}, ${skills.size} skills${meta.copies ? ', your copies\' descriptions where you have them' : ''}. Model: BM25 (k1 1.2, b 0.75) over each skill's name (counted twice) and description, words and word pairs.`, '');
  out.push(`- Prompts: ${a.results.length}`);
  out.push(`- Clear winner: ${count('clear')}`);
  out.push(`- Contested (runner-up at 80% or more of the winner): ${count('contested')}`);
  out.push(`- Weak (the winner matched one word and scored under 4): ${count('weak')}`);
  out.push(`- No skill matched: ${count('none')}`);
  if (a.expected) out.push(`- Expected skill won: ${a.hits} of ${a.expected}`);
  out.push('', '## Prompts', '', '| # | Prompt | Winner | Runner-up | Verdict | Expected |', '|---|---|---|---|---|---|');
  a.results.forEach((r, i) => {
    const w = r.verdict === 'none' ? '' : `${name(r.top[0].key)} ${r.top[0].score.toFixed(2)}`;
    const s = r.top[1] && r.top[1].score > 0 ? `${name(r.top[1].key)} ${r.top[1].score.toFixed(2)}` : '';
    const e = r.hit === null ? '' : `${r.hit ? 'yes' : 'no'}: ${r.expected && skills.has(r.expected) ? name(r.expected) : r.expected ?? ''}`;
    out.push(`| ${i + 1} | ${cell(r.prompt.text)} | ${cell(w)} | ${cell(s)} | ${VERDICT[r.verdict]} | ${cell(e)} |`);
  });
  out.push('', '## Skills that fight for the same prompts', '');
  if (!a.pairs.length) out.push('None found.');
  for (const p of a.pairs) {
    const why = [p.prompts.length ? `${p.prompts.length} contested prompt${p.prompts.length === 1 ? '' : 's'}` : '', p.similarity ? `descriptions ${Math.round(p.similarity * 100)}% alike` : ''].filter(Boolean).join(', ');
    out.push(`- ${name(p.a)} and ${name(p.b)}: ${why}${p.shared.length ? `; shared words: ${p.shared.join(', ')}` : ''}`);
  }
  out.push('', '## Skills that never win', '');
  if (!a.results.length) out.push('Run some prompts to find them.');
  else if (!a.losers.length) out.push('Every skill won at least one prompt.');
  for (const l of a.losers) {
    const why = l.reason === 'no-description' ? 'it has no description' : l.reason === 'never-matched' ? 'no prompt shared a word with it' : `best place was ${l.bestRank} for "${cell(a.results[l.bestPrompt].prompt.text)}"`;
    out.push(`- ${name(l.key)}: ${why}${l.distinctive.length ? `; words only it uses: ${l.distinctive.join(', ')}` : ''}`);
  }
  out.push('');
  return out.join('\n');
}
