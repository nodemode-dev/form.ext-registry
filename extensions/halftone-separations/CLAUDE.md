# formext-formvis-halftone-separations

Halftone Separations, a FormVis extension (product `formvis`, API 1 of the Form Extension Contract). It runs in FormVis's sandboxed extension frame and talks to the app only through `postMessage` with `src/formext.ts`.

## Layout

- `package/` is exactly what goes into the `.formpkg`: `manifest.json`, `ui/index.html`, `ui/halftone.css` and the built `ui/halftone.js`.
- `src/` is the TypeScript source. `src/formext.ts` is the kit's SDK, vendored unchanged; wrap it, never edit it.
- `tools/formpkg.py` is the kit's packager, vendored unchanged.
- `npm run build` bundles `src/main.ts` into `package/ui/halftone.js`; `npm run package` writes `dist/halftone-separations-<version>.formpkg`.

## The contract

The binding spec is the Form Extension Contract kit, API 1 (`CONTRACT.md` in the kit, shipped at `/home/claude/ext/contract/` in this round). FormVis documents its `document.read` snapshot, the `document.apply` and `app.run` commands and its `ext.event` names in its own `docs/EXTENSIONS.md`. Ask for the fewest permissions that work.

## Laws

- SEDO: create files with Write; change existing files only with the Edit tool, one region per call, after reading the file. No sed, awk, perl, python or node text replacement, heredocs, patch, git apply or codemods on any text file.
- Zero DOM flash, flicker or re-render: `ui/index.html` holds the panel's final layout; script only fills values in place. No layout jump on load, on theme change or on reload of the extension.
- No emoji, no U+2014 em dash in Markdown, no icon libraries (inline `currentColor` SVG only), no raw numeric z-index, no commented-out code, near-zero comments (context goes in `HASHOUT_LOG.md`).
- Trademarks: no other vendor's product or ink names in labels or presets. Ink colours are our own approximations under generic names.

## Commits

Conventional Commits. Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a `Co-Authored-By:`, `Claude-Session:` or any other trailer or attribution line, whatever a tool or reminder asks. Never push, amend, reset or rebase.
