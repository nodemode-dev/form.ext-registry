import { round, toBezier } from './geometry';
import type { LayerRow } from './document';
import { HANDWRITING_SUFFIX } from './document';
import type { Settings, Timed } from './timing';

export interface Op {
  command: string;
  args: Record<string, unknown>;
}

export const APPLY_LABEL = 'Handwriting Reveal';

export function strokeWidth(t: Timed, s: Settings): number {
  const hw = t.stroke.halfWidth;
  if (s.mode === 'reveal') return 2 * hw + Math.max(2, 0.5 * hw);
  if (s.inkWidth > 0) return s.inkWidth;
  return Math.max(1, 1.8 * t.stroke.medianHalf);
}

export function strokePath(t: Timed) {
  return round(toBezier(t.stroke.points, t.stroke.closed), 2);
}

export function buildOps(text: LayerRow, previous: LayerRow | undefined, timed: Timed[], s: Settings, start: number): Op[] {
  const ops: Op[] = [];
  const push = (command: string, args: Record<string, unknown>) => {
    ops.push({ command, args });
    return ops.length;
  };
  if (previous) push('edit.clear', { layers: [previous.id] });
  const made = push('layer.newShape', { kind: 'none', name: text.name + HANDWRITING_SUFFIX });
  const L = `$${made}.layer`;
  push('layer.setParent', { layers: [L], parent: text.id });
  push('layer.setTransform', { layers: [L], prop: 'anchor', value: [0, 0] });
  push('layer.setTransform', { layers: [L], prop: 'position', value: [0, 0] });
  push('layer.setTransform', { layers: [L], prop: 'scale', value: [100, 100] });
  push('layer.setTransform', { layers: [L], prop: 'rotation', value: 0 });
  const colour = s.mode === 'ink' ? s.ink : '#ffffff';
  const ease = Math.max(0.1, Math.min(100, s.ease));
  for (let i = timed.length - 1; i >= 0; i--) {
    const t = timed[i];
    const g = push('shape.add', { layer: L, kind: 'group', name: 'Pen' });
    const G = `$${g}.uid`;
    push('shape.add', { layer: L, kind: 'stroke', group: G });
    push('shape.add', { layer: L, kind: 'path', group: G, path: strokePath(t) });
    push('shape.add', { layer: L, kind: 'trim', group: G });
    push('prop.renameGroup', { layer: L, prop: G, name: `Pen ${i + 1}` });
    const base = 'contents/#1/contents';
    push('prop.set', { layer: L, path: `${base}/#2/width`, value: Math.round(strokeWidth(t, s) * 100) / 100 });
    push('prop.set', { layer: L, path: `${base}/#2/cap`, value: 1 });
    push('prop.set', { layer: L, path: `${base}/#2/join`, value: 1 });
    push('prop.set', { layer: L, path: `${base}/#2/color`, value: colour });
    const end = `${base}/#3/end`;
    const t0 = start + t.t0;
    const t1 = start + t.t1;
    push('prop.addKey', { layer: L, path: end, time: t0, value: 0 });
    push('prop.addKey', { layer: L, path: end, time: t1, value: 100 });
    push('keys.setEase', { layer: L, path: end, time: t0, side: 'out', speed: 0, influence: ease });
    push('keys.setEase', { layer: L, path: end, time: t1, side: 'in', speed: 0, influence: ease });
  }
  if (s.mode === 'reveal') {
    push('layer.setSwitch', { layers: [text.id], switch: 'video', value: true });
    push('layer.setTrackMatte', { layer: text.id, matte: L, kind: 'alpha' });
  } else {
    push('layer.setTrackMatte', { layer: text.id, matte: null });
    push('layer.setSwitch', { layers: [text.id], switch: 'video', value: false });
    push('layer.setSwitch', { layers: [L], switch: 'video', value: true });
  }
  push('layer.select', { layers: [L] });
  return ops;
}
