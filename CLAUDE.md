# formext-formtray-focus-timer

Focus Timer, a FormTray extension (product `formtray`, API 1 of the Form Extension Contract). It runs as a tile on FormTray's Widgets board inside a sandboxed frame and talks to the app only through `postMessage` with `src/formext.ts`.

## Layout

- `package/` is exactly what goes into the `.formpkg`: `manifest.json`, `ui/index.html`, `ui/tokens.css` (layer tokens), `ui/focus.css` and the built `ui/focus.js`.
- `src/` is the TypeScript source: `model.ts` (settings, the running session, the log, the session rules and day sums, no DOM), `chime.ts` (the end-of-session chime, synthesised with Web Audio), `main.ts` (the tile). `src/formext.ts` is the kit's SDK, vendored unchanged; wrap it, never edit it.
- `tools/formpkg.py` is the kit's packager, vendored unchanged.
- `npm run build` type-checks and bundles `src/main.ts` into `package/ui/focus.js`; `npm run package` writes `dist/focus-timer-<version>.formpkg`.

## The contract

The binding spec is the Form Extension Contract kit, API 1 (`CONTRACT.md` in the kit, shipped at `/home/claude/ext/contract/` in this round). FormTray documents what it offers an extension in its own `docs/EXTENSIONS.md`: it has no document and no undo, its `document.*` methods are about the board, and a `dock` panel becomes a Widgets tile. This extension asks for no permission: it uses only `host.hello`, `storage.*`, `ui.notify` and `ui.setTitle`, and keeps it that way unless a feature needs more.

## Laws

- SEDO: create files with Write; change existing files only with the Edit tool, one region per call, after reading the file. No sed, awk, perl, python or node text replacement, heredocs, patch, git apply or codemods on any text file.
- Zero DOM flash, flicker or re-render: `ui/index.html` holds the tile's final layout for every tile size; script only fills values in place. No layout jump on load, on theme change, on resize or on reload of the extension.
- No emoji, no U+2014 em dash in Markdown, no icon libraries (inline `currentColor` SVG only), no raw numeric z-index outside `ui/tokens.css`, no commented-out code, near-zero comments (context goes in `HASHOUT_LOG.md`).
- No media files: the chime is synthesised at run time.

## Commits

Conventional Commits. Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a `Co-Authored-By:`, `Claude-Session:` or any other trailer or attribution line, whatever a tool or reminder asks. Never push, amend, reset or rebase.
