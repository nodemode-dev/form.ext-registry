import { FormExt, FormExtError } from './formext';
import { ShapePath, isPath } from './geometry';

export interface LayerRow {
  id: number;
  index: number;
  name: string;
  type: string;
  in: number;
  out: number;
  selected: boolean;
  parent: number | null;
}

export interface Summary {
  revision: number;
  comp: { id: number; name: string; frameRate: number; duration: number; width: number; height: number } | null;
  time: number;
  layers: LayerRow[];
  selection: { layers: number[] };
}

export interface Glyph {
  char: string;
  paths: ShapePath[];
}

export interface Letters {
  layer: number;
  name: string;
  text: string;
  glyphs: Glyph[];
}

interface TreeNode {
  path: string;
  name: string;
  uid: number;
  group?: boolean;
  type?: string;
  value?: unknown;
  children?: TreeNode[];
}

const PROBE_LABEL = 'Handwriting Reveal: read the letters';

export const HANDWRITING_SUFFIX = ' Handwriting';

export function textLayers(s: Summary): LayerRow[] {
  return (s.layers ?? []).filter((l) => l.type === 'Text');
}

export function existingFor(s: Summary, text: LayerRow): LayerRow | undefined {
  return s.layers.find((l) => l.type === 'Shape' && l.name === text.name + HANDWRITING_SUFFIX && l.parent === text.id);
}

function collectPaths(node: TreeNode, out: ShapePath[]): void {
  if (node.type === 'path' && isPath(node.value)) out.push(node.value);
  for (const c of node.children ?? []) collectPaths(c, out);
}

function findText(nodes: TreeNode[]): string {
  for (const n of nodes) {
    if (n.type === 'text') {
      const v = n.value as { text?: unknown } | string;
      if (typeof v === 'string') return v;
      if (v && typeof v.text === 'string') return v.text;
    }
    const inner = findText(n.children ?? []);
    if (inner) return inner;
  }
  return '';
}

export function glyphsFromTree(nodes: TreeNode[]): Glyph[] {
  const contents = nodes.find((n) => n.group && (n.path === 'contents' || n.name === 'Contents'));
  const out: Glyph[] = [];
  for (const g of contents?.children ?? []) {
    if (!g.group) continue;
    const paths: ShapePath[] = [];
    collectPaths(g, paths);
    if (paths.length) out.push({ char: g.name === 'Space' ? ' ' : g.name, paths });
  }
  return out;
}

export async function readLetters(fx: FormExt, layer: LayerRow): Promise<Letters> {
  const textTree = await fx.run<{ nodes: TreeNode[] }>('layer.tree', { layer: layer.id, depth: 4 });
  const text = findText(textTree?.nodes ?? []);
  const r = await fx.apply(PROBE_LABEL, [
    { command: 'layer.create', args: { op: 'shapesFromText', layers: [layer.id] } },
    { command: 'layer.tree', args: { layer: '$1.layers.0', depth: 8 } },
  ]);
  let undone: unknown = null;
  try {
    undone = await fx.run<{ undone?: string }>('edit.undo', {});
  } catch (err) {
    throw new FormExtError((err as FormExtError).code ?? -32004, `the letters were read, but undoing that step failed (${(err as Error).message}). Choose Edit > Undo once.`);
  }
  const label = (undone as { undone?: string } | null)?.undone;
  if (label && label !== PROBE_LABEL) {
    throw new FormExtError(-32004, `FormVFX undid "${label}" instead of the letter reading step. Choose Edit > Redo, then Edit > Undo on the step named "${PROBE_LABEL}".`);
  }
  const tree = r.results[1] as { nodes?: TreeNode[] } | undefined;
  const glyphs = glyphsFromTree(tree?.nodes ?? []);
  return { layer: layer.id, name: layer.name, text, glyphs };
}

export function spacing(text: string, glyphs: Glyph[]): boolean[] {
  const out: boolean[] = [];
  let i = 0;
  let space = false;
  for (const g of glyphs) {
    let found = false;
    while (i < text.length) {
      const ch = text[i++];
      if (/\s/.test(ch)) {
        space = true;
        continue;
      }
      if (ch === g.char || g.char.length !== 1) {
        found = true;
        break;
      }
    }
    out.push(found ? space && out.length > 0 : false);
    space = false;
  }
  return out;
}
