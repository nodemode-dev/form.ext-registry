# formext-formvfx-handwriting-reveal

Handwriting Reveal, a FormVFX extension made to the Form Extension Contract, API 1. It runs in FormVFX's sandboxed extension frame and talks to FormVFX only through `postMessage`.

## Where things are

- The contract: `/home/claude/ext/contract/CONTRACT.md` (kit copy), and FormVFX's own API page `docs/EXTENSIONS.md` in the formvfx repository (document snapshot, commands, events).
- `src/formext.ts` and `tools/formpkg.py` are vendored from the kit unchanged. Adapt by wrapping, never by editing them.
- `src/geometry.ts` turns FormVFX shape paths into canvas paths and back; `src/skeleton.ts` is the centre line tracer (distance transform, thinning, stroke graph, pen order); `src/timing.ts` times the strokes; `src/ops.ts` builds the `document.apply` ops; `src/document.ts` reads the letters from FormVFX; `src/preview.ts` draws and plays the preview; `src/main.ts` is the panel and the headless command; `src/handwriting-reveal.css` the styles.
- `package/` is exactly what goes in the `.formpkg`: `manifest.json`, `ui/index.html` (hand-written, final layout) and the built `ui/handwriting-reveal.js` and `ui/handwriting-reveal.css`.
- Rationale and decisions go in `HASHOUT_LOG.md`, not in code comments.

## Laws

- SEDO: new files with Write; existing files changed only by single-region hand edits after reading them. No sed, awk, perl, scripted replacement, patch, git apply or codemods on any text file.
- Zero DOM flash, flicker or re-render: the page's layout is final in HTML; script only fills it. No layout jump on load, on reload of the extension, or when the layer or the settings change.
- No emoji. No em dash in Markdown. No icon libraries (inline currentColor SVG only). No raw numeric z-index. Near-zero comments.
- Colours come from the host's theme tokens with fallbacks.
- The fewest permissions that work: `document` only. No files, no network.
- No product or company names other than the Form family's (FormVFX's trademark rule).
- Versions `X.YY.Z`; Conventional Commits.

## Commits

- Local identity nodemode-ai <mackin@nodemode.ai> for author and committer.
- No trailers of any kind (no Co-Authored-By, no session links, nothing).
- Never push, reset, amend, rebase or change origin (`git@github.com:nodemode-dev/formext-formvfx-handwriting-reveal.git`).
- `chore(release): vX.YY.Z` is the last commit of a release.
