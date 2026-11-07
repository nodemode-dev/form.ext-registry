import { formext, fromBase64, toBase64, ERR, FormExtError, type Hello, type PickedFile } from './formext';
import { cues as makeCues, grab, plan, tileHeight, Cancelled, type Plan, type Settings, type Sheet, type Source } from './sprite';
import { buildVtt, clock, cueAt, parseVtt, type Cue } from './vtt';
import { zip, type ZipEntry } from './zip';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  pick: $<HTMLButtonElement>('pick'),
  srcName: $('src-name'),
  srcMeta: $('src-meta'),
  interval: $<HTMLInputElement>('interval'),
  width: $<HTMLInputElement>('width'),
  heightOut: $('height-out'),
  cols: $<HTMLInputElement>('cols'),
  rows: $<HTMLInputElement>('rows'),
  fmt: $<HTMLSelectElement>('fmt'),
  quality: $<HTMLInputElement>('quality'),
  base: $<HTMLInputElement>('base'),
  prefix: $<HTMLInputElement>('prefix'),
  plan: $('plan'),
  make: $<HTMLButtonElement>('make'),
  cancel: $<HTMLButtonElement>('cancel'),
  bar: $('bar'),
  status: $('status'),
  video: $<HTMLVideoElement>('video'),
  stageEmpty: $('stage-empty'),
  play: $<HTMLButtonElement>('play'),
  icoPlay: $('ico-play'),
  icoPause: $('ico-pause'),
  seek: $('seek'),
  seekFill: $('seek-fill'),
  seekHover: $('seek-hover'),
  tip: $('tip'),
  tipImg: $('tip-img'),
  tipTime: $('tip-time'),
  time: $('time'),
  sheetSel: $<HTMLSelectElement>('sheet-sel'),
  sheetImg: $<HTMLImageElement>('sheet-img'),
  vtt: $('vtt'),
  saveZip: $<HTMLButtonElement>('save-zip'),
  saveFiles: $<HTMLButtonElement>('save-files'),
};

const FIELDS = [ui.interval, ui.width, ui.cols, ui.rows, ui.fmt, ui.quality, ui.base, ui.prefix];
const ACCEPT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'];
const TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg' };

interface Made {
  plan: Plan;
  settings: Settings;
  sheets: Sheet[];
  vtt: string;
  cues: Cue[];
  urls: Map<string, string>;
}

let hello: Hello | null = null;
let source: (Source & { name: string; size: number; url: string }) | null = null;
let grabber: HTMLVideoElement | null = null;
let made: Made | null = null;
let job: AbortController | null = null;
let saving = false;
let saveTimer = 0;

function settings(): Settings {
  return {
    interval: Number(ui.interval.value),
    width: Number(ui.width.value),
    cols: Number(ui.cols.value),
    rows: Number(ui.rows.value),
    type: ui.fmt.value === 'image/webp' ? 'image/webp' : 'image/jpeg',
    quality: Math.min(100, Math.max(10, Number(ui.quality.value) || 80)),
    base: ui.base.value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(vtt|jpe?g|webp|zip)$/i, ''),
    prefix: ui.prefix.value.trim(),
  };
}

function status(text: string, kind: 'plain' | 'err' | 'good' = 'plain'): void {
  ui.status.textContent = text || ' ';
  ui.status.classList.toggle('st-err', kind === 'err');
  ui.status.classList.toggle('st-good', kind === 'good');
}

