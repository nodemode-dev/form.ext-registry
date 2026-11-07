import { formext, FormExtError, ERR, toBase64, fromBase64, type Hello, type Activation } from './formext';
import { Index, analyse, judge, firstSentence, type Analysis, type SkillDoc, type Prompt, type Ranked, type PromptResult } from './model';
import { parseLines, parseFile, toLines, MAX_PROMPTS } from './prompts';
import { readDescription, writeDescription } from './frontmatter';
import { toJson, toMarkdown, label } from './report';

type Scope = 'all' | 'chosen' | 'yours';
type Tab = 'prompts' | 'overlaps' | 'losers' | 'try';

interface LibSkill { folder: string; name: string; description: string }
interface LibApp { id: string; name: string; skills: LibSkill[] }
interface Library { apps: LibApp[] }
interface Edit { app: string; folder: string; name: string; edited: string[] }
interface Selection { chosen: { id: string; name: string } | null; reading: { app: string; folder: string } | null }
interface FileText { text: string | null }

const OWN = 'yours';
const DESCRIPTION_MAX = 1024;
const CHUNK = 40;
const STORE_LIMIT = 120_000;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  count: $('skill-count'),
  copies: $<HTMLInputElement>('copies'),
  text: $<HTMLTextAreaElement>('prompt-text'),
  run: $<HTMLButtonElement>('run'),
  load: $<HTMLButtonElement>('load'),
  self: $<HTMLButtonElement>('self'),
  cancel: $<HTMLButtonElement>('cancel'),
  bar: $('bar'),
  promptCount: $('prompt-count'),
  sPrompts: $('s-prompts'),
  sClear: $('s-clear'),
  sContested: $('s-contested'),
  sNone: $('s-none'),
  sExpected: $('s-expected'),
  tPrompts: $('t-prompts'),
  tOverlaps: $('t-overlaps'),
  tLosers: $('t-losers'),
  promptList: $('prompt-list'),
  pairList: $('pair-list'),
  loserList: $('loser-list'),
  emptyPrompts: $('empty-prompts'),
  emptyOverlaps: $('empty-overlaps'),
  emptyLosers: $('empty-losers'),
  trySkill: $<HTMLSelectElement>('try-skill'),
  tryText: $<HTMLTextAreaElement>('try-text'),
  trySave: $<HTMLButtonElement>('try-save'),
  tryReset: $<HTMLButtonElement>('try-reset'),
  tryChars: $('try-chars'),
  tryWins: $('try-wins'),
  tryList: $('try-list'),
  status: $('status'),
  saveMd: $<HTMLButtonElement>('save-md'),
  saveJson: $<HTMLButtonElement>('save-json'),
};

const state = {
  hello: null as Hello | null,
  apps: [] as LibApp[],
  own: [] as LibSkill[],
  copies: new Map<string, string>(),
  chosen: '' as string,
  scope: 'all' as Scope,
  useCopies: true,
  tab: 'prompts' as Tab,
  skills: new Map<string, SkillDoc>(),
  index: null as Index | null,
  analysis: null as Analysis | null,
  ranked: [] as Ranked[][],
  work: 0,
  busy: false,
  tryKey: '',
};

function can(p: string): boolean {
  return !!state.hello?.permissions.includes(p as never);
}

function say(message: string, kind: '' | 'error' | 'ok' = ''): void {
  ui.status.textContent = message;
  ui.status.classList.toggle('is-error', kind === 'error');
  ui.status.classList.toggle('is-ok', kind === 'ok');
}

