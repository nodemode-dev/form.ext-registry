import { formext } from './formext.js';
import { $, esc, fill, status, errorText, debounce, headless } from './kit.js';
import { DEFAULTS, merge, hasCells, usesSize, buildSvg, summary, pixelsPerUnit } from './grid.js';
import { gridImage, withDpi, grayscale, fromBase64, toBase64 } from './image.js';

const TOKEN = /\[(g[a-z0-9]{4,8})\]\s*$/;
const fields = [...document.querySelectorAll('[data-k]')];

let doc = null; // the last document snapshot
let editing = null; // { id, token, name, known } when a grid layer is active
let forceNew = false;

// ---- storage: the last settings, and each grid's settings by its token ----

async function lastSettings() {
  return merge(await formext.storageGet('last').catch(() => null));
}
async function registry() {
  return (await formext.storageGet('grids').catch(() => null)) ?? {};
}
async function remember(token, s) {
  const all = await registry();
  if (s) all[token] = s;
  else delete all[token];
  await formext.storageSet('grids', all);
}

// ---- the form ----

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}

function readForm() {
  const s = merge({});
  for (const el of fields) {
    const k = el.dataset.k;
    if (el.type === 'radio') {
      if (el.checked) setPath(s, k, el.value);
    } else if (el.type === 'checkbox') setPath(s, k, el.checked);
    else if (el.type === 'number' || el.type === 'range') {
      const v = Number(el.value);
      setPath(s, k, Number.isFinite(v) && el.value !== '' ? v : getPath(DEFAULTS, k));
    } else setPath(s, k, el.value);
  }
  return s;
}

function writeForm(s) {
  for (const el of fields) {
    const v = getPath(s, el.dataset.k);
    if (el.type === 'radio') el.checked = el.value === v;
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  }
  sync();
}

function sync() {
  const s = readForm();
  const on = {
    size: usesSize(s.type),
    cells: s.sizeMode === 'cells',
    print: s.sizeMode === 'print',
    rows: s.type === 'square' && !s.square,
    'square-only': s.type === 'square',
    radial: s.type === 'radial',
    major: usesSize(s.type),
    'major-on': s.major.on,
    'cells-type': hasCells(s.type),
    'border-on': s.border.on,
  };
  for (const el of document.querySelectorAll('[data-show]')) {
    const show = el.dataset.show.split(' ').every((t) => on[t]);
    if (el.hidden === show) el.hidden = !show;
  }
  const printMode = usesSize(s.type) && s.sizeMode === 'print';
  const text = (el, v) => el && el.textContent !== v && (el.textContent = v);
  text($('#border-unit'), printMode ? s.unit : 'px');
  for (const el of document.querySelectorAll('[data-unit]')) text(el, s.unit);
  text($('#opacity-out'), `${Math.round(s.stroke.opacity * 100)} %`);
  text($('#stroke-hex'), s.stroke.color);
  text($('#border-hex'), s.border.color);
  let hint = '';
  if (doc?.open && printMode) {
    const ppu = pixelsPerUnit(s, doc.width);
    const h = Math.round((s.printWidth * doc.height * 100) / doc.width) / 100;
    const ppi = s.unit === 'in' ? ppu : ppu * 2.54;
    hint = `Prints ${s.printWidth} × ${h} ${s.unit}, ${Math.round(ppi)} ppi`;
  } else if (doc?.open && usesSize(s.type)) hint = summary(s, doc.width, doc.height);
  if ($('#print-hint').textContent !== hint) $('#print-hint').textContent = hint;
}

function renderMode() {
  const isEdit = !!editing && !forceNew;
  const box = $('#mode');
  box.dataset.editing = String(isEdit);
  const label = isEdit
    ? `Editing <b>${esc(editing.name.replace(/^Grid\s*·\s*/, ''))}</b>`
    : doc?.open
      ? 'Adds a new grid layer'
      : 'Open a picture to add a grid';
  fill($('#mode-text'), label);
  $('#mode-text').title = isEdit && !editing.known ? 'Saved settings not found; Update uses the panel as it is.' : '';
  $('#apply').textContent = isEdit ? 'Update Grid' : 'Add Grid Overlay';
  $('#delete').hidden = !isEdit;
  $('#apply').disabled = !doc?.open;
  $('#export').disabled = !doc?.open;
}

// ---- the document ----

function findLayer(layers, pred) {
  for (const l of layers ?? []) {
    if (pred(l)) return l;
    const inner = findLayer(l.children, pred);
    if (inner) return inner;
  }
  return null;
}

// The grid the panel last drew. formvis may briefly report another active layer
// while it settles after our edit; the panel stays on this grid meanwhile.
let pinned = null; // { id, until }

