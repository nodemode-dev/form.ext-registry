export interface SnapMarker {
  id: string;
  atS: number;
  label: string;
}

export interface SnapRegion {
  id: string | null;
  startS: number;
  endS: number;
  label: string;
}

export interface Snap {
  rate: number;
  lengthS: number | null;
  playheadS: number | null;
  name: string | null;
  markers: SnapMarker[];
  regions: SnapRegion[];
}

type Json = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function root(raw: unknown): Json {
  const r = (raw ?? {}) as Json;
  for (const key of ["document", "session", "doc", "snapshot"]) {
    const inner = r[key];
    if (inner && typeof inner === "object" && (Array.isArray(inner.markers) || Array.isArray(inner.tracks))) return { ...r, ...inner };
  }
  return r;
}

export function adapt(raw: unknown): Snap {
  const r = root(raw);
  const rate = num(r.sample_rate) ?? num(r.sampleRate) ?? 48000;
  const secs = (o: Json, s: string, samples: string) => num(o[s]) ?? (num(o[samples]) !== null ? (o[samples] as number) / rate : null);
  const markers: SnapMarker[] = (Array.isArray(r.markers) ? r.markers : [])
    .map((m: Json) => ({ id: String(m.id ?? m.markerId ?? ""), atS: secs(m, "at_s", "at") ?? 0, label: String(m.label ?? m.name ?? "") }))
    .filter((m: SnapMarker) => m.id);
  const regions: SnapRegion[] = (Array.isArray(r.regions) ? r.regions : []).map((g: Json) => ({
    id: g.id ?? g.regionId ? String(g.id ?? g.regionId) : null,
    startS: secs(g, "start_s", "start") ?? 0,
    endS: secs(g, "end_s", "end") ?? 0,
    label: String(g.label ?? g.name ?? ""),
  }));
  let lengthS = num(r.length_s) ?? num(r.lengthS) ?? num(r.duration_s);
  if (lengthS === null && Array.isArray(r.tracks)) {
    let end = 0;
    for (const t of r.tracks as Json[]) {
      for (const c of (t.clips ?? []) as Json[]) {
        const e = num(c.end_s) ?? (num(c.start_s) !== null && num(c.length_s) !== null ? c.start_s + c.length_s : num(c.start) !== null && num(c.length) !== null ? (c.start + c.length) / rate : null);
        if (e !== null) end = Math.max(end, e);
      }
    }
    lengthS = end;
  }
  const transport = (r.transport ?? {}) as Json;
  const playheadS = num(r.playhead_s) ?? num(r.playheadS) ?? (num(transport.positionSamples) !== null ? transport.positionSamples / rate : null) ?? (num(r.playhead) !== null ? r.playhead / rate : null);
  const name = typeof r.saved_as === "string" ? r.saved_as : typeof r.name === "string" ? r.name : null;
  return { rate, lengthS, playheadS, name, markers, regions };
}

export const samples = (seconds: number, rate: number) => Math.max(0, Math.round(seconds * rate));