function plain(e: unknown, doing: string): string {
  if (e instanceof FormExtError) {
    if (e.code === ERR.CANCELLED) return `${doing}: cancelled.`;
    if (e.code === ERR.PERMISSION) return `${doing}: Trigger Tester was not allowed to do that. Allow it in the Extensions panel.`;
    if (e.code === ERR.UNAVAILABLE) return `${doing}: not available here (${e.message}).`;
    return `${doing}: ${e.message}`;
  }
  return `${doing}: ${e instanceof Error ? e.message : String(e)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function progress(f: number): void {
  ui.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
}

function setBusy(on: boolean): void {
  state.busy = on;
  ui.run.disabled = on || !can('document');
  ui.self.disabled = on || !can('document');
  ui.load.disabled = on || !can('files-read');
  ui.cancel.disabled = !on;
  if (!on) progress(0);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function buildSkills(): void {
  const all = new Map<string, SkillDoc>();
  for (const app of state.apps) {
    if (app.id === OWN) continue;
    for (const s of app.skills) {
      const key = `${app.id}/${s.folder}`;
      const copy = state.useCopies ? state.copies.get(key) : undefined;
      all.set(key, { key, app: app.id, appName: app.name, folder: s.folder, name: s.name || s.folder, description: copy ?? s.description ?? '', fromCopy: copy !== undefined });
    }
  }
  for (const s of state.own) {
    const key = `${OWN}/${s.folder}`;
    all.set(key, { key, app: OWN, appName: 'Your skills', folder: s.folder, name: s.name || s.folder, description: s.description ?? '', fromCopy: false });
  }
  const scoped = new Map<string, SkillDoc>();
  for (const [k, s] of all) {
    if (state.scope === 'all' || (state.scope === 'yours' && s.app === OWN) || (state.scope === 'chosen' && s.app === state.chosen)) scoped.set(k, s);
  }
  state.skills = scoped;
  state.index = new Index([...scoped.values()]);
  const copies = [...scoped.values()].filter((s) => s.fromCopy).length;
  const where = state.scope === 'chosen' ? (state.chosen ? ` in ${appLabel(state.chosen)}` : ': choose an app in formskills') : '';
  ui.count.textContent = `${scoped.size} skill${scoped.size === 1 ? '' : 's'}${where}${copies ? `, ${copies} from your copies` : ''}`;
  fillTrySelect();
}

function appLabel(id: string): string {
  if (id === OWN) return 'Your skills';
  return state.apps.find((a) => a.id === id)?.name ?? id;
}

async function loadCopies(token: number): Promise<void> {
  state.copies.clear();
  if (!state.useCopies) return;
  const edits = ((await formext.readDocument<{ edits: Edit[] }>('edits'))?.edits ?? []).filter((e) => e.edited.includes('SKILL.md'));
  for (let i = 0; i < edits.length; i++) {
    if (token !== state.work) return;
    const e = edits[i];
    say(`Reading your copies: ${i + 1} of ${edits.length}`);
    progress((i + 1) / edits.length);
    try {
      const f = await formext.run<FileText>('edit-read', { app: e.app, skill: e.folder, path: 'SKILL.md' });
      const d = f.text === null ? null : readDescription(f.text);
      if (d !== null) state.copies.set(`${e.app}/${e.folder}`, d);
    } catch {
      continue;
    }
  }
}

async function loadLibrary(withCopies: boolean): Promise<boolean> {
  const token = ++state.work;
  setBusy(true);
  try {
    say('Reading the library.');
    const lib = await formext.readDocument<Library>('library');
    state.apps = lib?.apps ?? [];
    try {
      state.own = (await formext.readDocument<{ skills: LibSkill[] }>('own'))?.skills ?? [];
    } catch {
      state.own = [];
    }
    try {
      state.chosen = (await formext.readDocument<Selection>('selection'))?.chosen?.id ?? '';
    } catch {
      state.chosen = '';
    }
    if (withCopies) await loadCopies(token);
    if (token !== state.work) return false;
    buildSkills();
    say(state.skills.size ? 'Ready. Paste prompts and press Run.' : 'No skills in this scope yet.');
    return true;
  } catch (e) {
    say(plain(e, 'Could not read the library'), 'error');
    return false;
  } finally {
    if (token === state.work) setBusy(false);
  }
}

function prompts(): Prompt[] {
  return parseLines(ui.text.value).slice(0, MAX_PROMPTS);
}

function updatePromptCount(): void {
  const all = parseLines(ui.text.value);
  const withExpect = all.filter((p) => p.expect).length;
  ui.promptCount.textContent = `${all.length} prompt${all.length === 1 ? '' : 's'}${withExpect ? `, ${withExpect} with an expected skill` : ''}${all.length > MAX_PROMPTS ? `, first ${MAX_PROMPTS} run` : ''}`;
}

async function run(): Promise<void> {
  if (state.busy || !state.index) return;
  const list = prompts();
  if (!list.length) {
    say('Write at least one prompt first.', 'error');
    ui.text.focus();
    return;
  }
  if (!state.skills.size) {
    say('There are no skills in this scope to rank.', 'error');
    return;
  }
  const token = ++state.work;
  setBusy(true);
  const index = state.index;
  const results: PromptResult[] = [];
  const ranked: Ranked[][] = [];
  try {
    for (let i = 0; i < list.length; i++) {
      if (token !== state.work) {
        say('Cancelled. The last results are kept.');
        return;
      }
      const r = index.rank(list[i].text);
      ranked.push(r);
      results.push(judge(index, list[i], r));
      if (i % CHUNK === CHUNK - 1) {
        progress((i + 1) / list.length);
        say(`Ranking ${i + 1} of ${list.length}`);
        await tick();
      }
    }
    state.ranked = ranked;
    state.analysis = analyse(index, new Set(state.skills.keys()), results);
    render();
    const a = state.analysis;
    say(`Ranked ${list.length} prompt${list.length === 1 ? '' : 's'} against ${state.skills.size} skills. ${a.pairs.length} overlap${a.pairs.length === 1 ? '' : 's'}, ${a.losers.length} never win${a.losers.length === 1 ? 's' : ''}.`, 'ok');
  } finally {
    if (token === state.work) setBusy(false);
  }
}

function openSkill(key: string): void {
  const s = state.skills.get(key);
  if (!s) return;
  formext.run('open-skill', { app: s.app, skill: s.folder }).then(
    () => say(`Opened ${s.name} in formskills.`),
    (e) => say(plain(e, `Could not open ${s.name}`), 'error'),
  );
}

function candRow(box: HTMLElement, t: Ranked, max: number, first: boolean): void {
  const s = state.skills.get(t.key);
  const b = el('button', `cand${first ? ' is-first' : ''}`);
  b.type = 'button';
  b.title = s ? `${s.description || 'No description'}\n\nOpen in formskills` : t.key;
  b.append(el('b', '', s?.name ?? t.key), el('small', '', `${s?.appName ?? ''}${s?.fromCopy ? ', your copy' : ''}`));
  b.addEventListener('click', () => openSkill(t.key));
  const meter = el('span', 'meter');
  const fill = el('i');
  fill.style.width = `${max > 0 ? Math.round((t.score / max) * 100) : 0}%`;
  meter.append(fill);
  const words = el('span', 'words');
  for (const w of t.terms.slice(0, 5)) words.append(el('span', 'word', w.term));
  box.append(b, meter, el('span', 'score', t.score.toFixed(2)), words);
}

const VERDICT_TEXT = { clear: 'clear', contested: 'contested', weak: 'weak', none: 'no match' } as const;

function render(): void {
  const a = state.analysis;
  const results = a?.results ?? [];
  const n = (v: string) => results.filter((r) => r.verdict === v).length;
  ui.sPrompts.textContent = String(results.length);
  ui.sClear.textContent = String(n('clear'));
  ui.sContested.textContent = String(n('contested'));
  ui.sNone.textContent = String(n('none') + n('weak'));
  ui.sExpected.textContent = a?.expected ? `${a.hits} / ${a.expected}` : '0 / 0';
  ui.tPrompts.textContent = String(results.length);
  ui.tOverlaps.textContent = String(a?.pairs.length ?? 0);
  ui.tLosers.textContent = String(a?.losers.length ?? 0);

  const pl = document.createDocumentFragment();
  results.forEach((r, i) => {
    const li = el('li', `res v-${r.verdict}`);
    const head = el('div', 'head');
    head.append(el('span', 'num', String(i + 1)), el('span', 'ptext', r.prompt.text), el('span', `tag tag-${r.verdict}`, r.verdict === 'contested' ? `contested ${Math.round(r.share * 100)}%` : VERDICT_TEXT[r.verdict]));
    if (r.hit !== null) {
      const want = r.expected && state.skills.has(r.expected) ? state.skills.get(r.expected)!.name : r.expected ?? '';
      const tag = el('span', `tag ${r.hit ? 'tag-hit' : 'tag-miss'}`, r.hit ? 'expected won' : `expected ${want}${state.skills.has(r.expected ?? '') ? '' : ' (not in scope)'}`);
      head.append(tag);
    }
    li.append(head);
    const shown = r.top.filter((t) => t.score > 0);
    if (shown.length) {
      const cands = el('div', 'cands');
      shown.forEach((t, k) => candRow(cands, t, shown[0].score, k === 0 && r.verdict !== 'none'));
      li.append(cands);
    } else li.append(el('span', 'why', 'No skill shares a word with this prompt.'));
    pl.append(li);
  });
  ui.promptList.replaceChildren(pl);
  ui.emptyPrompts.hidden = results.length > 0;

  const pr = document.createDocumentFragment();
  for (const p of a?.pairs ?? []) {
    const li = el('li', 'pair');
    const head = el('div', 'head');
    head.append(el('b', '', label(state.skills, p.a)), el('span', 'vs', 'and'), el('b', '', label(state.skills, p.b)));
    const why = [p.prompts.length ? `${p.prompts.length} contested prompt${p.prompts.length === 1 ? '' : 's'}` : '', p.similarity ? `descriptions ${Math.round(p.similarity * 100)}% alike` : ''].filter(Boolean).join(', ');
    head.append(el('span', 'tag tag-contested', why));
    li.append(head);
    if (p.shared.length) {
      const words = el('span', 'words');
      words.append(el('span', 'why', 'Shared words'));
      for (const w of p.shared) words.append(el('span', 'word', w));
      li.append(words);
    }
    if (p.prompts.length) li.append(el('span', 'why', `For example: ${results[p.prompts[0]].prompt.text}`));
    pr.append(li);
  }
  ui.pairList.replaceChildren(pr);
  ui.emptyOverlaps.hidden = (a?.pairs.length ?? 0) > 0;

  const lr = document.createDocumentFragment();
  for (const l of a?.losers ?? []) {
    const s = state.skills.get(l.key)!;
    const li = el('li', 'loser');
    const head = el('div', 'head');
    const open = el('button', 'cand');
    open.type = 'button';
    open.append(el('b', '', s.name), el('small', '', s.appName));
    open.addEventListener('click', () => openSkill(l.key));
    const why = l.reason === 'no-description' ? 'no description' : l.reason === 'never-matched' ? 'never matched' : `best place ${l.bestRank}`;
    head.append(open, el('span', 'tag tag-none', why));
    const tryIt = el('button', 'btn btn-small btn-quiet', 'Try a description');
    tryIt.type = 'button';
    tryIt.addEventListener('click', () => {
      ui.trySkill.value = l.key;
      chooseTry(l.key);
      setTab('try');
    });
    head.append(tryIt);
    li.append(head);
    if (l.bestPrompt >= 0) li.append(el('span', 'why', `Came closest on: ${results[l.bestPrompt].prompt.text}`));
    if (l.distinctive.length) {
      const words = el('span', 'words');
      words.append(el('span', 'why', 'Words only it uses'));
      for (const w of l.distinctive) words.append(el('span', 'word', w));
      li.append(words);
    }
    lr.append(li);
  }
  ui.loserList.replaceChildren(lr);
  ui.emptyLosers.hidden = (a?.losers.length ?? 0) > 0;
  if (a && results.length && !a.losers.length) ui.emptyLosers.textContent = 'Every skill in scope won at least one prompt.';

  ui.saveMd.disabled = !a || !can('files-write');
  ui.saveJson.disabled = !a || !can('files-write');
  renderTry();
}

function setTab(tab: Tab): void {
  state.tab = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.hidden = v.dataset.view !== tab;
  remember();
}

function setScope(scope: Scope): void {
  state.scope = scope;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
  if (state.apps.length || state.own.length) {
    buildSkills();
    if (state.analysis) void run();
  }
  remember();
}

function fillTrySelect(): void {
  const keep = state.tryKey;
  const opts = [...state.skills.values()].sort((a, b) => a.name.localeCompare(b.name) || a.app.localeCompare(b.app));
  const frag = document.createDocumentFragment();
  const none = el('option', '', 'Choose a skill');
  none.value = '';
  frag.append(none);
  for (const s of opts) {
    const o = el('option', '', `${s.name} (${s.appName})`);
    o.value = s.key;
    frag.append(o);
  }
  ui.trySkill.replaceChildren(frag);
  ui.trySkill.value = state.skills.has(keep) ? keep : '';
  if (!state.skills.has(keep)) chooseTry('');
}

function chooseTry(key: string): void {
  state.tryKey = key;
  const s = state.skills.get(key);
  ui.tryText.disabled = !s;
  ui.tryText.value = s?.description ?? '';
  renderTry();
}

function winsOf(key: string, ranks: Ranked[][]): number {
  return ranks.filter((r) => r[0] && r[0].key === key && r[0].score >= 0.5).length;
}

function renderTry(): void {
  const s = state.skills.get(state.tryKey);
  const text = ui.tryText.value;
  const chars = [...text].length;
  ui.tryChars.textContent = `${chars} / ${DESCRIPTION_MAX}`;
  ui.tryChars.classList.toggle('over', chars > DESCRIPTION_MAX);
  const changed = !!s && text.replace(/\s+/g, ' ').trim() !== s.description.replace(/\s+/g, ' ').trim();
  ui.tryReset.disabled = !changed;
  ui.trySave.disabled = !changed || !text.trim() || chars > DESCRIPTION_MAX || !can('document') || state.busy;
  ui.trySave.textContent = s?.app === OWN ? 'Save to your skill' : 'Save to my copy';
  const a = state.analysis;
  if (!s || !a || !state.index) {
    ui.tryWins.textContent = s ? 'Run some prompts to see what changes.' : ' ';
    ui.tryList.replaceChildren();
    return;
  }
  const after = a.results.map((r) => state.index!.rankWith(r.prompt.text, s.key, text));
  const before = state.ranked;
  ui.tryWins.textContent = `Wins ${winsOf(s.key, before)} of ${a.results.length} now, ${winsOf(s.key, after)} with this text`;
  const frag = document.createDocumentFragment();
  a.results.forEach((r, i) => {
    const b = before[i]?.findIndex((t) => t.key === s.key) ?? -1;
    const n = after[i].findIndex((t) => t.key === s.key);
    const bs = before[i]?.[b]?.score ?? 0;
    const ns = after[i][n]?.score ?? 0;
    if (b === n && Math.abs(bs - ns) < 0.01) return;
    if (bs === 0 && ns === 0) return;
    const li = el('li', 'delta');
    const head = el('div', 'head');
    const cls = n < b ? 'up' : n > b ? 'down' : '';
    head.append(el('span', 'num', String(i + 1)), el('span', 'ptext', r.prompt.text), el('b', cls, `place ${b + 1} to ${n + 1}`), el('span', 'score', `${bs.toFixed(2)} to ${ns.toFixed(2)}`));
    li.append(head);
    if (n === 0 && after[i][1]) li.append(el('span', 'why', `Runner-up: ${label(state.skills, after[i][1].key)}`));
    else if (n > 0) li.append(el('span', 'why', `Winner: ${label(state.skills, after[i][0].key)}`));
    frag.append(li);
  });
  ui.tryList.replaceChildren(frag);
}

async function saveTry(): Promise<void> {
  const s = state.skills.get(state.tryKey);
  if (!s || state.busy) return;
  const value = ui.tryText.value.replace(/\s+/g, ' ').trim();
  const token = ++state.work;
  setBusy(true);
  try {
    let text: string | null;
    const hasCopy = s.app === OWN || s.fromCopy || (await formext.readDocument<{ edits: Edit[] }>('edits')).edits.some((e) => e.app === s.app && e.folder === s.folder);
    if (hasCopy) text = (await formext.run<FileText>('edit-read', { app: s.app, skill: s.folder, path: 'SKILL.md' })).text;
    else text = (await formext.run<FileText>('read-file', { app: s.app, path: `${s.folder}/SKILL.md` })).text;
    if (text === null) throw new Error('SKILL.md is not text');
    const next = writeDescription(text, value);
    const ops = s.app === OWN ? [] : [{ command: 'edit-start', args: { app: s.app, skill: s.folder } }];
    ops.push({ command: 'edit-write', args: { app: s.app, skill: s.folder, path: 'SKILL.md', text: next } as never });
    ownWriteUntil = Date.now() + 60_000;
    try {
      await formext.apply(`Description of ${s.name}`, ops);
    } finally {
      ownWriteUntil = Date.now() + 3000;
    }
    if (s.app !== OWN) state.copies.set(s.key, value);
    else {
      const own = state.own.find((o) => o.folder === s.folder);
      if (own) own.description = value;
    }
    if (s.app !== OWN && !state.useCopies) {
      state.useCopies = true;
      ui.copies.checked = true;
      remember();
    }
    if (token === state.work) setBusy(false);
    buildSkills();
    ui.trySkill.value = s.key;
    chooseTry(s.key);
    if (state.analysis) await run();
    let checked = '';
    try {
      const rep = await formext.run<{ errors: number; warnings: number }>('check', { app: s.app, skill: s.folder, copy: true });
      checked = rep.errors ? ` Check found ${rep.errors} error${rep.errors === 1 ? '' : 's'}.` : rep.warnings ? ` Check: ${rep.warnings} warning${rep.warnings === 1 ? '' : 's'}.` : ' Check passed.';
    } catch {
      checked = '';
    }
    say(`Saved the description to ${s.app === OWN ? 'your skill' : 'your copy'} of ${s.name}. Undo is in formskills' status line.${checked}`, 'ok');
  } catch (e) {
    say(plain(e, `Could not save the description of ${s.name}`), 'error');
  } finally {
    if (token === state.work) setBusy(false);
  }
}

