import { ERR, formext, FormExtError, toBase64 } from './formext';
import { compass, LIGHT_NAMES, Span } from './astro';
import { dayChart, emptyChart, resolvedPalette, SCREEN, skyChart, standalone } from './chart';
import { ALL_LEAVES, analyse, Analysis, DEFAULT_OPTIONS, keywordOps, leafPath, Options, PhotoRecord, readSelection } from './photos';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  count: $('count'),
  refresh: $<HTMLButtonElement>('refresh'),
  status: $('status'),
  meter: $('meter'),
  statusText: $('status-text'),
  cancel: $<HTMLButtonElement>('cancel'),
  list: $<HTMLUListElement>('list'),
  viewTitle: $('view-title'),
  chart: document.getElementById('chart') as unknown as SVGSVGElement,
  saveSvg: $<HTMLButtonElement>('save-svg'),
  parent: $<HTMLInputElement>('parent'),
  zone: $<HTMLSelectElement>('zone'),
  optTime: $<HTMLInputElement>('opt-time'),
  optDir: $<HTMLInputElement>('opt-dir'),
  optMoon: $<HTMLInputElement>('opt-moon'),
  preview: $('preview'),
  saveCsv: $<HTMLButtonElement>('save-csv'),
  write: $<HTMLButtonElement>('write'),
  segs: [...document.querySelectorAll<HTMLButtonElement>('.gh-seg button')],
  facts: {
    light: $('f-light'),
    sun: $('f-sun'),
    moon: $('f-moon'),
    rise: $('f-rise'),
    golden: $('f-golden'),
    blue: $('f-blue'),
    civil: $('f-civil'),
    nautical: $('f-nautical'),
    astro: $('f-astro'),
    moonrise: $('f-moonrise'),
    phase: $('f-phase'),
    zone: $('f-zone'),
  },
};

const state = {
  options: { ...DEFAULT_OPTIONS } as Options,
  photos: [] as PhotoRecord[],
  results: [] as Analysis[],
  current: -1,
  view: 'day' as 'day' | 'sky',
  run: 0,
  busy: false,
  writing: false,
  canWrite: false,
  canSave: false,
};

function setText(el: HTMLElement, text: string) {
  const t = text || ' ';
  if (el.textContent !== t) el.textContent = t;
}

