import { ERR, FormExtError, formext, type Activation } from './formext';
import { SPOT_INKS, SPOT_PRESETS, nameForHex } from './inks';
import { Cancelled, type Job, type Picture } from './separate';
import { SHAPES, type DotShape } from './screen';
import { clean, defaults, platesOf, spotPlates, type PlateSetting, type Settings } from './settings';
import { Renderer, composite, plateFilm, plateLayer, pngOf, type Result } from './render';
import { layerOps, readDoc, readPicture, workScale, type DocInfo } from './app';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const note = $('note');
const docLine = $('doc');
const statusEl = $('status');
const bar = $('bar');
const showSel = $<HTMLSelectElement>('show');
const presetSel = $<HTMLSelectElement>('preset');
const paperIn = $<HTMLInputElement>('paper');
const paperHex = $<HTMLInputElement>('paper-hex');
const ppiIn = $<HTMLInputElement>('ppi');
const cellHint = $('cell');
const rows = [...document.querySelectorAll<HTMLElement>('.plate[data-i]')];

let settings: Settings = defaults();
let doc: DocInfo | null = null;
let scaleOfWork = 1;
let renderer: Renderer | null = null;
let zoom: 'fit' | 1 | 2 = 'fit';
let pan = { x: 0, y: 0 };
let shown: Result | null = null;
let previewJob: Job | null = null;
let actionJob: Job | null = null;
let busyTimer = 0;
let saveTimer = 0;
let previewTimer = 0;
let staleTimer = 0;
let headless = false;