function meta() {
  return { appVersion: state.hello?.appVersion ?? '', scope: state.scope === 'chosen' ? appLabel(state.chosen) : state.scope === 'yours' ? 'your skills' : 'all apps', copies: state.useCopies, when: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function saveReport(kind: 'md' | 'json'): Promise<void> {
  const a = state.analysis;
  if (!a) return;
  const body = kind === 'md' ? toMarkdown(a, state.skills, meta()) : JSON.stringify(toJson(a, state.skills, meta()), null, 2) + '\n';
  const name = `trigger-report-${stamp()}.${kind}`;
  try {
    say(`Saving ${name}.`);
    const r = await formext.saveFile(name, kind === 'md' ? 'text/markdown' : 'application/json', toBase64(new TextEncoder().encode(body)));
    say(`Saved ${r.name}.`, 'ok');
  } catch (e) {
    say(plain(e, 'Could not save the report'), e instanceof FormExtError && e.code === ERR.CANCELLED ? '' : 'error');
  }
}

function replaceText(area: HTMLTextAreaElement, text: string): void {
  area.focus();
  area.select();
  if (!document.execCommand('insertText', false, text)) area.value = text;
  area.setSelectionRange(0, 0);
  area.scrollTop = 0;
  updatePromptCount();
  remember();
}

async function loadPrompts(): Promise<void> {
  try {
    const [f] = await formext.openFiles(['.txt', '.md', '.json', '.jsonl', '.csv']);
    if (!f) return;
    const list = parseFile(f.name, new TextDecoder().decode(fromBase64(f.data)));
    if (!list.length) {
      say(`${f.name} holds no prompts.`, 'error');
      return;
    }
    replaceText(ui.text, toLines(list));
    say(`Loaded ${list.length} prompt${list.length === 1 ? '' : 's'} from ${f.name}.`);
    await run();
  } catch (e) {
    say(plain(e, 'Could not load prompts'), e instanceof FormExtError && e.code === ERR.CANCELLED ? '' : 'error');
  }
}

function selfTest(): void {
  const list = [...state.skills.values()].filter((s) => s.description.trim()).map((s) => ({ text: firstSentence(s.description), expect: s.key }));
  if (!list.length) {
    say('No skill in scope has a description to test.', 'error');
    return;
  }
  replaceText(ui.text, toLines(list));
  say(`Wrote ${list.length} self-test prompts, one per skill. Each should win its own skill.`);
  void run();
}

let saveTimer = 0;
function remember(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const text = ui.text.value.length <= STORE_LIMIT ? ui.text.value : '';
    void formext.storageSet('state', { prompts: text, scope: state.scope, copies: state.useCopies, tab: state.tab }).catch(() => undefined);
  }, 500);
}

