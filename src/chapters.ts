export interface Embedded {
  mime: string;
  data: string;
  width: number;
  height: number;
}

export interface Extra {
  url?: string;
  img?: string;
  image?: Embedded;
  hidden?: boolean;
}

export interface Chapter {
  key: string;
  kind: "marker" | "region";
  refId: string;
  start: number;
  end?: number;
  title: string;
  extra: Extra;
}

export interface Episode {
  title?: string;
  podcastName?: string;
}

export interface Problem {
  key?: string;
  field?: "title" | "url" | "img" | "start";
  text: string;
}

export interface JsonChapter {
  startTime: number;
  endTime?: number;
  title?: string;
  url?: string;
  img?: string;
  toc?: boolean;
}

const ms = (s: number) => Math.round(s * 1000) / 1000;

export function stamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const f = total % 1000;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
}

export function parseStamp(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}([.,]\d+)?$/.test(t)) return null;
  const [whole, frac = ""] = t.replace(",", ".").split(".");
  const parts = whole.split(":").map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s + (frac ? Number(`0.${frac}`) : 0);
}

export function isWebUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function check(chapters: Chapter[], lengthS: number | null): Problem[] {
  const out: Problem[] = [];
  chapters.forEach((c, i) => {
    if (!c.title.trim()) out.push({ key: c.key, field: "title", text: `Chapter ${i + 1} has no title.` });
    if (c.extra.url && !isWebUrl(c.extra.url)) out.push({ key: c.key, field: "url", text: `Chapter ${i + 1}'s link is not a web address (it should start with https://).` });
    if (c.extra.img && !isWebUrl(c.extra.img)) out.push({ key: c.key, field: "img", text: `Chapter ${i + 1}'s image link is not a web address.` });
    if (lengthS !== null && lengthS > 0 && c.start >= lengthS) out.push({ key: c.key, field: "start", text: `Chapter ${i + 1} starts after the session ends (${stamp(lengthS)}).` });
    const prev = chapters[i - 1];
    if (prev && c.start - prev.start < 1) out.push({ key: c.key, field: "start", text: `Chapter ${i + 1} starts less than a second after the one before it.` });
  });
  if (chapters.length && chapters[0].start > 0.5) out.push({ text: `The first chapter starts at ${stamp(chapters[0].start)}; most apps show nothing before it. Add a chapter at 0:00 for the opening.` });
  return out;
}

export function toJson(chapters: Chapter[], episode: Episode): string {
  const out: Record<string, unknown> = { version: "1.2.0" };
  if (episode.title?.trim()) out.title = episode.title.trim();
  if (episode.podcastName?.trim()) out.podcastName = episode.podcastName.trim();
  out.chapters = chapters.map((c) => {
    const j: JsonChapter = { startTime: ms(c.start) };
    if (c.end !== undefined) j.endTime = ms(c.end);
    j.title = c.title.trim();
    if (c.extra.url?.trim()) j.url = c.extra.url.trim();
    if (c.extra.img?.trim()) j.img = c.extra.img.trim();
    if (c.extra.hidden) j.toc = false;
    return j;
  });
  return `${JSON.stringify(out, null, 2)}\n`;
}

export class JsonError extends Error {}

export function fromJson(text: string): { chapters: JsonChapter[]; episode: Episode } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new JsonError("This file is not JSON. Choose a Podcasting 2.0 chapters file (.json).");
  }
  const obj = data as { chapters?: unknown; title?: unknown; podcastName?: unknown };
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.chapters)) throw new JsonError("This JSON has no chapters list, so it is not a Podcasting 2.0 chapters file.");
  const chapters: JsonChapter[] = [];
  for (const raw of obj.chapters as Record<string, unknown>[]) {
    const start = Number(raw?.startTime);
    if (!Number.isFinite(start) || start < 0) continue;
    const end = Number(raw.endTime);
    chapters.push({
      startTime: start,
      ...(Number.isFinite(end) && end > start ? { endTime: end } : {}),
      title: typeof raw.title === "string" ? raw.title : "",
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
      ...(typeof raw.img === "string" ? { img: raw.img } : {}),
      ...(raw.toc === false ? { toc: false } : {}),
    });
  }
  if (!chapters.length) throw new JsonError("This chapters file lists no chapter with a start time.");
  chapters.sort((a, b) => a.startTime - b.startTime);
  return {
    chapters,
    episode: {
      ...(typeof obj.title === "string" ? { title: obj.title } : {}),
      ...(typeof obj.podcastName === "string" ? { podcastName: obj.podcastName } : {}),
    },
  };
}

export function endsMs(chapters: Chapter[], lengthMs: number): number[] {
  return chapters.map((c, i) => {
    const next = chapters[i + 1];
    const end = c.end !== undefined ? c.end * 1000 : next ? next.start * 1000 : lengthMs;
    return Math.max(Math.round(c.start * 1000) + 1, Math.min(Math.round(end), Math.round(lengthMs)));
  });
}