function newJob(): Job {
  return { cancelled: false, progress: (f) => (bar.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`) };
}

function setStatus(text: string, error = false) {
  statusEl.textContent = text || ' ';
  statusEl.classList.toggle('error', error);
}

function setNote(text: string, error = false) {
  note.textContent = text;
  note.classList.toggle('error', error);
}

function busy(on: boolean, immediate = false) {
  clearTimeout(busyTimer);
  if (!on) {
    app.dataset.busy = 'false';
    return;
  }
  bar.style.width = '0%';
  if (immediate) app.dataset.busy = 'true';
  else busyTimer = window.setTimeout(() => (app.dataset.busy = 'true'), 250);
}

function words(err: unknown): string {
  if (err instanceof FormExtError) {
    if (err.code === ERR.PERMISSION) return 'Halftone Separations is not allowed to read or change the picture yet. Allow it in the Extensions panel.';
    if (err.code === ERR.CANCELLED) return 'Stopped.';
    if (err.code === ERR.UNAVAILABLE) return `FormVis could not do that: ${err.message}`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function ppiBase(): number {
  if (settings.ppi) return settings.ppi;
  const r = doc?.resolution ?? 72;
  return r >= 150 ? r : 300;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => formext.storageSet('settings', settings).catch(() => undefined), 400);
}

function changed(recompute = true) {
  persist();
  syncControls();
  if (recompute) schedule();
}

function radio(group: HTMLElement, attr: string, value: string) {
  for (const b of group.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset[attr] === value));
}

function fillInkOptions(sel: HTMLSelectElement, p: PlateSetting) {
  const known = SPOT_INKS.some((i) => i.hex === p.hex && i.name === p.name);
  const want = SPOT_INKS.map((i) => i.name).concat(known ? [] : [p.name]);
  if (sel.options.length !== want.length || [...sel.options].some((o, k) => o.value !== want[k])) {
    sel.replaceChildren(...want.map((n) => new Option(n, n)));
  }
  sel.value = p.name;
}

function syncRows() {
  const plates = platesOf(settings);
  const spot = settings.mode === 'spot';
  rows.forEach((row, i) => {
    const p = plates[i];
    row.dataset.state = p ? 'on' : spot && i === plates.length ? 'empty' : 'off';
    row.dataset.fixed = String(!spot || plates.length <= 2);
    if (!p) return;
    const q = <T extends HTMLElement>(s: string) => row.querySelector(s) as T;
    q<HTMLButtonElement>('.eye').setAttribute('aria-pressed', String(p.visible));
    const sw = q<HTMLInputElement>('.swatch');
    sw.value = p.hex;
    sw.disabled = !spot;
    const name = q<HTMLSelectElement>('.ink-name');
    name.title = p.name;
    if (spot) {
      fillInkOptions(name, p);
      name.disabled = false;
    } else {
      if (name.options.length !== 1 || name.options[0].value !== p.name) name.replaceChildren(new Option(p.name, p.name));
      name.disabled = true;
    }
    q<HTMLInputElement>('.angle').value = String(p.angle);
    q<HTMLInputElement>('.lpi').value = String(p.lpi);
    q<HTMLSelectElement>('.shape').value = p.shape;
    q<HTMLInputElement>('.density').value = String(p.density);
  });
  [...showSel.options].forEach((o, k) => {
    if (k === 0) return;
    const p = plates[k - 1];
    o.hidden = !p;
    o.disabled = !p;
    o.textContent = p ? `${k}. ${p.name}` : `Plate ${k}`;
  });
  if (showSel.value !== 'all' && !plates[Number(showSel.value)]) showSel.value = 'all';
}

function syncPreset() {
  if (settings.mode === 'cmyk') {
    if (presetSel.options.length !== 1 || presetSel.options[0].value !== 'process') presetSel.replaceChildren(new Option('Process cyan, magenta, yellow, black', 'process'));
    presetSel.disabled = true;
    return;
  }
  presetSel.disabled = false;
  const names = settings.spot.map((p) => p.name).join('|');
  const match = SPOT_PRESETS.find((p) => p.inks.join('|') === names && settings.spot.every((s) => SPOT_INKS.some((i) => i.name === s.name && i.hex === s.hex)));
  const want = SPOT_PRESETS.map((p) => [p.id, p.label]).concat(match ? [] : [['custom', 'Custom inks']]);
  if (presetSel.options.length !== want.length || [...presetSel.options].some((o, k) => o.value !== want[k][0])) presetSel.replaceChildren(...want.map(([v, l]) => new Option(l, v)));
  presetSel.value = match ? match.id : 'custom';
}

function syncControls() {
  app.dataset.mode = settings.mode;
  radio($('mode'), 'mode', settings.mode);
  radio($('edges'), 'hard', String(settings.hard));
  syncPreset();
  paperIn.value = settings.paper;
  if (document.activeElement !== paperHex) paperHex.value = settings.paper;
  if (document.activeElement !== ppiIn) ppiIn.value = String(ppiBase());
  for (const [id, v] of [['misreg', settings.misreg], ['bg', settings.blackGeneration], ['limit', settings.inkLimit]] as const) {
    $<HTMLInputElement>(id).value = String(v);
    if (document.activeElement !== $(`${id}-n`)) $<HTMLInputElement>(`${id}-n`).value = String(v);
  }
  const lpi = platesOf(settings)[0]?.lpi ?? 60;
  const cell = ppiBase() / lpi;
  cellHint.textContent = `${cell.toFixed(1)} px per dot${cell < 3 ? ', too fine to see' : ''}`;
  syncRows();
}

function buildRows() {
  const tpl = $<HTMLTemplateElement>('plate-row');
  rows.forEach((row, i) => {
    row.append(tpl.content.cloneNode(true));
    const shape = row.querySelector<HTMLSelectElement>('.shape')!;
    shape.replaceChildren(...SHAPES.map((s) => new Option(s.label, s.id)));
    const plate = () => platesOf(settings)[i];
    const numIn = (sel: string, key: 'angle' | 'lpi' | 'density', lo: number, hi: number) => {
      const el = row.querySelector<HTMLInputElement>(sel)!;
      el.addEventListener('input', () => {
        const v = Number(el.value);
        if (!Number.isFinite(v) || el.value === '') return;
        const p = plate();
        if (!p) return;
        p[key] = Math.min(hi, Math.max(lo, key === 'angle' ? ((Math.round(v) % 180) + 180) % 180 : v));
        changed();
      });
      el.addEventListener('change', () => syncControls());
    };
    numIn('.angle', 'angle', 0, 179);
    numIn('.lpi', 'lpi', 5, 300);
    numIn('.density', 'density', 0, 150);
    shape.addEventListener('change', () => {
      const p = plate();
      if (p) {
        p.shape = shape.value as DotShape;
        changed();
      }
    });
    row.querySelector('.eye')!.addEventListener('click', () => {
      const p = plate();
      if (p) {
        p.visible = !p.visible;
        changed(false);
        redraw();
      }
    });
    const sw = row.querySelector<HTMLInputElement>('.swatch')!;
    sw.addEventListener('input', () => {
      const p = plate();
      if (!p || settings.mode !== 'spot') return;
      p.hex = sw.value.toLowerCase();
      p.name = nameForHex(p.hex);
      changed();
    });
    const name = row.querySelector<HTMLSelectElement>('.ink-name')!;
    name.addEventListener('change', () => {
      const p = plate();
      const ink = SPOT_INKS.find((k) => k.name === name.value);
      if (!p || !ink || settings.mode !== 'spot') return;
      p.name = ink.name;
      p.hex = ink.hex;
      changed();
    });
    row.querySelector('.remove')!.addEventListener('click', () => {
      if (settings.mode !== 'spot' || settings.spot.length <= 2) return;
      settings.spot.splice(i, 1);
      changed();
    });
    row.querySelector('.add')!.addEventListener('click', () => {
      if (settings.mode !== 'spot' || settings.spot.length >= 4) return;
      const used = new Set(settings.spot.map((p) => p.name));
      const ink = SPOT_INKS.find((k) => !used.has(k.name)) ?? SPOT_INKS[0];
      const angles = [15, 75, 0, 45, 30, 60];
      const angle = angles.find((a) => !settings.spot.some((p) => p.angle === a)) ?? 0;
      const lpi = settings.spot[0]?.lpi ?? 45;
      settings.spot.push({ name: ink.name, hex: ink.hex, angle, lpi, shape: settings.spot[0]?.shape ?? 'round', density: 100, visible: true });
      changed();
    });
  });
}

function wireControls() {
  for (const b of $('mode').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode === 'spot' ? 'spot' : 'cmyk';
      changed();
    });
  }
  for (const b of $('edges').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      settings.hard = b.dataset.hard === 'true';
      changed();
    });
  }
  for (const b of $('zoom').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      const z = b.dataset.zoom === 'fit' ? 'fit' : (Number(b.dataset.zoom) as 1 | 2);
      if (z === zoom) return;
      zoom = z;
      pan = { x: 0, y: 0 };
      radio($('zoom'), 'zoom', String(b.dataset.zoom));
      stage.dataset.zoom = String(b.dataset.zoom);
      schedule(0);
    });
  }
  presetSel.addEventListener('change', () => {
    if (settings.mode !== 'spot' || presetSel.value === 'custom') return;
    const keep = settings.spot[0];
    settings.preset = presetSel.value;
    settings.spot = spotPlates(presetSel.value, keep?.lpi ?? 45).map((p) => ({ ...p, shape: keep?.shape ?? p.shape }));
    changed();
  });
  paperIn.addEventListener('input', () => {
    settings.paper = paperIn.value.toLowerCase();
    changed();
  });
  paperHex.addEventListener('input', () => {
    const v = paperHex.value.trim();
    const hex = (v.startsWith('#') ? v : `#${v}`).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(hex)) {
      settings.paper = hex;
      changed();
    }
  });
  paperHex.addEventListener('change', () => (paperHex.value = settings.paper));
  ppiIn.addEventListener('input', () => {
    const v = Number(ppiIn.value);
    if (ppiIn.value === '' || !Number.isFinite(v) || v < 36 || v > 2400) return;
    settings.ppi = Math.round(v);
    changed();
  });
  ppiIn.addEventListener('change', () => syncControls());
  const pairs: [string, 'misreg' | 'blackGeneration' | 'inkLimit'][] = [['misreg', 'misreg'], ['bg', 'blackGeneration'], ['limit', 'inkLimit']];
  for (const [id, key] of pairs) {
    const range = $<HTMLInputElement>(id), box = $<HTMLInputElement>(`${id}-n`);
    const set = (raw: string) => {
      const v = Number(raw);
      if (raw === '' || !Number.isFinite(v)) return;
      settings[key] = Math.min(Number(range.max), Math.max(Number(range.min), v));
      changed();
    };
    range.addEventListener('input', () => set(range.value));
    box.addEventListener('input', () => set(box.value));
    box.addEventListener('change', () => syncControls());
  }
  showSel.addEventListener('change', () => redraw());
  $('cancel').addEventListener('click', () => {
    if (actionJob) actionJob.cancelled = true;
    if (previewJob) previewJob.cancelled = true;
  });
  $('layers').addEventListener('click', () => void addLayers());
  $('save').addEventListener('click', () => void savePlates());
  new ResizeObserver(() => {
    if (zoom === 'fit') schedule(150);
    else place();
  }).observe(stage);
  let drag: { x: number; y: number; px: number; py: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if (zoom === 'fit') return;
    drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    pan = { x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y };
    place();
  });
  const end = () => {
    drag = null;
    stage.classList.remove('panning');
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

function previewScale(pic: { width: number; height: number }): number {
  if (zoom !== 'fit') return 1;
  const dpr = window.devicePixelRatio || 1;
  const s = Math.min(1, ((stage.clientWidth - 2) * dpr) / pic.width, ((stage.clientHeight - 2) * dpr) / pic.height);
  return Math.max(1 / 64, Math.ceil(s * 64) / 64);
}

function place() {
  if (!shown) return;
  const dpr = window.devicePixelRatio || 1;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  let cw: number, ch: number;
  if (zoom === 'fit') {
    const k = Math.min(sw / shown.width, sh / shown.height);
    cw = shown.width * k;
    ch = shown.height * k;
    pan = { x: 0, y: 0 };
  } else {
    cw = (shown.width * zoom) / dpr;
    ch = (shown.height * zoom) / dpr;
    const mx = Math.max(0, (cw - sw) / 2), my = Math.max(0, (ch - sh) / 2);
    pan = { x: Math.max(-mx, Math.min(mx, pan.x)), y: Math.max(-my, Math.min(my, pan.y)) };
  }
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.style.transform = `translate(${Math.round((sw - cw) / 2 + pan.x)}px, ${Math.round((sh - ch) / 2 + pan.y)}px)`;
}

function visibleList(): boolean[] {
  const plates = platesOf(settings);
  if (showSel.value === 'all') return plates.map((p) => p.visible);
  return plates.map((_, i) => String(i) === showSel.value);
}

let drawSeq = 0;
async function redraw() {
  if (!shown) return;
  const seq = ++drawSeq;
  const img = await composite(shown, visibleList(), { cancelled: false, progress: () => undefined });
  if (seq !== drawSeq) return;
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = img.width;
    canvas.height = img.height;
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  place();
}

function schedule(delay = 120) {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void preview(), delay);
}