async function refresh() {
  try {
    doc = await formext.readDocument('document');
    fill($('#sub'), doc.open ? `${esc(doc.name)}, ${doc.width} × ${doc.height}` : 'No document open');
    const prev = editing?.id;
    editing = null;
    if (doc.open) {
      const tree = await formext.readDocument('layers');
      let layer = findLayer(tree?.layers, (l) => l.id === tree?.activeLayerId);
      if (!(layer && TOKEN.test(layer.name)) && pinned && Date.now() < pinned.until) {
        layer = findLayer(tree?.layers, (l) => l.id === pinned.id) ?? layer;
      }
      const m = layer && TOKEN.exec(layer.name);
      if (m) {
        const saved = (await registry())[m[1]];
        editing = { id: layer.id, token: m[1], name: layer.name.replace(TOKEN, '').trim(), known: !!saved, layer };
        if (prev !== layer.id && !pinnedJustDrawn(layer.id)) {
          forceNew = false;
          if (saved) writeForm(merge(saved));
        }
      } else if (prev) forceNew = false;
    }
    sync();
    renderMode();
  } catch (err) {
    status(errorText(err), 'error');
  }
}

// The panel already shows the settings of a grid it has just drawn.
function pinnedJustDrawn(id) {
  return pinned?.id === id && Date.now() < pinned.until;
}

// ---- making grids ----

