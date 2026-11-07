import { summary } from "./diff";
import type { Diff, Snapshot } from "./model";
import { when } from "./snapshot";

const STATUS: Record<string, string> = { added: "Added", removed: "Removed", renamed: "Renamed", changed: "Changed", same: "Same" };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function meta(s: Snapshot): string {
  return `${esc(s.label)}${s.server ? ` &middot; ${esc(s.server)}` : ""} &middot; ${s.tools.length} tools`;
}

export function html(appName: string, before: Snapshot, after: Snapshot, d: Diff, made: number): string {
  const rows = d.tools
    .filter((t) => t.status !== "same")
    .map((t) => {
      const items = t.changes.map((c) => `<li class="${c.level}"><span class="lv">${c.level}</span>${c.path ? `<code>${esc(c.path)}</code> ` : ""}${esc(c.text)}</li>`).join("");
      return `<section class="tool ${t.level ?? "note"}"><h3><span class="st">${STATUS[t.status]}</span><code>${esc(t.name)}</code>${t.from ? ` <small>was <code>${esc(t.from)}</code></small>` : ""}</h3><ul>${items}</ul></section>`;
    })
    .join("\n");
  const same = d.tools.filter((t) => t.status === "same").map((t) => `<code>${esc(t.name)}</code>`).join(", ");
  const notes = d.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tool Diff: ${esc(appName)}</title>
<style>
:root{color-scheme:light;--ink:#15171c;--soft:#464b57;--faint:#7a8193;--edge:#e2e4ea;--bad:#d4253a;--warn:#b86200;--good:#16804a}
body{margin:32px auto;max-width:860px;padding:0 24px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Ubuntu,system-ui,sans-serif;color:var(--ink);background:#fff}
h1{margin:0 0 4px;font-size:24px}h2{margin:28px 0 8px;font-size:16px}h3{margin:0 0 6px;font-size:14px;display:flex;gap:8px;align-items:baseline}
.meta{margin:0;color:var(--soft)}.sum{font-weight:600;margin:16px 0}
table{border-collapse:collapse}td,th{padding:4px 16px 4px 0;text-align:left}th{color:var(--faint);font-weight:500}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.tool{border:1px solid var(--edge);border-left:4px solid var(--faint);border-radius:8px;padding:10px 14px;margin:8px 0;break-inside:avoid}
.tool.breaking{border-left-color:var(--bad)}.tool.caution{border-left-color:var(--warn)}.tool.additive{border-left-color:var(--good)}
.st{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--soft)}
ul{margin:0;padding:0;list-style:none}li{padding:2px 0}
.lv{display:inline-block;min-width:64px;margin-right:8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint)}
li.breaking .lv{color:var(--bad)}li.caution .lv{color:var(--warn)}li.additive .lv{color:var(--good)}
.note{color:var(--soft);font-style:italic}.same{color:var(--soft)}footer{margin-top:32px;color:var(--faint);font-size:12px}
</style></head><body>
<h1>Tool Diff: ${esc(appName)}</h1>
<p class="meta">Made ${esc(when(made))} with Tool Diff for formMCP</p>
<table><tr><th>Before</th><td>${meta(before)}</td></tr><tr><th>After</th><td>${meta(after)}</td></tr></table>
<p class="sum">${esc(summary(d))}</p>
${notes}
<table><tr><th>Added</th><th>Removed</th><th>Renamed</th><th>Changed</th><th>Same</th><th>Breaking</th></tr><tr><td>${d.counts.added}</td><td>${d.counts.removed}</td><td>${d.counts.renamed}</td><td>${d.counts.changed}</td><td>${d.counts.same}</td><td>${d.counts.breaking}</td></tr></table>
<h2>Changes</h2>
${rows || '<p class="same">No tool was added, removed or changed.</p>'}
${same ? `<h2>Unchanged</h2><p class="same">${same}</p>` : ""}
<footer>Breaking: a call that worked before can fail now. Caution: a call still works but may behave differently. Additive: something new that old calls do not need.</footer>
</body></html>
`;
}

export function json(appName: string, before: Snapshot, after: Snapshot, d: Diff, made: number): string {
  return `${JSON.stringify({ format: "tool-diff-report", format_version: 1, made: new Date(made).toISOString(), app: appName, summary: summary(d), before, after, diff: d }, null, 2)}\n`;
}
