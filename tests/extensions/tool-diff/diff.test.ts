import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, summary, types } from "../../../extensions/tool-diff/src/diff.ts";

type AnyObj = Record<string, any>;

function tool(name: string, properties: AnyObj | null = {}, extra: AnyObj = {}, description = `Does ${name}`): AnyObj {
  const { readOnly = null, ...schemaExtra } = extra;
  return {
    name,
    description,
    readOnly,
    schema: properties === null ? null : { type: "object", properties, ...schemaExtra },
  };
}

function snap(tools: AnyObj[], label = "snap", app = "formcut"): any {
  return { id: label, app, label, taken: 1, source: "file", server: "srv", tools };
}

function one(before: AnyObj, after: AnyObj): AnyObj {
  const d = diff(snap([before], "before"), snap([after], "after"));
  assert.equal(d.tools.length, 1);
  return d.tools[0];
}

function at(t: AnyObj, path: string): AnyObj[] {
  return t.changes.filter((c: AnyObj) => c.path === path);
}

const search = () =>
  tool("search", { query: { type: "string", description: "Text to find" }, limit: { type: "integer", default: 10 } }, { required: ["query"] });
const cut = () =>
  tool("cut", { clip: { type: "string" }, at: { type: "number" }, mode: { type: "string", enum: ["ripple", "roll"] } }, { required: ["clip", "at"] });

test("a snapshot compared with itself has no changes", () => {
  const s = snap([search(), cut()]);
  const d = diff(s, s);
  assert.deepEqual(d.counts, { added: 0, removed: 0, renamed: 0, changed: 0, same: 2, breaking: 0 });
  assert.equal(d.argsCompared, true);
  assert.deepEqual(d.notes, []);
  for (const t of d.tools) {
    assert.equal(t.status, "same");
    assert.equal(t.level, null);
    assert.deepEqual(t.changes, []);
  }
});

test("tool order does not matter", () => {
  const d = diff(snap([search(), cut()]), snap([cut(), search()]));
  assert.equal(d.counts.same, 2);
  assert.equal(d.counts.changed + d.counts.added + d.counts.removed + d.counts.renamed, 0);
});

test("object key order, required order, enum order and type list order do not matter", () => {
  const a = tool(
    "export",
    { format: { type: ["string", "null"], enum: ["mp4", "mov"], description: "Container" }, size: { type: "object", properties: { w: { type: "integer" }, h: { type: "integer" } } } },
    { required: ["format", "size"] },
  );
  const b: AnyObj = {
    schema: {
      required: ["size", "format"],
      properties: {
        size: { properties: { h: { type: "integer" }, w: { type: "integer" } }, type: "object" },
        format: { description: "Container", enum: ["mov", "mp4"], type: ["null", "string"] },
      },
      type: "object",
    },
    readOnly: null,
    description: "Does export",
    name: "export",
  };
  const t = one(a, b);
  assert.equal(t.status, "same");
  assert.deepEqual(t.changes, []);
});

test("an added tool is additive and not breaking", () => {
  const d = diff(snap([search()]), snap([search(), tool("trim", { clip: { type: "string" } })]));
  assert.deepEqual(d.counts, { added: 1, removed: 0, renamed: 0, changed: 0, same: 1, breaking: 0 });
  const t = d.tools.find((x) => x.name === "trim")!;
  assert.equal(t.status, "added");
  assert.equal(t.level, "additive");
  assert.match(t.changes[0].text, /1 argument\b/);
});

test("a removed tool is breaking", () => {
  const d = diff(snap([search(), cut()]), snap([search()]));
  assert.deepEqual(d.counts, { added: 0, removed: 1, renamed: 0, changed: 0, same: 1, breaking: 1 });
  const t = d.tools.find((x) => x.name === "cut")!;
  assert.equal(t.status, "removed");
  assert.equal(t.level, "breaking");
});

test("a tool with the same schema under a new name is a breaking rename", () => {
  const renamed = { ...cut(), name: "split" };
  const d = diff(snap([search(), cut()]), snap([search(), renamed]));
  assert.deepEqual(d.counts, { added: 0, removed: 0, renamed: 1, changed: 0, same: 1, breaking: 1 });
  const t = d.tools.find((x) => x.status === "renamed")!;
  assert.equal(t.name, "split");
  assert.equal(t.from, "cut");
  assert.equal(t.level, "breaking");
  assert.match(t.changes[0].text, /cut/);
});

