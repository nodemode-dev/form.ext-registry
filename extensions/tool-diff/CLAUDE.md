# formext-formmcp-tool-diff

Tool Diff, a formMCP extension (product `formmcp`, API 1 of the Form Extension Contract). It runs in formMCP's sandboxed extension frame and talks to the window only through `postMessage` with `src/formext.ts`.

## Layout

- `package/` is exactly what goes into the `.formpkg`: `manifest.json`, `ui/index.html`, `ui/tool-diff.css` and the built `ui/tool-diff.js`.
- `src/` is the TypeScript source. `src/formext.ts` is the kit's SDK, vendored unchanged; wrap it, never edit it. `model.ts` holds the types, `snapshot.ts` reads formMCP's tool rows and imported files, `diff.ts` compares two snapshots, `store.ts` keeps snapshots in the extension's storage, `report.ts` writes the HTML and JSON reports, `main.ts` is the panel and the headless commands.
- `tools/formpkg.py` is the kit's packager, vendored unchanged.
- `npm run build` type-checks and bundles `src/main.ts` into `package/ui/tool-diff.js`; `npm run package` writes `dist/tool-diff-<version>.formpkg`.

## The contract

The binding spec is the Form Extension Contract kit, API 1 (`CONTRACT.md` in the kit, shipped at `/home/claude/ext/contract/` in this round). formMCP documents its `document.read` snapshot, its `app.run` commands (`tool_list`, `tool_load` and the rest) and its `ext.event` names in its own `docs/EXTENSIONS.md`. Ask for the fewest permissions that work: today `document`, `files-read` and `files-write`.

## Laws

- SEDO: create files with Write; change existing files only with the Edit tool, one region per call, after reading the file. No sed, awk, perl, python or node text replacement, heredocs, patch, git apply or codemods on any text file.
- Zero DOM flash, flicker or re-render: `ui/index.html` holds the panel's final layout; script only fills values in place. No layout jump on load, on theme change or on reload of the extension.
- No emoji, no U+2014 em dash in Markdown, no icon libraries (inline `currentColor` SVG only), no raw numeric z-index, no commented-out code, near-zero comments (context goes in `HASHOUT_LOG.md`).
- Tool Diff only reads tool lists and starts an app through formMCP's own `tool_load`; it never turns tools or apps on or off.

## Commits

Conventional Commits. Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a `Co-Authored-By:`, `Claude-Session:` or any other trailer or attribution line, whatever a tool or reminder asks. Never push, amend, reset or rebase.