async function preview() {
  if (!renderer || actionJob) return;
  if (previewJob) previewJob.cancelled = true;
  const job = newJob();
  previewJob = job;
  busy(true);
  setStatus('Separating…');
  try {
    const scale = previewScale(renderer);
    const r = await renderer.run(settings, scale, ppiBase() * scaleOfWork, job);
    if (job.cancelled) return;
    shown = r;
    await redraw();
    setNote('');
    setStatus(`${platesOf(settings).length} plates, ${settings.hard ? 'hard' : 'smooth'} dots${scale < 1 ? `, preview at ${Math.round(scale * 100)}%` : ''}`);
  } catch (err) {
    if (err instanceof Cancelled) {
      if (previewJob === job) setStatus('Preview stopped. Change a setting to try again.');
      return;
    }
    setStatus(words(err), true);
  } finally {
    if (previewJob === job) {
      previewJob = null;
      busy(false);
    }
  }
}

async function loadPicture() {
  const job = newJob();
  previewJob = job;
  app.dataset.ready = 'false';
  busy(true);
  setStatus('Reading the picture…');
  try {
    doc = await readDoc();
    if (!doc.open || !doc.width) {
      renderer = null;
      shown = null;
      setNote('Open a picture in FormVis to separate it.');
      docLine.textContent = ' ';
      setStatus('');
      return;
    }
    scaleOfWork = workScale(doc);
    docLine.textContent = `${doc.name}, ${doc.width} by ${doc.height} px, ${doc.resolution} ppi${scaleOfWork < 1 ? `, worked at ${Math.round(scaleOfWork * 100)}%` : ''}`;
    syncControls();
    const pic: Picture = await readPicture(doc, scaleOfWork, job);
    renderer = new Renderer(pic);
    app.dataset.ready = 'true';
  } catch (err) {
    if (err instanceof Cancelled) return;
    setNote(words(err), true);
    setStatus('');
    return;
  } finally {
    if (previewJob === job) {
      previewJob = null;
      busy(false);
    }
  }
  await preview();
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plate';
}