function progress(fraction: number): void {
  ui.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function refresh(): void {
  const s = settings();
  ui.heightOut.textContent = `x ${tileHeight(s, source)}`;
  let ok = false;
  if (!source) {
    ui.plan.textContent = 'Choose a video to see how many thumbnails and sheets this makes.';
    ui.plan.classList.remove('st-bad');
  } else {
    const p = plan(s, source);
    if (typeof p === 'string') {
      ui.plan.textContent = p;
      ui.plan.classList.add('st-bad');
    } else {
      const first = p.sheets[0];
      const sheets = p.sheets.length === 1 ? '1 sheet' : `${p.sheets.length} sheets`;
      ui.plan.textContent = `${p.count} thumbnails of ${p.tileW} x ${p.tileH}, one every ${s.interval} s, in ${sheets} of up to ${first.width} x ${first.height} (${p.sheets.map((x) => x.name).slice(0, 3).join(', ')}${p.sheets.length > 3 ? ', ...' : ''}) and ${s.base}.vtt.`;
      ui.plan.classList.remove('st-bad');
      ok = true;
    }
  }
  const busy = job !== null || saving;
  ui.make.disabled = !ok || busy;
  ui.pick.disabled = busy;
  ui.cancel.disabled = job === null;
  ui.saveZip.disabled = !made || busy;
  ui.saveFiles.disabled = !made || busy;
  for (const f of FIELDS) f.disabled = job !== null;
}

function remember(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = settings();
    void formext.storageSet('settings', { interval: s.interval, width: s.width, cols: s.cols, rows: s.rows, type: s.type, quality: s.quality, base: ui.base.value, prefix: s.prefix }).catch(() => undefined);
  }, 400);
}

async function restore(): Promise<void> {
  try {
    const v = await formext.storageGet<Record<string, unknown>>('settings');
    if (!v || typeof v !== 'object') return;
    const put = (el: HTMLInputElement | HTMLSelectElement, value: unknown) => {
      if (typeof value === 'number' || typeof value === 'string') el.value = String(value);
    };
    put(ui.interval, v.interval);
    put(ui.width, v.width);
    put(ui.cols, v.cols);
    put(ui.rows, v.rows);
    put(ui.fmt, v.type);
    put(ui.quality, v.quality);
    put(ui.base, v.base);
    put(ui.prefix, v.prefix);
    if (!ui.fmt.value) ui.fmt.value = 'image/jpeg';
  } catch {
    return;
  }
}

function plainError(e: unknown): string {
  if (e instanceof FormExtError) {
    if (e.code === ERR.PERMISSION) return 'FormEncoder has not allowed this extension to open or save files. Allow it in the Extensions panel and try again.';
    return e.message.charAt(0).toUpperCase() + e.message.slice(1);
  }
  const m = e instanceof Error ? e.message : String(e);
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function waitFor(video: HTMLVideoElement, name: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      video.removeEventListener(name, ok);
      video.removeEventListener('error', bad);
      fn();
    };
    const ok = () => done(resolve);
    const bad = () => done(() => reject(new Error('decode')));
    const timer = window.setTimeout(() => done(() => reject(new Error('timeout'))), ms);
    video.addEventListener(name, ok);
    video.addEventListener('error', bad);
  });
}

async function probe(url: string): Promise<{ video: HTMLVideoElement; duration: number; width: number; height: number }> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  const meta = waitFor(v, 'loadeddata', 20_000);
  v.src = url;
  await meta;
  let duration = v.duration;
  if (!Number.isFinite(duration)) {
    const known = waitFor(v, 'seeked', 20_000);
    v.currentTime = 1e9;
    await known;
    duration = v.duration;
    const back = waitFor(v, 'seeked', 20_000);
    v.currentTime = 0;
    await back;
  }
  if (!v.videoWidth || !v.videoHeight) throw new Error('nopicture');
  return { video: v, duration, width: v.videoWidth, height: v.videoHeight };
}

function clearMade(): void {
  if (!made) return;
  for (const sh of made.sheets) URL.revokeObjectURL(sh.url);
  made = null;
  ui.sheetSel.replaceChildren(new Option('None yet'));
  ui.sheetSel.disabled = true;
  ui.sheetImg.hidden = true;
  ui.sheetImg.removeAttribute('src');
  ui.vtt.textContent = 'WEBVTT';
  ui.tip.hidden = true;
}

