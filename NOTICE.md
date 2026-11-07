# Notices

Trigger Tester is licensed under the Apache License 2.0 (see `LICENSE`). Copyright nodemode.

## Vendored and build-time components

| Component | Licence | Owner | Where | Ships in the package |
|---|---|---|---|---|
| Form Extension Contract kit | Apache-2.0 | nodemode | `src/formext.ts`, `tools/formpkg.py` | `formext.ts` is bundled into `ui/trigger.js` |
| esbuild 0.25.10 | MIT | Evan Wallace | dev dependency (bundler) | no |
| TypeScript 5.9.3 | Apache-2.0 | Microsoft | dev dependency (type check) | no |

The package carries no media, fonts or third-party data. The ranking model (BM25 with a small suffix stemmer and stop-word list) is our own code. The skills it ranks belong to the apps that ship them; Trigger Tester only reads their names and descriptions, and writes only to your own copies.
