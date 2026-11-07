import { Box, Pt, ShapePath, pathBox, polylineLength, simplify, smooth, traceInto } from './geometry';

export interface Stroke {
  points: Pt[];
  closed: boolean;
  dot: boolean;
  halfWidth: number;
  medianHalf: number;
  length: number;
}

export interface Raster {
  w: number;
  h: number;
  ink: Uint8Array;
  box: Box;
  scale: number;
  pad: number;
}

const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const MAX_SIDE = 1400;

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function context(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    if (c) return c;
  }
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const c = el.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('this window cannot draw the letters (no canvas)');
  return c;
}

export function rasterize(paths: ShapePath[], scale: number): Raster | null {
  const box = pathBox(paths);
  if (!isFinite(box.x0) || box.x1 - box.x0 <= 0 || box.y1 - box.y0 <= 0) return null;
  const pad = 4;
  let s = scale;
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) * s;
  if (side > MAX_SIDE) s = (s * MAX_SIDE) / side;
  const w = Math.ceil((box.x1 - box.x0) * s) + pad * 2;
  const h = Math.ceil((box.y1 - box.y0) * s) + pad * 2;
  const ctx = context(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  traceInto(ctx, paths, (p) => [(p[0] - box.x0) * s + pad, (p[1] - box.y0) * s + pad]);
  ctx.fill('nonzero');
  const data = ctx.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  return { w, h, ink, box, scale: s, pad };
}

function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

export function distance(r: Raster): Float64Array {
  const { w, h, ink } = r;
  const BIG = 1e12;
  const out = new Float64Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = ink[y * w + x] ? BIG : 0;
    edt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

export function thin(r: Raster): Uint8Array {
  const { w, h } = r;
  const img = r.ink.slice();
  const del: number[] = [];
  let changed = true;
  const p = new Uint8Array(8);
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          let b = 0;
          for (let k = 0; k < 8; k++) {
            p[k] = img[(y + DY[k]) * w + x + DX[k]];
            b += p[k];
          }
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
          if (a !== 1) continue;
          if (pass === 0) {
            if (p[0] && p[2] && p[4]) continue;
            if (p[2] && p[4] && p[6]) continue;
          } else {
            if (p[0] && p[2] && p[6]) continue;
            if (p[0] && p[4] && p[6]) continue;
          }
          del.push(i);
        }
      }
      if (del.length) changed = true;
      for (const i of del) img[i] = 0;
    }
  }
  return img;
}

interface Node {
  x: number;
  y: number;
  hw: number;
  edges: number[];
}

interface Edge {
  a: number;
  b: number;
  px: number[];
  dead: boolean;
}

function crossing(sk: Uint8Array, w: number, i: number): number {
  const x = i % w;
  const y = (i - x) / w;
  let a = 0;
  for (let k = 0; k < 8; k++) {
    const p = sk[(y + DY[k]) * w + x + DX[k]];
    const q = sk[(y + DY[(k + 1) % 8]) * w + x + DX[(k + 1) % 8]];
    if (!p && q) a++;
  }
  return a;
}

function neighbours(w: number, i: number): number[] {
  const x = i % w;
  const y = (i - x) / w;
  const out: number[] = [];
  for (const k of [0, 2, 4, 6, 1, 3, 5, 7]) out.push((y + DY[k]) * w + x + DX[k]);
  return out;
}

class Graph {
  nodes: Node[] = [];
  edges: Edge[] = [];
  nodeOf: Int32Array;

  constructor(private sk: Uint8Array, private w: number, private dist: Float64Array) {
    this.nodeOf = new Int32Array(sk.length).fill(-1);
  }

