import { decodeText, parseCsv, parseRanges, type Table } from './csv';
import { ERR, FormExtError, formext, fromBase64, toBase64, type Hello } from './formext';
import { CLEAR, KEEP, Cancelled, type Cell, type Mapping, autoMap, rowCells, runJob, unknownTokens } from './merge';
import { PdfDoc } from './pdf/doc';
import { type Field, fillable } from './pdf/form';
import { type HostField, type Summary, type Template, fromFile, fromHost, signature } from './template';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SVG = 'http://www.w3.org/2000/svg';

const ui = {
  tplName: $('tpl-name'),
  tplSub: $('tpl-sub'),
  tplNote: $('tpl-note'),
  tplFile: $<HTMLButtonElement>('tpl-file'),
  csvName: $('csv-name'),
  csvSub: $('csv-sub'),
  csvOpen: $<HTMLButtonElement>('csv-open'),
  pasteToggle: $<HTMLButtonElement>('csv-paste-toggle'),
  pasteBox: $('csv-paste-box'),
  paste: $<HTMLTextAreaElement>('csv-paste'),
  pasteUse: $<HTMLButtonElement>('csv-paste-use'),
  dataMsg: $('data-msg'),
  mapCount: $('map-count'),
  mapEmpty: $('map-empty'),
  mapList: $('map-list'),
  mapAuto: $<HTMLButtonElement>('map-auto'),
  problems: $('pv-problems'),
  prev: $<HTMLButtonElement>('pv-prev'),
  next: $<HTMLButtonElement>('pv-next'),
  rowInput: $<HTMLInputElement>('pv-row'),
  total: $('pv-total'),
  nextProblem: $<HTMLButtonElement>('pv-next-problem'),
  pages: $('pv-pages'),
  svg: $('pv-svg') as unknown as SVGSVGElement,
  paper: $('pv-paper') as unknown as SVGRectElement,
  boxes: $('pv-boxes') as unknown as SVGGElement,
  values: $('pv-values'),
  show: $<HTMLButtonElement>('pv-show'),
  pvMsg: $('pv-msg'),
  pattern: $<HTMLInputElement>('out-pattern'),
  patternHint: $('out-pattern-hint'),
  nameField: $('name-field'),
  rowsInput: $<HTMLInputElement>('out-rows'),
  flatten: $<HTMLInputElement>('out-flatten'),
  make: $<HTMLButtonElement>('make'),
  cancel: $<HTMLButtonElement>('cancel'),
  progress: $('progress'),
  bar: $('bar'),
  makeMsg: $('make-msg'),
};

const PATTERN_HINT = 'Column names in braces, plus {row} and {file}';

interface Prefs {
  mapping: Mapping;
  pattern: string;
  mode: 'zip' | 'combined';
  flatten: boolean;
}

const state = {
  hello: null as Hello | null,
  ready: false,
  canRead: false,
  summary: { open: false } as Summary,
  openTpl: null as Template | null,
  fileTpl: null as Template | null,
  fileKey: '' as string | undefined,
  fileId: '',
  hostFile: null as boolean | null,
  table: null as Table | null,
  tableName: '',
  mapping: {} as Mapping,
  row: 0,
  page: 0,
  focus: '' as string,
  problemRows: [] as number[],
  problemCount: 0,
  job: null as AbortController | null,
  restoring: false,
};

const tpl = () => state.fileTpl ?? state.openTpl;
const stem = (n: string) => n.replace(/\.pdf$/i, '') || 'form';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function say(node: HTMLElement, text: string, kind: '' | 'error' | 'ok' | 'warn' = '') {
  node.textContent = text || ' ';
  node.classList.toggle('is-error', kind === 'error');
  node.classList.toggle('is-ok', kind === 'ok');
  node.classList.toggle('is-warn', kind === 'warn');
}

