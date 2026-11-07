import { canonical, hasSchemas, RANK, type Change, type Diff, type Json, type Level, type Schema, type Snapshot, type Tool, type ToolDiff } from "./model";

const LIMITS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"];
const DEPTH = 5;

function obj(v: Json | undefined): Schema | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function show(v: Json | undefined): string {
  if (v === undefined) return "none";
  const text = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function refName(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1] || ref;
}

export function types(s: Schema | null): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  const t = s.type;
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x);
  for (const key of ["anyOf", "oneOf"]) {
    const list = s[key];
    if (Array.isArray(list)) for (const member of list) for (const x of types(obj(member))) out.add(x);
  }
  if (!out.size && typeof s.$ref === "string") out.add(refName(s.$ref));
  if (!out.size && Array.isArray(s.enum)) out.add("enum");
  if (!out.size && s.const !== undefined) out.add("const");
  if (!out.size && obj(s.properties)) out.add("object");
  return out;
}

function typeText(t: Set<string>): string {
  return t.size ? [...t].sort().join(" or ") : "any";
}

function covers(wide: Set<string>, narrow: Set<string>): boolean {
  if (!wide.size) return true;
  for (const t of narrow) if (!wide.has(t) && !(t === "integer" && wide.has("number"))) return false;
  return narrow.size > 0;
}

function props(s: Schema | null): Record<string, Schema> {
  const p = obj(s?.properties);
  const out: Record<string, Schema> = {};
  if (p) for (const [k, v] of Object.entries(p)) out[k] = obj(v) ?? {};
  return out;
}

function required(s: Schema | null): Set<string> {
  const r = s?.required;
  return new Set(Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : []);
}

function compareObject(path: string, a: Schema | null, b: Schema | null, out: Change[], depth: number): void {
  const pa = props(a);
  const pb = props(b);
  const ra = required(a);
  const rb = required(b);
  const names = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
  for (const name of names) {
    const p = path ? `${path}.${name}` : name;
    if (!(name in pa)) {
      if (rb.has(name)) out.push({ path: p, level: "breaking", text: `New required argument (${typeText(types(pb[name]))})` });
      else out.push({ path: p, level: "additive", text: `New optional argument (${typeText(types(pb[name]))})` });
    } else if (!(name in pb)) {
      out.push({ path: p, level: "breaking", text: "Argument removed" });
    } else {
      compareArg(p, pa[name], pb[name], ra.has(name), rb.has(name), out, depth);
    }
  }
  const ea = a?.additionalProperties;
  const eb = b?.additionalProperties;
  if (ea !== false && eb === false) out.push({ path: path || "(arguments)", level: "caution", text: "No longer accepts extra arguments" });
  else if (ea === false && eb !== false && eb !== undefined) out.push({ path: path || "(arguments)", level: "additive", text: "Now accepts extra arguments" });
}

function compareArg(path: string, a: Schema, b: Schema, reqA: boolean, reqB: boolean, out: Change[], depth: number): void {
  const ta = types(a);
  const tb = types(b);
  if (typeText(ta) !== typeText(tb)) {
    if (covers(tb, ta)) out.push({ path, level: "additive", text: `Type widened: ${typeText(ta)} to ${typeText(tb)}` });
    else out.push({ path, level: "breaking", text: `Type changed: ${typeText(ta)} to ${typeText(tb)}` });
  }
  if (!reqA && reqB) out.push({ path, level: "breaking", text: "Now required" });
  if (reqA && !reqB) out.push({ path, level: "additive", text: "Now optional" });
  const enA = Array.isArray(a.enum) ? a.enum.map((v) => canonical(v)) : null;
  const enB = Array.isArray(b.enum) ? b.enum.map((v) => canonical(v)) : null;
  if (enA && enB) {
    const gone = enA.filter((v) => !enB.includes(v));
    const extra = enB.filter((v) => !enA.includes(v));
    if (gone.length) out.push({ path, level: "breaking", text: `Values removed: ${gone.join(", ")}` });
    if (extra.length) out.push({ path, level: "additive", text: `Values added: ${extra.join(", ")}` });
  } else if (!enA && enB) {
    out.push({ path, level: "breaking", text: `Now limited to: ${enB.join(", ")}` });
  } else if (enA && !enB) {
    out.push({ path, level: "additive", text: "No longer limited to a list of values" });
  }
  if (canonical(a.default) !== canonical(b.default)) out.push({ path, level: "caution", text: `Default ${show(a.default)} to ${show(b.default)}` });
  for (const key of LIMITS) {
    if (canonical(a[key]) !== canonical(b[key])) out.push({ path, level: "caution", text: `${key} ${show(a[key])} to ${show(b[key])}` });
  }
  if ((a.description ?? "") !== (b.description ?? "")) out.push({ path, level: "note", text: "Description changed" });
  if (depth >= DEPTH) {
    if (canonical(a) !== canonical(b) && !out.some((c) => c.path === path)) out.push({ path, level: "caution", text: "Nested arguments changed" });
    return;
  }
  if (obj(a.properties) || obj(b.properties)) compareObject(path, a, b, out, depth + 1);
  const ia = obj(a.items);
  const ib = obj(b.items);
  if (ia && ib) compareArg(`${path}[]`, ia, ib, true, true, out, depth + 1);
}