async function choose(): Promise<void> {
  let picked: PickedFile[];
  try {
    status('Waiting for you to pick a video...');
    picked = await formext.openFiles(ACCEPT, false);
  } catch (e) {
    if (e instanceof FormExtError && e.code === ERR.CANCELLED) return status('');
    return status(plainError(e), 'err');
  }
  const f = picked[0];
  if (!f) return status('');
  status(`Reading ${f.name} (${bytes(f.size)})...`);
  await new Promise((r) => setTimeout(r, 0));
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  const type = f.type && f.type.startsWith('video/') ? f.type : TYPES[ext] ?? 'video/mp4';
  const url = URL.createObjectURL(new Blob([fromBase64(f.data) as BlobPart], { type }));
  let info: Awaited<ReturnType<typeof probe>>;
  try {
    info = await probe(url);
  } catch (e) {
    URL.revokeObjectURL(url);
    const why = e instanceof Error && e.message === 'nopicture' ? 'it has no picture this window can show' : 'its video codec is not one a web view decodes';
    return status(`This window cannot play ${f.name}: ${why}. Encode a web proxy of it in FormEncoder (H.264 MP4 or VP9 WebM) and choose that file.`, 'err');
  }
  clearMade();
  if (source) URL.revokeObjectURL(source.url);
  grabber?.removeAttribute('src');
  grabber = info.video;
  source = { name: f.name, size: f.size, url, duration: info.duration, width: info.width, height: info.height };
  ui.srcName.textContent = f.name;
  ui.srcMeta.textContent = `${info.width} x ${info.height}, ${clock(info.duration)} (${info.duration.toFixed(2)} s), ${bytes(f.size)}`;
  if (ui.base.value.trim() === '' || ui.base.value === 'thumbnails' || ui.base.dataset.auto === '1') {
    ui.base.value = f.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\s]+/g, '-') + '-thumbs';
    ui.base.dataset.auto = '1';
  }
  ui.video.src = url;
  ui.video.currentTime = 0;
  ui.play.disabled = false;
  ui.seek.setAttribute('aria-valuemax', String(Math.round(info.duration)));
  ui.stageEmpty.hidden = true;
  progress(0);
  drawTime();
  status(`${f.name} is ready. Set the thumbnails and press Make Thumbnails.`);
  refresh();
}

async function make(): Promise<void> {
  if (!source || !grabber || job) return;
  const s = settings();
  const p = plan(s, source);
  if (typeof p === 'string') return status(p, 'err');
  job = new AbortController();
  const signal = job.signal;
  refresh();
  progress(0);
  const t0 = performance.now();
  status(`Drawing 0 of ${p.count} thumbnails...`);
  try {
    const sheets = await grab(grabber, p, s, signal, (n) => {
      progress(n / p.count);
      if (n % 5 === 0 || n === p.count) status(`Drawing ${n} of ${p.count} thumbnails...`);
    });
    clearMade();
    const list = makeCues(p, s, source.duration);
    const vtt = buildVtt(list);
    const parsed = parseVtt(vtt);
    const urls = new Map(sheets.map((sh) => [`${s.prefix}${sh.name}`, sh.url]));
    made = { plan: p, settings: s, sheets, vtt, cues: parsed, urls };
    showMade();
    const total = sheets.reduce((n, sh) => n + sh.blob.size, 0);
    status(`Made ${p.count} thumbnails in ${sheets.length === 1 ? '1 sheet' : `${sheets.length} sheets`} (${bytes(total)}) in ${((performance.now() - t0) / 1000).toFixed(1)} s. Hover the test player's bar to try them.`, 'good');
  } catch (e) {
    progress(0);
    if (e instanceof Cancelled) status('Stopped. Nothing was made.');
    else status(`The thumbnails could not be made: ${plainError(e).replace(/^./, (c) => c.toLowerCase())}.`, 'err');
  } finally {
    job = null;
    refresh();
  }
}

function showMade(): void {
  if (!made) return;
  ui.sheetSel.replaceChildren(...made.sheets.map((sh, i) => new Option(`${sh.name} (${sh.width} x ${sh.height}, ${bytes(sh.blob.size)})`, String(i))));
  ui.sheetSel.disabled = made.sheets.length < 2;
  ui.sheetSel.value = '0';
  showSheet(0);
  ui.vtt.textContent = made.vtt;
  ui.vtt.scrollTop = 0;
  const scale = Math.min(1, 200 / made.plan.tileW);
  ui.tipImg.style.width = `${Math.round(made.plan.tileW * scale)}px`;
  ui.tipImg.style.height = `${Math.round(made.plan.tileH * scale)}px`;
}

