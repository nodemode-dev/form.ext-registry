# formext-formencoder-scrub-thumbnails

Scrub Thumbnails, a FormEncoder extension made to the Form Extension Contract, API 1. It runs in FormEncoder's sandboxed extension frame and talks to FormEncoder only through `postMessage`.

## Where things are

- The contract: `/home/claude/ext/contract/CONTRACT.md` (kit copy), and FormEncoder's own API page `docs/EXTENSIONS.md` in the formencoder repository (document snapshot, commands, events, files).
- `src/formext.ts` and `tools/formpkg.py` are vendored from the kit unchanged. Adapt by wrapping, never by editing them.
- `src/sprite.ts` plans the sheets and draws the frames, `src/vtt.ts` writes and reads the WebVTT thumbnails track, `src/zip.ts` packs the ZIP, `src/main.ts` is the panel and the test player, `src/scrub-thumbnails.css` the styles.
- `package/` is exactly what goes in the `.formpkg`: `manifest.json`, `ui/index.html` (hand-written, final layout) and the built `ui/scrub-thumbnails.js` and `ui/scrub-thumbnails.css`.
- Rationale and decisions go in `HASHOUT_LOG.md`, not in code comments.

## Laws

- SEDO: new files with Write; existing files changed only by single-region hand edits after reading them. No sed, awk, perl, scripted replacement, patch, git apply or codemods on any text file.
- Zero DOM flash, flicker or re-render: the page's layout is final in HTML; script only fills it. No layout jump on load, on reload of the extension, or when a video, a sheet or the theme changes.
- No emoji. No em dash in Markdown. No icon libraries (inline currentColor SVG only). No raw numeric z-index (the tip stacks by DOM order). Near-zero comments.
- Colours come from FormEncoder's theme tokens with fallbacks.
- The fewest permissions that work: `files-read` (the video you pick) and `files-write` (the sheets, the track, the ZIP). No `document`, no network.
- FormEncoder's trademark rules apply to this repo too: other vendors' names only to name a format.
- Versions `X.YY.Z`; Conventional Commits.

## Commits

- Local identity nodemode-ai <mackin@nodemode.ai> for author and committer.
- No trailers of any kind (no Co-Authored-By, no session links, nothing).
- Never push, reset, amend, rebase or change origin (`git@github.com:nodemode-dev/formext-formencoder-scrub-thumbnails.git`).
- `chore(release): vX.YY.Z` is the last commit of a release.
