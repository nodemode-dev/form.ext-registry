export interface MediaInfo {
  id: string;
  name: string;
  kind: string;
  width: number;
  height: number;
  frame?: string;
}

export interface Shot {
  key: string;
  clipId: string;
  number: number;
  name: string;
  kind: string;
  track: string;
  trackIndex: number;
  start: number;
  duration: number;
  sourceIn: number;
  speed: number;
  mediaId?: string;
  mediaName?: string;
  text?: string;
  frame?: string;
  markerNotes: string[];
}

export interface Board {
  projectId: string;
  title: string;
  timeline: string;
  timelineId: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
  tracks: { index: number; name: string; shots: number }[];
  shots: Shot[];
  selected: string[];
}

const PICTURE = new Set(['video', 'image', 'text', 'timeline', 'device']);

type Loose = Record<string, any>;

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function pickProject(raw: Loose): Loose {
  if (raw && Array.isArray(raw.timelines)) return raw;
  for (const key of ['project', 'document', 'state']) {
    const inner = raw?.[key];
    if (inner && Array.isArray(inner.timelines)) return { ...raw, ...inner };
  }
  return raw ?? {};
}

function pickTimeline(project: Loose): Loose | null {
  const timelines: Loose[] = Array.isArray(project.timelines) ? project.timelines : [];
  if (project.timeline && Array.isArray(project.timeline.tracks)) return project.timeline;
  const active = project.activeTimeline;
  if (typeof active === 'number' && timelines[active]) return timelines[active];
  if (typeof active === 'string') {
    const found = timelines.find((t) => t.id === active);
    if (found) return found;
  }
  if (typeof project.activeTimelineId === 'string') {
    const found = timelines.find((t) => t.id === project.activeTimelineId);
    if (found) return found;
  }
  if (Array.isArray(project.tracks)) return { id: '', name: str(project.title, 'Timeline'), tracks: project.tracks, markers: project.markers };
  return timelines[0] ?? null;
}

function frameOf(entry: Loose | undefined): string | undefined {
  if (!entry) return undefined;
  for (const key of ['frame', 'thumbnail', 'thumb', 'poster', 'image']) {
    const v = entry[key];
    if (typeof v === 'string' && v.startsWith('data:image/')) return v;
  }
  return undefined;
}

export function mediaIndex(raw: Loose): Map<string, MediaInfo> {
  const out = new Map<string, MediaInfo>();
  const list: Loose[] = Array.isArray(raw?.media) ? raw.media : Array.isArray(raw?.project?.media) ? raw.project.media : Array.isArray(raw?.library) ? raw.library : [];
  for (const m of list) {
    if (!m || typeof m.id !== 'string') continue;
    out.set(m.id, { id: m.id, name: str(m.name, m.id), kind: str(m.kind, 'video'), width: num(m.width, 0), height: num(m.height, 0), frame: frameOf(m) });
  }
  return out;
}

export function toBoard(raw: unknown): Board {
  const root = (raw ?? {}) as Loose;
  const top = pickProject(root);
  const project: Loose = root.project && !Array.isArray(root.project.timelines) ? { ...top, ...root.project, timeline: top.timeline ?? root.timeline } : top;
  const timeline = pickTimeline(project);
  const media = mediaIndex(root);
  const fps = num(timeline?.fps, num(project.fps, 25)) || 25;
  const width = num(timeline?.width, num(project.width, 1920)) || 1920;
  const height = num(timeline?.height, num(project.height, 1080)) || 1080;
  const tracksRaw: Loose[] = Array.isArray(timeline?.tracks) ? timeline!.tracks : [];
  const markers: Loose[] = Array.isArray(timeline?.markers) ? timeline!.markers : [];
  const shots: Shot[] = [];
  const tracks: Board['tracks'] = [];
  tracksRaw.forEach((track, trackIndex) => {
    const clips: Loose[] = Array.isArray(track?.clips) ? track.clips : [];
    let count = 0;
    for (const clip of clips) {
      const kind = str(clip?.kind, 'video');
      if (!PICTURE.has(kind) || typeof clip.id !== 'string') continue;
      const m = clip.mediaId ? media.get(clip.mediaId) : undefined;
      const start = num(clip.start, 0);
      const duration = Math.max(0, num(clip.duration, 0));
      const text = kind === 'text' ? str(clip.text, str(clip.textStyle?.content, str(clip.label))) : undefined;
      shots.push({
        key: `${clip.mediaId ?? clip.id}@${num(clip.sourceIn, 0).toFixed(3)}`,
        clipId: clip.id,
        number: 0,
        name: str(clip.label) || m?.name || kind,
        kind,
        track: str(track.name, `Track ${trackIndex + 1}`),
        trackIndex,
        start,
        duration,
        sourceIn: num(clip.sourceIn, 0),
        speed: num(clip.speed, 1) || 1,
        mediaId: typeof clip.mediaId === 'string' ? clip.mediaId : undefined,
        mediaName: m?.name,
        text,
        frame: frameOf(clip) ?? m?.frame,
        markerNotes: markers
          .filter((mk) => num(mk?.t, -1) >= start && num(mk?.t, -1) < start + duration && str(mk?.note).trim())
          .map((mk) => str(mk.note).trim()),
      });
      count++;
    }
    tracks.push({ index: trackIndex, name: str(track?.name, `Track ${trackIndex + 1}`), shots: count });
  });
  shots.sort((a, b) => a.start - b.start || a.trackIndex - b.trackIndex);
  const sel = root.selection ?? project.selection;
  const ids: unknown[] = Array.isArray(sel) ? sel : Array.isArray(sel?.clipIds) ? sel.clipIds : [];
  const selected: string[] = ids.filter((s): s is string => typeof s === 'string');
  const single = typeof sel?.clipId === 'string' ? sel.clipId : project.selectedClipId;
  if (typeof single === 'string' && !selected.includes(single)) selected.push(single);
  const end = shots.reduce((max, s) => Math.max(max, s.start + s.duration), 0);
  return {
    projectId: str(project.projectId, str(project.id, 'untitled')),
    title: str(project.title, str(project.name, 'Untitled')),
    timeline: str(timeline?.name, 'Timeline'),
    timelineId: str(timeline?.id),
    fps,
    width,
    height,
    duration: Math.max(end, num(project.duration, 0)),
    tracks,
    shots,
    selected,
  };
}

export function numberShots(shots: Shot[]): Shot[] {
  return shots.map((s, i) => ({ ...s, number: i + 1 }));
}