function words(err: unknown): string {
  if (err instanceof FormExtError) {
    if (err.code === ERR.PERMISSION) return 'formpdf has not allowed this yet. Open the Extensions panel and allow Mail Merge.';
    if (err.code === ERR.CANCELLED) return '';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function sync<T extends Element>(parent: Element, keys: string[], make: (key: string) => T, update: (node: T, key: string) => void) {
  const have = new Map<string, T>();
  for (const c of [...parent.children]) {
    const k = (c as HTMLElement).dataset?.key ?? c.getAttribute('data-key') ?? '';
    if (keys.includes(k)) have.set(k, c as T);
    else c.remove();
  }
  let before: Element | null = parent.firstElementChild;
  for (const k of keys) {
    let node = have.get(k);
    if (!node) {
      node = make(k);
      node.setAttribute('data-key', k);
    }
    if (node !== before) parent.insertBefore(node, before);
    else before = before.nextElementSibling;
    update(node, k);
  }
}

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

let saveTimer = 0;
function savePrefs() {
  const t = tpl();
  if (!t || state.restoring) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const prefs: Prefs = { mapping: state.mapping, pattern: ui.pattern.value, mode: mode(), flatten: ui.flatten.checked };
    formext.storageSet(`prefs:${hash(signature(t))}`, prefs).catch(() => undefined);
  }, 300);
}

async function loadPrefs(): Promise<Prefs | null> {
  const t = tpl();
  if (!t) return null;
  try {
    return await formext.storageGet<Prefs>(`prefs:${hash(signature(t))}`);
  } catch {
    return null;
  }
}

const mode = (): 'zip' | 'combined' => ((document.querySelector('input[name="mode"]:checked') as HTMLInputElement)?.value === 'combined' ? 'combined' : 'zip');

function renderTemplate() {
  const t = tpl();
  const s = state.summary;
  const fillableCount = t ? t.fields.filter(fillable).length : 0;
  if (!state.ready && !t) {
    ui.tplName.textContent = 'Reading the open PDF';
    ui.tplSub.textContent = ' ';
    say(ui.tplNote, '');
  } else if (!state.canRead && !t) {
    ui.tplName.textContent = 'No form loaded';
    ui.tplSub.textContent = 'Load a PDF with form fields';
    say(ui.tplNote, 'Mail Merge cannot read the open document until formpdf allows it, so load the PDF file instead.', 'warn');
  } else if (!t) {
    ui.tplName.textContent = s.open ? s.name ?? 'Open PDF' : 'No PDF open';
    ui.tplSub.textContent = s.open ? 'This PDF has no form fields' : 'Open a PDF with form fields in formpdf';
    say(ui.tplNote, s.open ? 'Add fields in the Prepare form tab, or load another PDF file.' : '');
  } else {
    ui.tplName.textContent = t.name;
    ui.tplSub.textContent = `${plural(fillableCount, 'field')} to fill · ${plural(t.pages.length, 'page')}`;
    if (state.fileTpl && state.fileId) {
      say(ui.tplNote, 'Copies are made from the open PDF as it is now.', 'ok');
    } else if (state.fileTpl) {
      const same = state.openTpl && signature(state.openTpl) === signature(state.fileTpl);
      say(ui.tplNote, same ? 'File loaded. Its fields match the open PDF.' : state.openTpl ? 'File loaded. It is not the PDF open in formpdf, so filling the open PDF is off.' : 'File loaded.', same || !state.openTpl ? 'ok' : 'warn');
    } else if (state.hostFile !== false) {
      say(ui.tplNote, 'Copies are made from the open PDF with every applied change.');
    } else if (s.dirty) {
      say(ui.tplNote, 'Making PDFs reads the saved file. Save your changes first so the copies match what you see.', 'warn');
    } else {
      say(ui.tplNote, 'Making PDFs needs the saved file; you choose it once.');
    }
  }
  ui.tplFile.textContent = 'Use another PDF file';
  ui.tplFile.disabled = !!state.job || !state.hello?.permissions.includes('files-read');
}

function renderData() {
  const t = state.table;
  if (!t) {
    ui.csvName.textContent = 'No data yet';
    ui.csvSub.textContent = 'A CSV file with a header row: one row per filled PDF';
  } else {
    ui.csvName.textContent = state.tableName;
    ui.csvSub.textContent = `${plural(t.rows.length, 'row')} · ${plural(t.columns.length, 'column')}`;
  }
  const canOpen = !!state.hello?.permissions.includes('files-read');
  ui.csvOpen.disabled = !canOpen || !!state.job;
}

