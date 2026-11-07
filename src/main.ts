import { ERR, FormExtError, Hello, formext as fx } from './formext';
import { LayerRow, Letters, Summary, existingFor, readLetters, spacing, textLayers } from './document';
import { pathBox } from './geometry';
import { APPLY_LABEL, buildOps } from './ops';
import { Preview } from './preview';
import { traceGlyph } from './skeleton';
import { DEFAULTS, Letter, Settings, Timed, schedule } from './timing';

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

const ui = {
  root: document.querySelector('.hr') as HTMLElement,
  layer: $<HTMLSelectElement>('layer'),
  trace: $<HTMLButtonElement>('trace'),
  status: $('status'),
  meter: $('meter'),
  statusText: $('status-text'),
  cancel: $<HTMLButtonElement>('cancel'),
  empty: $('empty'),
  play: $<HTMLButtonElement>('play'),
  playIco: $<SVGElement>('play-ico'),
  pauseIco: $<SVGElement>('pause-ico'),
  scrub: $<HTMLInputElement>('scrub'),
  time: $('time'),
  guides: $<HTMLInputElement>('show-guides'),
  duration: $<HTMLInputElement>('duration'),
  start: $<HTMLSelectElement>('start'),
  lift: $<HTMLInputElement>('lift'),
  gap: $<HTMLInputElement>('gap'),
  ease: $<HTMLInputElement>('ease'),
  ink: $<HTMLInputElement>('ink-colour'),
  inkWidth: $<HTMLInputElement>('ink-width'),
  facts: $('facts'),
  write: $<HTMLButtonElement>('write'),
  modes: [...document.querySelectorAll<HTMLButtonElement>('.hr-seg button')],
  inkRows: [...document.querySelectorAll<HTMLElement>('.hr-ink-row')],
};

const preview = new Preview($('preview'), $('ghost'), $('revealed'), $('mask-strokes'), $('ink'), $('guides'));

let hello: Hello | null = null;
let summary: Summary | null = null;
let settings: Settings = { ...DEFAULTS };
let letters: Letters | null = null;
let traced: Letter[] = [];
let timed: Timed[] = [];
let tracedRevision = -1;
let busy = false;
let cancelled = false;
let layerSig = '';

class Cancelled extends Error {}

function setStatus(text: string, kind: 'idle' | 'busy' | 'error' = 'idle', progress?: number): void {
  ui.statusText.textContent = text;
  ui.status.classList.toggle('is-error', kind === 'error');
  ui.meter.style.width = progress === undefined ? (kind === 'busy' ? '100%' : '0') : `${Math.round(progress * 100)}%`;
  ui.meter.style.opacity = kind === 'busy' ? '1' : '0';
  ui.cancel.disabled = kind !== 'busy' || progress === undefined;
}

function plain(err: unknown): string {
  if (err instanceof Cancelled) return 'Cancelled';
  const e = err as FormExtError;
  if (e?.code === ERR.PERMISSION) return 'Handwriting Reveal needs to read and change the open project. Open it again and choose Allow.';
  if (e?.code === ERR.CANCELLED) return 'Cancelled';
  if (e?.code === ERR.UNAVAILABLE) return `FormVFX did not answer in time (${e.message}).`;
  const msg = String(e?.message ?? err).replace(/^step \d+ \([^)]*\) failed: /, '');
  return `FormVFX could not do that: ${msg}`;
}

function hasDocument(): boolean {
  return !!hello?.permissions?.includes('document');
}

function selectedRow(): LayerRow | undefined {
  const id = Number(ui.layer.value);
  return summary?.layers.find((l) => l.id === id && l.type === 'Text');
}

function fillLayers(): void {
  const rows = summary ? textLayers(summary) : [];
  const sig = rows.map((r) => `${r.id}:${r.name}`).join('|');
  const current = ui.layer.value;
  if (sig !== layerSig) {
    layerSig = sig;
    const opts = rows.length ? rows.map((r) => new Option(`${r.index}. ${r.name}`, String(r.id))) : [new Option(summary?.comp ? 'No text layer in this composition' : 'No composition open', '')];
    ui.layer.replaceChildren(...opts);
  }
  const sel = rows.find((r) => summary!.selection.layers.includes(r.id));
  const keep = rows.find((r) => String(r.id) === current);
  const pick = sel ?? keep ?? rows[0];
  ui.layer.value = pick ? String(pick.id) : '';
  ui.layer.disabled = !rows.length || busy;
  ui.trace.disabled = !pick || busy || !hasDocument();
}

async function readSummary(): Promise<Summary> {
  summary = await fx.readDocument<Summary>('summary');
  return summary;
}

async function refresh(): Promise<void> {
  if (!hasDocument()) return;
  const before = ui.layer.value;
  await readSummary();
  fillLayers();
  if (letters && (ui.layer.value !== String(letters.layer) || !selectedRow())) resetTrace();
  else if (!letters && before !== ui.layer.value) resetTrace();
  updateButtons();
}

