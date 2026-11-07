export type Pt = [number, number];

export interface ShapePath {
  vertices: Pt[];
  in: Pt[];
  out: Pt[];
  closed: boolean;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function grow(b: Box, p: Pt): void {
  if (p[0] < b.x0) b.x0 = p[0];
  if (p[1] < b.y0) b.y0 = p[1];
  if (p[0] > b.x1) b.x1 = p[0];
  if (p[1] > b.y1) b.y1 = p[1];
}

export function isPath(v: unknown): v is ShapePath {
  const o = v as ShapePath;
  return !!o && Array.isArray(o.vertices) && o.vertices.every((p) => Array.isArray(p) && p.length >= 2);
}

function tangent(list: Pt[] | undefined, i: number): Pt {
  const t = list?.[i];
  return t ? [t[0] || 0, t[1] || 0] : [0, 0];
}

export function segments(p: ShapePath): [Pt, Pt, Pt, Pt][] {
  const n = p.vertices.length;
  const out: [Pt, Pt, Pt, Pt][] = [];
  const count = n < 2 ? 0 : p.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const a = p.vertices[i];
    const b = p.vertices[j];
    const o = tangent(p.out, i);
    const t = tangent(p.in, j);
    out.push([a, [a[0] + o[0], a[1] + o[1]], [b[0] + t[0], b[1] + t[1]], b]);
  }
  return out;
}

export function pathBox(paths: ShapePath[]): Box {
  const b = emptyBox();
  for (const p of paths) for (const s of segments(p)) for (const q of s) grow(b, q);
  return b;
}

export function traceInto(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, paths: ShapePath[], map: (p: Pt) => Pt): void {
  ctx.beginPath();
  for (const p of paths) {
    if (!p.vertices.length) continue;
    const m = map(p.vertices[0]);
    ctx.moveTo(m[0], m[1]);
    for (const [, c1, c2, b] of segments(p)) {
      const u = map(c1);
      const v = map(c2);
      const w = map(b);
      ctx.bezierCurveTo(u[0], u[1], v[0], v[1], w[0], w[1]);
    }
    if (p.closed) ctx.closePath();
  }
}

export function polylineLength(pts: Pt[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 2) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return len;
}

export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d2: number;
      if (L2 < 1e-12) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > best) {
        best = d2;
        bi = i;
      }
    }
    if (bi >= 0 && best > tol2) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function smooth(pts: Pt[], closed: boolean, passes = 2): Pt[] {
  let cur = pts;
  const n = pts.length;
  if (n < 3) return pts.slice();
  for (let k = 0; k < passes; k++) {
    const next: Pt[] = new Array(n);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        next[i] = cur[i];
        continue;
      }
      const a = cur[(i - 1 + n) % n];
      const b = cur[i];
      const c = cur[(i + 1) % n];
      next[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    cur = next;
  }
  return cur;
}

export function toBezier(pts: Pt[], closed: boolean): ShapePath {
  const n = pts.length;
  const ins: Pt[] = [];
  const outs: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let tx = (next[0] - prev[0]) / 6;
    let ty = (next[1] - prev[1]) / 6;
    if (!closed && (i === 0 || i === n - 1)) {
      tx = 0;
      ty = 0;
    }
    ins.push([-tx, -ty]);
    outs.push([tx, ty]);
  }
  return { vertices: pts.map((p) => [p[0], p[1]] as Pt), in: ins, out: outs, closed };
}

export function round(p: ShapePath, digits = 2): ShapePath {
  const k = 10 ** digits;
  const r = (q: Pt): Pt => [Math.round(q[0] * k) / k, Math.round(q[1] * k) / k];
  return { vertices: p.vertices.map(r), in: p.in.map(r), out: p.out.map(r), closed: p.closed };
}