const KIND_LABEL: Record<string, string> = { text: 'Text', checkbox: 'Check', radio: 'Choice', combo: 'List', list: 'List' };

function renderMapping() {
  const t = tpl();
  const table = state.table;
  const fields = t ? t.fields.filter(fillable) : [];
  const ready = !!t && !!table && fields.length > 0;
  ui.mapEmpty.hidden = ready;
  ui.mapEmpty.textContent = !t ? 'Load a form and a CSV to match columns to fields.' : !fields.length ? 'This form has no fields to fill.' : 'Choose a CSV to match its columns to these fields.';
  ui.mapAuto.disabled = !ready || !!state.job;
  const matched = fields.filter((f) => (state.mapping[f.name] ?? KEEP) !== KEEP).length;
  ui.mapCount.textContent = `${matched} of ${fields.length}`;
  const columns = table?.columns ?? [];
  const colKey = columns.join('\u0001');
  sync<HTMLDivElement>(
    ui.mapList,
    ready ? fields.map((f) => f.name) : [],
    (key) => {
      const row = el('div', 'mm-map-row');
      row.setAttribute('role', 'listitem');
      const name = el('div', 'mm-fname');
      const text = el('span', 'mm-fname-text', key);
      text.title = key;
      const kind = el('span', 'mm-kind');
      name.append(text, kind);
      const sel = el('select', 'mm-select');
      sel.setAttribute('aria-label', `Column for ${key}`);
      sel.addEventListener('change', () => {
        state.mapping[key] = sel.value;
        savePrefs();
        recount();
        renderMapping();
        renderPreview();
      });
      sel.addEventListener('focus', () => setFocus(key));
      row.append(name, sel);
      return row;
    },
    (row, key) => {
      const f = fields.find((x) => x.name === key)!;
      (row.querySelector('.mm-kind') as HTMLElement).textContent = KIND_LABEL[f.kind] ?? f.kind;
      row.classList.toggle('is-focus', state.focus === key);
      const sel = row.querySelector('select') as HTMLSelectElement;
      if (sel.dataset.cols !== colKey) {
        sel.dataset.cols = colKey;
        sel.replaceChildren();
        const keep = new Option(f.readOnly ? 'Read-only: kept' : "Keep the form's value", KEEP);
        sel.append(keep);
        if (!f.readOnly) {
          sel.append(new Option('Clear it', CLEAR));
          for (const c of columns) sel.append(new Option(c, c));
        }
      }
      sel.disabled = f.readOnly || !!state.job;
      const want = state.mapping[key] ?? KEEP;
      if (sel.value !== want) sel.value = want;
    },
  );
}

function recount() {
  const t = tpl();
  state.problemRows = [];
  state.problemCount = 0;
  if (!t || !state.table) return;
  for (let i = 0; i < state.table.rows.length; i++) {
    const n = rowCells(t, state.table, state.mapping, i).filter((c) => c.check?.problem).length;
    if (n) {
      state.problemRows.push(i);
      state.problemCount += n;
    }
  }
}

function setFocus(name: string) {
  if (state.focus === name) return;
  state.focus = name;
  const t = tpl();
  const shapes = t?.shapes.get(name) ?? [];
  if (shapes.length && !shapes.some((s) => s.page === state.page)) state.page = shapes[0].page;
  renderMapping();
  renderPreview();
}

function display(c: Cell, f: Field): string {
  if (c.input === null) {
    if (f.kind === 'checkbox') return f.value ? 'Checked' : 'Not checked';
    const o = f.options.find((x) => x.value === f.value);
    return o ? o.label : f.value;
  }
  return c.check?.shown ?? '';
}

