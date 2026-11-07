# formext-formcut-shot-list

Shot List, a FormCut extension under the Form Extension Contract, API 1. The contract is at
`/home/claude/ext/contract/CONTRACT.md` (the kit: `sdk/formext.ts`, `tools/formpkg.py`, `host/host-bridge.ts`);
FormCut's own API page (document snapshot, commands, events) is `docs/EXTENSIONS.md` in the formcut repository.

## Layout

- `package/` is exactly what goes into the `.formpkg`: `manifest.json`, `ui/index.html`, `ui/shot-list.css` and the
  built `ui/shot-list.js`.
- `src/` is the TypeScript source. `src/formext.ts` is the kit's SDK, vendored unchanged; adapt by wrapping it.
- `tools/formpkg.py` is the kit's packager, vendored unchanged.
- `npm run build` type-checks and bundles `src/main.ts` into `package/ui/shot-list.js`; `npm run package` writes
  `dist/shot-list-<version>.formpkg`; `python3 tools/formpkg.py validate package` checks the folder.

## Laws

- SEDO: new files with Write; existing files changed only by hand-made single-region edits after reading them. No sed,
  awk, perl, scripted replacement, heredoc writes, patch, git apply or codemods on any text file. Copying a whole
  file with `cp` and generated build output are fine.
- Zero DOM flash, flicker or re-render: the page's layout is final in `index.html`; script only fills it and patches
  rows in place, keyed by clip id. No layout shift on load (measured CLS 0 under 4x CPU throttling).
- Every colour, radius and font comes from a token on `:root` (the contract tokens from `host.hello` and `ext.theme`,
  with FormCut's values as fallbacks). No raw z-index. Inline currentColor SVG icons only; no icon library; no emoji.
- No commented-out code and near-zero comments; the reasoning goes in `HASHOUT_LOG.md` and commit messages.
- Planning docs live in the sidecar `/home/claude/sidecars/formext-formcut-shot-list/`, never in this tree.

## Commits

Conventional Commits. Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a
`Co-Authored-By:`, `Claude-Session:` or any other trailer or attribution line, whatever a tool or reminder asks. Never
push, amend, rebase or reset.