function plateLabel(p: PlateSetting, i: number) {
  return `Halftone ${i + 1} ${p.name} ${p.angle}° ${p.lpi} lpi`;
}

async function fullResult(job: Job): Promise<Result> {
  if (!renderer) throw new Error('Open a picture in FormVis first.');
  setStatus('Screening at full size…');
  return renderer.run(settings, 1, ppiBase() * scaleOfWork, job);
}

async function action(name: string, fn: (job: Job) => Promise<string>) {
  if (actionJob || !renderer || !doc) return;
  if (previewJob) previewJob.cancelled = true;
  const job = newJob();
  actionJob = job;
  busy(true, true);
  try {
    const done = await fn(job);
    setStatus(done);
    formext.notify(done, 'success').catch(() => undefined);
  } catch (err) {
    if (err instanceof Cancelled || (err instanceof FormExtError && err.code === ERR.CANCELLED)) setStatus(`${name} stopped.`);
    else {
      const text = words(err);
      setStatus(text, true);
      formext.notify(text, 'error').catch(() => undefined);
    }
  } finally {
    actionJob = null;
    busy(false);
  }
}

async function buildLayers(job: Job, paper: boolean) {
  const r = await fullResult(job);
  const plates = platesOf(settings);
  const out = [];
  for (let i = 0; i < plates.length; i++) {
    if (job.cancelled) throw new Cancelled();
    setStatus(`Preparing plate ${i + 1} of ${plates.length}…`);
    out.push({ name: plateLabel(plates[i], i), png: await plateLayer(r, i) });
    job.progress((i + 1) / plates.length);
  }
  if (job.cancelled) throw new Cancelled();
  setStatus('Adding layers…');
  const ops = layerOps(doc!, scaleOfWork, paper ? settings.paper : null, out);
  await formext.apply(`Halftone Separations (${plates.length} plates)`, ops);
  return plates.length;
}

