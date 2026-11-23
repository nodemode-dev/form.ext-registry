import { test } from "node:test";
import assert from "node:assert/strict";

const g = globalThis as any;
g.window = {
  addEventListener() {},
  parent: { postMessage() {} },
  setTimeout,
};

const model = await import("../../../extensions/tool-diff/src/model.ts");
const snapshot = await import("../../../extensions/tool-diff/src/snapshot.ts");
const report = await import("../../../extensions/tool-diff/src/report.ts");
const { formext } = await import("../../../extensions/tool-diff/src/formext.ts");
const store = await import("../../../extensions/tool-diff/src/store.ts");

type AnyObj = Record<string, any>;

const host = {
  saved: new Map<string, unknown>(),
  calls: [] as { method: string; params: any }[],
  failGet: false,
  reset(initial?: unknown) {
    this.saved = new Map();
    if (initial !== undefined) this.saved.set("snapshots", JSON.parse(JSON.stringify(initial)));
    this.calls = [];
    this.failGet = false;
  },
};

(formext as any).call = async (method: string, params: any) => {
  host.calls.push({ method, params });
  if (method === "storage.get") {
    if (host.failGet) throw new Error("host down");
    const v = host.saved.get(params.key);
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }
  if (method === "storage.set") {
    host.saved.set(params.key, JSON.parse(JSON.stringify(params.value)));
    return null;
  }
  throw new Error(`unexpected ${method}`);
};

function tool(name: string, description = `Does ${name}`, extra: AnyObj = {}): AnyObj {
  return { name, description, readOnly: null, schema: null, ...extra };
}

function snap(id: string, app: string, taken: number, tools: AnyObj[] = [tool("one")], extra: AnyObj = {}): any {
  return { id, app, label: id, taken, source: "file", server: "", tools, ...extra };
}