function renderPreview() {
  const t = tpl();
  const table = state.table;
  const rows = table?.rows.length ?? 0;
  const ready = !!t && !!table && rows > 0;
  if (state.row >= rows) state.row = Math.max(0, rows - 1);
  ui.total.textContent = String(rows);
  ui.rowInput.max = String(Math.max(1, rows));
  if (document.activeElement !== ui.rowInput || ui.rowInput.value !== String(state.row + 1)) ui.rowInput.value = String(state.row + 1);
  ui.rowInput.disabled = !ready;
  ui.prev.disabled = !ready || state.row <= 0;
  ui.next.disabled = !ready || state.row >= rows - 1;
  ui.problems.hidden = !ready || !state.problemCount;
  ui.problems.textContent = `${plural(state.problemCount, 'problem')} in ${plural(state.problemRows.length, 'row')}`;
  ui.nextProblem.hidden = !ready || !state.problemRows.length;

  const cells = ready ? rowCells(t!, table!, state.mapping, state.row) : [];
  const byName = new Map(cells.map((c) => [c.field.name, c]));
  const pagesWithFields = t ? [...new Set([...t.shapes.values()].flat().map((s) => s.page))].sort((a, b) => a - b) : [];
  if (pagesWithFields.length && !pagesWithFields.includes(state.page)) state.page = pagesWithFields[0];
  sync<HTMLButtonElement>(
    ui.pages,
    pagesWithFields.length > 1 ? pagesWithFields.map(String) : [],
    (key) => {
      const b = el('button', 'mm-page', `Page ${Number(key) + 1}`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => {
        state.page = Number(key);
        renderPreview();
      });
      return b;
    },
    (b, key) => b.setAttribute('aria-selected', String(Number(key) === state.page)),
  );

  const size = t?.pages[state.page] ?? { w: 612, h: 792 };
  const vb = `0 0 ${size.w} ${size.h}`;
  if (ui.svg.getAttribute('viewBox') !== vb) {
    ui.svg.setAttribute('viewBox', vb);
    ui.svg.style.aspectRatio = `${size.w} / ${size.h}`;
    ui.paper.setAttribute('width', String(size.w));
    ui.paper.setAttribute('height', String(size.h));
  }
  const boxKeys: string[] = [];
  if (t) for (const f of t.fields) if (fillable(f)) (t.shapes.get(f.name) ?? []).forEach((s, i) => s.page === state.page && boxKeys.push(`${f.name}\u0001${i}`));
  sync<SVGGElement>(
    ui.boxes,
    boxKeys,
    (key) => {
      const g = svg('g', { class: 'mm-box' });
      const title = svg('title');
      const r = svg('rect');
      const inner = svg('svg', { overflow: 'hidden' });
      const text = svg('text');
      const mark = svg('path');
      const dot = svg('circle');
      inner.append(text, mark, dot);
      g.append(title, r, inner);
      g.addEventListener('click', () => {
        const name = key.split('\u0001')[0];
        setFocus(name);
        const sel = ui.mapList.querySelector(`[data-key="${CSS.escape(name)}"] select`) as HTMLSelectElement | null;
        sel?.focus();
      });
      return g;
    },
    (g, key) => {
      const [name, idx] = key.split('\u0001');
      const f = t!.fields.find((x) => x.name === name)!;
      const s = t!.shapes.get(name)![Number(idx)];
      const c = byName.get(name);
      const set = !!c && c.input !== null;
      g.classList.toggle('is-set', set && !c!.check?.problem);
      g.classList.toggle('is-problem', !!c?.check?.problem);
      g.classList.toggle('is-focus', state.focus === name);
      const [title, r, inner] = g.children as unknown as [SVGTitleElement, SVGRectElement, SVGSVGElement];
      title.textContent = name;
      for (const [k, v] of Object.entries({ x: s.x, y: s.y, width: Math.max(1, s.w), height: Math.max(1, s.h) })) {
        r.setAttribute(k, String(v));
        inner.setAttribute(k, String(v));
      }
      const [text, mark, dot] = inner.children as unknown as [SVGTextElement, SVGPathElement, SVGCircleElement];
      let label = '';
      let checked = false;
      if (c) {
        const v = c.input === null ? f.value : c.check?.value ?? '';
        if (f.kind === 'checkbox') checked = c.input === null ? !!f.value && f.value !== 'Off' : v === 'on';
        else if (f.kind === 'radio') checked = !!s.on && (c.input === null ? f.options.find((o) => o.label === f.value || o.value === f.value)?.value === s.on : v === s.on);
        else label = display(c, f);
        if (f.kind === 'combo' || f.kind === 'list') label = c.input !== null && !c.check?.value ? '' : label;
      }
      const fs = Math.max(4, Math.min(11, s.h * 0.62));
      text.setAttribute('x', '3');
      text.setAttribute('y', String(f.multiline ? fs + 2 : s.h / 2 + fs * 0.35));
      text.setAttribute('font-size', String(fs));
      if (text.textContent !== label) text.textContent = label;
      const m = Math.min(s.w, s.h);
      mark.setAttribute('d', checked && f.kind === 'checkbox' ? `M${s.w / 2 - m * 0.28} ${s.h / 2} l${m * 0.2} ${m * 0.22} l${m * 0.36} ${-m * 0.42}` : '');
      mark.setAttribute('stroke-width', String(Math.max(1, m * 0.12)));
      dot.setAttribute('cx', String(s.w / 2));
      dot.setAttribute('cy', String(s.h / 2));
      dot.setAttribute('r', checked && f.kind === 'radio' ? String(m * 0.22) : '0');
    },
  );

  sync<HTMLDivElement>(
    ui.values,
    cells.filter((c) => c.input !== null).map((c) => c.field.name),
    (key) => {
      const row = el('div', 'mm-val');
      row.setAttribute('role', 'listitem');
      const name = el('span', 'mm-val-name', key);
      name.title = key;
      const val = el('span', 'mm-val-text');
      row.append(name, val);
      row.addEventListener('click', () => setFocus(key));
      return row;
    },
    (row, key) => {
      const c = byName.get(key)!;
      row.classList.toggle('is-focus', state.focus === key);
      const val = row.children[1] as HTMLElement;
      const shown = display(c, c.field);
      val.classList.toggle('is-keep', c.input === null);
      val.textContent = shown || (c.source === CLEAR ? 'Cleared' : 'Empty');
      if (c.check?.problem) {
        const p = el('span', 'mm-val-problem', c.check.problem);
        val.append(p);
      }
    },
  );
  const openFields = state.openTpl?.fields.length ?? 0;
  ui.show.disabled = !ready || !state.summary.open || !openFields || !state.canRead || !!state.job || !showable();
}

