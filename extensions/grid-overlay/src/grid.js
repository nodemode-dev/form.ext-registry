// Grid geometry and SVG drawing. One SVG per grid, the size of the document,
// so the layer lines up 1:1 with the art.

export const TYPES = {
  thirds: 'Rule of thirds',
  square: 'Square grid',
  phi: 'Golden ratio',
  triangle: 'Triangular / isometric',
  radial: 'Radial / center lines',
};

export const DEFAULTS = {
  type: 'thirds',
  sizeMode: 'cells', // 'cells' | 'print'
  cols: 6,
  rows: 4,
  square: true,
  unit: 'in', // 'in' | 'cm'
  printWidth: 16,
  cellSize: 2,
  center: false,
  stroke: { width: 3, color: '#000000', opacity: 0.8, style: 'solid' },
  major: { on: false, every: 4, mult: 2.5 },
  diagonals: false,
  labels: false,
  edge: false,
  border: { on: false, width: 40, color: '#ffffff' },
  radial: { spokes: 8, rings: 0 },
  grayscale: false,
};

const SECTIONS = ['stroke', 'major', 'border', 'radial'];

export function merge(saved) {
  const out = { ...DEFAULTS, ...(saved ?? {}) };
  for (const k of SECTIONS) out[k] = { ...DEFAULTS[k], ...(saved?.[k] ?? {}) };
  if (!TYPES[out.type]) out.type = DEFAULTS.type;
  return out;
}

export const hasCells = (type) => type === 'thirds' || type === 'square' || type === 'phi';
export const usesSize = (type) => type === 'square' || type === 'triangle';

const FRACTIONS = { thirds: [1 / 3, 2 / 3], phi: [0.381966, 0.618034] };
const n = (v) => Math.round(v * 100) / 100;
const pos = (v, lo, hi) => (Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : lo);

// Pixels per print unit (inch or cm) when the whole image is printed at printWidth.
export function pixelsPerUnit(s, W) {
  return W / pos(s.printWidth, 0.1, 10000);
}

export function borderPx(s, W) {
  if (!s.border.on) return 0;
  const w = s.sizeMode === 'print' && usesSize(s.type) ? s.border.width * pixelsPerUnit(s, W) : s.border.width;
  return Math.max(0, w);
}

// Lines strictly inside [start, start+len], every `step`, starting at `offset`.
function run(start, len, step, offset) {
  const lines = [];
  if (!(step > 0.5)) return lines;
  for (let k = 0, p = offset; p < len - 0.01 && k < 5000; k++, p = offset + k * step) {
    if (p > 0.01) lines.push({ p: start + p, k });
  }
  return lines;
}

export function layout(s, W, H) {
  const b = Math.min(borderPx(s, W), Math.min(W, H) / 2 - 1);
  const area = { x: b, y: b, w: Math.max(1, W - 2 * b), h: Math.max(1, H - 2 * b) };
  let xs = [];
  let ys = [];
  if (s.type === 'thirds' || s.type === 'phi') {
    xs = FRACTIONS[s.type].map((f, k) => ({ p: area.x + f * area.w, k: k + 1 }));
    ys = FRACTIONS[s.type].map((f, k) => ({ p: area.y + f * area.h, k: k + 1 }));
  } else if (s.type === 'square') {
    let cw, ch;
    if (s.sizeMode === 'print') {
      cw = ch = pos(s.cellSize, 0.01, 1e5) * pixelsPerUnit(s, W);
    } else {
      cw = area.w / pos(Math.round(s.cols), 1, 500);
      ch = s.square ? cw : area.h / pos(Math.round(s.rows), 1, 500);
    }
    const ox = s.center ? (area.w % cw) / 2 : 0;
    const oy = s.center ? (area.h % ch) / 2 : 0;
    xs = run(area.x, area.w, cw, ox);
    ys = run(area.y, area.h, ch, oy);
    // A centred grid counts major lines out from the middle, so they sit symmetrically.
    if (s.center) {
      const recount = (lines, start, len, step, off) => {
        const mid = Math.round((len / 2 - off) / step);
        for (const l of lines) l.k = Math.abs(Math.round((l.p - start - off) / step) - mid);
      };
      recount(xs, area.x, area.w, cw, ox);
      recount(ys, area.y, area.h, ch, oy);
    }
  }
  return { area, xs, ys, border: b };
}