function resetTrace(): void {
  letters = null;
  traced = [];
  timed = [];
  tracedRevision = -1;
  preview.clear();
  ui.empty.textContent = selectedRow() ? 'Trace to see how this layer will be written.' : 'Choose a text layer and Trace to see how it will be written.';
  ui.empty.classList.remove('is-hidden');
  ui.facts.textContent = ' ';
  if (!busy) setStatus(selectedRow() ? 'Ready to trace' : summary?.comp ? 'Select a text layer' : 'Open a composition with a text layer');
}

function updateButtons(): void {
  const ok = hasDocument() && !busy;
  ui.trace.disabled = !ok || !selectedRow();
  ui.write.disabled = !ok || !selectedRow();
  ui.play.disabled = !timed.length;
  ui.scrub.disabled = !timed.length;
  ui.layer.disabled = busy || !summary || !textLayers(summary).length;
}

function readSettings(): Settings {
  const num = (el: HTMLInputElement, lo: number, hi: number, d: number) => {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
  };
  return {
    mode: settings.mode,
    duration: num(ui.duration, 0.2, 600, DEFAULTS.duration),
    lift: num(ui.lift, 0, 5, DEFAULTS.lift),
    letterGap: num(ui.gap, 0, 5, DEFAULTS.letterGap),
    ease: num(ui.ease, 0, 100, DEFAULTS.ease),
    ink: /^#[0-9a-f]{6}$/i.test(ui.ink.value) ? ui.ink.value : DEFAULTS.ink,
    inkWidth: num(ui.inkWidth, 0, 500, 0),
    start: ui.start.value === 'in' ? 'in' : 'now',
  };
}

function showSettings(s: Settings): void {
  ui.duration.value = String(s.duration);
  ui.lift.value = String(s.lift);
  ui.gap.value = String(s.letterGap);
  ui.ease.value = String(s.ease);
  ui.ink.value = s.ink;
  ui.inkWidth.value = String(s.inkWidth);
  ui.start.value = s.start;
  for (const b of ui.modes) {
    const on = b.dataset.mode === s.mode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  for (const r of ui.inkRows) r.classList.toggle('is-off', s.mode !== 'ink');
  ui.ink.disabled = s.mode !== 'ink';
  ui.inkWidth.disabled = s.mode !== 'ink';
}

let saveTimer = 0;
function settingsChanged(): void {
  settings = readSettings();
  showSettings(settings);
  reschedule();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void fx.storageSet('settings', settings).catch(() => {}), 400);
}

function fps(): number {
  return summary?.comp?.frameRate || 30;
}

function reschedule(): void {
  if (!letters) return;
  timed = schedule(traced, settings, fps());
  preview.show(letters.glyphs, timed, settings);
  const strokes = timed.length;
  const end = timed.length ? timed[timed.length - 1].t1 : 0;
  ui.facts.textContent = strokes
    ? `${traced.length} letter${traced.length === 1 ? '' : 's'}, ${strokes} stroke${strokes === 1 ? '' : 's'}, written in ${end.toFixed(2)} s. ${settings.mode === 'reveal' ? 'The strokes become a track matte that reveals the text.' : 'The strokes are drawn as ink; the text layer is hidden.'}`
    : 'No strokes were found in these letters.';
  ui.empty.classList.toggle('is-hidden', strokes > 0);
  if (!strokes) ui.empty.textContent = 'These letters have no shapes to trace.';
  updateButtons();
}

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

async function trace(row: LayerRow): Promise<void> {
  cancelled = false;
  setStatus(`Reading the letters of ${row.name}`, 'busy');
  const got = await readLetters(fx, row);
  if (!got.glyphs.length) throw new FormExtError(ERR.REFUSED, `${row.name} has no letters to trace`);
  const H = Math.max(...got.glyphs.map((g) => {
    const b = pathBox(g.paths);
    return b.y1 - b.y0;
  }));
  const scale = 150 / Math.max(H, 1e-6);
  const spaces = spacing(got.text, got.glyphs);
  const out: Letter[] = [];
  for (let i = 0; i < got.glyphs.length; i++) {
    if (cancelled) throw new Cancelled();
    setStatus(`Tracing ${got.glyphs[i].char} (${i + 1} of ${got.glyphs.length})`, 'busy', i / got.glyphs.length);
    await pause();
    out.push({ char: got.glyphs[i].char, spaceBefore: spaces[i], strokes: traceGlyph(got.glyphs[i].paths, { scale }) });
  }
  letters = got;
  traced = out;
  await readSummary();
  tracedRevision = summary!.revision;
  reschedule();
}

async function guarded(work: () => Promise<void>): Promise<boolean> {
  if (busy) return false;
  busy = true;
  updateButtons();
  try {
    await work();
    return true;
  } catch (err) {
    if (err instanceof Cancelled) setStatus('Cancelled. The project is unchanged.');
    else setStatus(plain(err), 'error');
    return false;
  } finally {
    busy = false;
    updateButtons();
  }
}

async function doTrace(): Promise<boolean> {
  const row = selectedRow();
  if (!row) {
    setStatus('Select a text layer first', 'error');
    return false;
  }
  return guarded(async () => {
    await trace(row);
    setStatus(`Traced ${row.name}. Play the preview, then Write On.`);
  });
}

