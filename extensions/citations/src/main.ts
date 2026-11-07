import { formext, fromBase64, FormExtError, ERR, type Activation, type Hello } from './formext';
import { parseBibtex } from './bibtex';
import { parseCslJson } from './csljson';
import { Cancelled, type Item, type Job, type Library } from './model';
import { build, citationText, findSection, firstUse, groupText, scan, type Snapshot } from './page';
import { STYLES, type StyleId } from './styles';

const LIB_KEY = 'library';
const PREFS_KEY = 'prefs';
const BIB_PREFIX = 'bib.';
const STORE_LIMIT = 200_000;
const SHOW = 200;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  app: $('app'),
  styleBtns: [...document.querySelectorAll<HTMLButtonElement>('.cx-seg-btn')],
  importBtn: $<HTMLButtonElement>('import'),
  libStatus: $('lib-status'),
  progress: $('progress'),
  bar: $('bar'),
  cancel: $<HTMLButtonElement>('cancel'),
  search: $<HTMLInputElement>('search'),
  entries: $<HTMLUListElement>('entries'),
  entriesEmpty: $('entries-empty'),
  locator: $<HTMLInputElement>('locator'),
  cite: $<HTMLButtonElement>('cite'),
  citeLabel: $('cite-label'),
  citeAt: $('cite-at'),
  count: $('count'),
  uses: $<HTMLUListElement>('uses'),
  usesEmpty: $('uses-empty'),
  heading: $<HTMLInputElement>('heading'),
  build: $<HTMLButtonElement>('build'),
  buildLabel: $('build-label'),
  buildStatus: $('build-status'),
};

const state = {
  lib: null as Library | null,
  map: new Map<string, Item>(),
  style: 'apa' as StyleId,
  selected: [] as string[],
  snap: null as Snapshot | null,
  canDoc: false,
  canFiles: false,
  job: null as Job | null,
  busy: false,
};

type Tone = 'info' | 'warning' | 'error' | 'success';

function say(el: HTMLElement, text: string, tone: Tone = 'info') {
  el.textContent = text;
  if (tone === 'info') delete el.dataset.tone;
  else el.dataset.tone = tone;
}

