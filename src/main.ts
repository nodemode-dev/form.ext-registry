import { ERR, formext, FormExtError, fromBase64, toBase64, type Activation, type Hello } from "./formext";
import { diff, summary } from "./diff";
import type { Diff, Snapshot } from "./model";
import { html, json } from "./report";
import { fromRows, newId, parseImport, when, type ToolRows } from "./snapshot";
import * as store from "./store";

type AppRow = { id: string; name: string; mcp: boolean; installed?: boolean };
type AppsDoc = { live?: boolean; apps?: AppRow[] };

const HEADLESS = new Set(["snapshot-all", "check"]);
const HEIGHT = 520;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $<HTMLElement>("app");
const appPick = $<HTMLSelectElement>("app-pick");
const beforePick = $<HTMLSelectElement>("before");
const afterPick = $<HTMLSelectElement>("after");
const snapBtn = $<HTMLButtonElement>("snap");
const loadBtn = $<HTMLButtonElement>("load");
const swapBtn = $<HTMLButtonElement>("swap");
const importBtn = $<HTMLButtonElement>("import");
const forgetBtn = $<HTMLButtonElement>("forget");
const saveHtml = $<HTMLButtonElement>("save-html");
const saveJson = $<HTMLButtonElement>("save-json");
const stopBtn = $<HTMLButtonElement>("stop");
const list = $<HTMLDivElement>("list");
const empty = $<HTMLParagraphElement>("empty");
const summaryLine = $<HTMLParagraphElement>("summary");
const status = $<HTMLParagraphElement>("status");
const meterFill = $<HTMLSpanElement>("meter-fill");
const chips = [...document.querySelectorAll<HTMLButtonElement>(".chip")];

let hello: Hello | null = null;
let apps: AppRow[] = [];
let live = true;
let filter = "all";
let current: { before: Snapshot; after: Snapshot; diff: Diff } | null = null;
let cancel: (() => void) | null = null;
const now = new Map<string, Snapshot | null>();