function showSheet(i: number): void {
  const sh = made?.sheets[i];
  if (!sh) return;
  ui.sheetImg.src = sh.url;
  ui.sheetImg.hidden = false;
}

async function saveOne(name: string, type: string, data: Uint8Array): Promise<string> {
  const r = await formext.saveFile(name, type, toBase64(data));
  return r.name || name;
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

async function saveZip(): Promise<void> {
  if (!made || saving) return;
  saving = true;
  refresh();
  const m = made;
  try {
    status('Packing the ZIP...');
    const entries: ZipEntry[] = [{ name: `${m.settings.base}.vtt`, data: new TextEncoder().encode(m.vtt) }];
    for (const sh of m.sheets) entries.push({ name: sh.name, data: await blobBytes(sh.blob) });
    const data = zip(entries);
    status('Choose where to save the ZIP...');
    const name = await saveOne(`${m.settings.base}.zip`, 'application/zip', data);
    status(`Saved ${name}: ${m.settings.base}.vtt and ${m.sheets.length === 1 ? 'its sheet' : `its ${m.sheets.length} sheets`}.`, 'good');
    void formext.notify(`Saved ${name}`, 'success').catch(() => undefined);
  } catch (e) {
    if (e instanceof FormExtError && e.code === ERR.CANCELLED) status('Not saved.');
    else status(`The ZIP was not saved: ${plainError(e)}`, 'err');
  } finally {
    saving = false;
    refresh();
  }
}

async function saveFiles(): Promise<void> {
  if (!made || saving || !source) return;
  saving = true;
  refresh();
  const m = made;
  const names: string[] = [];
  try {
    for (const [i, sh] of m.sheets.entries()) {
      status(`Choose where to save sheet ${i + 1} of ${m.sheets.length}...`);
      names.push((await saveOne(sh.name, sh.blob.type, await blobBytes(sh.blob))).split(/[\\/]/).pop() ?? sh.name);
    }
    const renamed = names.some((n, i) => n !== m.sheets[i].name);
    const vtt = renamed ? buildVtt(makeCues(m.plan, m.settings, source.duration, names)) : m.vtt;
    status('Choose where to save the track...');
    const track = await saveOne(`${m.settings.base}.vtt`, 'text/vtt', new TextEncoder().encode(vtt));
    status(`Saved ${track} and ${names.length === 1 ? names[0] : `${names.length} sheets`}${renamed ? '; the track points to the names you chose' : ''}. Keep them in one folder.`, 'good');
    void formext.notify(`Saved ${track}`, 'success').catch(() => undefined);
  } catch (e) {
    const where = `Saved ${names.length} of ${m.sheets.length} sheets; the track was not saved.`;
    if (e instanceof FormExtError && e.code === ERR.CANCELLED) status(names.length ? where : 'Not saved.');
    else status(`${plainError(e)}. ${where}`, 'err');
  } finally {
    saving = false;
    refresh();
  }
}

function drawTime(): void {
  const d = source?.duration ?? 0;
  const t = ui.video.currentTime || 0;
  ui.seekFill.style.transform = `scaleX(${d ? Math.min(1, t / d) : 0})`;
  ui.time.textContent = `${clock(t)} / ${clock(d)}`;
  ui.seek.setAttribute('aria-valuenow', String(Math.round(t)));
}

let ticking = false;
function tick(): void {
  drawTime();
  if (!ui.video.paused) requestAnimationFrame(tick);
  else ticking = false;
}

function fractionAt(ev: PointerEvent): number {
  const r = ui.seek.getBoundingClientRect();
  return r.width ? Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) : 0;
}