function showable(): boolean {
  if (!state.openTpl) return false;
  if (!state.fileTpl) return true;
  return signature(state.openTpl) === signature(state.fileTpl);
}

function renderMake() {
  const t = tpl();
  const ready = !!t && !!state.table && state.table.rows.length > 0;
  ui.make.disabled = !ready || !!state.job || !state.hello?.permissions.includes('files-write');
  ui.cancel.hidden = !state.job;
  ui.progress.classList.toggle('is-on', !!state.job);
  const combined = mode() === 'combined';
  ui.nameField.classList.toggle('is-off', combined);
  ui.pattern.disabled = combined || !!state.job;
  ui.rowsInput.disabled = !!state.job;
  ui.flatten.disabled = !!state.job;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.disabled = !!state.job;
  const unknown = state.table ? unknownTokens(ui.pattern.value, state.table) : [];
  ui.patternHint.textContent = unknown.length ? `No column called ${unknown.map((u) => `"${u}"`).join(', ')}; it stays empty` : PATTERN_HINT;
  ui.patternHint.classList.toggle('is-warn', unknown.length > 0);
}

function renderAll() {
  renderTemplate();
  renderData();
  renderMapping();
  renderPreview();
  renderMake();
}

async function readOpen() {
  if (!state.canRead) return;
  let summary: Summary;
  try {
    summary = await formext.readDocument<Summary>('summary');
  } catch (err) {
    if (err instanceof FormExtError && err.code === ERR.PERMISSION) {
      state.canRead = false;
      renderAll();
      return;
    }
    summary = { open: false };
  }
  const keyChanged = summary.key !== state.summary.key;
  state.summary = summary;
  if (!summary.open) {
    state.openTpl = null;
  } else {
    try {
      const res = await formext.readDocument<{ fields: HostField[] }>('fields');
      state.openTpl = res.fields?.length ? fromHost(summary, res.fields) : null;
    } catch {
      state.openTpl = null;
    }
  }
  const stale = (state.fileId && state.fileId !== summary.id) || (keyChanged && state.fileKey && state.fileKey !== summary.key);
  if (state.fileTpl && stale && !state.job) {
    state.fileTpl = null;
    state.fileKey = '';
    state.fileId = '';
  }
  if (keyChanged) await adoptTemplate();
  recount();
  renderAll();
  if (!state.fileTpl && state.table && summary.open && state.hostFile === true && !state.job) void loadFile(true, false);
}

