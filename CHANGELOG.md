# Changelog

## 0.2.0 (2026-11-23)

- A test suite. `tests/` holds pytest tests of `tools/` and of the kit's Python (`formpkg.py`, `formext_host.py`), and
  Node tests of the kit's bridge and SDK and of the modules of all thirteen extensions: 1,912 cases, run by the new
  `tests` workflow on every pull request and on `main`. The tests sit outside `extensions/` and `contract/`, so no
  extension's bytes and no kit file changed and no extension's version moves. A test that shows a fault is kept and
  marked as an expected failure (48 in pytest, 35 in Node); `tests/README.md` says how to run them and what a test
  must do.
- The contract kit copy is brought up to date with form.ext: `contract/tools/formpkg.py` and
  `contract/host/python/formext_host.py` now reject an id, version or `entry.ui` that the host refuses (a trailing
  newline, a backslash, an `entry.ui` that is not exactly a package file). No published package or index entry changed.
- `contract.sha256` lists the SHA-256 of every file of the kit copy, and `tools/check_kit.py` fails when the copy does
  not match it. The `verify` workflow runs it before the extension checks.
- README and KEYS.md say the registry is published and the keys exist, and spell formMCP and formskills as the Form
  family's host list does.
- Added since 0.1.3 and not recorded here before: grid-overlay 0.1.1 (#4) and the `nodemode` publisher public key in
  `registry/publishers.json` (#5).

## 0.1.3 (2026-11-08)

- `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md`, which separates submitting or updating an extension, reporting one,
  changing the registry's own checks, signing and workflows, and changing the contract (the kit first). `SECURITY.md`
  says what is supported and what counts as a security problem here, and the README links all three.

## 0.1.2 (2026-11-08)

- The README shows the registry's icon, light or dark to follow the reader's GitHub theme (`assets/`), and says the
  repository is public. Publishing skips with a notice until the signing keys are set (#1).

## 0.1.1 (2026-11-07)

- Check 5 (permissions) skips the Form Extension SDK build an extension ships unchanged as `ui/formext.js`, listed by
  SHA-256 in `tools/sdk_builds.txt`, so a form.ext starter with no `src/` is judged by its own calls. Code bans still
  read that file.

## 0.1.0 (2026-11-07)

- The registry: `extensions/<id>/` per extension, `registry/blocklist.json`, `registry/publishers.json`, the Form
  Extension Contract kit vendored unchanged in `contract/`, Apache-2.0 for the registry's own files, and
  `@nodemode-ai` and `@gbarnai` as code owners.
- Twelve extensions joined with their full history (subtree merges; every original commit kept with its author,
  dates and message): citations, focus-timer, golden-hour, halftone-separations, handwriting-reveal, mail-merge,
  podcast-chapters, rehearsal-coach, scrub-thumbnails, shot-list, tool-diff, trigger-tester.
- `tools/check.py`: the seven checks (contract, version and immutability, reproducible builds with `npm ci`, code
  bans, permissions declared against used, metadata, block list) in `--changed`, `--all` and per-folder modes, with a
  plain report and a non-zero exit on any error.
- `tools/build_index.py`: builds every package with the kit's deterministic `formpkg.py`, signs packages with the
  publisher key and `extensions.json` and `blocklist.json` with the registry key, and leaves blocked extensions out.
- `tools/new_signing_key.py`: makes the registry and publisher Ed25519 key pairs.
- Workflows: `verify` on pull requests (the checks, reported as the job summary) and `publish` on `main` (immutable
  `ext-<id>-v<version>` releases and the rolling `index` release).
- tool-diff 0.1.2: `package-lock.json` committed so `npm ci` reproduces its build (check 3).
- Docs: README, SUBMITTING, POLICY, SECURITY and KEYS.