  build(): void {
    const { sk, w } = this;
    const kind = new Int8Array(sk.length);
    for (let i = 0; i < sk.length; i++) {
      if (!sk[i]) continue;
      const cn = crossing(sk, w, i);
      kind[i] = cn === 2 ? 2 : cn >= 3 ? 3 : 1;
    }
    for (let i = 0; i < sk.length; i++) {
      if (!sk[i] || kind[i] === 2 || this.nodeOf[i] >= 0) continue;
      const id = this.nodes.length;
      const node: Node = { x: 0, y: 0, hw: 0, edges: [] };
      const stack = [i];
      this.nodeOf[i] = id;
      let n = 0;
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % w;
        node.x += x;
        node.y += (j - x) / w;
        node.hw = Math.max(node.hw, this.dist[j]);
        n++;
        if (kind[j] !== 3) continue;
        for (const q of neighbours(w, j)) {
          if (sk[q] && kind[q] === 3 && this.nodeOf[q] < 0) {
            this.nodeOf[q] = id;
            stack.push(q);
          }
        }
      }
      node.x /= n;
      node.y /= n;
      this.nodes.push(node);
    }
    const seen = new Uint8Array(sk.length);
    const direct = new Set<string>();
    for (let i = 0; i < sk.length; i++) {
      const a = this.nodeOf[i];
      if (a < 0) continue;
      for (const q of neighbours(w, i)) {
        if (!sk[q]) continue;
        const b = this.nodeOf[q];
        if (b === a) continue;
        if (b >= 0) {
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (!direct.has(key)) {
            direct.add(key);
            this.addEdge(a, b, [i, q]);
          }
          continue;
        }
        if (seen[q]) continue;
        this.walk(a, i, q, seen);
      }
    }
    for (let i = 0; i < sk.length; i++) {
      if (!sk[i] || this.nodeOf[i] >= 0 || seen[i]) continue;
      const id = this.nodes.length;
      const x = i % w;
      this.nodes.push({ x, y: (i - x) / w, hw: this.dist[i], edges: [] });
      this.nodeOf[i] = id;
      for (const q of neighbours(w, i)) {
        if (sk[q] && !seen[q] && this.nodeOf[q] < 0) {
          this.walk(id, i, q, seen);
          break;
        }
      }
    }
  }

  private walk(a: number, from: number, start: number, seen: Uint8Array): void {
    const { sk, w } = this;
    const px = [from, start];
    seen[start] = 1;
    let prev = from;
    let cur = start;
    for (;;) {
      let end = -1;
      let next = -1;
      for (const q of neighbours(w, cur)) {
        if (!sk[q] || q === prev) continue;
        const b = this.nodeOf[q];
        if (b >= 0) {
          if (b !== a || px.length > 3) {
            end = q;
            break;
          }
          continue;
        }
        if (!seen[q] && next < 0) next = q;
      }
      if (end >= 0) {
        px.push(end);
        this.addEdge(a, this.nodeOf[end], px);
        return;
      }
      if (next < 0) {
        const id = this.nodes.length;
        const x = cur % w;
        this.nodes.push({ x, y: (cur - x) / w, hw: this.dist[cur], edges: [] });
        this.nodeOf[cur] = id;
        this.addEdge(a, id, px);
        return;
      }
      seen[next] = 1;
      px.push(next);
      prev = cur;
      cur = next;
    }
  }

  addEdge(a: number, b: number, px: number[]): number {
    const id = this.edges.length;
    this.edges.push({ a, b, px, dead: false });
    this.nodes[a].edges.push(id);
    this.nodes[b].edges.push(id);
    return id;
  }

  degree(n: number): number {
    return this.nodes[n].edges.filter((e) => !this.edges[e].dead).length;
  }

  live(n: number): number[] {
    return this.nodes[n].edges.filter((e) => !this.edges[e].dead);
  }

  prune(): void {
    for (let round = 0; round < 6; round++) {
      let changed = false;
      for (let e = 0; e < this.edges.length; e++) {
        const E = this.edges[e];
        if (E.dead || E.a === E.b) continue;
        const da = this.degree(E.a);
        const db = this.degree(E.b);
        const tip = da === 1 && db >= 3 ? E.b : db === 1 && da >= 3 ? E.a : -1;
        if (tip < 0) continue;
        const limit = 1.6 * this.nodes[tip].hw + 2;
        if (E.px.length < limit) {
          E.dead = true;
          changed = true;
        }
      }
      for (let n = 0; n < this.nodes.length; n++) {
        const live = this.live(n);
        if (live.length !== 2 || live[0] === live[1]) continue;
        const [e1, e2] = live.map((e) => this.edges[e]);
        if (e1.a === e1.b || e2.a === e2.b) continue;
        const p1 = e1.b === n ? e1.px : e1.px.slice().reverse();
        const p2 = e2.a === n ? e2.px : e2.px.slice().reverse();
        const o1 = e1.b === n ? e1.a : e1.b;
        const o2 = e2.a === n ? e2.b : e2.a;
        e1.dead = true;
        e2.dead = true;
        this.addEdge(o1, o2, p1.concat(p2.slice(1)));
        changed = true;
      }
      if (!changed) break;
    }
  }

  dir(px: number[], atNode: number, reach: number): Pt {
    const q = px[Math.min(px.length - 1, Math.max(1, Math.round(reach)))];
    const n = this.nodes[atNode];
    const x = q % this.w;
    const dx = x - n.x;
    const dy = (q - x) / this.w - n.y;
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  }

  strokes(): { px: number[]; closed: boolean }[] {
    const partner = new Map<string, string>();
    const end = (e: number, side: 0 | 1) => `${e}:${side}`;
    for (let n = 0; n < this.nodes.length; n++) {
      const live = this.live(n);
      if (live.length < 3) continue;
      const ends: { e: number; side: 0 | 1; d: Pt }[] = [];
      const reach = Math.max(4, Math.min(24, 2 * this.nodes[n].hw));
      for (const e of new Set(live)) {
        const E = this.edges[e];
        if (E.a === n) ends.push({ e, side: 0, d: this.dir(E.px, n, reach) });
        if (E.b === n) ends.push({ e, side: 1, d: this.dir(E.px.slice().reverse(), n, reach) });
      }
      const pairs: { i: number; j: number; s: number }[] = [];
      for (let i = 0; i < ends.length; i++)
        for (let j = i + 1; j < ends.length; j++) {
          const s = -(ends[i].d[0] * ends[j].d[0] + ends[i].d[1] * ends[j].d[1]);
          if (s > 0.55) pairs.push({ i, j, s });
        }
      pairs.sort((p, q) => q.s - p.s);
      const used = new Set<number>();
      for (const p of pairs) {
        if (used.has(p.i) || used.has(p.j)) continue;
        used.add(p.i);
        used.add(p.j);
        const a = end(ends[p.i].e, ends[p.i].side);
        const b = end(ends[p.j].e, ends[p.j].side);
        partner.set(a, b);
        partner.set(b, a);
      }
    }
    const done = new Set<number>();
    const out: { px: number[]; closed: boolean }[] = [];
    const follow = (e: number, entry: 0 | 1): { px: number[]; closed: boolean } => {
      const px: number[] = [];
      let cur = e;
      let side = entry;
      const first = e;
      for (;;) {
        done.add(cur);
        const E = this.edges[cur];
        const seq = side === 0 ? E.px : E.px.slice().reverse();
        px.push(...(px.length ? seq.slice(1) : seq));
        const exit = end(cur, side === 0 ? 1 : 0);
        const nxt = partner.get(exit);
        if (!nxt) return { px, closed: false };
        const [ne, ns] = nxt.split(':').map(Number);
        if (ne === first && ns === entry) return { px, closed: true };
        if (done.has(ne)) return { px, closed: false };
        cur = ne;
        side = ns as 0 | 1;
      }
    };
    for (let e = 0; e < this.edges.length; e++) {
      if (this.edges[e].dead || done.has(e)) continue;
      if (!partner.has(end(e, 0))) out.push(follow(e, 0));
      else if (!partner.has(end(e, 1))) {
        const r = follow(e, 1);
        out.push(r);
      }
    }
    for (let e = 0; e < this.edges.length; e++) {
      if (this.edges[e].dead || done.has(e)) continue;
      out.push(follow(e, 0));
    }
    for (const s of out) {
      if (!s.closed && s.px.length > 3 && s.px[0] === s.px[s.px.length - 1]) {
        s.px.pop();
        s.closed = true;
      }
    }
    return out;
  }
}