async function adoptTemplate() {
  const t = tpl();
  if (!t) return;
  const prefs = await loadPrefs();
  state.restoring = true;
  if (prefs) {
    ui.pattern.value = prefs.pattern || ui.pattern.value;
    ui.flatten.checked = !!prefs.flatten;
    const r = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${prefs.mode === 'combined' ? 'combined' : 'zip'}"]`);
    if (r) r.checked = true;
  }
  if (state.table) applyMapping(prefs?.mapping);
  state.restoring = false;
}

function applyMapping(saved?: Mapping) {
  const t = tpl();
  if (!t || !state.table) return;
  const cols = new Set(state.table.columns);
  const auto = autoMap(t.fields, state.table.columns);
  const out: Mapping = {};
  for (const f of t.fields.filter(fillable)) {
    const s = saved?.[f.name];
    out[f.name] = s !== undefined && (s === KEEP || s === CLEAR || cols.has(s)) ? s : auto[f.name] ?? KEEP;
  }
  state.mapping = out;
}

async function bytesOfOpen(): Promise<{ name: string; data: Uint8Array } | null> {
  if (!state.canRead || !state.summary.open || state.hostFile === false) return null;
  try {
    const f = await formext.readDocument<{ name?: string; data?: string }>('file');
    if (f && typeof f.data === 'string') {
      state.hostFile = true;
      return { name: f.name ?? state.summary.name ?? 'form.pdf', data: fromBase64(f.data) };
    }
  } catch (err) {
    if (err instanceof FormExtError && (err.code === ERR.INVALID || err.code === ERR.NOT_FOUND)) state.hostFile = false;
  }
  return null;
}

async function loadFile(fromOpen: boolean, picker = true): Promise<boolean> {
  say(ui.tplNote, 'Reading the PDF…');
  try {
    let picked = fromOpen ? await bytesOfOpen() : null;
    const fromHost = !!picked;
    if (!picked && !picker) {
      renderTemplate();
      return false;
    }
    if (!picked) {
      if (fromOpen && state.summary.open) formext.notify(`Choose ${state.summary.name ?? 'the PDF'} so Mail Merge can make filled copies of it.`, 'info').catch(() => undefined);
      const files = await formext.openFiles(['.pdf']);
      if (!files.length) {
        renderTemplate();
        return false;
      }
      picked = { name: files[0].name, data: fromBase64(files[0].data) };
    }
    const doc = await PdfDoc.load(picked.data);
    const t = fromFile(picked.name, doc);
    if (!t.fields.some(fillable)) {
      renderTemplate();
      say(ui.tplNote, `${picked.name} has no form fields to fill. Add fields in the Prepare form tab first.`, 'error');
      return false;
    }
    state.fileTpl = t;
    state.fileKey = state.summary.key;
    state.fileId = fromHost ? state.summary.id ?? '' : '';
    await adoptTemplate();
    if (state.table && !Object.keys(state.mapping).length) applyMapping();
    recount();
    renderAll();
    return true;
  } catch (err) {
    renderTemplate();
    const msg = words(err);
    if (msg) say(ui.tplNote, msg.startsWith('This') ? msg : `Could not read that PDF: ${msg}`, 'error');
    return false;
  }
}

function useTable(t: Table, name: string) {
  if (!t.columns.length) {
    say(ui.dataMsg, `${name} is empty.`, 'error');
    return;
  }
  if (!t.rows.length) {
    say(ui.dataMsg, `${name} has column names but no rows below them.`, 'error');
    return;
  }
  state.table = t;
  state.tableName = name;
  state.row = 0;
  say(ui.pvMsg, '');
  say(ui.makeMsg, '');
  void loadPrefs().then((prefs) => {
    applyMapping(prefs?.mapping);
    if (!prefs && ui.pattern.value === '{file} {row}') {
      const nameCol = t.columns.find((c) => /name/i.test(c));
      if (nameCol) ui.pattern.value = `{${nameCol}}`;
    }
    const matched = Object.values(state.mapping).filter((v) => v !== KEEP).length;
    say(ui.dataMsg, tpl() ? `Matched ${plural(matched, 'field')} by name. Check the list below.` : '', 'ok');
    recount();
    renderAll();
    if (!state.fileTpl && state.canRead && state.summary.open && state.hostFile !== false) void loadFile(true, false);
  });
}