async function restore(): Promise<void> {
  try {
    const s = await formext.storageGet<{ prompts?: string; scope?: Scope; copies?: boolean; tab?: Tab }>('state');
    if (!s || headlessMode) return;
    if (typeof s.prompts === 'string') ui.text.value = s.prompts;
    if (s.scope === 'all' || s.scope === 'chosen' || s.scope === 'yours') {
      state.scope = s.scope;
      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === s.scope));
    }
    if (typeof s.copies === 'boolean') ui.copies.checked = state.useCopies = s.copies;
    if (s.tab === 'prompts' || s.tab === 'overlaps' || s.tab === 'losers' || s.tab === 'try') setTab(s.tab);
  } catch {
    return;
  }
}

async function headless(a: Activation): Promise<void> {
  const args = (a.args && typeof a.args === 'object' ? a.args : {}) as { prompts?: unknown; scope?: unknown; copies?: unknown };
  try {
    state.hello = await formext.hello();
    if (args.scope === 'all' || args.scope === 'chosen' || args.scope === 'yours') state.scope = args.scope;
    if (typeof args.copies === 'boolean') state.useCopies = args.copies;
    if (Array.isArray(args.prompts)) ui.text.value = toLines(args.prompts.map((p) => (typeof p === 'string' ? { text: p, expect: '' } : { text: String((p as Prompt)?.text ?? ''), expect: String((p as Prompt)?.expect ?? '') })).filter((p) => p.text));
    else if (typeof args.prompts === 'string') ui.text.value = args.prompts;
    else ui.text.value = (await formext.storageGet<{ prompts?: string }>('state').catch(() => null))?.prompts ?? '';
    if (!(await loadLibrary(true))) throw new Error(ui.status.textContent ?? 'could not read the library');
    if (!prompts().length) throw new Error('no prompts: pass { "prompts": [...] } or save some in the Trigger Tester panel first');
    await run();
    await formext.done(toJson(state.analysis!, state.skills, meta()));
  } catch (e) {
    await formext.done({ error: e instanceof Error ? e.message : String(e) });
  }
}

