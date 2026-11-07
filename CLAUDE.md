# formext-formlit-golden-hour

Golden Hour, a FormLit extension made to the Form Extension Contract, API 1. It runs in FormLit's sandboxed extension frame and talks to FormLit only through `postMessage`.

## Where things are

- The contract: `/home/claude/ext/contract/CONTRACT.md` (kit copy), and FormLit's own API page `docs/EXTENSIONS.md` in the formlit repository (document snapshot, ops, events).
- `src/formext.ts` and `tools/formpkg.py` are vendored from the kit unchanged. Adapt by wrapping, never by editing them.
- `src/astro.ts` is the astronomy (sun, moon, day events), `src/photos.ts` reads the selection and builds the keyword ops, `src/chart.ts` draws the diagrams, `src/main.ts` is the panel and the headless command, `src/golden-hour.css` the styles.
- `package/` is exactly what goes in the `.formpkg`: `manifest.json`, `ui/index.html` (hand-written, final layout) and the built `ui/golden-hour.js` and `ui/golden-hour.css`.
- Rationale and decisions go in `HASHOUT_LOG.md`, not in code comments.

## Laws

- SEDO: new files with Write; existing files changed only by single-region hand edits after reading them. No sed, awk, perl, scripted replacement, patch, git apply or codemods on any text file.
- Zero DOM flash, flicker or re-render: the page's layout is final in HTML; script only fills it. No layout jump on load, on reload of the extension, or when a photo or view changes.
- No emoji. No em dash in Markdown. No icon libraries (inline currentColor SVG only). No raw numeric z-index. Near-zero comments.
- Colours come from the host's theme tokens with fallbacks; the sky band colours are this extension's own tokens in `src/golden-hour.css`.
- The fewest permissions that work: `document` (read the selection, write keywords) and `files-write` (Save Timetable, save the diagram). No network.
- Versions `X.YY.Z`; Conventional Commits.

## Commits

- Local identity nodemode-ai <mackin@nodemode.ai> for author and committer.
- No trailers of any kind (no Co-Authored-By, no session links, nothing).
- Never push, reset, amend, rebase or change origin (`git@github.com:nodemode-dev/formext-formlit-golden-hour.git`).
- `chore(release): vX.YY.Z` is the last commit of a release.