function orient(points: Pt[], closed: boolean): Pt[] {
  if (closed) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a[0] * b[1] - b[0] * a[1];
      cx += a[0];
      cy += a[1];
    }
    cx /= points.length;
    cy /= points.length;
    const pts = area > 0 ? points.slice().reverse() : points.slice();
    let best = 0;
    let bv = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const v = (pts[i][0] - cx) * 0.5 - (pts[i][1] - cy) * 0.866;
      if (v > bv) {
        bv = v;
        best = i;
      }
    }
    return pts.slice(best).concat(pts.slice(0, best));
  }
  const a = points[0];
  const b = points[points.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const flip = Math.abs(dx) > 1.5 * Math.abs(dy) ? dx < 0 : dy < 0;
  return flip ? points.slice().reverse() : points;
}

export interface TraceOptions {
  scale: number;
}

export function traceGlyph(paths: ShapePath[], opts: TraceOptions): Stroke[] {
  const r = rasterize(paths, opts.scale);
  if (!r) return [];
  const dist = distance(r);
  const sk = thin(r);
  const g = new Graph(sk, r.w, dist);
  g.build();
  g.prune();
  const s = r.scale;
  const toLayer = (i: number): Pt => {
    const x = i % r.w;
    const y = (i - x) / r.w;
    return [(x + 0.5 - r.pad) / s + r.box.x0, (y + 0.5 - r.pad) / s + r.box.y0];
  };
  const out: Stroke[] = [];
  const maxHw = (px: number[]) => px.reduce((m, i) => Math.max(m, dist[i]), 0);
  const used = new Uint8Array(sk.length);
  for (const st of g.strokes()) {
    if (!st.px.length) continue;
    for (const i of st.px) used[i] = 1;
    const hws = st.px.map((i) => dist[i]).sort((a, b) => a - b);
    const hw = maxHw(st.px);
    const med = hws[Math.floor(hws.length / 2)];
    if (st.px.length < Math.max(3, 0.9 * hw)) {
      out.push(dotStroke(st.px, dist, r, toLayer));
      continue;
    }
    let pts = st.px.map(toLayer);
    pts = smooth(pts, st.closed, 2);
    pts = simplify(pts, 0.7 / s);
    if (st.closed && pts.length > 2) {
      const f = pts[0];
      const l = pts[pts.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1.5 / s) pts.pop();
    }
    if (pts.length < 2) {
      out.push(dotStroke(st.px, dist, r, toLayer));
      continue;
    }
    pts = orient(pts, st.closed);
    out.push({ points: pts, closed: st.closed && pts.length > 2, dot: false, halfWidth: hw / s, medianHalf: med / s, length: polylineLength(pts, st.closed) });
  }
  for (const d of dots(r, dist, used, toLayer)) out.push(d);
  return order(out, (r.box.y1 - r.box.y0) / 6);
}

