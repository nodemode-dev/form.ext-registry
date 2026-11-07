# Changelog

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