function wire(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scope]')) b.addEventListener('click', () => setScope(b.dataset.scope as Scope));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab as Tab));
  ui.copies.addEventListener('change', async () => {
    state.useCopies = ui.copies.checked;
    remember();
    if (await loadLibrary(true)) {
      if (state.analysis) await run();
    }
  });
  ui.run.addEventListener('click', () => void run());
  ui.load.addEventListener('click', () => void loadPrompts());
  ui.self.addEventListener('click', selfTest);
  ui.cancel.addEventListener('click', () => {
    state.work++;
    setBusy(false);
    say('Cancelled.');
  });
  ui.text.addEventListener('input', () => {
    updatePromptCount();
    remember();
  });
  ui.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void run();
    }
  });
  ui.trySkill.addEventListener('change', () => chooseTry(ui.trySkill.value));
  let tryTimer = 0;
  ui.tryText.addEventListener('input', () => {
    clearTimeout(tryTimer);
    tryTimer = window.setTimeout(renderTry, 120);
  });
  ui.tryReset.addEventListener('click', () => chooseTry(state.tryKey));
  ui.trySave.addEventListener('click', () => void saveTry());
  ui.saveMd.addEventListener('click', () => void saveReport('md'));
  ui.saveJson.addEventListener('click', () => void saveReport('json'));
}