async function chooseCsv() {
  try {
    const files = await formext.openFiles(['.csv', '.tsv', '.txt']);
    if (!files.length) return;
    useTable(parseCsv(decodeText(fromBase64(files[0].data))), files[0].name);
  } catch (err) {
    const msg = words(err);
    if (msg) say(ui.dataMsg, msg, 'error');
  }
}

function fillValues(): Record<string, string> {
  const t = tpl()!;
  const open = state.openTpl!;
  const names = new Set(open.fields.map((f) => f.name));
  const values: Record<string, string> = {};
  for (const c of rowCells(t, state.table!, state.mapping, state.row)) {
    if (c.input === null || !c.check || c.field.readOnly || !names.has(c.field.name)) continue;
    const f = c.field;
    if (f.kind === 'checkbox') values[f.name] = c.check.value === 'on' ? f.options[0]?.value ?? 'Yes' : 'Off';
    else if (f.kind === 'radio') {
      if (c.check.value || !f.loose) values[f.name] = c.check.value || 'Off';
    }
    else values[f.name] = c.check.value;
  }
  return values;
}

async function showRow() {
  const values = fillValues();
  if (!Object.keys(values).length) {
    say(ui.pvMsg, 'No matched field is in the open PDF.', 'error');
    return;
  }
  ui.show.disabled = true;
  say(ui.pvMsg, 'Filling the open PDF…');
  try {
    await formext.apply(`Mail Merge: row ${state.row + 1}`, [{ command: 'fill', args: { values } }]);
    const page = (tpl()?.shapes.get(state.focus)?.[0]?.page ?? state.page) + 1;
    formext.run('pdf-go-page', { page }).catch(() => undefined);
    say(ui.pvMsg, `Filled with row ${state.row + 1}. Undo in formpdf takes it back.`, 'ok');
  } catch (err) {
    const msg = words(err);
    say(ui.pvMsg, msg ? `formpdf did not fill it: ${msg}` : '', 'error');
  }
  renderPreview();
}

async function make() {
  const table = state.table!;
  const rows = parseRanges(ui.rowsInput.value, table.rows.length);
  if (typeof rows === 'string') {
    say(ui.makeMsg, `Rows: ${rows}.`, 'error');
    ui.rowsInput.focus();
    return;
  }
  if (!rows.length) {
    say(ui.makeMsg, 'No rows to make.', 'error');
    return;
  }
  if (!state.fileTpl) {
    say(ui.makeMsg, 'Mail Merge needs the PDF file first.');
    if (!(await loadFile(true)) || !state.fileTpl) {
      say(ui.makeMsg, 'Mail Merge needs the PDF file to make copies of it.', 'error');
      return;
    }
  }
  const t = state.fileTpl!;
  const missing = Object.entries(state.mapping).filter(([f, v]) => v !== KEEP && !t.fields.some((x) => x.name === f)).map(([f]) => f);
  if (missing.length === Object.values(state.mapping).filter((v) => v !== KEEP).length && missing.length) {
    say(ui.makeMsg, 'None of the matched fields are in the loaded PDF.', 'error');
    return;
  }
  const ctl = new AbortController();
  state.job = ctl;
  ui.bar.style.transform = 'scaleX(0)';
  renderAll();
  say(ui.makeMsg, `Making ${plural(rows.length, 'PDF')}…`);
  try {
    const out = await runJob(
      { doc: t.doc!, form: t.form!, table, mapping: state.mapping, rows, flatten: ui.flatten.checked, mode: mode(), pattern: ui.pattern.value, stem: stem(t.name) },
      (done, total) => {
        ui.bar.style.transform = `scaleX(${done / total})`;
        say(ui.makeMsg, `Filled ${done} of ${total}…`);
      },
      ctl.signal,
    );
    if (ctl.signal.aborted) throw new Cancelled('Cancelled');
    say(ui.makeMsg, 'Choose where to save…');
    const res = await formext.saveFile(out.name, out.type, toBase64(out.bytes));
    const what = mode() === 'combined' ? `one PDF of ${plural(rows.length, 'row')}` : rows.length === 1 ? 'one PDF' : `${plural(rows.length, 'PDF')} in a zip`;
    const note = out.problems ? ` ${plural(out.problems, 'value')} did not fit a field; see Preview.` : '';
    say(ui.makeMsg, `Saved ${res.name || out.name}: ${what}, ${(out.bytes.length / 1048576).toFixed(1)} MB.${note}`, out.problems ? 'warn' : 'ok');
  } catch (err) {
    if (err instanceof Cancelled) say(ui.makeMsg, 'Cancelled. Nothing was saved.');
    else if (err instanceof FormExtError && err.code === ERR.CANCELLED) say(ui.makeMsg, 'Not saved.');
    else say(ui.makeMsg, `Could not make the PDFs: ${words(err)}`, 'error');
  } finally {
    state.job = null;
    ui.bar.style.transform = 'scaleX(0)';
    renderAll();
  }
}