function compareTool(a: Tool, b: Tool, args: boolean): Change[] {
  const out: Change[] = [];
  if (a.description !== b.description) out.push({ path: "", level: "note", text: "Description changed" });
  if (a.readOnly === true && b.readOnly === false) out.push({ path: "", level: "caution", text: "No longer marked read-only: it can now change things" });
  if (a.readOnly === false && b.readOnly === true) out.push({ path: "", level: "note", text: "Now marked read-only" });
  if (args && a.schema && b.schema) compareObject("", a.schema, b.schema, out, 0);
  return out;
}

function top(changes: Change[]): Level | null {
  let best: Level | null = null;
  for (const c of changes) if (best === null || RANK[c.level] > RANK[best]) best = c.level;
  return best;
}

function looksRenamed(a: Tool, b: Tool, args: boolean): boolean {
  if (args && a.schema && b.schema) {
    const same = canonical(a.schema) === canonical(b.schema);
    return same && (Object.keys(props(a.schema)).length > 0 || (a.description !== "" && a.description === b.description));
  }
  return a.description !== "" && a.description === b.description;
}

const ORDER: Record<string, number> = { changed: 0, removed: 1, renamed: 2, added: 3, same: 4 };

export function diff(before: Snapshot, after: Snapshot): Diff {
  const args = hasSchemas(before) && hasSchemas(after);
  const notes: string[] = [];
  if (!args) {
    const missing = [before, after].filter((s) => !hasSchemas(s) && s.tools.length).map((s) => s.label);
    if (missing.length) notes.push(`Arguments not compared: ${missing.join(" and ")} ${missing.length > 1 ? "have" : "has"} no argument schemas. formMCP keeps tool names and descriptions; import a saved tools/list for arguments.`);
  }
  if (before.app !== after.app) notes.push(`These snapshots are of different apps (${before.app} and ${after.app}).`);
  const mapA = new Map(before.tools.map((t) => [t.name, t]));
  const mapB = new Map(after.tools.map((t) => [t.name, t]));
  const removed = before.tools.filter((t) => !mapB.has(t.name));
  const added = after.tools.filter((t) => !mapA.has(t.name));
  const tools: ToolDiff[] = [];
  const paired = new Set<string>();
  for (const r of removed) {
    const match = added.find((t) => !paired.has(t.name) && looksRenamed(r, t, args));
    if (!match) continue;
    paired.add(match.name);
    paired.add(`-${r.name}`);
    const changes: Change[] = [{ path: "", level: "breaking", text: `Renamed from ${r.name}: calls by the old name fail` }, ...compareTool(r, match, args)];
    tools.push({ name: match.name, from: r.name, status: "renamed", level: top(changes), changes });
  }
  for (const r of removed) {
    if (paired.has(`-${r.name}`)) continue;
    tools.push({ name: r.name, status: "removed", level: "breaking", changes: [{ path: "", level: "breaking", text: "Tool removed: calls to it fail" }] });
  }
  for (const t of added) {
    if (paired.has(t.name)) continue;
    const n = Object.keys(props(t.schema)).length;
    const text = t.schema ? `New tool with ${n} argument${n === 1 ? "" : "s"}${t.readOnly ? ", read-only" : ""}` : `New tool${t.readOnly ? ", read-only" : ""}`;
    tools.push({ name: t.name, status: "added", level: "additive", changes: [{ path: "", level: "additive", text }] });
  }
  for (const a of before.tools) {
    const b = mapB.get(a.name);
    if (!b) continue;
    const changes = compareTool(a, b, args);
    tools.push({ name: a.name, status: changes.length ? "changed" : "same", level: top(changes), changes });
  }
  tools.sort((x, y) => ORDER[x.status] - ORDER[y.status] || RANK[y.level ?? "note"] - RANK[x.level ?? "note"] || x.name.localeCompare(y.name));
  const counts = { added: 0, removed: 0, renamed: 0, changed: 0, same: 0, breaking: 0 };
  for (const t of tools) {
    counts[t.status] += 1;
    if (t.level === "breaking") counts.breaking += 1;
  }
  return { tools, counts, argsCompared: args, notes };
}

export function summary(d: Diff): string {
  const c = d.counts;
  const parts = [`${c.added} added`, `${c.removed} removed`, `${c.changed} changed`];
  if (c.renamed) parts.push(`${c.renamed} renamed`);
  const head = parts.join(", ");
  return c.breaking ? `${head}; ${c.breaking} breaking` : `${head}; nothing breaking`;
}