test("unrelated tools that swap in and out are not called a rename", () => {
  const d = diff(snap([cut()]), snap([tool("render", { quality: { type: "integer" } })]));
  assert.equal(d.counts.renamed, 0);
  assert.equal(d.counts.added, 1);
  assert.equal(d.counts.removed, 1);
  assert.equal(d.counts.breaking, 1);
});

test("without schemas a rename is found by an equal description", () => {
  const a = tool("old_name", null, {}, "Renders the timeline");
  const b = tool("new_name", null, {}, "Renders the timeline");
  const d = diff(snap([a]), snap([b]));
  assert.equal(d.counts.renamed, 1);
  assert.equal(d.tools[0].from, "old_name");
  assert.equal(d.tools[0].level, "breaking");
});

test("a changed tool description is a note and not breaking", () => {
  const b = { ...search(), description: "Finds clips by text" };
  const t = one(search(), b);
  assert.equal(t.status, "changed");
  assert.equal(t.level, "note");
  assert.deepEqual(t.changes.map((c: AnyObj) => c.path), [""]);
  assert.match(t.changes[0].text, /description/i);
});

test("a changed argument description is a note at the argument path", () => {
  const b = search();
  b.schema.properties.query.description = "Words to look for";
  const t = one(search(), b);
  assert.equal(t.level, "note");
  assert.equal(at(t, "query").length, 1);
});

test("a new optional property is additive", () => {
  const b = search();
  b.schema.properties.offset = { type: "integer" };
  const t = one(search(), b);
  assert.equal(t.status, "changed");
  assert.equal(t.level, "additive");
  assert.deepEqual(at(t, "offset").map((c) => c.level), ["additive"]);
  assert.match(at(t, "offset")[0].text, /integer/);
});

test("a new required property is breaking", () => {
  const b = search();
  b.schema.properties.project = { type: "string" };
  b.schema.required = ["query", "project"];
  const d = diff(snap([search()]), snap([b]));
  assert.equal(d.counts.breaking, 1);
  assert.equal(d.tools[0].level, "breaking");
  assert.deepEqual(at(d.tools[0], "project").map((c) => c.level), ["breaking"]);
});

test("a removed property is breaking", () => {
  const b = search();
  delete b.schema.properties.limit;
  const t = one(search(), b);
  assert.equal(t.level, "breaking");
  assert.deepEqual(at(t, "limit").map((c) => c.level), ["breaking"]);
});

test("a type changed to an unrelated type is breaking and names both types", () => {
  const b = search();
  b.schema.properties.limit = { type: "string", default: 10 };
  const t = one(search(), b);
  assert.equal(t.level, "breaking");
  const c = at(t, "limit");
  assert.equal(c.length, 1);
  assert.match(c[0].text, /integer/);
  assert.match(c[0].text, /string/);
});

test("integer widened to number is additive and number narrowed to integer is breaking", () => {
  const wide = search();
  wide.schema.properties.limit.type = "number";
  assert.equal(one(search(), wide).level, "additive");
  assert.equal(one(wide, search()).level, "breaking");
});

test("accepting an extra type is additive and dropping one is breaking", () => {
  const wide = search();
  wide.schema.properties.query.type = ["string", "null"];
  assert.equal(one(search(), wide).level, "additive");
  const narrowed = one(wide, search());
  assert.equal(narrowed.level, "breaking");
  assert.equal(at(narrowed, "query").length, 1);
});

test("an enum value added is additive", () => {
  const b = cut();
  b.schema.properties.mode.enum = ["ripple", "roll", "slip"];
  const t = one(cut(), b);
  assert.equal(t.level, "additive");
  assert.match(at(t, "mode")[0].text, /slip/);
});

test("an enum value removed is breaking", () => {
  const b = cut();
  b.schema.properties.mode.enum = ["ripple"];
  const t = one(cut(), b);
  assert.equal(t.level, "breaking");
  assert.match(at(t, "mode")[0].text, /roll/);
  assert.doesNotMatch(at(t, "mode")[0].text, /ripple/);
});

test("a newly introduced enum is breaking and a dropped enum is not", () => {
  const free = cut();
  delete free.schema.properties.mode.enum;
  assert.equal(one(free, cut()).level, "breaking");
  assert.equal(one(cut(), free).level, "additive");
});

test("an optional property made required is breaking", () => {
  const b = search();
  b.schema.required = ["query", "limit"];
  const t = one(search(), b);
  assert.equal(t.level, "breaking");
  assert.deepEqual(at(t, "limit").map((c) => c.level), ["breaking"]);
  assert.equal(at(t, "query").length, 0);
});

