import { ERR, FormExtError, formext, toBase64, type Hello } from './formext';
import { ACCEPT, Cancelled, FrameStore, frameFromDataUrl, frameKey, sourceTime, textCard, type Position } from './frames';
import { buildPdf } from './pdf';
import { canvasToBytes, drawPage } from './render-canvas';
import { layout, type SheetOptions } from './sheet';
import { numberShots, toBoard, type Board, type Shot } from './snapshot';
import { shortDuration, timecode } from './timecode';

interface Prefs {
  paper: string;
  columns: number;
  lines: number;
  position: Position;
  track: string;
}

const $ = <T extends Element = HTMLElement>(ref: string) => document.querySelector(`[data-ref="${ref}"]`) as T;

const ui = {
  timeline: $('timeline'),
  count: $('count'),
  refresh: $<HTMLButtonElement>('refresh'),
  track: $<HTMLSelectElement>('track'),
  position: $<HTMLSelectElement>('position'),
  addFiles: $<HTMLButtonElement>('add-files'),
  statusBox: document.querySelector('.sl-status') as HTMLElement,
  status: $('status'),
  meter: $('meter'),
  cancel: $<HTMLButtonElement>('cancel'),
  list: $('list'),
  empty: $('empty'),
  sheet: $('sheet'),
  preview: $<HTMLCanvasElement>('preview'),
  page: $('page'),
  prev: $<HTMLButtonElement>('prev'),
  next: $<HTMLButtonElement>('next'),
  paper: $<HTMLSelectElement>('paper'),
  columns: $<HTMLSelectElement>('columns'),
  lines: $<HTMLSelectElement>('lines'),
  markers: $<HTMLButtonElement>('markers'),
  savePng: $<HTMLButtonElement>('save-png'),
  savePdf: $<HTMLButtonElement>('save-pdf'),
  row: $<HTMLTemplateElement>('row'),
  tabs: [...document.querySelectorAll<HTMLButtonElement>('.seg-btn')],
};

const frames = new FrameStore();
const rows = new Map<string, HTMLElement>();
let hello: Hello | null = null;
let board: Board | null = null;
let shots: Shot[] = [];
let notes: Record<string, string> = {};
let notesFor = '';
let prefs: Prefs = { paper: 'a4-landscape', columns: 3, lines: 2, position: 'first', track: 'all' };
let view: 'list' | 'sheet' = 'list';
let page = 0;
let job: { cancelled: boolean } | null = null;
let refreshTimer = 0;
let notesTimer = 0;
let ready: Promise<void>;

function say(text: string, state: 'idle' | 'busy' | 'error' = 'idle') {
  ui.status.textContent = text || ' ';
  ui.statusBox.dataset.state = state;
  if (state !== 'busy') ui.meter.style.width = '0';
}

function meter(done: number, total: number) {
  ui.meter.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
}

function plain(err: unknown, doing: string): string {
  if (err instanceof Cancelled) return `${doing} cancelled.`;
  if (err instanceof FormExtError) {
    if (err.code === ERR.CANCELLED) return `${doing} cancelled.`;
    if (err.code === ERR.PERMISSION) return `Shot List is not allowed to do that yet. Allow it from FormCut's Extensions panel, then try again.`;
    if (err.code === ERR.UNAVAILABLE) return `FormCut cannot do that here: ${err.message}`;
    if (err.code === ERR.REFUSED) return `FormCut refused: ${err.message}`;
    return `${doing} failed: ${err.message}`;
  }
  return `${doing} failed: ${err instanceof Error ? err.message : String(err)}`;
}

function setBusy(on: boolean) {
  for (const b of [ui.addFiles, ui.markers, ui.savePng, ui.savePdf, ui.refresh]) b.disabled = on;
}

function sheetOptions(continuous: boolean): SheetOptions {
  const [paper, orientation] = prefs.paper.split('-') as ['a4' | 'letter', 'landscape' | 'portrait'];
  return { paper, orientation, columns: prefs.columns, noteLines: prefs.lines, continuous, date: new Date().toISOString().slice(0, 10) };
}

