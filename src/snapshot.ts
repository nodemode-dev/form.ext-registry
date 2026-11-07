import type { Json, Schema, Snapshot, Tool } from "./model";

export type ToolRows = { app: string; loaded: number | null; server?: Json; tools: { name: string; description?: string; read_only?: boolean }[] };

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function when(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function serverText(server: unknown): string {
  const s = obj(server);
  if (!s) return "";
  const info = obj(s.serverInfo) ?? s;
  const name = typeof info.name === "string" ? info.name : "";
  const version = typeof info.version === "string" ? info.version : "";
  return [name, version].filter(Boolean).join(" ");
}

function byName(tools: Tool[]): Tool[] {
  const seen = new Map<string, Tool>();
  for (const t of tools) seen.set(t.name, t);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function fromRows(rows: ToolRows, source: "formmcp" | "now"): Snapshot | null {
  if (rows.loaded === null || rows.loaded === undefined) return null;
  const tools = byName(
    (rows.tools ?? [])
      .filter((t) => typeof t?.name === "string")
      .map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 240), readOnly: typeof t.read_only === "boolean" ? t.read_only : null, schema: null })),
  );
  const taken = rows.loaded * 1000;
  return { id: source === "now" ? "now" : newId(), app: rows.app, label: source === "now" ? `Now, formMCP's list from ${when(taken)}` : `Snapshot ${when(taken)}`, taken, source, server: serverText(rows.server), tools };
}

function toolOf(raw: unknown): Tool | null {
  const t = obj(raw);
  if (!t || typeof t.name !== "string" || !t.name) return null;
  const ann = obj(t.annotations);
  const schema = obj(t.inputSchema) ?? obj(t.input_schema);
  const readOnly = typeof ann?.readOnlyHint === "boolean" ? ann.readOnlyHint : typeof t.read_only === "boolean" ? t.read_only : typeof t.readOnly === "boolean" ? t.readOnly : null;
  return { name: t.name, description: typeof t.description === "string" ? t.description.slice(0, 240) : "", readOnly, schema: schema ? (schema as Schema) : null };
}

function asSnapshot(raw: unknown): Snapshot | null {
  const s = obj(raw);
  if (!s || !Array.isArray(s.tools) || typeof s.app !== "string") return null;
  const tools = byName(s.tools.map(toolOf).filter((t): t is Tool => t !== null));
  const taken = typeof s.taken === "number" ? s.taken : Date.now();
  return { id: newId(), app: s.app, label: typeof s.label === "string" ? s.label : `Snapshot ${when(taken)}`, taken, source: "file", server: typeof s.server === "string" ? s.server : "", tools };
}

export type Imported = { snapshots: Snapshot[]; guessedApp: boolean };

export function parseImport(name: string, text: string, apps: string[], fallbackApp: string): Imported {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error(`${name} is not JSON. Tool Diff reads a saved tools/list answer, a formMCP tool list or a Tool Diff report.`);
  }
  const r = obj(root);
  if (r && r.format === "tool-diff-report") {
    const list = [asSnapshot(r.before), asSnapshot(r.after)].filter((s): s is Snapshot => s !== null);
    if (!list.length) throw new Error(`${name} is a Tool Diff report without snapshots.`);
    for (const s of list) s.label = `${s.label} (from ${name})`;
    return { snapshots: list, guessedApp: false };
  }
  if (r && r.format === "tool-diff-snapshot") {
    const s = asSnapshot(r);
    if (!s) throw new Error(`${name} is a Tool Diff snapshot without tools.`);
    return { snapshots: [s], guessedApp: false };
  }
  const result = obj(r?.result);
  const list = Array.isArray(root) ? root : Array.isArray(result?.tools) ? result?.tools : Array.isArray(r?.tools) ? r?.tools : null;
  if (!list) {
    const err = obj(r?.error);
    if (err) throw new Error(`${name} holds an error answer, not a tool list: ${String(err.message ?? "")}`);
    throw new Error(`${name} has no tool list. Tool Diff reads a saved tools/list answer, a formMCP tool list or a Tool Diff report.`);
  }
  const tools = byName((list as unknown[]).map(toolOf).filter((t): t is Tool => t !== null));
  if (!tools.length) throw new Error(`${name} has a tool list with no tools in it.`);
  const server = serverText(r?.server ?? r?.serverInfo ?? result?.serverInfo);
  const lower = name.toLowerCase();
  let app = typeof r?.app === "string" ? r.app : "";
  if (!app) app = apps.find((id) => lower.startsWith(id) || lower.includes(`${id}.`) || lower.includes(`${id}-`) || lower.includes(`${id}_`)) ?? "";
  if (!app) app = apps.find((id) => server.toLowerCase().startsWith(id)) ?? "";
  const guessed = !app;
  if (!app) app = fallbackApp;
  const taken = typeof r?.loaded === "number" ? r.loaded * 1000 : Date.now();
  return { snapshots: [{ id: newId(), app, label: `${name}${server ? `, ${server}` : ""}`, taken, source: "file", server, tools }], guessedApp: guessed };
}