async function doWrite(): Promise<boolean> {
  return guarded(async () => {
    await readSummary();
    fillLayers();
    const row = selectedRow();
    if (!row) throw new FormExtError(ERR.REFUSED, 'select a text layer first');
    if (!letters || letters.layer !== row.id || summary!.revision !== tracedRevision) await trace(row);
    if (!timed.length) throw new FormExtError(ERR.REFUSED, `no strokes were found in ${row.name}`);
    await readSummary();
    const fresh = summary!.layers.find((l) => l.id === row.id) ?? row;
    const start = settings.start === 'in' ? fresh.in : summary!.time;
    const ops = buildOps(fresh, existingFor(summary!, fresh), timed, settings, start);
    setStatus(`Writing ${timed.length} strokes onto ${fresh.name}`, 'busy');
    await fx.apply(APPLY_LABEL, ops);
    await readSummary();
    tracedRevision = summary!.revision;
    fillLayers();
    const end = start + timed[timed.length - 1].t1;
    setStatus(`Written: ${timed.length} strokes from ${start.toFixed(2)} s to ${end.toFixed(2)} s. Edit > Undo removes it.`);
    void fx.notify(`${fresh.name} is written on in ${timed.length} strokes`, 'success').catch(() => {});
  });
}

async function headless(): Promise<void> {
  try {
    await refresh();
    const sel = summary ? textLayers(summary).find((r) => summary!.selection.layers.includes(r.id)) : undefined;
    if (!sel) throw new FormExtError(ERR.REFUSED, 'select a text layer, then run Write On again');
    ui.layer.value = String(sel.id);
    const ok = await doWrite();
    if (!ok) await fx.notify(ui.statusText.textContent || 'Handwriting Reveal could not write the layer', 'error').catch(() => {});
    await fx.done({ ok, strokes: ok ? timed.length : 0 });
  } catch (err) {
    await fx.notify(plain(err), 'error').catch(() => {});
    await fx.done({ ok: false, error: plain(err) }).catch(() => {});
  }
}

let refreshTimer = 0;
fx.onEvent((e) => {
  if (e.name !== 'document.changed' && e.name !== 'selection.changed' && e.name !== 'comp.changed') return;
  if (busy) return;
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh().catch((err) => setStatus(plain(err), 'error')), 200);
});

const ready = (async () => {
  hello = await fx.hello();
  const stored = await fx.storageGet<Partial<Settings>>('settings').catch(() => null);
  if (stored && typeof stored === 'object') settings = { ...DEFAULTS, ...stored };
  showSettings(settings);
  if (!hasDocument()) {
    setStatus('Handwriting Reveal needs to read and change the open project. Open it again and choose Allow.', 'error');
    updateButtons();
    return;
  }
  await refresh();
  resetTrace();
})().catch((err) => setStatus(plain(err), 'error'));

fx.onActivate(async (a) => {
  await ready;
  if (!hasDocument()) {
    hello = await fx.call<Hello>('host.hello').catch(() => hello);
    if (hasDocument()) {
      await refresh().catch(() => {});
      resetTrace();
    }
  }
  if (a.reason === 'command' && a.command === 'write-selected') return void headless();
  if (a.reason === 'command' && a.command === 'show') {
    await refresh().catch(() => {});
    if (selectedRow()) void doTrace();
  }
});

ui.trace.addEventListener('click', () => void doTrace());
ui.write.addEventListener('click', () => void doWrite());
ui.cancel.addEventListener('click', () => {
  cancelled = true;
  ui.cancel.disabled = true;
});
ui.layer.addEventListener('change', () => {
  resetTrace();
  updateButtons();
});
ui.play.addEventListener('click', () => preview.toggle());
ui.scrub.addEventListener('input', () => {
  preview.stop();
  preview.seek((Number(ui.scrub.value) / 1000) * preview.total);
});
ui.guides.addEventListener('change', () => ui.root.classList.toggle('show-guides', ui.guides.checked));
for (const el of [ui.duration, ui.lift, ui.gap, ui.ease, ui.inkWidth, ui.ink]) el.addEventListener('input', settingsChanged);
ui.start.addEventListener('change', settingsChanged);
for (const b of ui.modes)
  b.addEventListener('click', () => {
    settings = { ...readSettings(), mode: b.dataset.mode === 'ink' ? 'ink' : 'reveal' };
    showSettings(settings);
    settingsChanged();
  });

preview.onTime = (t, playing) => {
  ui.time.textContent = `${t.toFixed(2)} s`;
  ui.scrub.value = String(preview.total ? Math.round((t / preview.total) * 1000) : 1000);
  ui.playIco.toggleAttribute('hidden', playing);
  ui.pauseIco.toggleAttribute('hidden', !playing);
  ui.play.setAttribute('aria-label', playing ? 'Pause the preview' : 'Play the preview');
  ui.play.title = playing ? 'Pause the preview' : 'Play the preview';
};
