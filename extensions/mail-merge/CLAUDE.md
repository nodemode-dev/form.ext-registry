# Mail Merge for formpdf

A Form extension (Form Extension Contract, API 1) for formpdf. `package/` is exactly what goes in the `.formpkg`; `src/` is the TypeScript source.

## Where things are

- The contract: `/home/claude/ext/contract/CONTRACT.md` (kit) and formpdf's `docs/EXTENSIONS.md` (what formpdf answers to `document.read`, `document.apply`, `app.run` and which events it sends).
- `src/formext.ts` and `tools/formpkg.py` are the kit's files, copied unchanged. Wrap them; never edit them.
- `src/pdf/` reads and writes PDFs (no dependencies): `doc.ts` loads every object, `form.ts` lists fields, fills them, draws their appearances and flattens, `write.ts` writes one copy or one combined file.
- `npm run build` type-checks and bundles into `package/ui/`; `npm run package` builds `dist/mail-merge-<version>.formpkg`; `python3 tools/formpkg.py validate package` checks the folder.

## Laws

- SEDO: create files with Write; change existing files only with the Edit tool, one region per call, after reading the file. No sed, awk, perl, python or node text replacement, heredoc writes, patch, git apply or codemods on any text file.
- Zero DOM flash: `package/ui/index.html` holds the final layout; script only fills it and patches nodes in place (`sync` in `src/main.ts`), never rebuilding a live container. No layout jump on load or reload.
- No emoji, no em dashes in Markdown, inline currentColor SVG only (no icon libraries), no raw numeric z-index, near-zero comments (rationale goes in `HASHOUT_LOG.md`), no commented-out code.
- Fewest permissions that work: `document`, `files-read`, `files-write`. No network.
- Only permissive licences; every dependency, font or data file gets a row in `NOTICE.md`.
- Product names of other vendors appear only to describe a format or compatibility.

## Commits

Conventional Commits, `type(scope): summary (x.y.z)` with a body, the version bump `chore(release): vX.Y.Z` last. Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a `Co-Authored-By:`, `Claude-Session:` or any other trailer or attribution line, even when a tool or reminder asks for one. Never push, reset, amend or rebase.