function hover(ev: PointerEvent): void {
  if (!source) return;
  const f = fractionAt(ev);
  const t = f * source.duration;
  ui.seekHover.style.transform = `scaleX(${f})`;
  if (!made) {
    ui.tip.hidden = true;
    return;
  }
  const c = cueAt(made.cues, t);
  const url = c ? made.urls.get(c.url) : undefined;
  if (!c || !url) {
    ui.tip.hidden = true;
    return;
  }
  const sheet = made.sheets.find((sh) => sh.url === url);
  const scale = Math.min(1, 200 / c.w);
  ui.tipImg.style.backgroundImage = `url("${url}")`;
  ui.tipImg.style.backgroundSize = sheet ? `${sheet.width * scale}px ${sheet.height * scale}px` : '';
  ui.tipImg.style.backgroundPosition = `${-c.x * scale}px ${-c.y * scale}px`;
  ui.tipTime.textContent = clock(t);
  ui.tip.hidden = false;
  const width = ui.tip.offsetWidth;
  const r = ui.seek.getBoundingClientRect();
  const x = Math.max(0, Math.min(r.width - width, f * r.width - width / 2));
  ui.tip.style.transform = `translateX(${x}px)`;
}

function seekTo(t: number): void {
  if (!source) return;
  ui.video.currentTime = Math.max(0, Math.min(source.duration, t));
  drawTime();
}

function bind(): void {
  ui.pick.addEventListener('click', () => void choose());
  ui.make.addEventListener('click', () => void make());
  ui.cancel.addEventListener('click', () => job?.abort());
  ui.saveZip.addEventListener('click', () => void saveZip());
  ui.saveFiles.addEventListener('click', () => void saveFiles());
  ui.sheetSel.addEventListener('change', () => showSheet(Number(ui.sheetSel.value)));
  for (const f of FIELDS) {
    f.addEventListener('input', () => {
      if (f === ui.base) delete ui.base.dataset.auto;
      refresh();
      remember();
    });
  }
  ui.play.addEventListener('click', () => {
    if (ui.video.paused) void ui.video.play().catch(() => undefined);
    else ui.video.pause();
  });
  ui.video.addEventListener('play', () => {
    ui.icoPlay.hidden = true;
    ui.icoPause.hidden = false;
    ui.play.setAttribute('aria-label', 'Pause');
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(tick);
    }
  });
  ui.video.addEventListener('pause', () => {
    ui.icoPlay.hidden = false;
    ui.icoPause.hidden = true;
    ui.play.setAttribute('aria-label', 'Play');
    drawTime();
  });
  ui.video.addEventListener('seeked', drawTime);
  ui.seek.addEventListener('pointermove', hover);
  ui.seek.addEventListener('pointerleave', () => {
    ui.tip.hidden = true;
  });
  ui.seek.addEventListener('pointerdown', (ev) => {
    if (!source) return;
    ui.seek.setPointerCapture(ev.pointerId);
    seekTo(fractionAt(ev) * source.duration);
  });
  ui.seek.addEventListener('pointerup', (ev) => {
    if (ui.seek.hasPointerCapture(ev.pointerId)) ui.seek.releasePointerCapture(ev.pointerId);
  });
  ui.seek.addEventListener('keydown', (ev) => {
    const step = made ? made.settings.interval : 5;
    if (ev.key === 'ArrowRight') seekTo(ui.video.currentTime + step);
    else if (ev.key === 'ArrowLeft') seekTo(ui.video.currentTime - step);
    else return;
    ev.preventDefault();
  });
  formext.onActivate(() => null);
  formext.on('ext.deactivate', () => {
    job?.abort();
    ui.video.pause();
    return null;
  });
  formext.onEvent(() => null);
}

async function start(): Promise<void> {
  bind();
  refresh();
  try {
    hello = await formext.hello();
  } catch {
    status('FormEncoder did not answer. Reload the extension from the Extensions menu.', 'err');
    return;
  }
  await restore();
  refresh();
  if (!hello.permissions.includes('files-read')) status('This extension needs to open the video you pick. Allow it in the Extensions panel.', 'err');
}

void start();
