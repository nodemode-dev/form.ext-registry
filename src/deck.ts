import { formext } from './formext';
import type { SlideInfo } from './plan';

export interface DeckView { key: string; title: string; slides: SlideInfo[]; current: string | null }

interface Snapshot {
  deck?: { id?: string; title?: string };
  current?: { slide?: string; n?: number } | null;
  selection?: { slide?: string } | null;
  slides?: Array<{ id?: string; n?: number; title?: string; notes?: string; hidden?: boolean }>;
}

export async function readDeck(): Promise<DeckView> {
  const snap = await formext.readDocument<Snapshot>('deck');
  const list = Array.isArray(snap?.slides) ? snap.slides : [];
  const slides: SlideInfo[] = list
    .filter((s) => typeof s.id === 'string')
    .map((s, i) => ({
      id: s.id as string,
      n: typeof s.n === 'number' ? s.n : i + 1,
      title: (s.title ?? '').trim() || `Slide ${typeof s.n === 'number' ? s.n : i + 1}`,
      notes: typeof s.notes === 'string' ? s.notes : '',
      hidden: !!s.hidden,
    }));
  return {
    key: snap?.deck?.id || snap?.deck?.title || 'untitled',
    title: snap?.deck?.title ?? '',
    slides,
    current: snap?.current?.slide ?? snap?.selection?.slide ?? null,
  };
}

export function currentFrom(deck: DeckView, data?: unknown): string | null {
  const d = data as { slide?: unknown; n?: unknown } | undefined;
  if (d && typeof d.slide === 'string') return d.slide;
  if (d && typeof d.n === 'number') return deck.slides.find((s) => s.n === d.n)?.id ?? null;
  if (data !== undefined) return null;
  return deck.current && deck.slides.some((s) => s.id === deck.current) ? deck.current : deck.slides[0]?.id ?? null;
}

export async function goToSlide(s: SlideInfo): Promise<void> {
  await formext.run('go-to-slide', { number: s.n });
}

export async function writeNotes(changes: { slide: SlideInfo; notes: string }[], label: string): Promise<void> {
  const ops = changes.map((c) => ({ op: 'set', path: ['slides', { id: c.slide.id }, 'notes'], value: c.notes }));
  await formext.apply(label, [{ command: 'apply-ops', args: { ops } }]);
}