function filtered(): Shot[] {
  if (!board) return [];
  const list = prefs.track === 'all' ? board.shots : board.shots.filter((s) => String(s.trackIndex) === prefs.track);
  return numberShots(list).map((s) => ({ ...s, key: frameKey(s, prefs.position, board!.fps) }));
}

async function loadPrefs() {
  try {
    const saved = await formext.storageGet<Partial<Prefs>>('prefs');
    if (saved) prefs = { ...prefs, ...saved };
  } catch {}
  ui.paper.value = prefs.paper;
  ui.columns.value = String(prefs.columns);
  ui.lines.value = String(prefs.lines);
  ui.position.value = prefs.position;
}

function savePrefs() {
  formext.storageSet('prefs', prefs).catch(() => {});
}

async function loadNotes(projectId: string) {
  if (notesFor === projectId) return;
  notesFor = projectId;
  notes = {};
  try {
    notes = (await formext.storageGet<Record<string, string>>(`notes:${projectId}`)) ?? {};
  } catch {}
}

function queueNotesSave() {
  clearTimeout(notesTimer);
  const id = notesFor;
  notesTimer = window.setTimeout(() => {
    const kept = Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim()));
    formext.storageSet(`notes:${id}`, kept).catch((err) => say(plain(err, 'Saving notes'), 'error'));
  }, 400);
}

function patchTracks() {
  if (!board) return;
  const wanted = [{ value: 'all', label: 'All picture tracks' }, ...board.tracks.filter((t) => t.shots > 0).map((t) => ({ value: String(t.index), label: t.name }))];
  const opts = [...ui.track.options];
  wanted.forEach((w, i) => {
    const o = opts[i] ?? ui.track.appendChild(document.createElement('option'));
    if (o.value !== w.value) o.value = w.value;
    if (o.textContent !== w.label) o.textContent = w.label;
  });
  for (let i = opts.length - 1; i >= wanted.length; i--) opts[i].remove();
  if (!wanted.some((w) => w.value === prefs.track)) prefs.track = 'all';
  ui.track.value = prefs.track;
}

async function prepareInstantFrames() {
  if (!board) return;
  const aspect = board.height / board.width;
  for (const shot of shots) {
    if (frames.has(shot.key)) continue;
    if (shot.frame) {
      try {
        frames.set(shot.key, await frameFromDataUrl(shot.frame));
        continue;
      } catch {}
    }
    if (shot.kind === 'text') frames.set(shot.key, textCard(shot.text ?? shot.name, aspect));
  }
}