function plain(err: unknown): string {
  if (err instanceof FormExtError) {
    if (err.code === ERR.PERMISSION) return "Tool Diff is not allowed to do that. Allow it from formMCP's Extensions panel.";
    if (err.code === ERR.CANCELLED) return "Cancelled.";
    if (err.code === ERR.UNAVAILABLE) return `Not available here: ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function say(text: string, level: "info" | "success" | "error" = "info"): void {
  status.textContent = text || " ";
  status.dataset.level = level;
}

function busy(text: string | null, fraction = 0): void {
  root.dataset.busy = text === null ? "false" : "true";
  meterFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (text !== null) say(text);
  syncButtons();
}

function cancellable<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    cancel = () => reject(new FormExtError(ERR.CANCELLED, "Stopped waiting."));
    work.then(resolve, reject);
  }).finally(() => {
    cancel = null;
  });
}

function appName(id: string): string {
  return apps.find((a) => a.id === id)?.name ?? id;
}

function can(p: string): boolean {
  return !!hello?.permissions.includes(p as never);
}

function syncButtons(): void {
  const idle = root.dataset.busy !== "true";
  const app = appPick.value;
  const doc = can("document") && live;
  snapBtn.disabled = !idle || !app || !doc;
  loadBtn.disabled = !idle || !app || !doc;
  importBtn.disabled = !idle || !can("files-read");
  forgetBtn.disabled = !idle || !store.get(beforePick.value);
  swapBtn.disabled = !idle || beforePick.options.length + afterPick.options.length < 2;
  saveHtml.disabled = saveJson.disabled = !idle || !current || !can("files-write");
  saveHtml.title = saveJson.title = can("files-write") ? "Save this comparison as a report" : "Tool Diff was not given permission to save files";
}

async function readNow(app: string, fresh = false): Promise<Snapshot | null> {
  if (!fresh && now.has(app)) return now.get(app) ?? null;
  const rows = await formext.run<ToolRows>("tool_list", { id: app });
  const snap = fromRows(rows, "now");
  now.set(app, snap);
  return snap;
}

function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

function snapLabel(s: Snapshot): string {
  return `${s.label} (${s.tools.length} tools${s.source === "file" ? ", imported" : ""}${store.isSessionOnly(s.id) ? ", this session only" : ""})`;
}

function fillSides(beforeId?: string, afterId?: string): void {
  const app = appPick.value;
  const snaps = store.list(app);
  const nowSnap = now.get(app) ?? null;
  const nowOpt = option("now", nowSnap ? `${nowSnap.label} (${nowSnap.tools.length} tools)` : "Now, formMCP's list (not read yet)");
  const b = snaps.length ? snaps.map((s) => option(s.id, snapLabel(s))) : [option("", "No snapshot yet")];
  beforePick.replaceChildren(...b, option("now", nowOpt.textContent ?? "Now"));
  afterPick.replaceChildren(nowOpt, ...snaps.map((s) => option(s.id, snapLabel(s))));
  const pickIn = (sel: HTMLSelectElement, id: string | undefined, fallback: string) => {
    sel.value = id && [...sel.options].some((o) => o.value === id) ? id : fallback;
  };
  pickIn(beforePick, beforeId, snaps[0]?.id ?? "");
  pickIn(afterPick, afterId, "now");
  beforePick.disabled = afterPick.disabled = false;
  syncButtons();
}

function resolveSide(id: string): Snapshot | null {
  if (id === "now") return now.get(appPick.value) ?? null;
  return store.get(id);
}

function clearList(message: string): void {
  current = null;
  for (const el of [...list.children]) if (el !== empty) el.remove();
  empty.textContent = message;
  empty.hidden = false;
  summaryLine.textContent = " ";
  for (const n of document.querySelectorAll<HTMLElement>("[data-count]")) n.textContent = "0";
  syncButtons();
}

const STATUS: Record<string, string> = { added: "Added", removed: "Removed", renamed: "Renamed", changed: "Changed" };

function render(before: Snapshot, after: Snapshot, d: Diff): void {
  current = { before, after, diff: d };
  for (const el of [...list.children]) if (el !== empty) el.remove();
  const nodes: HTMLElement[] = [];
  for (const n of d.notes) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = n;
    nodes.push(p);
  }
  const shown = d.tools.filter((t) => t.status !== "same");
  for (const t of shown) {
    const row = document.createElement("details");
    row.className = "row";
    row.setAttribute("role", "listitem");
    row.dataset.status = t.status;
    row.dataset.level = t.level ?? "note";
    row.open = t.status !== "added" && t.changes.length <= 6;
    const head = document.createElement("summary");
    const st = document.createElement("span");
    st.className = "st";
    st.textContent = STATUS[t.status];
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = t.name;
    if (t.from) {
      const was = document.createElement("span");
      was.className = "was";
      was.textContent = ` was ${t.from}`;
      name.append(was);
    }
    const tally = document.createElement("span");
    tally.className = "tally";
    const nb = t.changes.filter((c) => c.level === "breaking").length;
    tally.textContent = nb ? `${nb} breaking` : `${t.changes.length} change${t.changes.length === 1 ? "" : "s"}`;
    head.append(st, name, tally);
    const ul = document.createElement("ul");
    ul.className = "changes";
    for (const c of t.changes) {
      const li = document.createElement("li");
      li.dataset.level = c.level;
      const lv = document.createElement("span");
      lv.className = "lv";
      lv.textContent = c.level;
      const txt = document.createElement("span");
      txt.className = "txt";
      if (c.path) {
        const code = document.createElement("code");
        code.textContent = c.path;
        txt.append(code, " ");
      }
      txt.append(c.text);
      li.append(lv, txt);
      ul.append(li);
    }
    row.append(head, ul);
    nodes.push(row);
  }
  list.append(...nodes);
  const c = d.counts;
  const counts: Record<string, number> = { all: shown.length, breaking: c.breaking, changed: c.changed + c.renamed, added: c.added, removed: c.removed };
  for (const n of document.querySelectorAll<HTMLElement>("[data-count]")) n.textContent = String(counts[n.dataset.count ?? ""] ?? 0);
  summaryLine.textContent = `${appName(after.app)}: ${summary(d)}; ${c.same} unchanged of ${after.tools.length} tools${d.argsCompared ? ", arguments compared" : ""}`;
  empty.textContent = shown.length ? "Nothing of this kind." : `No differences: the ${after.tools.length} tools are the same in both.`;
  applyFilter();
  syncButtons();
}

function applyFilter(): void {
  let visible = 0;
  for (const row of list.querySelectorAll<HTMLElement>(".row")) {
    const s = row.dataset.status;
    const show = filter === "all" || (filter === "breaking" ? row.dataset.level === "breaking" : filter === "changed" ? s === "changed" || s === "renamed" : s === filter);
    row.hidden = !show;
    if (show) visible += 1;
  }
  empty.hidden = visible > 0;
}

async function compare(): Promise<void> {
  const app = appPick.value;
  if (!app) return;
  if (beforePick.value === "now" || afterPick.value === "now") {
    if (!now.has(app) && can("document") && live) {
      try {
        await readNow(app);
        fillSides(beforePick.value, afterPick.value);
      } catch (e) {
        clearList(plain(e));
        return;
      }
    }
  }
  const before = resolveSide(beforePick.value);
  const after = resolveSide(afterPick.value);
  if (!before || !after) {
    const name = appName(app);
    if (!store.list(app).length && !now.get(app)) clearList(`formMCP has not listed ${name}'s tools yet. Load from App starts ${name} once so formMCP can list them, or Import a saved list.`);
    else if (!store.list(app).length) clearList(`No snapshot of ${name} yet. Snapshot keeps formMCP's current list of its ${now.get(app)?.tools.length ?? 0} tools; after ${name} updates, Load from App and compare. Or Import a saved tools/list.`);
    else clearList(`formMCP has not listed ${name}'s tools yet. Load from App starts ${name} once so formMCP can list them.`);
    return;
  }
  if (before === after) {
    clearList("Before and After are the same snapshot. Pick another one on either side.");
    return;
  }
  render(before, after, diff(before, after));
}