test("a required property made optional is not breaking", () => {
  const b = search();
  delete b.schema.required;
  const d = diff(snap([search()]), snap([b]));
  assert.equal(d.counts.breaking, 0);
  assert.equal(d.tools[0].level, "additive");
  assert.equal(at(d.tools[0], "query").length, 1);
});

test("a changed default and a changed limit are cautions", () => {
  const b = search();
  b.schema.properties.limit.default = 25;
  b.schema.properties.query.maxLength = 80;
  const t = one(search(), b);
  assert.equal(t.level, "caution");
  assert.deepEqual(at(t, "limit").map((c) => c.level), ["caution"]);
  assert.match(at(t, "limit")[0].text, /10/);
  assert.match(at(t, "limit")[0].text, /25/);
  assert.deepEqual(at(t, "query").map((c) => c.level), ["caution"]);
});

test("a change inside a nested object is reported with a dotted path", () => {
  const make = (unitType: string, req: string[]) =>
    tool("resize", { size: { type: "object", properties: { width: { type: "integer" }, unit: { type: unitType } }, required: req } });
  const typed = one(make("string", ["width"]), make("boolean", ["width"]));
  assert.deepEqual(typed.changes.map((c: AnyObj) => c.path), ["size.unit"]);
  assert.equal(typed.level, "breaking");
  const req = one(make("string", ["width"]), make("string", ["width", "unit"]));
  assert.deepEqual(req.changes.map((c: AnyObj) => [c.path, c.level]), [["size.unit", "breaking"]]);
});

test("a property added and removed inside a nested object carries the parent path", () => {
  const a = tool("resize", { size: { type: "object", properties: { width: { type: "integer" }, depth: { type: "integer" } } } });
  const b = tool("resize", { size: { type: "object", properties: { width: { type: "integer" }, height: { type: "integer" } } } });
  const t = one(a, b);
  assert.deepEqual(at(t, "size.depth").map((c) => c.level), ["breaking"]);
  assert.deepEqual(at(t, "size.height").map((c) => c.level), ["additive"]);
  assert.equal(t.changes.length, 2);
});

test("a changed array item type is reported at the item path", () => {
  const a = tool("tag", { tags: { type: "array", items: { type: "string" } } });
  const b = tool("tag", { tags: { type: "array", items: { type: "integer" } } });
  const t = one(a, b);
  assert.equal(t.level, "breaking");
  assert.deepEqual(t.changes.map((c: AnyObj) => c.path), ["tags[]"]);
});

test("a change inside an object held in an array is reported under the item path", () => {
  const make = (t: string) => tool("batch", { jobs: { type: "array", items: { type: "object", properties: { id: { type: t } } } } });
  const t = one(make("string"), make("number"));
  assert.deepEqual(t.changes.map((c: AnyObj) => c.path), ["jobs[].id"]);
  assert.equal(t.level, "breaking");
});

test("a change nested very deeply is still reported", () => {
  const deep = (leaf: string) => {
    let s: AnyObj = { type: leaf };
    for (let i = 8; i >= 1; i--) s = { type: "object", properties: { [`l${i}`]: s } };
    return tool("deep", { root: s });
  };
  const t = one(deep("string"), deep("boolean"));
  assert.equal(t.status, "changed");
  assert.ok(t.changes.length >= 1);
  assert.ok(t.changes.every((c: AnyObj) => c.path.startsWith("root.l1.l2")));
  assert.notEqual(t.level, "additive");
  assert.notEqual(t.level, "note");
});

test("closing additionalProperties is flagged and is not graded as harmless", () => {
  const a = tool("open", { path: { type: "string" } }, { additionalProperties: true });
  const b = tool("open", { path: { type: "string" } }, { additionalProperties: false });
  const t = one(a, b);
  assert.equal(t.status, "changed");
  assert.ok(t.level === "caution" || t.level === "breaking");
  const unset = tool("open", { path: { type: "string" } });
  assert.ok(["caution", "breaking"].includes(one(unset, b).level));
});

test("opening additionalProperties is additive", () => {
  const a = tool("open", { path: { type: "string" } }, { additionalProperties: false });
  const b = tool("open", { path: { type: "string" } }, { additionalProperties: true });
  const t = one(a, b);
  assert.equal(t.status, "changed");
  assert.equal(t.level, "additive");
});