export function triangleSide(s, W, area) {
  if (s.sizeMode === 'print') return pos(s.cellSize, 0.01, 1e5) * pixelsPerUnit(s, W);
  return area.w / pos(Math.round(s.cols), 1, 500);
}

export function colName(i) {
  let out = '';
  for (let v = i + 1; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(65 + ((v - 1) % 26)) + out;
  return out;
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

function dash(style, w) {
  if (style === 'dashed') return ` stroke-dasharray="${n(w * 4)} ${n(w * 3)}"`;
  if (style === 'dotted') return ` stroke-dasharray="0 ${n(w * 2.5)}" stroke-linecap="round"`;
  return '';
}

function strokePath(d, w, style) {
  if (!d) return '';
  return `<path d="${d}" stroke-width="${n(w)}"${dash(style, w)}/>`;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function buildSvg(s, W, H) {
  const L = layout(s, W, H);
  const { area } = L;
  const sw = pos(s.stroke.width, 0.25, 500);
  const majorW = sw * pos(s.major.mult, 1, 20);
  const every = Math.max(1, Math.round(s.major.every) || 1);
  const isMajor = (k) => s.major.on && k % every === 0;
  const minor = [];
  const major = [];
  const add = (k, seg, allowMajor = true) => (allowMajor && isMajor(k) ? major : minor).push(seg);
  const x0 = area.x, y0 = area.y, x1 = area.x + area.w, y1 = area.y + area.h;
  const parts = [];

  if (L.border > 0) {
    parts.push(
      `<path fill="${esc(s.border.color)}" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${n(x0)} ${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z"/>`,
    );
  }

  let clip = '';
  if (s.type === 'triangle') {
    const side = triangleSide(s, W, area);
    const h = (side * Math.sqrt(3)) / 2;
    const slant = area.h / Math.sqrt(3);
    if (side > 1) {
      for (let j = 1; j * h < area.h - 0.01 && j < 5000; j++) add(j, `M${n(x0)} ${n(y0 + j * h)}H${n(x1)}`);
      const kLo = Math.floor(-slant / side) - 1;
      const kHi = Math.ceil((area.w + slant) / side) + 1;
      for (let k = kLo; k <= kHi && k - kLo < 10000; k++) {
        const xa = x0 + k * side;
        add(Math.abs(k), `M${n(xa)} ${n(y0)}L${n(xa + slant)} ${n(y1)}`);
        add(Math.abs(k), `M${n(xa)} ${n(y0)}L${n(xa - slant)} ${n(y1)}`);
      }
    }
    clip = 'triangle';
  } else if (s.type === 'radial') {
    const cx = x0 + area.w / 2, cy = y0 + area.h / 2;
    const R = Math.hypot(area.w, area.h);
    const spokes = Math.max(2, Math.min(360, Math.round(s.radial.spokes) || 8));
    for (let i = 0; i < spokes; i++) {
      const a = (i * 2 * Math.PI) / spokes;
      minor.push(`M${n(cx)} ${n(cy)}L${n(cx + Math.cos(a) * R)} ${n(cy + Math.sin(a) * R)}`);
    }
    // The centre cross is always there, drawn heavier.
    major.push(`M${n(cx)} ${n(y0)}V${n(y1)}M${n(x0)} ${n(cy)}H${n(x1)}`);
    const rings = Math.max(0, Math.min(200, Math.round(s.radial.rings) || 0));
    const step = Math.min(area.w, area.h) / 2 / Math.max(1, rings);
    for (let i = 1; i <= rings; i++) {
      const r = i * step;
      minor.push(`M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`);
    }
    clip = 'radial';
  } else {
    for (const l of L.xs) add(l.k, `M${n(l.p)} ${n(y0)}V${n(y1)}`, s.type === 'square');
    for (const l of L.ys) add(l.k, `M${n(x0)} ${n(l.p)}H${n(x1)}`, s.type === 'square');
  }

  const lines = [];
  lines.push(strokePath(minor.join(''), sw, s.stroke.style));
  // Radial's centre cross is heavier even without major lines turned on.
  const mw = s.type === 'radial' && !s.major.on ? sw * 1.6 : majorW;
  lines.push(strokePath(major.join(''), mw, s.stroke.style));

  // Cell boundaries, for diagonals and labels.
  const bx = [x0, ...L.xs.map((l) => l.p), x1];
  const by = [y0, ...L.ys.map((l) => l.p), y1];

  if (s.diagonals && hasCells(s.type)) {
    let d = '';
    for (let i = 0; i < bx.length - 1; i++) {
      for (let j = 0; j < by.length - 1; j++) {
        const [a, b, c, e] = [bx[i], by[j], bx[i + 1], by[j + 1]].map(n);
        d += `M${a} ${b}L${c} ${e}M${c} ${b}L${a} ${e}`;
      }
    }
    lines.push(`<g opacity="0.7">${strokePath(d, Math.max(0.25, sw * 0.6), s.stroke.style)}</g>`);
  }
  if (s.edge) lines.push(strokePath(`M${n(x0)} ${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z`, sw, 'solid'));

  const clipDef = clip
    ? `<defs><clipPath id="a"><rect x="${n(x0)}" y="${n(y0)}" width="${n(area.w)}" height="${n(area.h)}"/></clipPath></defs>`
    : '';
  parts.push(
    `<g fill="none" stroke="${esc(s.stroke.color)}" opacity="${pos(s.stroke.opacity, 0.02, 1)}"${clip ? ' clip-path="url(#a)"' : ''}>${lines.join('')}</g>`,
  );

  if (s.labels && hasCells(s.type)) parts.push(labelsSvg(s, bx, by, L.border));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${clipDef}${parts.join('')}</svg>`;
}

function labelsSvg(s, bx, by, border) {
  const widths = bx.slice(1).map((v, i) => v - bx[i]);
  const heights = by.slice(1).map((v, i) => v - by[i]);
  const typical = Math.min(Math.max(...widths), Math.max(...heights));
  const fs = Math.max(10, Math.min(240, typical * 0.14));
  const inBand = border >= fs * 1.5;
  const color = inBand ? (luminance(s.border.color) > 0.5 ? '#000000' : '#ffffff') : s.stroke.color;
  const halo = luminance(color) > 0.5 ? '#000000' : '#ffffff';
  const style = inBand
    ? `fill="${esc(color)}"`
    : `fill="${esc(color)}" stroke="${halo}" stroke-width="${n(fs * 0.2)}" stroke-linejoin="round" paint-order="stroke"`;
  const out = [];
  const pad = fs * 0.35;
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] < fs * 0.9) continue;
    const t = colName(i);
    if (inBand) out.push(`<text x="${n(bx[i] + widths[i] / 2)}" y="${n(border / 2)}" text-anchor="middle" dominant-baseline="central">${t}</text>`);
    else out.push(`<text x="${n(bx[i] + pad)}" y="${n(by[0] + pad)}" dominant-baseline="hanging">${t}</text>`);
  }
  for (let j = 0; j < heights.length; j++) {
    if (heights[j] < fs * 0.9) continue;
    const t = String(j + 1);
    if (inBand) out.push(`<text x="${n(border / 2)}" y="${n(by[j] + heights[j] / 2)}" text-anchor="middle" dominant-baseline="central">${t}</text>`);
    else if (j > 0 || widths[0] < fs * 0.9) out.push(`<text x="${n(bx[0] + pad)}" y="${n(by[j] + pad)}" dominant-baseline="hanging">${t}</text>`);
    else out.push(`<text x="${n(bx[0] + pad)}" y="${n(by[0] + pad + fs * 1.15)}" dominant-baseline="hanging">${t}</text>`);
  }
  return `<g font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-weight="600" font-size="${n(fs)}" ${style}>${out.join('')}</g>`;
}

// One line describing the grid, for the panel and the layer name.
export function summary(s, W, H) {
  if (!W || !H) return TYPES[s.type];
  const { area } = layout(s, W, H);
  if (s.type === 'square') {
    if (s.sizeMode === 'print') return `${TYPES.square}, ${s.cellSize} ${s.unit} cells`;
    const rows = s.square ? Math.ceil(area.h / (area.w / Math.round(s.cols)) - 0.01) : Math.round(s.rows);
    return `${TYPES.square}, ${Math.round(s.cols)} × ${rows}`;
  }
  if (s.type === 'triangle') return s.sizeMode === 'print' ? `Triangular, ${s.cellSize} ${s.unit}` : `Triangular, ${Math.round(s.cols)} across`;
  if (s.type === 'radial') return `Radial, ${Math.round(s.radial.spokes)} spokes`;
  return TYPES[s.type];
}