function plain(err: unknown): string {
  if (err instanceof FormExtError) {
    if (err.code === ERR.PERMISSION) return 'Citations has not been allowed yet. Allow it from the Extensions panel.';
    if (err.code === ERR.CANCELLED) return 'Cancelled.';
    if (err.code === ERR.UNAVAILABLE) return `Form.md could not do that: ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function authorLine(it: Item) {
  const list = it.author?.length ? it.author : it.editor ?? [];
  const fam = list.map((n) => n.literal ?? [n.particle, n.family].filter(Boolean).join(' ') ?? '');
  const who = fam.length === 0 ? 'No author' : fam.length === 1 ? fam[0] : fam.length === 2 ? `${fam[0]} and ${fam[1]}` : `${fam[0]} et al.`;
  const year = it.issued?.year ?? it.issued?.literal ?? 'n.d.';
  return `${who} (${year})`;
}

function haystack(it: Item) {
  const names = [...(it.author ?? []), ...(it.editor ?? [])].map((n) => `${n.literal ?? ''} ${n.given ?? ''} ${n.particle ?? ''} ${n.family ?? ''}`).join(' ');
  return fold(`${it.id} ${names} ${it.title ?? ''} ${it.container ?? ''} ${it.issued?.year ?? ''}`);
}

const hayCache = new WeakMap<Item, string>();

const CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function row(it: Item) {
  const li = document.createElement('li');
  li.className = 'cx-item';
  li.setAttribute('role', 'option');
  li.tabIndex = 0;
  li.dataset.key = it.id;
  li.setAttribute('aria-selected', String(state.selected.includes(it.id)));
  const check = document.createElement('span');
  check.className = 'cx-check';
  check.innerHTML = CHECK;
  const line = document.createElement('span');
  line.className = 'cx-line';
  const who = document.createElement('span');
  who.className = 'cx-who';
  who.textContent = authorLine(it);
  const key = document.createElement('span');
  key.className = 'cx-key';
  key.textContent = it.id;
  line.append(who, key);
  const what = document.createElement('span');
  what.className = 'cx-what';
  what.textContent = it.title ?? it.container ?? '';
  li.append(check, line, what);
  return li;
}

function renderEntries() {
  const items = state.lib?.items ?? [];
  const terms = fold(ui.search.value).split(/\s+/).filter(Boolean);
  const hits: Item[] = [];
  let total = 0;
  for (const it of items) {
    let h = hayCache.get(it);
    if (!h) {
      h = haystack(it);
      hayCache.set(it, h);
    }
    if (terms.every((t) => h!.includes(t))) {
      total++;
      if (hits.length < SHOW) hits.push(it);
    }
  }
  const frag = document.createDocumentFragment();
  for (const it of hits) frag.append(row(it));
  if (total > hits.length) {
    const more = document.createElement('li');
    more.className = 'cx-more';
    more.textContent = `Showing ${hits.length} of ${total}. Search to narrow the list.`;
    frag.append(more);
  }
  ui.entries.replaceChildren(frag);
  ui.entriesEmpty.textContent = items.length ? 'Nothing in the library matches that search.' : 'Entries appear here after you import a library.';
}

function syncCite() {
  const n = state.selected.length;
  ui.citeLabel.textContent = n > 1 ? `Cite ${n}` : 'Cite';
  const sel = state.snap?.selection;
  const ready = state.canDoc && !!state.snap?.page && !!state.snap?.writable && !!sel;
  ui.cite.disabled = state.busy || n === 0 || !ready;
  if (!state.snap?.page) say(ui.citeAt, 'Open a page to cite in it.');
  else if (!state.snap.writable) say(ui.citeAt, 'This page is read-only here, so citations cannot be added.', 'warning');
  else if (!sel) say(ui.citeAt, 'Click in the page where the citation goes, then pick entries.');
  else if (n === 0) say(ui.citeAt, 'Pick one or more entries to cite.');
  else {
    const block = state.snap.blocks?.find((b) => b.id === sel.block);
    const at = sel.empty ? sel.from : sel.to;
    const before = (block?.text ?? '').slice(Math.max(0, at - 28), at).replace(/\s+/g, ' ');
    say(ui.citeAt, `Inserts ${citationText(state.selected, ui.locator.value)} after “…${before}”`);
  }
}

function libStatus() {
  const lib = state.lib;
  if (!lib) return say(ui.libStatus, 'No library yet. Import a BibTeX (.bib) or CSL-JSON (.json) file.');
  const skipped = lib.warnings.length ? `, ${lib.warnings.length} skipped (${lib.warnings[0]})` : '';
  say(ui.libStatus, `${lib.items.length} ${lib.items.length === 1 ? 'entry' : 'entries'} from ${lib.source}${skipped}`, lib.warnings.length ? 'warning' : 'info');
}

function storedBib(): Promise<string[]> {
  const id = state.snap?.page?.id;
  if (!id) return Promise.resolve([]);
  return formext.storageGet<string[]>(BIB_PREFIX + id).then((v) => (Array.isArray(v) ? v : []), () => []);
}

async function renderPage() {
  const snap = state.snap;
  const blocks = snap?.blocks ?? [];
  const stored = await storedBib();
  const section = findSection(blocks, stored, ui.heading.value || 'References');
  const groups = scan(blocks, new Set(section));
  const { order } = firstUse(groups);
  const missing = new Set(order.filter((k) => !state.map.has(k)));
  ui.count.textContent = String(order.length);
  const frag = document.createDocumentFragment();
  groups.forEach((g, i) => {
    const li = document.createElement('li');
    li.className = 'cx-use';
    li.tabIndex = 0;
    li.dataset.block = g.block;
    const miss = g.uses.filter((u) => missing.has(u.key));
    li.dataset.missing = String(miss.length > 0);
    const n = document.createElement('span');
    n.className = 'cx-use-n';
    n.textContent = String(i + 1);
    const text = document.createElement('span');
    text.className = 'cx-use-text';
    text.textContent = groupText(state.style, g.uses, state.map, order);
    text.title = citationText(g.uses.map((u) => u.key), '');
    li.append(n, text);
    if (miss.length) {
      const flag = document.createElement('span');
      flag.className = 'cx-use-flag';
      flag.textContent = state.lib ? 'not in library' : 'no library';
      li.append(flag);
    }
    frag.append(li);
  });
  ui.uses.replaceChildren(frag);
  ui.usesEmpty.textContent = snap?.page ? 'No citations yet. Cite an entry, or type [@key] in the page.' : 'Open a page to see its citations.';
  const canBuild = state.canDoc && !!snap?.page && !!snap.writable && !state.busy;
  ui.build.disabled = !canBuild;
  ui.buildLabel.textContent = section.length ? 'Update Bibliography' : 'Build Bibliography';
  if (!state.busy && !ui.buildStatus.dataset.tone) {
    const h = ui.heading.value.trim() || 'References';
    say(ui.buildStatus, section.length ? `Replaces the ${h} section in place as one undo step.` : `Adds a ${h} section at the end of the page as one undo step.`);
  }
  syncCite();
}

async function refresh() {
  if (!state.canDoc) return;
  try {
    state.snap = await formext.readDocument<Snapshot>('all');
  } catch (err) {
    state.snap = null;
    say(ui.buildStatus, plain(err), 'error');
  }
  await renderPage();
}

let refreshTimer = 0;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, 300);
}

function setBusy(on: boolean) {
  state.busy = on;
  ui.app.dataset.state = on ? 'busy' : 'idle';
  ui.importBtn.disabled = on || !state.canFiles;
  syncCite();
  ui.build.disabled = on || !state.canDoc || !state.snap?.page || !state.snap.writable;
}

function showProgress(done: number, total: number) {
  ui.progress.dataset.active = 'true';
  ui.progress.setAttribute('aria-hidden', 'false');
  ui.bar.style.transform = `scaleX(${total ? Math.min(1, done / total) : 0})`;
}

function hideProgress() {
  ui.progress.dataset.active = 'false';
  ui.progress.setAttribute('aria-hidden', 'true');
  ui.bar.style.transform = 'scaleX(0)';
}

function useLibrary(lib: Library) {
  state.lib = lib;
  state.map = new Map(lib.items.map((it) => [it.id, it]));
  state.selected = state.selected.filter((k) => state.map.has(k));
  libStatus();
  renderEntries();
}

async function importLibrary() {
  let files;
  try {
    files = await formext.openFiles(['.bib', '.bibtex', '.json'], false);
  } catch (err) {
    if (!(err instanceof FormExtError && err.code === ERR.CANCELLED)) say(ui.libStatus, plain(err), 'error');
    return;
  }
  const file = files?.[0];
  if (!file) return;
  const job: Job = { cancelled: false };
  state.job = job;
  setBusy(true);
  showProgress(0, 1);
  say(ui.libStatus, `Reading ${file.name}…`);
  try {
    const text = new TextDecoder('utf-8').decode(fromBase64(file.data)).replace(/^﻿/, '');
    const json = /\.json$/i.test(file.name) || /^\s*[[{]/.test(text);
    const lib = json ? await parseCslJson(text, file.name, job, showProgress) : await parseBibtex(text, file.name, job, showProgress);
    if (!lib.items.length) throw new Error(`${file.name} has no references that Citations can read.`);
    useLibrary(lib);
    const payload = { v: 1, source: lib.source, format: lib.format, items: lib.items, warnings: lib.warnings.slice(0, 20) };
    const size = JSON.stringify(payload).length;
    if (size > STORE_LIMIT) {
      say(ui.libStatus, `${lib.items.length} entries from ${lib.source}. This library is too big to remember after the panel closes, so import it again next time.`, 'warning');
    } else {
      await formext.storageSet(LIB_KEY, payload).catch(() => say(ui.libStatus, `${lib.items.length} entries from ${lib.source}. It could not be saved for next time.`, 'warning'));
    }
    await renderPage();
  } catch (err) {
    if (err instanceof Cancelled) say(ui.libStatus, 'Import cancelled. The library was not changed.', 'warning');
    else say(ui.libStatus, plain(err), 'error');
    if (state.lib && err instanceof Cancelled) setTimeout(libStatus, 2500);
  } finally {
    state.job = null;
    hideProgress();
    setBusy(false);
  }
}

async function cite(keys: string[]) {
  const sel = state.snap?.selection;
  if (!sel || !keys.length) return;
  const block = state.snap?.blocks?.find((b) => b.id === sel.block);
  const at = sel.empty ? sel.from : sel.to;
  const prev = (block?.text ?? '').charAt(at - 1);
  const text = (at > 0 && prev && !/[\s([]/.test(prev) ? ' ' : '') + citationText(keys, ui.locator.value);
  setBusy(true);
  try {
    await formext.apply(`Cite ${keys.join(', ')}`, [
      { command: 'doc.select', args: { block: sel.block, from: at, to: at } },
      { command: 'doc.insertText', args: { text, at: 'cursor' } },
    ]);
    state.selected = [];
    ui.locator.value = '';
    for (const li of ui.entries.querySelectorAll('.cx-item')) li.setAttribute('aria-selected', 'false');
    say(ui.buildStatus, '');
  } catch (err) {
    say(ui.citeAt, plain(err), 'error');
  } finally {
    setBusy(false);
  }
  await refresh();
}

export interface BuildResult {
  ok: boolean;
  message: string;
  cited?: number;
  missing?: string[];
}

async function buildBibliography(): Promise<BuildResult> {
  const snap = await formext.readDocument<Snapshot>('all');
  state.snap = snap;
  if (!snap.page) return { ok: false, message: 'Open a page first.' };
  if (!snap.writable) return { ok: false, message: 'This page is read-only here, so the bibliography cannot be written.' };
  if (!state.lib) return { ok: false, message: 'Import a library first.' };
  const blocks = snap.blocks ?? [];
  const heading = ui.heading.value.trim() || 'References';
  const section = findSection(blocks, await storedBib(), heading);
  const { order } = firstUse(scan(blocks, new Set(section)));
  if (!order.length) return { ok: false, message: 'No citations in this page yet. Cite an entry, or type [@key] in the page.' };
  const built = build(state.style, heading, 2, order, state.map);
  if (!built.cited.length) return { ok: false, message: `None of the cited keys are in the library: ${built.missing.slice(0, 5).join(', ')}.`, missing: built.missing };
  const ops = section.length
    ? [{ command: 'doc.replaceBlock', args: { block: section[0], markdown: built.markdown } }, ...section.slice(1).map((block) => ({ command: 'doc.deleteBlock', args: { block } }))]
    : [{ command: 'doc.insertMarkdown', args: { markdown: built.markdown, at: 'end' } }];
  const res = await formext.apply(section.length ? `Update ${heading}` : `Add ${heading}`, ops);
  const first = res.results?.[0] as { blocks?: string[] } | undefined;
  if (Array.isArray(first?.blocks)) await formext.storageSet(BIB_PREFIX + snap.page.id, first.blocks).catch(() => undefined);
  const miss = built.missing.length ? ` ${built.missing.length} cited ${built.missing.length === 1 ? 'key is' : 'keys are'} not in the library: ${built.missing.slice(0, 5).join(', ')}.` : '';
  return { ok: true, message: `${STYLES[state.style].label} bibliography with ${built.cited.length} ${built.cited.length === 1 ? 'entry' : 'entries'}${section.length ? ' updated' : ' added'}. Undo removes it in one step.${miss}`, cited: built.cited.length, missing: built.missing };
}

async function onBuild() {
  setBusy(true);
  say(ui.buildStatus, 'Building…');
  try {
    const r = await buildBibliography();
    say(ui.buildStatus, r.message, !r.ok ? 'warning' : r.missing?.length ? 'warning' : 'success');
  } catch (err) {
    say(ui.buildStatus, plain(err), 'error');
  } finally {
    setBusy(false);
  }
  await refresh();
}

function setStyle(id: StyleId) {
  state.style = id;
  for (const b of ui.styleBtns) b.setAttribute('aria-pressed', String(b.dataset.style === id));
}

function savePrefs() {
  formext.storageSet(PREFS_KEY, { style: state.style, heading: ui.heading.value.trim() || 'References' }).catch(() => undefined);
}

function toggle(li: HTMLElement) {
  const key = li.dataset.key!;
  const on = !state.selected.includes(key);
  state.selected = on ? [...state.selected, key] : state.selected.filter((k) => k !== key);
  li.setAttribute('aria-selected', String(on));
  syncCite();
}

function wire() {
  for (const b of ui.styleBtns)
    b.addEventListener('click', () => {
      setStyle(b.dataset.style as StyleId);
      savePrefs();
      delete ui.buildStatus.dataset.tone;
      renderPage();
    });
  ui.importBtn.addEventListener('click', importLibrary);
  ui.cancel.addEventListener('click', () => {
    if (state.job) state.job.cancelled = true;
  });
  ui.search.addEventListener('input', renderEntries);
  ui.entries.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.cx-item');
    if (li) toggle(li);
  });
  ui.entries.addEventListener('dblclick', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.cx-item');
    if (li && !ui.cite.disabled) cite(state.selected.includes(li.dataset.key!) ? state.selected : [li.dataset.key!]);
  });
  ui.entries.addEventListener('keydown', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.cx-item');
    if (!li) return;
    if (e.key === ' ') {
      e.preventDefault();
      toggle(li);
    } else if (e.key === 'Enter' && !ui.cite.disabled) {
      e.preventDefault();
      cite(state.selected);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling) as HTMLElement | null;
      next?.focus();
    }
  });
  ui.locator.addEventListener('input', syncCite);
  ui.locator.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !ui.cite.disabled) cite(state.selected);
  });
  ui.cite.addEventListener('click', () => cite(state.selected));
  const go = async (li: HTMLElement | null) => {
    if (!li?.dataset.block) return;
    try {
      await formext.apply('Go to citation', [{ command: 'doc.select', args: { block: li.dataset.block } }]);
    } catch (err) {
      say(ui.buildStatus, plain(err), 'error');
    }
  };
  ui.uses.addEventListener('click', (e) => go((e.target as HTMLElement).closest<HTMLElement>('.cx-use')));
  ui.uses.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go((e.target as HTMLElement).closest<HTMLElement>('.cx-use'));
  });
  ui.heading.addEventListener('change', () => {
    savePrefs();
    delete ui.buildStatus.dataset.tone;
    renderPage();
  });
  ui.build.addEventListener('click', onBuild);
}

async function loadStored() {
  const prefs = await formext.storageGet<{ style?: StyleId; heading?: string }>(PREFS_KEY).catch(() => null);
  if (prefs?.style && prefs.style in STYLES) setStyle(prefs.style);
  if (prefs?.heading) ui.heading.value = prefs.heading;
  const lib = await formext.storageGet<{ source: string; format: Library['format']; items: Item[]; warnings?: string[] }>(LIB_KEY).catch(() => null);
  if (lib && Array.isArray(lib.items)) useLibrary({ source: lib.source, format: lib.format, items: lib.items, warnings: lib.warnings ?? [] });
}

async function headless(a: Activation) {
  try {
    const r = await buildBibliography();
    await formext.notify(r.message, r.ok ? (r.missing?.length ? 'warning' : 'success') : 'warning');
    await formext.done(r);
  } catch (err) {
    const message = plain(err);
    await formext.notify(message, 'error').catch(() => undefined);
    await formext.done({ ok: false, message, command: a.command });
  }
}

async function recheck() {
  const hello = await formext.call<Hello>('host.hello').catch(() => null);
  if (!hello) return;
  state.canDoc = hello.permissions.includes('document');
  state.canFiles = hello.permissions.includes('files-read');
  ui.importBtn.disabled = !state.canFiles;
  if (state.canDoc && ui.buildStatus.dataset.tone === 'warning') say(ui.buildStatus, '');
}

const started = (async () => {
  wire();
  const hello = await formext.hello();
  state.canDoc = hello.permissions.includes('document');
  state.canFiles = hello.permissions.includes('files-read');
  ui.importBtn.disabled = !state.canFiles;
  await loadStored();
  if (!state.canDoc) {
    say(ui.buildStatus, 'Citations has not been allowed yet. Allow it from the Extensions panel.', 'warning');
    await renderPage();
    return;
  }
  await refresh();
})();

formext.onActivate(async (a) => {
  if (a.reason === 'command' && a.command === 'update-bibliography') {
    started.catch(() => undefined).then(() => headless(a));
    return null;
  }
  await started.catch(() => undefined);
  if (!state.canDoc) await recheck();
  await refresh();
  return null;
});

formext.onEvent((e) => {
  if (e.name === 'document.changed') refreshSoon();
  else if (e.name === 'selection.changed' && state.snap) {
    const d = e.data as { page?: string; block: string; from: number; to: number; empty: boolean; text: string };
    if (d && d.block) {
      state.snap.selection = { block: d.block, from: d.from, to: d.to, empty: d.empty, text: d.text };
      syncCite();
    }
  }
  return null;
});

started.catch((err) => say(ui.buildStatus, plain(err), 'error'));