test("dropping additionalProperties false is reported as a change", { todo: "defect: additionalProperties false removed from a schema is not reported, though the mirror change is" }, () => {
  const a = tool("open", { path: { type: "string" } }, { additionalProperties: false });
  const b = tool("open", { path: { type: "string" } });
  const t = one(a, b);
  assert.equal(t.status, "changed");
  assert.equal(t.level, "additive");
});

test("additionalProperties flipped on a nested object is reported at its path", () => {
  const make = (extra: boolean) => tool("cfg", { opts: { type: "object", properties: { a: { type: "string" } }, additionalProperties: extra } });
  const t = one(make(true), make(false));
  assert.deepEqual(t.changes.map((c: AnyObj) => c.path), ["opts"]);
});

test("losing the read-only mark is a caution and gaining it is a note", () => {
  const ro = tool("list", { dir: { type: "string" } }, { readOnly: true });
  const rw = tool("list", { dir: { type: "string" } }, { readOnly: false });
  assert.equal(one(ro, rw).level, "caution");
  assert.equal(one(rw, ro).level, "note");
});

test("swapping the snapshots mirrors added and removed tools and breaking grades", () => {
  const a = snap([search(), cut()], "a");
  const withArg = search();
  withArg.schema.properties.project = { type: "string" };
  withArg.schema.required = ["query", "project"];
  const b = snap([withArg, tool("render", { quality: { type: "integer" } })], "b");
  const ab = diff(a, b);
  const ba = diff(b, a);
  assert.equal(ab.counts.added, ba.counts.removed);
  assert.equal(ab.counts.removed, ba.counts.added);
  assert.equal(ab.counts.changed, 1);
  assert.equal(ba.counts.changed, 1);
  assert.equal(ab.tools.find((t) => t.name === "render")!.status, "added");
  assert.equal(ba.tools.find((t) => t.name === "render")!.status, "removed");
  assert.equal(ab.tools.find((t) => t.name === "cut")!.status, "removed");
  assert.equal(ba.tools.find((t) => t.name === "cut")!.status, "added");
  const fwd = at(ab.tools.find((t) => t.name === "search")!, "project");
  const back = at(ba.tools.find((t) => t.name === "search")!, "project");
  assert.deepEqual(fwd.map((c) => c.level), ["breaking"]);
  assert.deepEqual(back.map((c) => c.level), ["breaking"]);
  assert.match(back[0].text, /removed/i);
});

test("the highest grade among several changes becomes the tool level", () => {
  const b = cut();
  b.description = "Cuts a clip";
  b.schema.properties.mode.enum = ["ripple", "roll", "slip"];
  b.schema.properties.at.default = 0;
  delete b.schema.properties.clip;
  b.schema.required = ["at"];
  const t = one(cut(), b);
  assert.equal(t.level, "breaking");
  assert.deepEqual([...new Set(t.changes.map((c: AnyObj) => c.level))].sort(), ["additive", "breaking", "caution", "note"]);
});

test("tools are listed changed first, then removed, renamed, added and unchanged", () => {
  const changed = search();
  changed.schema.properties.limit.type = "string";
  const before = snap([search(), cut(), tool("gone", { a: { type: "string" } }), tool("stay", { s: { type: "string" } })]);
  const after = snap([tool("stay", { s: { type: "string" } }), { ...cut(), name: "split" }, changed, tool("fresh", { f: { type: "boolean" } })]);
  const d = diff(before, after);
  assert.deepEqual(d.tools.map((t) => [t.name, t.status]), [["search", "changed"], ["gone", "removed"], ["split", "renamed"], ["fresh", "added"], ["stay", "same"]]);
  assert.equal(d.counts.breaking, 3);
});

test("a tool with no schema does not fail and arguments are not compared", () => {
  const before = snap([search(), tool("ping", null)], "Monday");
  const changed = search();
  delete changed.schema.properties.limit;
  const after = snap([changed, tool("ping", null, {}, "Pings harder")], "Tuesday");
  const d = diff(before, after);
  assert.equal(d.argsCompared, false);
  assert.equal(d.notes.length, 1);
  assert.match(d.notes[0], /Monday and Tuesday/);
  assert.equal(d.tools.find((t) => t.name === "search")!.status, "same");
  assert.equal(d.tools.find((t) => t.name === "ping")!.level, "note");
  assert.equal(d.counts.breaking, 0);
});