function step(to: number) {
  const rows = state.table?.rows.length ?? 0;
  if (!rows) return;
  state.row = Math.max(0, Math.min(rows - 1, to));
  say(ui.pvMsg, '');
  renderPreview();
}

ui.tplFile.addEventListener('click', () => void loadFile(false));
ui.csvOpen.addEventListener('click', () => void chooseCsv());
ui.pasteToggle.addEventListener('click', () => {
  const open = ui.pasteBox.hidden;
  ui.pasteBox.hidden = !open;
  ui.pasteToggle.setAttribute('aria-expanded', String(open));
  if (open) ui.paste.focus();
});
ui.pasteUse.addEventListener('click', () => {
  if (!ui.paste.value.trim()) {
    say(ui.dataMsg, 'Paste rows first: the first line names the columns.', 'error');
    return;
  }
  useTable(parseCsv(ui.paste.value), 'Pasted rows');
});
ui.mapAuto.addEventListener('click', () => {
  const t = tpl();
  if (!t || !state.table) return;
  state.mapping = autoMap(t.fields, state.table.columns);
  savePrefs();
  recount();
  renderMapping();
  renderPreview();
});
ui.prev.addEventListener('click', () => step(state.row - 1));
ui.next.addEventListener('click', () => step(state.row + 1));
ui.rowInput.addEventListener('change', () => step(Number(ui.rowInput.value) - 1));
ui.nextProblem.addEventListener('click', () => {
  const next = state.problemRows.find((r) => r > state.row) ?? state.problemRows[0];
  if (next === undefined) return;
  step(next);
  const t = tpl();
  const bad = t && state.table ? rowCells(t, state.table, state.mapping, next).find((c) => c.check?.problem) : null;
  if (bad) setFocus(bad.field.name);
});
ui.show.addEventListener('click', () => void showRow());
ui.make.addEventListener('click', () => void make());
ui.cancel.addEventListener('click', () => state.job?.abort());
ui.pattern.addEventListener('input', () => {
  savePrefs();
  renderMake();
});
ui.flatten.addEventListener('change', savePrefs);
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.addEventListener('change', () => {
  savePrefs();
  renderMake();
});

let eventTimer = 0;
formext.onEvent((e) => {
  if (e.name !== 'document.changed') return;
  window.clearTimeout(eventTimer);
  eventTimer = window.setTimeout(() => void readOpen(), 250);
});
formext.onActivate(() => null);
formext.on('ext.deactivate', () => state.job?.abort());

let lastHeight = 0;
new ResizeObserver(() => {
  const h = Math.ceil(document.documentElement.scrollHeight);
  if (Math.abs(h - lastHeight) < 2) return;
  lastHeight = h;
  formext.resize(h).catch(() => undefined);
}).observe(document.body);

async function start() {
  try {
    state.hello = await formext.hello();
  } catch (err) {
    say(ui.tplNote, `formpdf did not answer: ${words(err)}`, 'error');
    return;
  }
  state.canRead = state.hello.permissions.includes('document');
  renderAll();
  await readOpen();
  if (!state.summary.key) await adoptTemplate();
  state.ready = true;
  renderAll();
}

void start();