function dotStroke(px: number[], dist: Float64Array, r: Raster, toLayer: (i: number) => Pt): Stroke {
  let best = px[0];
  for (const i of px) if (dist[i] > dist[best]) best = i;
  const c = toLayer(best);
  const hw = dist[best] / r.scale;
  const k = Math.max(hw * 0.3, 0.5 / r.scale);
  const pts: Pt[] = [
    [c[0] - k, c[1] - k * 0.4],
    [c[0] + k, c[1] + k * 0.4],
  ];
  return { points: pts, closed: false, dot: true, halfWidth: hw, medianHalf: hw, length: polylineLength(pts, false) };
}

function dots(r: Raster, dist: Float64Array, sk: Uint8Array, toLayer: (i: number) => Pt): Stroke[] {
  const { w, h, ink } = r;
  const label = new Int32Array(w * h).fill(-1);
  const out: Stroke[] = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!ink[i] || label[i] >= 0) continue;
    const stack = [i];
    label[i] = next;
    const px: number[] = [];
    let hasSkeleton = false;
    while (stack.length) {
      const j = stack.pop()!;
      px.push(j);
      if (sk[j]) hasSkeleton = true;
      const x = j % w;
      const y = (j - x) / w;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (ink[q] && label[q] < 0) {
          label[q] = next;
          stack.push(q);
        }
      }
    }
    next++;
    if (!hasSkeleton && px.length > 2) out.push(dotStroke(px, dist, r, toLayer));
  }
  return out;
}

function order(strokes: Stroke[], band: number): Stroke[] {
  const key = (s: Stroke) => {
    const p = s.points[0];
    let y = p[1];
    let x = p[0];
    if (s.closed) {
      x = Math.min(...s.points.map((q) => q[0]));
      y = Math.min(...s.points.map((q) => q[1]));
    }
    return { row: Math.floor(y / Math.max(band, 1e-6)), x, y };
  };
  return strokes
    .map((s) => ({ s, k: key(s) }))
    .sort((a, b) => Number(a.s.dot) - Number(b.s.dot) || a.k.row - b.k.row || a.k.x - b.k.x || a.k.y - b.k.y)
    .map((e) => e.s);
}