function addLayers() {
  return action('Adding layers', async (job) => {
    const n = await buildLayers(job, true);
    return `Added ${n} plate layers and a paper layer as one step.`;
  });
}

function savePlates() {
  return action('Saving', async (job) => {
    const r = await fullResult(job);
    const plates = platesOf(settings);
    const base = slug(doc!.name.replace(/\.[a-z0-9]+$/i, ''));
    let saved = 0;
    for (let i = 0; i < plates.length; i++) {
      if (job.cancelled) throw new Cancelled();
      setStatus(`Saving plate ${i + 1} of ${plates.length}…`);
      const res = await formext.saveFile(`${base}-${i + 1}-${slug(plates[i].name)}.png`, 'image/png', await plateFilm(r, i));
      if (res?.saved) saved++;
      job.progress((i + 1) / (plates.length + 1));
    }
    if (job.cancelled) throw new Cancelled();
    setStatus('Saving the overprint…');
    const over = await composite(r, plates.map(() => true), job);
    const res = await formext.saveFile(`${base}-overprint.png`, 'image/png', await pngOf(over));
    return `Saved ${saved} plate${saved === 1 ? '' : 's'}${res?.saved ? ' and the overprint' : ''}.`;
  });
}

async function runCommand(a: Activation) {
  headless = true;
  const args = (a.args && typeof a.args === 'object' ? a.args : {}) as Record<string, unknown>;
  try {
    if (args.mode === 'cmyk' || args.mode === 'spot') settings.mode = args.mode;
    if (typeof args.preset === 'string' && SPOT_PRESETS.some((p) => p.id === args.preset)) settings.spot = spotPlates(args.preset, settings.spot[0]?.lpi ?? 45);
    for (const p of platesOf(settings)) {
      if (typeof args.lpi === 'number') p.lpi = Math.min(300, Math.max(5, args.lpi));
      if (typeof args.shape === 'string' && SHAPES.some((s) => s.id === args.shape)) p.shape = args.shape as DotShape;
    }
    if (typeof args.ppi === 'number') settings.ppi = Math.min(2400, Math.max(36, args.ppi));
    if (typeof args.hard === 'boolean') settings.hard = args.hard;
    doc = await readDoc();
    if (!doc.open || !doc.width) throw new Error('No picture is open.');
    scaleOfWork = workScale(doc);
    const job = newJob();
    renderer = new Renderer(await readPicture(doc, scaleOfWork, job));
    const n = await buildLayers(job, args.paper !== false);
    await formext.done({ ok: true, plates: n, mode: settings.mode });
  } catch (err) {
    const text = words(err);
    formext.notify(text, 'error').catch(() => undefined);
    await formext.done({ ok: false, error: text }).catch(() => undefined);
  }
}

function watch() {
  formext.onEvent((e) => {
    if (headless || actionJob) return;
    if (e.name === 'document.changed' || e.name === 'document.switched') {
      clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => void loadPicture(), 700);
    }
  });
}

async function main() {
  buildRows();
  wireControls();
  syncControls();
  let activated: (a: Activation | null) => void = () => undefined;
  const activation = new Promise<Activation | null>((ok) => (activated = ok));
  formext.onActivate((a) => {
    activated(a);
    return null;
  });
  try {
    await formext.hello();
  } catch (err) {
    setNote(`This page runs inside FormVis. ${words(err)}`, true);
    return;
  }
  const stored = await formext.storageGet('settings').catch(() => null);
  if (stored) settings = clean(stored);
  syncControls();
  const a = await Promise.race([activation, new Promise<null>((ok) => setTimeout(() => ok(null), 350))]);
  if (a?.reason === 'command') {
    await runCommand(a);
    return;
  }
  watch();
  formext.onActivate((b) => {
    if (b.reason === 'command') void runCommand(b);
    return null;
  });
  await loadPicture();
}

void main();