test("a schema with no properties and empty tool lists do not fail", () => {
  const bare = { name: "noop", description: "", readOnly: null, schema: {} };
  const d = diff(snap([bare]), snap([bare]));
  assert.equal(d.counts.same, 1);
  assert.equal(d.argsCompared, true);
  const empty = diff(snap([]), snap([]));
  assert.deepEqual(empty.tools, []);
  assert.deepEqual(empty.notes, []);
  const grown = diff(snap([]), snap([bare]));
  assert.equal(grown.counts.added, 1);
  assert.match(grown.tools[0].changes[0].text, /0 arguments/);
});

test("duplicate tool names do not fail and identical duplicates report nothing", () => {
  const s = snap([search(), search(), cut()]);
  const d = diff(s, snap([search(), search(), cut()]));
  assert.equal(d.counts.added + d.counts.removed + d.counts.renamed + d.counts.changed, 0);
  assert.equal(d.counts.breaking, 0);
  const gone = diff(s, snap([cut()]));
  assert.equal(gone.counts.breaking, gone.counts.removed);
  assert.ok(gone.counts.removed >= 1);
  assert.ok(gone.tools.every((t) => t.name !== "search" || t.status === "removed"));
});

test("snapshots of different apps are called out in a note", () => {
  const d = diff(snap([search()], "a", "formcut"), snap([search()], "b", "formpaint"));
  assert.equal(d.notes.length, 1);
  assert.match(d.notes[0], /formcut/);
  assert.match(d.notes[0], /formpaint/);
});

test("summary counts what changed and says when nothing is breaking", () => {
  const added = diff(snap([search()]), snap([search(), cut()]));
  assert.equal(summary(added), "1 added, 0 removed, 0 changed; nothing breaking");
  const mixed = diff(snap([search(), cut()]), snap([{ ...cut(), name: "split" }]));
  assert.equal(summary(mixed), "0 added, 1 removed, 0 changed, 1 renamed; 2 breaking");
});

test("types reads plain, listed, anyOf, ref, enum and implied object types", () => {
  assert.deepEqual([...types(null)], []);
  assert.deepEqual([...types({ type: "string" })], ["string"]);
  assert.deepEqual([...types({ type: ["string", "null"] })].sort(), ["null", "string"]);
  assert.deepEqual([...types({ anyOf: [{ type: "integer" }, { type: "string" }] })].sort(), ["integer", "string"]);
  assert.deepEqual([...types({ $ref: "#/$defs/Clip" })], ["Clip"]);
  assert.deepEqual([...types({ enum: ["a", "b"] })], ["enum"]);
  assert.deepEqual([...types({ properties: { a: {} } })], ["object"]);
  assert.deepEqual([...types({})], []);
});

test("a snapshot without schemas compared with one that has them does not report arguments as changed", () => {
  const bare = snap([tool("search", null), tool("cut", null)], "Bare");
  const full = snap([search(), cut()], "Full");
  for (const [a, b] of [[bare, full], [full, bare]]) {
    const d = diff(a, b);
    assert.equal(d.argsCompared, false);
    assert.deepEqual(d.counts, { added: 0, removed: 0, renamed: 0, changed: 0, same: 2, breaking: 0 });
    assert.ok(d.tools.every((t) => t.status === "same" && t.level === null && t.changes.length === 0));
    assert.equal(d.notes.length, 1);
    assert.match(d.notes[0], /^Arguments not compared: Bare has no argument schemas\./);
  }
});

test("both snapshots without schemas name both labels in the note", () => {
  const d = diff(snap([tool("a", null)], "One"), snap([tool("a", null)], "Two"));
  assert.equal(d.argsCompared, false);
  assert.equal(d.notes.length, 1);
  assert.match(d.notes[0], /One and Two have no argument schemas/);
});

test("two snapshots with schemas compare arguments", () => {
  const narrowed = search();
  delete narrowed.schema.properties.limit;
  const d = diff(snap([search()], "A"), snap([narrowed], "B"));
  assert.equal(d.argsCompared, true);
  assert.deepEqual(d.notes, []);
  assert.equal(d.counts.changed, 1);
  const t = d.tools[0];
  assert.equal(t.status, "changed");
  assert.equal(at(t, "limit").length, 1);
  assert.equal(at(t, "limit")[0].level, "breaking");
});

test("a renamed tool with identical schemas is paired when both snapshots have schemas", () => {
  const d = diff(snap([cut()]), snap([{ ...cut(), name: "split" }]));
  assert.equal(d.argsCompared, true);
  assert.deepEqual(d.tools.map((t) => [t.name, t.status]), [["split", "renamed"]]);
});
