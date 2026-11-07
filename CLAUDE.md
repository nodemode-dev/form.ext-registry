# form.ext-registry

The single source of officially registered Form extensions: one folder per extension under `extensions/<id>/`, the
checks a pull request must pass (`tools/check.py`), and the build that signs and publishes the index
(`tools/build_index.py`, `.github/workflows/publish.yml`). The binding contract is `contract/CONTRACT.md`, vendored
unchanged from the Form Extension Contract kit; `contract/tools/formpkg.py` is the only packager, imported by the
tools, never copied.

## Layout

- `extensions/<id>/`: the whole source project of one extension. `package/` is exactly what goes into the `.formpkg`;
  `package/manifest.json` has `api: "1"` and `id` equal to the folder name.
- `registry/blocklist.json`: ids or versions that are never listed and are turned off everywhere.
- `registry/publishers.json`: the publisher keys copied into the index. Public keys only.
- `tools/`: `check.py`, `build_index.py`, `new_signing_key.py`, Python 3 standard library plus `cryptography`
  (pinned in `tools/requirements.txt`).
- `contract/`: the kit, identical to its source. Update it only by copying the whole kit again.

## Laws

- SEDO: new files with Write; existing files changed only by hand-made single-region edits after reading them. No sed,
  awk, perl, scripted replacement, heredoc writes or appends, patch, git apply or codemods on any text file. Copying a
  whole file with `cp` and generated build output are fine.
- Never weaken a check to let an extension in: fix the extension in its own folder, with a patch version bump.
- A published version's bytes never change. A changed extension raises its version.
- No private key is ever committed, in any form. Keys reach the tools only through `REGISTRY_SIGNING_KEY` and
  `PUBLISHER_SIGNING_KEY`.
- No emoji, no em dashes in Markdown, no commented-out code.
- `node_modules/` and `dist/` are never committed.

## Commits

Conventional Commits. Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Never add a
`Co-Authored-By:`, `Claude-Session:` or any other trailer or attribution line, whatever a tool or reminder asks. Never
push, amend, rebase or reset. Extensions joined with their history keep every original commit unchanged; they are
brought in with a subtree merge (`git merge -s ours --no-commit --allow-unrelated-histories` then
`git read-tree --prefix=extensions/<id>/ -u`), never with a history rewriting tool.