function drawThumb(row: HTMLElement, shot: Shot) {
  const box = row.querySelector('.thumb') as HTMLElement;
  const canvas = box.querySelector('canvas') as HTMLCanvasElement;
  const label = box.querySelector('.thumb-label') as HTMLElement;
  const frame = frames.get(shot.key);
  if (box.dataset.kind !== shot.kind) box.dataset.kind = shot.kind;
  const labelText = shot.kind === 'video' ? 'No frame' : shot.kind;
  if (label.textContent !== labelText) label.textContent = labelText;
  if (row.dataset.frame === (frame ? shot.key : '')) return;
  row.dataset.frame = frame ? shot.key : '';
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  box.classList.toggle('has-frame', !!frame);
  if (!frame) return;
  const scale = Math.min(canvas.width / frame.w, canvas.height / frame.h);
  const w = frame.w * scale;
  const h = frame.h * scale;
  ctx.drawImage(frame.canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

function makeRow(clipId: string): HTMLElement {
  const row = (ui.row.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
  row.dataset.clip = clipId;
  const note = row.querySelector('.note') as HTMLTextAreaElement;
  note.addEventListener('input', () => {
    notes[clipId] = note.value;
    queueNotesSave();
    if (view === 'sheet') schedulePreview();
  });
  row.querySelector('.thumb')!.addEventListener('click', () => {
    const shot = shots.find((s) => s.clipId === clipId);
    if (shot) void showShot(shot);
  });
  return row;
}

function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

function patchRows() {
  if (!board) return;
  const fps = board.fps;
  const seen = new Set<string>();
  let before: Element | null = ui.list.firstElementChild === ui.empty ? ui.empty.nextElementSibling : ui.list.firstElementChild;
  for (const shot of shots) {
    seen.add(shot.clipId);
    let row = rows.get(shot.clipId);
    if (!row) {
      row = makeRow(shot.clipId);
      rows.set(shot.clipId, row);
    }
    if (row !== before) ui.list.insertBefore(row, before);
    else before = before.nextElementSibling;
    setText(row.querySelector('.num')!, String(shot.number));
    setText(row.querySelector('.name')!, shot.name);
    setText(row.querySelector('.dur')!, shortDuration(shot.duration, fps));
    setText(row.querySelector('.tc')!, `${timecode(shot.start, fps)}`);
    setText(row.querySelector('.trk')!, shot.mediaName && shot.mediaName !== shot.name ? `${shot.track} · ${shot.mediaName}` : shot.track);
    (row.querySelector('.name') as HTMLElement).title = shot.name;
    const note = row.querySelector('.note') as HTMLTextAreaElement;
    const want = notes[shot.clipId] ?? '';
    if (document.activeElement !== note && note.value !== want) note.value = want;
    note.placeholder = shot.markerNotes.length ? `Markers: ${shot.markerNotes.join(' / ')}` : 'Notes for this shot';
    row.classList.toggle('is-selected', board.selected.includes(shot.clipId));
    drawThumb(row, shot);
  }
  for (const [id, row] of rows) {
    if (!seen.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  ui.empty.hidden = shots.length > 0;
  if (!shots.length) setText(ui.empty, board.shots.length ? 'No picture clips on this track.' : 'This timeline has no picture clips yet. Add video, images or titles to the timeline.');
  setText(ui.timeline, board.timeline);
  setText(ui.count, `${shots.length} ${shots.length === 1 ? 'shot' : 'shots'} · ${timecode(board.duration, fps)}`);
}

function frameSummary(): string {
  const video = shots.filter((s) => s.kind === 'video');
  const have = video.filter((s) => frames.has(s.key)).length;
  if (!video.length) return '';
  if (have === video.length) return `All ${video.length} video shots have frames.`;
  return `${have} of ${video.length} video shots have frames. Add source files to fill the rest.`;
}

async function fillFrames(): Promise<void> {
  if (!board || !frames.sourceCount() || job) return;
  const jobs = shots.filter((s) => s.kind === 'video' || s.kind === 'image').map((s) => ({ key: s.key, shot: s, time: sourceTime(s, prefs.position, board!.fps) }));
  if (!jobs.some((j) => !frames.has(j.key) && frames.sourceFor(j.shot))) return;
  const signal = { cancelled: false };
  job = signal;
  setBusy(true);
  say('Taking frames…', 'busy');
  try {
    const result = await frames.extract(jobs, signal, (done, total) => {
      meter(done, total);
      say(`Taking frames ${done} of ${total}…`, 'busy');
      patchRows();
    });
    patchRows();
    if (result.failed.length) say(`This window cannot play ${result.failed.join(', ')}. Try an MP4 (H.264) or WebM copy.`, 'error');
    else say(frameSummary());
  } catch (err) {
    say(plain(err, 'Taking frames'), err instanceof Cancelled ? 'idle' : 'error');
  } finally {
    job = null;
    setBusy(false);
    if (view === 'sheet') schedulePreview();
  }
}

async function refresh(quiet = false) {
  try {
    const raw = await formext.readDocument();
    board = toBoard(raw);
    await loadNotes(`${board.projectId}:${board.timelineId}`);
    patchTracks();
    shots = filtered();
    await prepareInstantFrames();
    patchRows();
    if (!quiet || ui.statusBox.dataset.state === 'error') say(frameSummary());
    if (view === 'sheet') schedulePreview();
    void fillFrames();
  } catch (err) {
    say(plain(err, 'Reading the timeline'), 'error');
    if (!board) setText(ui.empty, 'Shot List could not read the timeline.');
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(true), 250);
}

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(renderPreview, 60);
}

function renderPreview() {
  if (!board) return;
  const pages = layout(board, shots, notes, frames.sizes(), sheetOptions(false));
  page = Math.min(page, pages.length - 1);
  const p = pages[page];
  const width = Math.max(200, ui.preview.parentElement!.clientWidth - 20);
  drawPage(ui.preview, p, (width / p.w) * (window.devicePixelRatio || 1), (k) => frames.get(k)?.canvas);
  setText(ui.page, `Page ${page + 1} of ${pages.length}`);
  ui.prev.disabled = page === 0;
  ui.next.disabled = page >= pages.length - 1;
}

function fileStem(): string {
  const base = `${board?.title ?? 'Shot List'} ${board?.timeline ?? ''}`.trim();
  return `${base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Shot List'} shot list`;
}

async function savePdf(): Promise<boolean> {
  if (!board) await refresh();
  if (!board) return false;
  const signal = { cancelled: false };
  job = signal;
  setBusy(true);
  say('Building the PDF…', 'busy');
  try {
    const pages = layout(board, shots, notes, frames.sizes(), sheetOptions(false));
    const keys = [...new Set(pages.flatMap((p) => p.ops.filter((o) => o.t === 'image').map((o) => (o as { key: string }).key)))];
    const images = new Map<string, { jpeg: Uint8Array; w: number; h: number }>();
    for (let i = 0; i < keys.length; i++) {
      if (signal.cancelled) throw new Cancelled();
      const img = await frames.jpeg(keys[i]);
      if (img) images.set(keys[i], img);
      meter(i + 1, keys.length + 1);
    }
    const bytes = buildPdf(pages, (k) => images.get(k), `${board.title} - ${board.timeline}`);
    if (signal.cancelled) throw new Cancelled();
    meter(1, 1);
    say('Choose where to save the PDF…', 'busy');
    const saved = await formext.saveFile(`${fileStem()}.pdf`, 'application/pdf', toBase64(bytes));
    say(`Saved ${saved.name} (${pages.length} ${pages.length === 1 ? 'page' : 'pages'}, ${shots.length} shots).`);
    return true;
  } catch (err) {
    say(plain(err, 'Saving the PDF'), err instanceof Cancelled || (err instanceof FormExtError && err.code === ERR.CANCELLED) ? 'idle' : 'error');
    return false;
  } finally {
    job = null;
    setBusy(false);
  }
}

async function savePng() {
  if (!board) return;
  const signal = { cancelled: false };
  job = signal;
  setBusy(true);
  say('Drawing the sheet…', 'busy');
  try {
    const [p] = layout(board, shots, notes, frames.sizes(), sheetOptions(true));
    const scale = Math.min(2, 16000 / p.h, 8000 / p.w);
    const canvas = document.createElement('canvas');
    drawPage(canvas, p, scale, (k) => frames.get(k)?.canvas);
    meter(1, 2);
    const bytes = await canvasToBytes(canvas, 'image/png');
    if (signal.cancelled) throw new Cancelled();
    meter(2, 2);
    say('Choose where to save the PNG…', 'busy');
    const saved = await formext.saveFile(`${fileStem()}.png`, 'image/png', toBase64(bytes));
    say(`Saved ${saved.name} (${canvas.width} x ${canvas.height}).`);
  } catch (err) {
    say(plain(err, 'Saving the PNG'), err instanceof Cancelled || (err instanceof FormExtError && err.code === ERR.CANCELLED) ? 'idle' : 'error');
  } finally {
    job = null;
    setBusy(false);
  }
}

async function notesToMarkers() {
  if (!board) return;
  const ops = shots
    .filter((s) => (notes[s.clipId] ?? '').trim())
    .map((s) => ({ shot: s, note: `Shot ${s.number}: ${(notes[s.clipId] ?? '').trim()}` }))
    .filter(({ shot, note }) => !shot.markerNotes.includes(note))
    .map(({ shot, note }) => ({ command: 'marker.add', args: { t: Math.round(shot.start * 1000) / 1000, note } }));
  if (!ops.length) {
    say(Object.values(notes).some((v) => v.trim()) ? 'Every note is already on the timeline as a marker.' : 'Write a note on a shot first, then add the notes as markers.');
    return;
  }
  setBusy(true);
  say(`Adding ${ops.length} ${ops.length === 1 ? 'marker' : 'markers'}…`, 'busy');
  try {
    const result = await formext.apply(`Shot notes to markers (${ops.length})`, ops);
    say(`Added ${result.applied} ${result.applied === 1 ? 'marker' : 'markers'}. One Undo removes them all.`);
    formext.notify(`Shot List added ${result.applied} markers`, 'success').catch(() => {});
    scheduleRefresh();
  } catch (err) {
    say(plain(err, 'Adding markers'), 'error');
  } finally {
    setBusy(false);
  }
}

async function addFiles() {
  try {
    const picked = await formext.openFiles(ACCEPT, true);
    const { added, skipped } = frames.addFiles(picked);
    const unmatched = added.filter((name) => !shots.some((s) => frames.sourceFor(s)?.name === name));
    if (skipped.length) say(`Skipped ${skipped.join(', ')}: not a video or image file.`, 'error');
    else if (unmatched.length && unmatched.length === added.length) say(`None of the picked files match a clip on this timeline by name.`, 'error');
    await fillFrames();
  } catch (err) {
    say(plain(err, 'Adding files'), err instanceof FormExtError && err.code === ERR.CANCELLED ? 'idle' : 'error');
  }
}

async function showShot(shot: Shot) {
  try {
    await formext.run('clip.select', { clipId: shot.clipId });
    await formext.run('transport.seek', { time: shot.start });
  } catch (err) {
    say(plain(err, 'Showing the shot'), 'error');
  }
}

function setView(next: 'list' | 'sheet') {
  view = next;
  for (const tab of ui.tabs) {
    const on = tab.dataset.view === next;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  }
  ui.list.hidden = next !== 'list';
  ui.sheet.hidden = next !== 'sheet';
  if (next === 'sheet') renderPreview();
}

function wire() {
  for (const tab of ui.tabs) tab.addEventListener('click', () => setView(tab.dataset.view as 'list' | 'sheet'));
  ui.refresh.addEventListener('click', () => void refresh());
  ui.cancel.addEventListener('click', () => {
    if (job) job.cancelled = true;
  });
  ui.addFiles.addEventListener('click', () => void addFiles());
  ui.markers.addEventListener('click', () => void notesToMarkers());
  ui.savePdf.addEventListener('click', () => void savePdf());
  ui.savePng.addEventListener('click', () => void savePng());
  ui.prev.addEventListener('click', () => {
    page = Math.max(0, page - 1);
    renderPreview();
  });
  ui.next.addEventListener('click', () => {
    page += 1;
    renderPreview();
  });
  ui.track.addEventListener('change', () => {
    prefs.track = ui.track.value;
    savePrefs();
    shots = filtered();
    patchRows();
    if (view === 'sheet') schedulePreview();
  });
  ui.position.addEventListener('change', () => {
    prefs.position = ui.position.value as Position;
    savePrefs();
    shots = filtered();
    void prepareInstantFrames().then(() => {
      patchRows();
      say(frameSummary());
      void fillFrames();
      if (view === 'sheet') schedulePreview();
    });
  });
  const opt = () => {
    prefs.paper = ui.paper.value;
    prefs.columns = Number(ui.columns.value);
    prefs.lines = Number(ui.lines.value);
    savePrefs();
    page = 0;
    if (view === 'sheet') schedulePreview();
  };
  ui.paper.addEventListener('change', opt);
  ui.columns.addEventListener('change', opt);
  ui.lines.addEventListener('change', opt);
  window.addEventListener('resize', () => view === 'sheet' && schedulePreview());
  formext.onEvent((e) => {
    if (e.name === 'document.changed' || e.name === 'selection.changed' || e.name === 'timeline.changed') scheduleRefresh();
  });
  formext.onActivate((a) => {
    if (a.reason !== 'command' || a.command !== 'save-pdf') return null;
    void ready
      .then(() => savePdf())
      .then((ok) => formext.done({ saved: ok }))
      .catch(() => formext.done({ saved: false }).catch(() => {}));
    return null;
  });
}

wire();
ready = (async () => {
  try {
    hello = await formext.hello();
    if (hello.product !== 'formcut') say(`Shot List is made for FormCut; this is ${hello.app}.`, 'error');
  } catch (err) {
    say(plain(err, 'Connecting to FormCut'), 'error');
  }
  await loadPrefs();
  await refresh();
})();