let refreshTimer = 0;
let ownWriteUntil = 0;
function onEvent(e: { name: string; data: unknown }): void {
  if (e.name === 'selection.changed') {
    const next = (e.data as Selection | null)?.chosen?.id ?? '';
    if (next === state.chosen) return;
    state.chosen = next;
    if (state.scope === 'chosen' && !state.busy) {
      buildSkills();
      if (state.analysis) void run();
    }
    return;
  }
  if (e.name === 'document.changed') {
    if ((e.data as { reason?: string } | null)?.reason === 'edit' && Date.now() < ownWriteUntil) return;
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
      if (state.busy) return;
      if ((await loadLibrary(true)) && state.analysis) await run();
    }, 300);
  }
}

let headlessMode = false;

async function start(): Promise<void> {
  wire();
  formext.onActivate((a) => {
    if (a.reason === 'command' && a.command === 'rank' && !a.panel && !headlessMode) {
      headlessMode = true;
      void headless(a);
    }
  });
  formext.onEvent(onEvent);
  try {
    state.hello = await formext.hello();
  } catch (e) {
    say(plain(e, 'Could not reach formskills'), 'error');
    return;
  }
  setBusy(false);
  if (!can('document')) {
    say('Trigger Tester needs permission to read the library. Allow it in the Extensions panel.', 'error');
    return;
  }
  if (headlessMode) return;
  await restore();
  if (headlessMode) return;
  updatePromptCount();
  if ((await loadLibrary(true)) && !headlessMode && prompts().length) await run();
}

void start();