async function snapshot(): Promise<void> {
  const app = appPick.value;
  busy(`Reading ${appName(app)}'s tool list…`, 0.3);
  try {
    const nowSnap = await readNow(app, true);
    if (!nowSnap) {
      busy(null);
      fillSides();
      await compare();
      say(`formMCP has not listed ${appName(app)}'s tools yet. Load from App starts it once.`, "error");
      return;
    }
    const res = await store.add({ ...nowSnap, id: newId(), source: "formmcp", label: `Snapshot ${when(Date.now())}` });
    busy(null);
    fillSides(res.snapshot.id, "now");
    await compare();
    if (res.unchanged) say(`No change since ${res.snapshot.label}, so that snapshot is kept.`);
    else say(`Kept ${appName(app)}'s ${nowSnap.tools.length} tools as ${res.snapshot.label}${res.sessionOnly ? " for this session only (too big to store)" : ""}${res.dropped.length ? `; made room by dropping ${res.dropped.join(", ")}` : ""}.`, "success");
  } catch (e) {
    busy(null);
    say(plain(e), "error");
  }
}

async function loadFromApp(): Promise<void> {
  const app = appPick.value;
  const name = appName(app);
  busy(`Starting ${name} so formMCP can list its tools…`, 0.5);
  try {
    const rows = await cancellable(formext.run<ToolRows>("tool_load", { id: app }));
    const snap = fromRows(rows, "now");
    now.set(app, snap);
    busy(null);
    const latest = store.latest(app);
    fillSides(latest?.id, "now");
    await compare();
    say(snap ? `${name} listed ${snap.tools.length} tools${latest ? `; compared with ${latest.label}` : ""}.` : `${name} started but listed no tools.`, "success");
  } catch (e) {
    busy(null);
    if (e instanceof FormExtError && e.code === ERR.CANCELLED) say(`Stopped waiting. formMCP may still finish starting ${name}; its list shows here when it does.`);
    else say(plain(e), "error");
  }
}

async function importFiles(): Promise<void> {
  busy("Choose a saved tool list…", 0.1);
  try {
    const files = await cancellable(formext.openFiles([".json"], true));
    const ids = apps.map((a) => a.id);
    const added: Snapshot[] = [];
    let guessed = false;
    for (const [i, f] of files.entries()) {
      busy(`Reading ${f.name}…`, (i + 1) / (files.length + 1));
      const got = parseImport(f.name, new TextDecoder().decode(fromBase64(f.data)), ids, appPick.value);
      guessed ||= got.guessedApp;
      for (const s of got.snapshots) added.push((await store.add(s, false)).snapshot);
    }
    busy(null);
    if (!added.length) return;
    const app = added[added.length - 1].app;
    if (apps.some((a) => a.id === app) && appPick.value !== app) appPick.value = app;
    const mine = added.filter((s) => s.app === appPick.value);
    const older = store.list(appPick.value).filter((s) => s.source === "file" && !mine.includes(s) && s.tools.some((t) => t.schema));
    if (mine.length >= 2) fillSides(mine[0].id, mine[mine.length - 1].id);
    else if (older.length) fillSides(older[0].id, mine[0]?.id);
    else fillSides(mine[0]?.id, "now");
    await compare();
    say(`Imported ${added.length} snapshot${added.length === 1 ? "" : "s"}${guessed ? ` as ${appName(appPick.value)} (the file did not name its app)` : ""}.`, "success");
  } catch (e) {
    busy(null);
    say(plain(e), e instanceof FormExtError && e.code === ERR.CANCELLED ? "info" : "error");
  }
}

