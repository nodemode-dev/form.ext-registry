import { Box, ShapePath, emptyBox, grow, pathBox, segments, toBezier } from './geometry';
import type { Glyph } from './document';
import { strokeWidth } from './ops';
import { Settings, Timed, progressAt } from './timing';

const NS = 'http://www.w3.org/2000/svg';

function d(p: ShapePath): string {
  if (!p.vertices.length) return '';
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  let s = `M${f(p.vertices[0][0])} ${f(p.vertices[0][1])}`;
  for (const [, a, b, c] of segments(p)) s += `C${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])} ${f(c[0])} ${f(c[1])}`;
  return p.closed ? s + 'Z' : s;
}

export class Preview {
  private timed: Timed[] = [];
  private settings!: Settings;
  private maskEls: SVGPathElement[] = [];
  private inkEls: SVGPathElement[] = [];
  private raf = 0;
  private playing = false;
  private t = 0;
  private last = 0;
  total = 0;
  onTime: (t: number, playing: boolean) => void = () => {};

  constructor(
    private svg: SVGSVGElement,
    private ghost: SVGPathElement,
    private revealed: SVGPathElement,
    private mask: SVGGElement,
    private ink: SVGGElement,
    private guides: SVGGElement,
  ) {}

  clear(): void {
    this.stop();
    this.ghost.setAttribute('d', '');
    this.revealed.setAttribute('d', '');
    this.mask.replaceChildren();
    this.ink.replaceChildren();
    this.guides.replaceChildren();
    this.timed = [];
    this.maskEls = [];
    this.inkEls = [];
    this.total = 0;
    this.t = 0;
    this.onTime(0, false);
  }

  show(glyphs: Glyph[], timed: Timed[], s: Settings): void {
    const wasPlaying = this.playing;
    this.stop();
    this.timed = timed;
    this.settings = s;
    const all = glyphs.flatMap((g) => g.paths);
    const box: Box = all.length ? pathBox(all) : emptyBox();
    for (const t of timed) for (const p of t.stroke.points) grow(box, p);
    if (!isFinite(box.x0)) {
      this.clear();
      return;
    }
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    const m = Math.max(w, h) * 0.06 + 2;
    this.svg.setAttribute('viewBox', `${box.x0 - m} ${box.y0 - m} ${w + 2 * m} ${h + 2 * m}`);
    const outline = all.map(d).join('');
    this.ghost.setAttribute('d', outline);
    this.revealed.setAttribute('d', outline);
    this.mask.replaceChildren();
    this.ink.replaceChildren();
    this.guides.replaceChildren();
    this.maskEls = [];
    this.inkEls = [];
    const dot = Math.max(w, h) * 0.006 + 0.5;
    for (const t of timed) {
      const path = d(toBezier(t.stroke.points, t.stroke.closed));
      const el = document.createElementNS(NS, 'path');
      el.setAttribute('d', path);
      el.setAttribute('pathLength', '1');
      el.setAttribute('stroke-width', strokeWidth(t, s).toFixed(2));
      el.setAttribute('stroke-dasharray', '1 1');
      (s.mode === 'reveal' ? this.mask : this.ink).appendChild(el);
      (s.mode === 'reveal' ? this.maskEls : this.inkEls).push(el);
      const g = document.createElementNS(NS, 'path');
      g.setAttribute('d', path);
      this.guides.appendChild(g);
      const start = document.createElementNS(NS, 'circle');
      start.setAttribute('cx', t.stroke.points[0][0].toFixed(2));
      start.setAttribute('cy', t.stroke.points[0][1].toFixed(2));
      start.setAttribute('r', dot.toFixed(2));
      this.guides.appendChild(start);
    }
    this.ink.setAttribute('stroke', s.ink);
    this.revealed.style.display = s.mode === 'reveal' ? '' : 'none';
    this.total = timed.length ? timed[timed.length - 1].t1 : 0;
    this.seek(wasPlaying ? 0 : this.total);
    if (wasPlaying) this.play();
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.total, t));
    const els = this.settings?.mode === 'reveal' ? this.maskEls : this.inkEls;
    const ease = this.settings?.ease ?? 0;
    for (let i = 0; i < this.timed.length; i++) {
      const p = progressAt(this.timed[i], this.t, ease);
      const el = els[i];
      if (!el) continue;
      el.style.visibility = p <= 0 ? 'hidden' : '';
      el.setAttribute('stroke-dashoffset', (1 - p).toFixed(4));
    }
    this.onTime(this.t, this.playing);
  }

  play(): void {
    if (!this.timed.length) return;
    if (this.t >= this.total) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      const dt = (now - this.last) / 1000;
      this.last = now;
      const next = this.t + dt;
      if (next >= this.total) {
        this.playing = false;
        this.seek(this.total);
        return;
      }
      this.seek(next);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.onTime(this.t, true);
  }

  stop(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.onTime(this.t, false);
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