function newToken() {
  return `g${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

async function placeOp(s, d, name) {
  const svg = buildSvg(s, d.width, d.height);
  const img = await gridImage(svg, d.width, d.height);
  return { command: 'tool:place_image', args: { data: img.data, name, x: 0, y: 0, fit: 'none', center: false } };
}

// The id of the layer a place_image op made: from its result, else by the grid's token.
async function placedId(result, token, notId) {
  const id = result?.id ?? result?.layerId ?? result?.layer?.id;
  if (typeof id === 'string' && id !== notId) return id;
  const tree = await formext.readDocument('layers');
  const hit = findLayer(tree?.layers, (l) => l.id !== notId && TOKEN.exec(l.name)?.[1] === token);
  return hit?.id ?? null;
}

// Neighbours of a layer among its siblings (layers are listed bottom first).
function neighbours(layers, id) {
  for (const list of walkLists(layers)) {
    const i = list.findIndex((l) => l.id === id);
    if (i >= 0) return { above: list[i + 1]?.id ?? null, below: list[i - 1]?.id ?? null };
  }
  return { above: null, below: null };
}
function* walkLists(layers) {
  if (!layers?.length) return;
  yield layers;
  for (const l of layers) yield* walkLists(l.children);
}

function settle(id) {
  pinned = { id, until: Date.now() + 2500 };
}

async function addGrid(s) {
  const d = await formext.readDocument('document');
  if (!d.open) throw new Error('Open a picture first.');
  const token = newToken();
  const name = `Grid · ${summary(s, d.width, d.height)} [${token}]`;
  const r = await formext.apply('Add Grid Overlay', [await placeOp(s, d, name)]);
  await remember(token, s);
  await formext.storageSet('last', s);
  const id = await placedId(r?.results?.[0], token);
  if (id) {
    settle(id);
    // Select the new grid so the panel goes on editing it.
    await formext.run('tool:set_layer', { id, active: true }).catch(() => undefined);
  }
  return { name, token, id };
}

async function updateGrid(s, target) {
  const d = await formext.readDocument('document');
  if (!d.open) throw new Error('Open a picture first.');
  const name = `Grid · ${summary(s, d.width, d.height)} [${target.token}]`;
  const tree = await formext.readDocument('layers');
  const old = findLayer(tree?.layers, (l) => l.id === target.id) ?? target.layer ?? {};
  const near = neighbours(tree?.layers, target.id);
  // The new grid goes in first (formvis puts it on top) and the old one is removed.
  const r = await formext.apply('Update Grid Overlay', [
    await placeOp(s, d, name),
    { command: 'tool:delete_layer', args: { id: target.id } },
  ]);
  await remember(target.token, s);
  await formext.storageSet('last', s);
  const id = await placedId(r?.results?.[0], target.token, target.id);
  if (!id) return { name };
  settle(id);
  // Back to where the old grid sat, with its visibility, opacity and blend, and selected.
  const ops = [];
  if (near.above) ops.push({ command: 'tool:move_layer', args: { id, target: near.above, where: 'below' } });
  else if (near.below) ops.push({ command: 'tool:move_layer', args: { id, target: near.below, where: 'above' } });
  ops.push({
    command: 'tool:set_layer',
    args: { id, visible: old.visible ?? true, opacity: old.opacity ?? 1, blend: old.blend ?? 'normal', active: true },
  });
  await formext.apply('Update Grid Overlay', ops).catch(() =>
    formext.run('tool:set_layer', { id, active: true }).catch(() => undefined),
  );
  return { name, id };
}

async function deleteGrid(target) {
  await formext.apply('Delete Grid Overlay', [{ command: 'tool:delete_layer', args: { id: target.id } }]);
  await remember(target.token, null);
  pinned = null;
}

// ---- print export ----

async function exportForPrint(s) {
  const d = await formext.readDocument('document');
  if (!d.open) throw new Error('Open a picture first.');
  const img = await formext.readDocument({ what: 'image', max_size: 4096 });
  if (!img?.data) throw new Error('formvis did not hand over the picture.');
  const printMode = usesSize(s.type) && s.sizeMode === 'print';
  const widthIn = printMode ? (s.unit === 'in' ? s.printWidth : s.printWidth / 2.54) : 0;
  const dpi = widthIn > 0 ? img.width / widthIn : (d.resolution || 72) * (img.width / d.width);
  const base = (d.name || 'Artwork').replace(/\.[a-z0-9]+$/i, '');
  const saved = [];
  const color = withDpi(fromBase64(img.data), dpi);
  const r1 = await formext.saveFile(`${base} - grid.png`, 'image/png', toBase64(color));
  saved.push(r1?.name ?? `${base} - grid.png`);
  if (s.grayscale) {
    const gray = withDpi(await grayscale(img.data), dpi);
    const r2 = await formext.saveFile(`${base} - grid values.png`, 'image/png', toBase64(gray));
    saved.push(r2?.name ?? `${base} - grid values.png`);
  }
  const scaled = img.width < d.width ? ` (scaled to ${img.width} × ${img.height}, the largest formvis hands over)` : '';
  return { saved, dpi: Math.round(dpi), note: scaled };
}

// formvis's document.read takes { what, max_size }; readDocument only sends `what`.
formext.readDocument = function (what) {
  if (what === undefined) return this.call('document.read', {});
  return this.call('document.read', typeof what === 'object' ? what : { what });
};

// ---- wiring ----

let busy = false;
async function guard(label, fn) {
  if (busy) return;
  busy = true;
  status(label);
  try {
    await fn();
  } catch (err) {
    status(errorText(err), 'error');
  } finally {
    busy = false;
  }
}

const later = debounce(() => {
  sync();
  formext.storageSet('last', readForm()).catch(() => undefined);
}, 150);
for (const el of fields) {
  el.addEventListener('input', later);
  el.addEventListener('change', () => {
    sync();
    later();
  });
}

$('#new').addEventListener('click', () => {
  forceNew = true;
  renderMode();
});

$('#apply').addEventListener('click', () =>
  guard('Drawing grid…', async () => {
    const s = readForm();
    if (editing && !forceNew) {
      const r = await updateGrid(s, editing);
      status(`Updated ${r.name.replace(TOKEN, '').trim()}`, 'success');
    } else {
      const r = await addGrid(s);
      forceNew = false;
      if (r.id) editing = { id: r.id, token: r.token, name: r.name.replace(TOKEN, '').trim(), known: true };
      status(`Added ${r.name.replace(TOKEN, '').trim()}`, 'success');
    }
    await refresh();
  }),
);

$('#delete').addEventListener('click', () =>
  guard('Deleting grid…', async () => {
    if (!editing) return;
    await deleteGrid(editing);
    status('Grid deleted', 'success');
    await refresh();
  }),
);

$('#export').addEventListener('click', () =>
  guard('Preparing print file…', async () => {
    const r = await exportForPrint(readForm());
    status(`Saved ${r.saved.join(' and ')} at ${r.dpi} ppi${r.note}`, 'success');
  }),
);

headless(async (activation) => {
  if (activation.command !== 'add-grid') return { skipped: activation.command };
  const r = await addGrid(await lastSettings());
  await formext.notify(`Added ${r.name.replace(TOKEN, '').trim()}`, 'success');
  return r;
});

const refreshSoon = debounce(refresh, 150);
formext.onEvent(({ name }) => {
  if (name === 'document.changed' || name === 'document.switched' || name === 'layer.activated') refreshSoon();
});

// formvis gives an extension frame 240 px until it asks for more: size the frame to the
// panel's content, and again whenever a section opens or closes or a row shows or hides.
function fitFrame() {
  let last = 0;
  const send = () => {
    const h = Math.ceil($('main').getBoundingClientRect().height);
    if (h < 40 || Math.abs(h - last) < 2) return;
    last = h;
    formext.resize(h).catch(() => undefined);
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(send));
  ro.observe($('main'));
  for (const d of document.querySelectorAll('details')) d.addEventListener('toggle', send);
  send();
}

await formext.hello();
fitFrame();
const start = await lastSettings();
writeForm(start);
await refresh();
if (doc?.open && !(await formext.storageGet('last').catch(() => null))) {
  // First run: a line width that reads at print size for this picture.
  // Only the width field, so a selected grid's loaded settings stay as they are.
  const w = Math.max(2, Math.round(Math.min(doc.width, doc.height) / 500));
  if (!editing) {
    $('[data-k="stroke.width"]').value = String(w);
    sync();
  }
}
renderMode();
