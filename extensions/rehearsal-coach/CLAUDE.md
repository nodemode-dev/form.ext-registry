# Rehearsal Coach for Claude Code

A FormDeck extension (Form Extension Contract, API 1). `package/` is exactly what goes in the `.formpkg`; `src/` is the source; `tools/` builds and packages.

## Where things are

- The contract: `/home/claude/ext/contract/CONTRACT.md` (kit upstream: Form Extension Contract kit, Apache-2.0, nodemode). FormDeck's part of it (snapshot, commands, events): `docs/EXTENSIONS.md` in the formdeck repository.
- `src/formext.ts` and `tools/formpkg.py` are vendored from the kit unchanged. Never edit them; wrap them (`src/deck.ts` is the wrapper over FormDeck's snapshot and commands).
- Build: `npm run build` (type check, then `tools/build.mjs` bundles `src/main.ts` into `package/ui/coach.js` and inlines `src/coach.css` into `package/ui/index.html`). Package: `npm run package`, then `python3 tools/formpkg.py validate package`.

## Laws

- SEDO: new files with Write; existing files only with surgical, hand-made single-region edits after reading them. No sed, awk, perl, scripted replacement, heredoc writes, patch, git apply or codemods on any text file. Copying whole files with `cp` and generated build output are fine.
- Zero DOM flash, flicker or re-render: the page's layout is final in `src/index.html` and its inlined CSS; script only fills text, attributes and the slide rows in place (rows are keyed by slide id and patched, never rebuilt). Check CLS stays 0 under 4x CPU throttling after any layout change.
- No emoji, no U+2014 em dash in Markdown, inline currentColor SVG only (no icon libraries), no raw numeric z-index, no commented-out code, near-zero comments (context goes in `HASHOUT_LOG.md`).
- No speech or content analysis: the plan is the person's own target split evenly or by the shape of their last run, and every budget can be typed by hand (FormDeck's rule: no scoring, ranking or content classification).
- Permissions stay at `document` only.
- Other vendors' product names appear only to name a file format.

## Commits

- Local identity nodemode-ai <mackin@nodemode.ai> for author and committer.
- Conventional Commits `type(scope): summary (x.y.z)` with a body; the version bump `chore(release): vX.Y.Z` is the last commit of a release.
- No trailers of any kind (no Co-Authored-By, no Claude-Session, nothing).
- Never push, reset, amend, rebase or touch origin.
- Versions are `X.YY.Z`; bump `package.json`, `package/manifest.json` and `CHANGELOG.md` together.