async function forgetBefore(): Promise<void> {
  const s = store.get(beforePick.value);
  if (!s) return;
  try {
    await store.forget(s.id);
    fillSides(undefined, afterPick.value === s.id ? "now" : afterPick.value);
    await compare();
    say(`Forgot ${s.label}.`);
  } catch (e) {
    say(plain(e), "error");
  }
}

function stamp(ms: number): string {
  return when(ms).replace(/[-: ]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
}

async function save(kind: "html" | "json"): Promise<void> {
  if (!current) return;
  const made = Date.now();
  const name = appName(current.after.app);
  const text = kind === "html" ? html(name, current.before, current.after, current.diff, made) : json(name, current.before, current.after, current.diff, made);
  busy("Choose where to save the report…", 0.5);
  try {
    const res = await cancellable(formext.saveFile(`tool-diff-${current.after.app}-${stamp(made)}.${kind}`, kind === "html" ? "text/html" : "application/json", toBase64(new TextEncoder().encode(text))));
    busy(null);
    say(`Saved ${res.name}.`, "success");
  } catch (e) {
    busy(null);
    say(plain(e), e instanceof FormExtError && e.code === ERR.CANCELLED ? "info" : "error");
  }
}

function wire(): void {
  appPick.addEventListener("change", async () => {
    void formext.storageSet("app", appPick.value).catch(() => undefined);
    fillSides();
    await compare();
    say(" ");
  });
  beforePick.addEventListener("change", () => void compare());
  afterPick.addEventListener("change", () => void compare());
  swapBtn.addEventListener("click", () => {
    const b = beforePick.value;
    const a = afterPick.value;
    fillSides(a, b);
    void compare();
  });
  snapBtn.addEventListener("click", () => void snapshot());
  loadBtn.addEventListener("click", () => void loadFromApp());
  importBtn.addEventListener("click", () => void importFiles());
  forgetBtn.addEventListener("click", () => void forgetBefore());
  saveHtml.addEventListener("click", () => void save("html"));
  saveJson.addEventListener("click", () => void save("json"));
  stopBtn.addEventListener("click", () => cancel?.());
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      filter = chip.dataset.filter ?? "all";
      for (const c of chips) c.setAttribute("aria-pressed", String(c === chip));
      applyFilter();
    });
  }
  formext.onEvent(async (e) => {
    if (e.name !== "document.changed") return;
    const cmd = (e.data as { command?: string } | null)?.command ?? "";
    if (cmd !== "tool_load" && cmd !== "refresh" && cmd !== "set_tool") return;
    const app = appPick.value;
    if (root.dataset.busy === "true" || !app) return;
    now.delete(app);
    if (beforePick.value === "now" || afterPick.value === "now") await compare();
  });
}

async function startPanel(): Promise<void> {
  wire();
  if (!can("document")) {
    clearList("Tool Diff needs to read formMCP's tool lists. Allow it from formMCP's Extensions panel.");
    root.dataset.ready = "true";
    return;
  }
  try {
    const [doc, , saved] = await Promise.all([formext.readDocument<AppsDoc>("apps"), store.load(), formext.storageGet<string>("app").catch(() => null)]);
    live = doc.live !== false;
    apps = (doc.apps ?? []).filter((a) => a.mcp);
    const options = apps.map((a) => option(a.id, `${a.name}${a.installed === false ? " (not installed)" : ""}`));
    appPick.replaceChildren(...(options.length ? options : [option("", "No Form app with tools")]));
    const withSnap = apps.find((a) => store.list(a.id).length);
    const firstInstalled = apps.find((a) => a.installed !== false);
    appPick.value = (saved && apps.some((a) => a.id === saved) ? saved : withSnap?.id ?? firstInstalled?.id ?? apps[0]?.id) ?? "";
    appPick.disabled = !apps.length;
    fillSides();
    await compare();
    if (!live) say("Browser preview: open the formMCP app to read this computer's tool lists. Import still works.");
  } catch (e) {
    clearList(plain(e));
  }
  root.dataset.ready = "true";
  syncButtons();
}