function emptyDiff(): any {
  return { tools: [], counts: { added: 0, removed: 0, renamed: 0, changed: 0, same: 0, breaking: 0 }, argsCompared: false, notes: [] };
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

const MADE = new Date(2024, 0, 5, 7, 3).getTime();

test("hasSchemas is true only when the list is not empty and every tool has a schema", () => {
  const s = { type: "object" };
  assert.equal(model.hasSchemas(snap("a", "x", 1, [tool("p", "", { schema: s }), tool("q", "", { schema: s })])), true);
  assert.equal(model.hasSchemas(snap("a", "x", 1, [tool("p", "", { schema: s }), tool("q")])), false);
  assert.equal(model.hasSchemas(snap("a", "x", 1, [])), false);
});

test("canonical ignores key order and turns missing values into null", () => {
  assert.equal(model.canonical({ b: 1, a: [2, { d: 4, c: 3 }] }), model.canonical({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.equal(model.canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(model.canonical(undefined), "null");
  assert.notEqual(model.canonical([1, 2]), model.canonical([2, 1]));
});

test("sameTools sees a changed description but not a different key order", () => {
  const a = [tool("x", "first", { schema: { type: "object", required: ["q"] } })];
  const sameButReordered = [{ schema: { required: ["q"], type: "object" }, readOnly: null, description: "first", name: "x" }];
  assert.equal(model.sameTools(a, sameButReordered as any), true);
  assert.equal(model.sameTools(a, [tool("x", "second", { schema: { type: "object", required: ["q"] } })]), false);
  assert.equal(model.sameTools(a, []), false);
});

test("when writes local time as year-month-day hour:minute with padding", () => {
  assert.equal(snapshot.when(MADE), "2024-01-05 07:03");
});

test("serverText joins name and version and gives an empty text for anything else", () => {
  assert.equal(snapshot.serverText({ serverInfo: { name: "cut", version: "1.2" } }), "cut 1.2");
  assert.equal(snapshot.serverText({ name: "cut" }), "cut");
  assert.equal(snapshot.serverText({ serverInfo: { version: "3" } }), "3");
  assert.equal(snapshot.serverText(null), "");
  assert.equal(snapshot.serverText("cut 1"), "");
  assert.equal(snapshot.serverText(["cut"]), "");
});

test("a snapshot from rows keeps name, description and read-only mark, sorted by name with no schema", () => {
  const s = snapshot.fromRows(
    { app: "formcut", loaded: 1000, server: { serverInfo: { name: "cut", version: "2" } }, tools: [{ name: "zeta", description: "Last", read_only: true }, { name: "alpha", read_only: false }, { name: "mid", description: "Middle" }] },
    "formmcp",
  );
  assert.ok(s);
  assert.deepEqual(s.tools, [
    { name: "alpha", description: "", readOnly: false, schema: null },
    { name: "mid", description: "Middle", readOnly: null, schema: null },
    { name: "zeta", description: "Last", readOnly: true, schema: null },
  ]);
  assert.equal(s.app, "formcut");
  assert.equal(s.server, "cut 2");
  assert.equal(s.source, "formmcp");
});

test("a snapshot from rows cuts a long description to 240 characters and copes with bad entries and repeats", () => {
  const rows: any = { app: "a", loaded: 5, tools: [{ name: "long", description: "d".repeat(300) }, { description: "no name" }, null, { name: 7 }, { name: "dup", description: "one" }, { name: "dup", description: "two" }] };
  const s = snapshot.fromRows(rows, "formmcp");
  assert.ok(s);
  assert.deepEqual(s.tools.map((t) => t.name), ["dup", "long"]);
  assert.equal(s.tools[1].description.length, 240);
  assert.equal(s.tools[0].description, "two");
  const none = snapshot.fromRows({ app: "a", loaded: 5 } as any, "formmcp");
  assert.deepEqual(none?.tools, []);
  assert.equal(none?.server, "");
});

test("a snapshot from rows is empty-handed when the app was never loaded", () => {
  assert.equal(snapshot.fromRows({ app: "a", loaded: null, tools: [{ name: "x" }] }, "formmcp"), null);
  assert.equal(snapshot.fromRows({ app: "a", tools: [{ name: "x" }] } as any, "now"), null);
});

test("load time in seconds is turned into milliseconds and milliseconds stay as they are", () => {
  const seconds = Math.floor(MADE / 1000);
  const fromSeconds = snapshot.fromRows({ app: "a", loaded: seconds, tools: [] }, "formmcp");
  const fromMillis = snapshot.fromRows({ app: "a", loaded: MADE, tools: [] }, "formmcp");
  assert.equal(fromSeconds?.taken, MADE);
  assert.equal(fromMillis?.taken, MADE);
  assert.equal(fromSeconds?.label, "Snapshot 2024-01-05 07:03");
});

test("the now snapshot has the fixed id now and the stored one gets its own id", () => {
  const rows = { app: "a", loaded: MADE, tools: [{ name: "x" }] };
  const now = snapshot.fromRows(rows, "now");
  const kept1 = snapshot.fromRows(rows, "formmcp");
  const kept2 = snapshot.fromRows(rows, "formmcp");
  assert.equal(now?.id, "now");
  assert.equal(now?.label, "Now, formMCP's list from 2024-01-05 07:03");
  assert.ok(kept1 && kept2 && kept1.id !== "now" && kept1.id !== "");
  assert.notEqual(kept1.id, kept2.id);
});

test("the same rows give the same tools, server and time every time", () => {
  const rows = { app: "a", loaded: 99, server: { name: "srv", version: "1" }, tools: [{ name: "b", description: "B" }, { name: "a" }] };
  const one = snapshot.fromRows(rows, "formmcp")!;
  const two = snapshot.fromRows(rows, "formmcp")!;
  assert.deepEqual({ ...one, id: "" }, { ...two, id: "" });
  assert.equal(model.sameTools(one.tools, two.tools), true);
});

test("importing a bare array keeps schemas, read-only marks and ignores extra fields and nameless entries", () => {
  const list = [
    { name: "b", description: "B", inputSchema: { type: "object", properties: { x: { type: "string" } } }, annotations: { readOnlyHint: true }, extra: 5 },
    { name: "a", input_schema: { type: "object" }, read_only: false },
    { description: "nameless" },
    null,
    "text",
  ];
  const out = snapshot.parseImport("tools.json", JSON.stringify(list), ["formcut"], "other");
  assert.equal(out.snapshots.length, 1);
  const s = out.snapshots[0];
  assert.deepEqual(s.tools, [
    { name: "a", description: "", readOnly: false, schema: { type: "object" } },
    { name: "b", description: "B", readOnly: true, schema: { type: "object", properties: { x: { type: "string" } } } },
  ]);
  assert.equal(s.source, "file");
  assert.equal(s.label, "tools.json");
  assert.equal(s.app, "other");
  assert.equal(out.guessedApp, true);
});

test("importing a tools/list answer reads the server and finds the app from the server name", () => {
  const answer = { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "t" }], serverInfo: { name: "formcut-mcp", version: "2.1" } } };
  const out = snapshot.parseImport("answer.json", JSON.stringify(answer), ["formcut", "formsound"], "other");
  const s = out.snapshots[0];
  assert.equal(s.server, "formcut-mcp 2.1");
  assert.equal(s.app, "formcut");
  assert.equal(s.label, "answer.json, formcut-mcp 2.1");
  assert.equal(out.guessedApp, false);
});

test("importing finds the app from the file name", () => {
  const text = JSON.stringify([{ name: "t" }]);
  const apps = ["formcut", "formsound"];
  assert.equal(snapshot.parseImport("formsound-tools.json", text, apps, "o").snapshots[0].app, "formsound");
  assert.equal(snapshot.parseImport("Export_formcut_1.json", text, apps, "o").snapshots[0].app, "formcut");
  assert.equal(snapshot.parseImport("formcut.json", text, apps, "o").guessedApp, false);
  assert.equal(snapshot.parseImport("misc.json", text, apps, "o").snapshots[0].app, "o");
});

test("importing refuses text that is not a tool list and says why", () => {
  assert.throws(() => snapshot.parseImport("a.json", "not json {", [], "x"), /a\.json is not JSON/);
  assert.throws(() => snapshot.parseImport("a.json", '{"jsonrpc":"2.0","id":1,"error":{"message":"boom"}}', [], "x"), /holds an error answer.*boom/);
  assert.throws(() => snapshot.parseImport("a.json", '{"foo":1}', [], "x"), /has no tool list/);
  assert.throws(() => snapshot.parseImport("a.json", '{"tools":[{"description":"x"}]}', [], "x"), /no tools in it/);
  assert.throws(() => snapshot.parseImport("a.json", '{"format":"tool-diff-report"}', [], "x"), /report without snapshots/);
});

test("the HTML report names each added, removed, renamed and changed tool once, in the order of the comparison", () => {
  const d: any = emptyDiff();
  d.tools = [
    { name: "alpha", status: "changed", level: "breaking", changes: [{ path: "q", level: "breaking", text: "Argument removed" }] },
    { name: "beta", status: "removed", level: "breaking", changes: [{ path: "", level: "breaking", text: "Tool removed: calls to it fail" }] },
    { name: "gamma", from: "gam", status: "renamed", level: "breaking", changes: [{ path: "", level: "breaking", text: "Renamed from gam" }] },
    { name: "delta", status: "added", level: "additive", changes: [{ path: "", level: "additive", text: "New tool" }] },
    { name: "epsilon", status: "same", level: null, changes: [] },
  ];
  d.counts = { added: 1, removed: 1, renamed: 1, changed: 1, same: 1, breaking: 3 };
  const out = report.html("FormCut", snap("b", "formcut", 1), snap("a", "formcut", 2), d, MADE);
  assert.equal(count(out, '<section class="tool '), 4);
  assert.equal(count(out, '<span class="st">Changed</span><code>alpha</code>'), 1);
  assert.equal(count(out, '<span class="st">Removed</span><code>beta</code>'), 1);
  assert.equal(count(out, '<span class="st">Renamed</span><code>gamma</code>'), 1);
  assert.equal(count(out, '<span class="st">Added</span><code>delta</code>'), 1);
  assert.ok(out.includes("<small>was <code>gam</code></small>"));
  const at = ["alpha", "beta", "gamma", "delta"].map((n) => out.indexOf(`<code>${n}</code>`));
  assert.deepEqual([...at].sort((x, y) => x - y), at);
  assert.ok(at.every((i) => i > 0));
  assert.ok(out.includes("<h2>Unchanged</h2>"));
  assert.ok(out.includes('<p class="same"><code>epsilon</code></p>'));
  assert.equal(count(out, "<code>epsilon</code>"), 1);
});

test("the HTML report grades each tool section and each change line", () => {
  const d: any = emptyDiff();
  d.tools = [
    { name: "alpha", status: "changed", level: "breaking", changes: [{ path: "q", level: "breaking", text: "Argument removed" }, { path: "", level: "note", text: "Description changed" }] },
    { name: "delta", status: "added", level: "additive", changes: [{ path: "", level: "additive", text: "New tool" }] },
    { name: "odd", status: "changed", level: null, changes: [] },
  ];
  const out = report.html("A", snap("b", "a", 1), snap("a", "a", 2), d, MADE);
  assert.equal(count(out, '<section class="tool breaking">'), 1);
  assert.equal(count(out, '<section class="tool additive">'), 1);
  assert.equal(count(out, '<section class="tool note">'), 1);
  assert.ok(out.includes('<li class="breaking"><span class="lv">breaking</span><code>q</code> Argument removed</li>'));
  assert.ok(out.includes('<li class="note"><span class="lv">note</span>Description changed</li>'));
});

test("the HTML report escapes special characters in every name and text", () => {
  assert.equal(report.esc(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  const d: any = emptyDiff();
  d.tools = [{ name: "<b>x", from: "o&ld", status: "renamed", level: "breaking", changes: [{ path: "a<b", level: "breaking", text: 'say "hi"' }] }];
  d.notes = ["use <script>"];
  const before = snap("b", "a", 1, [], { label: "L<1>", server: "s&t" });
  const out = report.html("App <&>", before, snap("a", "a", 2), d, MADE);
  assert.ok(out.includes("<code>&lt;b&gt;x</code>"));
  assert.ok(out.includes("<code>o&amp;ld</code>"));
  assert.ok(out.includes("<code>a&lt;b</code> say &quot;hi&quot;"));
  assert.ok(out.includes('<p class="note">use &lt;script&gt;</p>'));
  assert.ok(out.includes("<title>Tool Diff: App &lt;&amp;&gt;</title>"));
  assert.ok(out.includes("L&lt;1&gt; &middot; s&amp;t &middot; 0 tools"));
  assert.ok(!out.includes("<script>"));
  assert.ok(!out.includes("<b>x"));
});

test("the HTML report says plainly that nothing changed", () => {
  const d: any = emptyDiff();
  d.tools = [{ name: "same1", status: "same", level: null, changes: [] }];
  d.counts.same = 1;
  const out = report.html("A", snap("b", "a", 1), snap("a", "a", 2), d, MADE);
  assert.ok(out.includes("No tool was added, removed or changed."));
  assert.ok(out.includes("0 added, 0 removed, 0 changed; nothing breaking"));
  assert.equal(count(out, "<section"), 0);
  const blank = report.html("A", snap("b", "a", 1, []), snap("a", "a", 2, []), emptyDiff(), MADE);
  assert.ok(blank.includes("No tool was added, removed or changed."));
  assert.ok(!blank.includes("<h2>Unchanged</h2>"));
});

test("the HTML report gives the summary, counts, snapshot lines and the time it was made", () => {
  const d: any = emptyDiff();
  d.counts = { added: 2, removed: 1, renamed: 0, changed: 3, same: 4, breaking: 1 };
  d.tools = [{ name: "x", status: "removed", level: "breaking", changes: [] }];
  const before = snap("b", "a", 1, [tool("a"), tool("b")], { label: "Old", server: "srv 1" });
  const after = snap("a", "a", 2, [tool("a")], { label: "New", server: "" });
  const out = report.html("FormCut", before, after, d, MADE);
  assert.ok(out.includes('<p class="sum">2 added, 1 removed, 3 changed; 1 breaking</p>'));
  assert.ok(out.includes("<td>2</td><td>1</td><td>0</td><td>3</td><td>4</td><td>1</td>"));
  assert.ok(out.includes("<th>Before</th><td>Old &middot; srv 1 &middot; 2 tools</td>"));
  assert.ok(out.includes("<th>After</th><td>New &middot; 1 tools</td>"));
  assert.ok(out.includes("Made 2024-01-05 07:03 with Tool Diff for formMCP"));
});

test("the JSON report holds the format, time, summary, both snapshots and the comparison", () => {
  const d: any = emptyDiff();
  d.counts.added = 1;
  const before = snap("b", "formcut", 1);
  const after = snap("a", "formcut", 2, [tool("one"), tool("two")]);
  const text = report.json("FormCut", before, after, d, 0);
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.startsWith('{\n  "format": "tool-diff-report",'));
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, "tool-diff-report");
  assert.equal(parsed.format_version, 1);
  assert.equal(parsed.made, "1970-01-01T00:00:00.000Z");
  assert.equal(parsed.app, "FormCut");
  assert.equal(parsed.summary, "1 added, 0 removed, 0 changed; nothing breaking");
  assert.deepEqual(parsed.before, before);
  assert.deepEqual(parsed.after, after);
  assert.deepEqual(parsed.diff, d);
});

test("a saved JSON report can be imported again with its labels, names, descriptions and marks", () => {
  const before = snap("b", "formcut", 5, [tool("one", "First", { readOnly: true })], { label: "Old", server: "srv 1" });
  const after = snap("a", "formcut", 6, [tool("two", "Second", { readOnly: false })], { label: "New" });
  const text = report.json("FormCut", before, after, emptyDiff(), MADE);
  const out = snapshot.parseImport("saved.json", text, ["formcut"], "x");
  assert.equal(out.guessedApp, false);
  assert.deepEqual(out.snapshots.map((s) => [s.app, s.label, s.taken, s.server, s.source]), [
    ["formcut", "Old (from saved.json)", 5, "srv 1", "file"],
    ["formcut", "New (from saved.json)", 6, "", "file"],
  ]);
  assert.deepEqual(out.snapshots[0].tools, [{ name: "one", description: "First", readOnly: true, schema: null }]);
  assert.deepEqual(out.snapshots[1].tools, [{ name: "two", description: "Second", readOnly: false, schema: null }]);
});

test("a saved JSON report keeps argument schemas when imported again", { todo: "defect: report.json writes tools with a schema field but parseImport reads only inputSchema or input_schema, so schemas are lost on re-import and arguments are no longer compared" }, () => {
  const schema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
  const before = snap("b", "formcut", 5, [tool("one", "First", { schema })]);
  const after = snap("a", "formcut", 6, [tool("one", "First", { schema })]);
  const out = snapshot.parseImport("saved.json", report.json("FormCut", before, after, emptyDiff(), MADE), ["formcut"], "x");
  assert.deepEqual(out.snapshots[0].tools[0].schema, schema);
});

test("load returns the saved snapshots unchanged and asks the host for the snapshots key", async () => {
  const saved = [snap("l1", "app-l", 10, [tool("a", "A", { readOnly: true, schema: { type: "object" } })]), snap("l2", "app-l", 20)];
  host.reset(saved);
  const out = await store.load();
  assert.deepEqual(out, saved);
  assert.deepEqual(host.calls[0], { method: "storage.get", params: { key: "snapshots" } });
});

test("load gives an empty list for nothing saved, a corrupted value or a failing host", async () => {
  host.reset();
  assert.deepEqual(await store.load(), []);
  for (const bad of ["garbage", 42, { snapshots: [] }, true]) {
    host.reset(bad);
    assert.deepEqual(await store.load(), [], `value ${JSON.stringify(bad)}`);
  }
  host.reset([snap("c1", "app-c", 1)]);
  host.failGet = true;
  assert.deepEqual(await store.load(), []);
  assert.deepEqual(store.list(), []);
});

test("load drops saved entries that have no app or no tool array and keeps the rest", async () => {
  const good = snap("d1", "app-d", 1);
  host.reset([null, 5, { id: "x", tools: [] }, { id: "y", app: "app-d", tools: "no" }, good, { id: "z", app: 3, tools: [] }]);
  assert.deepEqual(await store.load(), [good]);
});

test("list puts the newest first and can be limited to one app", async () => {
  host.reset([snap("s1", "app-a", 10), snap("s2", "app-b", 30), snap("s3", "app-a", 20), snap("s4", "app-b", 5)]);
  await store.load();
  assert.deepEqual(store.list().map((s) => s.id), ["s2", "s3", "s1", "s4"]);
  assert.deepEqual(store.list("app-a").map((s) => s.id), ["s3", "s1"]);
  assert.deepEqual(store.list("nothing"), []);
});

test("latest and get find a snapshot and give null for unknown ones", async () => {
  host.reset([snap("g1", "app-g", 10), snap("g2", "app-g", 20), snap("g3", "app-h", 99)]);
  await store.load();
  assert.equal(store.latest("app-g")?.id, "g2");
  assert.equal(store.latest("app-none"), null);
  assert.equal(store.get("g1")?.taken, 10);
  assert.equal(store.get("nope"), null);
});

test("adding a snapshot stores it and saves the whole list to the host", async () => {
  host.reset();
  await store.load();
  const s = snap("a1", "app-add", 100, [tool("x", "X", { schema: { type: "object" } })]);
  const res = await store.add(s);
  assert.deepEqual(res, { snapshot: s, unchanged: false, dropped: [], sessionOnly: false });
  assert.deepEqual(host.saved.get("snapshots"), [s]);
  assert.equal(store.get("a1")?.id, "a1");
});

test("adding a list that is the same as the latest one from the same source is not stored twice", async () => {
  host.reset();
  await store.load();
  const first = snap("u1", "app-u", 1, [tool("x", "X")]);
  await store.add(first);
  host.calls = [];
  const res = await store.add(snap("u2", "app-u", 2, [tool("x", "X")]));
  assert.equal(res.unchanged, true);
  assert.equal(res.snapshot.id, "u1");
  assert.equal(store.list("app-u").length, 1);
  assert.equal(host.calls.filter((c) => c.method === "storage.set").length, 0);
});

test("a same list is still stored when the source differs, when skipping is off or when a tool changed", async () => {
  host.reset();
  await store.load();
  await store.add(snap("k1", "app-k", 1, [tool("x", "X")]));
  const other = await store.add(snap("k2", "app-k", 2, [tool("x", "X")], { source: "formmcp" }));
  assert.equal(other.unchanged, false);
  const forced = await store.add(snap("k3", "app-k", 3, [tool("x", "X")], { source: "formmcp" }), false);
  assert.equal(forced.unchanged, false);
  const changed = await store.add(snap("k4", "app-k", 4, [tool("x", "Y")], { source: "formmcp" }));
  assert.equal(changed.unchanged, false);
  assert.equal(store.list("app-k").length, 4);
});

test("only eight snapshots are kept per app and the oldest goes first", async () => {
  host.reset();
  await store.load();
  await store.add(snap("o1", "app-other", 1, [tool("only")]));
  let last: any;
  for (let i = 1; i <= 9; i++) last = await store.add(snap(`p${i}`, "app-p", i, [tool("t", `v${i}`)], { label: `label ${i}` }));
  assert.deepEqual(last.dropped, ["label 1"]);
  assert.equal(store.list("app-p").length, 8);
  assert.equal(store.get("p1"), null);
  const tenth = await store.add(snap("p10", "app-p", 10, [tool("t", "v10")], { label: "label 10" }));
  assert.deepEqual(tenth.dropped, ["label 2"]);
  assert.deepEqual(store.list("app-p").map((s) => s.id), ["p10", "p9", "p8", "p7", "p6", "p5", "p4", "p3"]);
  assert.equal(store.get("o1")?.id, "o1");
  const savedIds = (host.saved.get("snapshots") as any[]).map((s) => s.id).sort();
  assert.deepEqual(savedIds, ["o1", "p10", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);
});

test("forget removes a snapshot from the list and from the saved value", async () => {
  host.reset([snap("f1", "app-f", 1), snap("f2", "app-f", 2)]);
  await store.load();
  await store.forget("f1");
  assert.deepEqual(store.list().map((s) => s.id), ["f2"]);
  assert.deepEqual((host.saved.get("snapshots") as any[]).map((s) => s.id), ["f2"]);
  await store.forget("never-there");
  assert.deepEqual(store.list().map((s) => s.id), ["f2"]);
});

test("when the saved total passes the size limit the oldest snapshots are dropped and named", async () => {
  host.reset();
  await store.load();
  const big = (id: string, app: string, taken: number) => snap(id, app, taken, [tool("t", "x".repeat(100_000))], { label: `big ${id}` });
  await store.add(big("z1", "app-z1", 1));
  await store.add(big("z2", "app-z2", 2));
  const res = await store.add(big("z3", "app-z3", 3));
  assert.deepEqual(res.dropped, ["big z1"]);
  assert.equal(res.sessionOnly, false);
  assert.equal(store.get("z1"), null);
  assert.deepEqual((host.saved.get("snapshots") as any[]).map((s) => s.id), ["z2", "z3"]);
});

test("one snapshot too big to save stays in the list for this session only and is not saved", async () => {
  host.reset();
  await store.load();
  const huge = snap("h1", "app-huge", 1, [tool("t", "y".repeat(260_000))]);
  const res = await store.add(huge);
  assert.equal(res.sessionOnly, true);
  assert.equal(store.isSessionOnly("h1"), true);
  assert.equal(store.get("h1")?.id, "h1");
  assert.deepEqual(host.saved.get("snapshots"), []);
  await store.forget("h1");
  assert.equal(store.isSessionOnly("h1"), false);
  assert.equal(store.get("h1"), null);
});