function status(text: string, progress: number | null = null, error = false) {
  setText(ui.statusText, text);
  ui.status.classList.toggle('is-error', error);
  ui.meter.style.width = progress === null ? '0' : `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

function plain(err: unknown): string {
  if (err instanceof FormExtError) {
    if (err.code === ERR.PERMISSION) return 'Golden Hour is not allowed to read the catalogue. Allow it in the Extensions panel.';
    if (err.code === ERR.CANCELLED) return 'Cancelled.';
    if (err.code === ERR.UNAVAILABLE) return `FormLit could not answer: ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const pad = (n: number) => String(n).padStart(2, '0');

function clock(t: number | null, offsetMin: number) {
  if (t === null) return '';
  const d = new Date(t + offsetMin * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function span(s: Span, offsetMin: number) {
  if (s.start === null && s.end === null) return 'none';
  if (s.start === null) return `until ${clock(s.end, offsetMin)}`;
  if (s.end === null) return `from ${clock(s.start, offsetMin)}`;
  return `${clock(s.start, offsetMin)} to ${clock(s.end, offsetMin)}`;
}

function zoneLabel(min: number) {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function lightLabel(a: Analysis) {
  if (!a.ok) return a.reason ?? '';
  let text = LIGHT_NAMES[a.kind!];
  if (a.kind !== 'daylight' && a.kind !== 'high-sun' && a.kind !== 'night') text += a.rising ? ', morning' : ', evening';
  if (a.lighting) text += `, ${a.lighting}`;
  return text;
}

function fillZones() {
  const offsets: number[] = [];
  for (let m = -12 * 60; m <= 14 * 60; m += 30) offsets.push(m);
  offsets.push(345, 525, 765, -570);
  offsets.sort((a, b) => a - b);
  for (const m of offsets) {
    const o = document.createElement('option');
    o.value = String(m);
    o.textContent = zoneLabel(m);
    ui.zone.append(o);
  }
}

function readOptions(): Options {
  const zone = ui.zone.value === 'auto' ? 'auto' : Number(ui.zone.value);
  return { parent: ui.parent.value.replace(/[|>]+/g, ' ').trim(), timeOfDay: ui.optTime.checked, direction: ui.optDir.checked, moonlit: ui.optMoon.checked, zone };
}

function showOptions(o: Options) {
  ui.parent.value = o.parent;
  ui.zone.value = String(o.zone);
  if (ui.zone.selectedIndex < 0) ui.zone.value = 'auto';
  ui.optTime.checked = o.timeOfDay;
  ui.optDir.checked = o.direction;
  ui.optMoon.checked = o.moonlit;
}

function rowHtml(a: Analysis, i: number) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const time = a.ok ? clock(a.utc!, a.offsetMin!) : '';
  const chip = a.ok ? LIGHT_NAMES[a.kind!] : a.reason ?? '';
  return `<li class="gh-row${a.ok ? '' : ' is-off'}" role="option" data-i="${i}" aria-selected="${i === state.current}"><span class="gh-dot${a.ok ? ` k-${a.kind}` : ''}"></span><span class="gh-name" title="${esc(a.photo.file)}">${esc(a.photo.file)}</span><span class="gh-time">${time}</span><span class="gh-chip">${esc(chip)}</span></li>`;
}

function renderList() {
  if (!state.results.length) {
    const msg = state.busy ? '' : 'Select photos with a location in the Library or Map. Golden Hour reads their place and capture time.';
    ui.list.innerHTML = `<li class="gh-empty">${msg}</li>`;
    return;
  }
  ui.list.innerHTML = state.results.map(rowHtml).join('');
}

function markCurrent() {
  for (const li of ui.list.querySelectorAll<HTMLElement>('.gh-row')) li.setAttribute('aria-selected', String(Number(li.dataset.i) === state.current));
}

function renderDetail() {
  const a = state.results[state.current];
  const F = ui.facts;
  if (!a || !a.ok) {
    setText(ui.viewTitle, a ? a.photo.file : 'No photo');
    ui.chart.innerHTML = emptyChart(SCREEN, a ? `${a.reason}: nothing to compute` : 'Pick a geotagged photo');
    for (const el of Object.values(F)) setText(el, '');
    ui.saveSvg.disabled = true;
    return;
  }
  const e = a.events!;
  const off = a.offsetMin!;
  setText(ui.viewTitle, a.photo.file);
  ui.chart.innerHTML = state.view === 'day' ? dayChart(a, SCREEN) : skyChart(a, SCREEN);
  setText(F.light, `${lightLabel(a)} at ${clock(a.utc!, off)}`);
  setText(F.sun, `${a.sun!.altitude.toFixed(1)}° high, bearing ${Math.round(a.sun!.azimuth)}° ${compass(a.sun!.azimuth)}`);
  setText(F.moon, `${a.moon!.altitude.toFixed(1)}° high, bearing ${Math.round(a.moon!.azimuth)}° ${compass(a.moon!.azimuth)}`);
  setText(F.phase, `${a.moon!.phaseName}, ${Math.round(a.moon!.fraction * 100)}% lit`);
  const polar = e.polar === 'day' ? 'Sun up all day' : e.polar === 'night' ? 'Sun down all day' : '';
  setText(F.rise, polar || `${clock(e.sunrise, off) || 'none'}, sets ${clock(e.sunset, off) || 'none'}, noon ${clock(e.noon, off)}`);
  setText(F.golden, `${span(e.goldenMorning, off)}; ${span(e.goldenEvening, off)}`);
  setText(F.blue, `${span(e.blueMorning, off)}; ${span(e.blueEvening, off)}`);
  const tw = (dawn: number | null, dusk: number | null) => (dawn === null && dusk === null ? 'none today' : `dawn ${clock(dawn, off) || 'none'}, dusk ${clock(dusk, off) || 'none'}`);
  setText(F.civil, tw(e.civilDawn, e.civilDusk));
  setText(F.nautical, tw(e.nauticalDawn, e.nauticalDusk));
  setText(F.astro, tw(e.astroDawn, e.astroDusk));
  setText(F.moonrise, `${clock(e.moonrise, off) || 'none'}, sets ${clock(e.moonset, off) || 'none'}`);
  const src = a.zoneSource === 'photo' ? 'from the photo' : a.zoneSource === 'chosen' ? 'chosen' : 'estimated from longitude';
  setText(F.zone, `${zoneLabel(off)}, ${src}`);
  ui.saveSvg.disabled = !state.canSave;
}

function renderPreview() {
  const ok = state.results.filter((r) => r.ok);
  const ops = keywordOps(state.results, state.options);
  ui.write.disabled = state.busy || state.writing || !state.canWrite || ops.length === 0;
  ui.saveCsv.disabled = state.busy || !state.canSave || ok.length === 0;
  if (!ok.length) {
    setText(ui.preview, state.results.length ? 'None of the selected photos has a location.' : '');
    return;
  }
  const counts = new Map<string, number>();
  for (const r of ok) for (const k of r.keywords) counts.set(k, (counts.get(k) ?? 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(', ');
  setText(ui.preview, ops.length ? `Writes ${list}` : `Already tagged: ${list}`);
  ui.preview.title = ui.preview.textContent ?? '';
}

function recompute() {
  state.options = readOptions();
  state.results = state.photos.map((p) => analyse(p, state.options));
  renderList();
  renderDetail();
  renderPreview();
}

function select(i: number) {
  if (i < 0 || i >= state.results.length || i === state.current) return;
  state.current = i;
  markCurrent();
  renderDetail();
  ui.list.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
}

function summary() {
  const ok = state.results.filter((r) => r.ok).length;
  const n = state.results.length;
  return n ? `${n} selected, ${ok} with a location` : 'No photos selected';
}

async function load() {
  const run = ++state.run;
  state.busy = true;
  ui.cancel.disabled = false;
  ui.refresh.disabled = true;
  renderPreview();
  status('Reading the selection', 0);
  try {
    const sel = await readSelection(formext);
    if (run !== state.run) return;
    const photos = sel.photos;
    const keep = state.results[state.current]?.photo.id;
    state.photos = photos;
    state.results = [];
    for (let i = 0; i < photos.length; i++) {
      state.results.push(analyse(photos[i], state.options));
      if (i % 25 === 24) {
        status(`Working out the light for ${i + 1} of ${photos.length}`, (i + 1) / photos.length);
        await new Promise((r) => setTimeout(r, 0));
        if (run !== state.run) return;
      }
    }
    const ids = photos;
    state.busy = false;
    const again = state.results.findIndex((r) => r.photo.id === keep);
    state.current = again >= 0 ? again : state.results.findIndex((r) => r.ok);
    if (state.current < 0 && state.results.length) state.current = 0;
    setText(ui.count, summary());
    renderList();
    renderDetail();
    renderPreview();
    status(sel.truncated ? `Showing the first ${photos.length} of ${sel.count} selected photos` : ids.length ? 'Times are local to where each photo was taken' : '');
  } catch (err) {
    if (run !== state.run) return;
    state.busy = false;
    setText(ui.count, 'Could not read the selection');
    renderList();
    renderPreview();
    status(plain(err), null, true);
  } finally {
    if (run === state.run) {
      ui.cancel.disabled = true;
      ui.refresh.disabled = false;
    }
  }
}

function cancel() {
  if (!state.busy) return;
  state.run++;
  state.busy = false;
  ui.cancel.disabled = true;
  ui.refresh.disabled = false;
  setText(ui.count, state.results.length ? summary() : 'Stopped');
  renderList();
  renderPreview();
  status('Stopped. Refresh to read the selection again.');
}

async function writeKeywords(fromCommand = false) {
  const ops = keywordOps(state.results, state.options);
  if (!ops.length) return { tagged: 0, ops: 0 };
  state.writing = true;
  renderPreview();
  status('Writing keywords', 0.5);
  try {
    const out = await formext.apply('Golden Hour Keywords', ops);
    const tagged = state.results.filter((r) => r.ok).length;
    const ours = new Set(ALL_LEAVES.map((l) => leafPath(state.options.parent, l).toLowerCase()));
    for (const r of state.results) if (r.ok) r.photo.keywords = [...r.photo.keywords.filter((k) => !ours.has(k.toLowerCase())), ...r.keywords];
    status(`Tagged ${tagged} photo${tagged === 1 ? '' : 's'} in one undo step`, 1);
    if (!fromCommand) formext.notify(`Golden Hour tagged ${tagged} photo${tagged === 1 ? '' : 's'}`, 'success');
    return { tagged, ops: out?.applied ?? ops.length };
  } catch (err) {
    status(plain(err), null, true);
    throw err;
  } finally {
    state.writing = false;
    renderPreview();
  }
}

async function save(name: string, type: string, text: string) {
  try {
    const out = await formext.saveFile(name, type, toBase64(new TextEncoder().encode(text)));
    if (out?.saved) status(`Saved ${out.name || name}`);
  } catch (err) {
    if (err instanceof FormExtError && err.code === ERR.CANCELLED) return;
    status(plain(err), null, true);
  }
}

function csv() {
  const head = ['file', 'local_time', 'utc_offset', 'latitude', 'longitude', 'light', 'sun_altitude', 'sun_azimuth', 'moon_altitude', 'moon_illumination', 'sunrise', 'sunset', 'golden_morning', 'golden_evening', 'blue_morning', 'blue_evening', 'keywords'];
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = state.results.filter((r) => r.ok).map((a) => {
    const e = a.events!;
    const o = a.offsetMin!;
    return [a.photo.file, `${new Date(a.utc! + o * 60_000).toISOString().slice(0, 16).replace('T', ' ')}`, zoneLabel(o), a.photo.lat!.toFixed(5), a.photo.lon!.toFixed(5), lightLabel(a), a.sun!.altitude.toFixed(2), a.sun!.azimuth.toFixed(1), a.moon!.altitude.toFixed(2), a.moon!.fraction.toFixed(2), clock(e.sunrise, o), clock(e.sunset, o), span(e.goldenMorning, o), span(e.goldenEvening, o), span(e.blueMorning, o), span(e.blueEvening, o), a.keywords.join('; ')].map(q).join(',');
  });
  return [head.join(','), ...rows].join('\n') + '\n';
}

let reloadTimer = 0;
function reloadSoon() {
  if (state.writing) return;
  clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => void load(), 250);
}

let optionsTimer = 0;
function optionsChanged() {
  recompute();
  clearTimeout(optionsTimer);
  optionsTimer = window.setTimeout(() => void formext.storageSet('options', state.options).catch(() => undefined), 400);
}

function wire() {
  ui.refresh.addEventListener('click', () => void load());
  ui.cancel.addEventListener('click', cancel);
  ui.list.addEventListener('click', (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>('.gh-row');
    if (li) select(Number(li.dataset.i));
  });
  ui.list.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      select(Math.max(0, Math.min(state.results.length - 1, state.current + (ev.key === 'ArrowDown' ? 1 : -1))));
    }
  });
  for (const b of ui.segs) {
    b.addEventListener('click', () => {
      state.view = b.dataset.view as 'day' | 'sky';
      for (const s of ui.segs) {
        s.classList.toggle('is-on', s === b);
        s.setAttribute('aria-selected', String(s === b));
      }
      renderDetail();
    });
  }
  for (const el of [ui.zone, ui.optTime, ui.optDir, ui.optMoon]) el.addEventListener('change', optionsChanged);
  ui.parent.addEventListener('input', optionsChanged);
  ui.write.addEventListener('click', () => void writeKeywords().catch(() => undefined));
  ui.saveCsv.addEventListener('click', () => void save('golden-hour-timetable.csv', 'text/csv', csv()));
  ui.saveSvg.addEventListener('click', () => {
    const a = state.results[state.current];
    if (!a?.ok) return;
    const p = resolvedPalette();
    const inner = state.view === 'day' ? dayChart(a, p) : skyChart(a, p);
    const base = a.photo.file.replace(/\.[^.]+$/, '');
    void save(`${base}-${state.view === 'day' ? 'sun-path' : 'sky'}.svg`, 'image/svg+xml', standalone(inner, `${a.photo.file}: ${lightLabel(a)}`));
  });
}

formext.onActivate(async (act) => {
  if (act.reason !== 'command') return null;
  if (act.command === 'tag-selected') {
    try {
      await load();
      const out = await writeKeywords(true);
      const ok = state.results.filter((r) => r.ok).length;
      const skipped = state.results.length - ok;
      const msg = !state.results.length ? 'Golden Hour: select photos first' : !ok ? 'Golden Hour: none of the selected photos has a location' : out.ops ? `Golden Hour tagged ${out.tagged} photo${out.tagged === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} without a location` : ''}` : 'Golden Hour: the light keywords are already up to date';
      await formext.notify(msg, ok && out.ops ? 'success' : ok ? 'info' : 'warning');
      await formext.done(out);
    } catch (err) {
      await formext.notify(`Golden Hour: ${plain(err)}`, 'error').catch(() => undefined);
      await formext.done({ error: plain(err) });
    }
  }
  return null;
});

formext.onEvent((ev) => {
  if (ev.name === 'selection.changed' || ev.name === 'document.changed' || ev.name === 'catalog.changed') reloadSoon();
});

fillZones();
wire();
renderList();
renderDetail();

(async () => {
  try {
    const hello = await formext.hello();
    state.canWrite = hello.permissions.includes('document');
    state.canSave = hello.permissions.includes('files-write');
    const saved = await formext.storageGet<Partial<Options>>('options').catch(() => null);
    if (saved && typeof saved === 'object') showOptions({ ...DEFAULT_OPTIONS, ...saved });
    state.options = readOptions();
    if (!state.canWrite) {
      setText(ui.count, 'Waiting for permission');
      status('Golden Hour needs permission to read the catalogue. Allow it in the Extensions panel.', null, true);
      return;
    }
    await load();
  } catch (err) {
    status(plain(err), null, true);
  }
})();