async function headlessApps(): Promise<AppRow[]> {
  const doc = await formext.readDocument<AppsDoc>("apps");
  return (doc.apps ?? []).filter((a) => a.mcp && a.installed !== false);
}

async function runHeadless(a: Activation): Promise<void> {
  const args = (a.args && typeof a.args === "object" ? a.args : {}) as { app?: string };
  try {
    await store.load();
    let rows = await headlessApps();
    if (args.app) rows = rows.filter((r) => r.id === args.app);
    if (a.command === "snapshot-all") {
      const saved: string[] = [];
      const unchanged: string[] = [];
      const notListed: string[] = [];
      for (const r of rows) {
        const snap = fromRows(await formext.run<ToolRows>("tool_list", { id: r.id }), "formmcp");
        if (!snap) {
          notListed.push(r.id);
          continue;
        }
        const res = await store.add(snap);
        (res.unchanged ? unchanged : saved).push(r.id);
      }
      const text = `Tool Diff kept ${saved.length} new snapshot${saved.length === 1 ? "" : "s"}${unchanged.length ? `, ${unchanged.length} unchanged` : ""}${notListed.length ? `, ${notListed.length} not listed yet` : ""}.`;
      void formext.notify(text, "success").catch(() => undefined);
      await formext.done({ summary: text, saved, unchanged, not_listed: notListed });
      return;
    }
    const report = [];
    for (const r of rows) {
      const base = store.latest(r.id);
      if (!base) continue;
      const nowSnap = fromRows(await formext.run<ToolRows>("tool_list", { id: r.id }), "now");
      if (!nowSnap) continue;
      const d = diff(base, nowSnap);
      report.push({
        app: r.id,
        since: base.label,
        summary: summary(d),
        breaking: d.counts.breaking,
        added: d.tools.filter((t) => t.status === "added").map((t) => t.name),
        removed: d.tools.filter((t) => t.status === "removed").map((t) => t.name),
        renamed: d.tools.filter((t) => t.status === "renamed").map((t) => ({ from: t.from, to: t.name })),
        changed: d.tools.filter((t) => t.status === "changed").map((t) => ({ name: t.name, level: t.level, changes: t.changes.map((c) => (c.path ? `${c.path}: ${c.text}` : c.text)) })),
      });
    }
    const touched = report.filter((r) => r.added.length + r.removed.length + r.renamed.length + r.changed.length > 0);
    const text = report.length
      ? touched.length
        ? `Tool changes in ${touched.map((r) => r.app).join(", ")} since their last snapshot.`
        : `No tool changes in ${report.length} app${report.length === 1 ? "" : "s"} since their last snapshot.`
      : args.app
        ? `No snapshot of ${args.app} yet. Run Snapshot Every App's Tools first.`
        : "No snapshots yet. Run Snapshot Every App's Tools first.";
    await formext.done({ summary: text, apps: report });
  } catch (e) {
    void formext.notify(`Tool Diff: ${plain(e)}`, "error").catch(() => undefined);
    await formext.done({ error: plain(e) }).catch(() => undefined);
  }
}

let started = false;
let gotActivation: (a: Activation | null) => void = () => undefined;
const activation = new Promise<Activation | null>((resolve) => (gotActivation = resolve));

formext.onActivate((a) => {
  gotActivation(a);
  if (started && a.reason === "command" && a.command && HEADLESS.has(a.command)) void runHeadless(a);
  return null;
});

async function main(): Promise<void> {
  void formext.resize(HEIGHT).catch(() => undefined);
  try {
    hello = await formext.hello();
  } catch (e) {
    clearList(`Tool Diff could not reach formMCP: ${plain(e)}`);
    root.dataset.ready = "true";
    return;
  }
  const first = await Promise.race([activation, new Promise<null>((r) => window.setTimeout(() => r(null), 400))]);
  started = true;
  if (first && first.reason === "command" && first.command && HEADLESS.has(first.command)) {
    void runHeadless(first);
    return;
  }
  await startPanel();
}

void main();
