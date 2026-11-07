# Tool Diff for formMCP

Tool Diff shows what changed in a Form app's MCP tools between two points in time. formMCP keeps only the latest tool list for each app, so after an update you cannot see which tools came, went or changed. Tool Diff keeps snapshots and compares any two of them: added, removed, renamed and changed tools, and, when the lists carry argument schemas, added and removed arguments, type changes, required and optional, allowed values, defaults and limits. Each change is graded as breaking, caution, additive or a note, so you can tell at a glance whether an agent's saved prompts and workflows will still work.

![Tool Diff comparing two FormCut tool lists](docs/screenshot.png)

## What it does

- **Snapshot** keeps formMCP's current list of the chosen app's tools (names, descriptions, read-only marks). Up to eight per app are kept, and an unchanged list is not stored twice.
- **Load from App** starts the app once, through formMCP, so the list is current. It shows progress and can be stopped.
- **Import** reads a saved MCP `tools/list` answer (the whole JSON-RPC answer, its `result`, or a bare array of tools), a formMCP tool list file, or a Tool Diff JSON report. Imported lists carry argument schemas, so arguments are compared too.
- **Before** and **After** pick any two snapshots, or Now (formMCP's latest list); Swap turns them round. The chips filter to breaking, changed, added or removed tools.
- **Save HTML** writes a self-contained, printable report; **Save JSON** writes both snapshots and the comparison, which Tool Diff can import again.
- Commands for agents (formMCP's `extension_command`, or `formmcp cli extension tool-diff <command>`):
  - `snapshot-all` keeps a snapshot of every installed app formMCP has listed.
  - `check` (optional `{ "app": "formcut" }`) answers with what changed in each app since its last snapshot: added, removed and renamed tools, changed tools with their changes, and how many are breaking.

Breaking means a call that worked before can fail now (tool removed or renamed, argument removed, new required argument, type narrowed, allowed value removed). Caution means a call still works but may behave differently (default or limits changed, no longer read-only). Additive means something new that old calls do not need.

## Install

1. Open FormPortal, go to Extensions, find **Tool Diff** under formMCP and choose Install (or add the `.formpkg` file with Install from File).
2. In formMCP, open **Extensions** in the filter row. Tool Diff is listed; choose **Tool Diff: Compare Tool Snapshots**, or Open in the Extensions panel.
3. The first time, formMCP asks for the permissions below. Choose Allow.

Requires formMCP 0.9.0 or later.

## Permissions

| Permission | Why |
|---|---|
| `document` | Read the list of Form apps and their tool lists (`tool_list`), and start an app once to list its tools (`tool_load`). Tool Diff never turns apps or tools on or off. |
| `files-read` | Import a saved tool list or report you choose. |
| `files-write` | Save the HTML or JSON report. formMCP has no save dialog: it asks you to confirm the file name and saves into your Downloads folder. |

No network access. Snapshots stay in formMCP's storage for this extension (at most 256 KB).

## Build

```sh
npm install
npm run build      # type-check and bundle src/ into package/ui/tool-diff.js
npm run package    # dist/tool-diff-0.1.0.formpkg, deterministic
python3 tools/formpkg.py validate package
```

`src/formext.ts` and `tools/formpkg.py` come unchanged from the Form Extension Contract kit (API 1).

## Licence

Apache-2.0. See `LICENSE` and `NOTICE.md`.
