# Notice

Handwriting Reveal, a FormVFX extension. Copyright nodemode. Licensed under the Apache License 2.0 (see `LICENSE`).

FormVFX and the Form apps are nodemode's. The extension uses only FormVFX's own command surface through the Form Extension Contract.

## Third-party material

| Component | Licence | Source | Where |
|---|---|---|---|
| Form Extension Contract kit | Apache-2.0 | nodemode | `src/formext.ts`, `tools/formpkg.py` (vendored unchanged) |
| esbuild (build tool only, not shipped) | MIT | Evan Wallace | `devDependencies` |
| TypeScript (build tool only, not shipped) | Apache-2.0 | Microsoft | `devDependencies` |

## Methods

The centre line tracer is written for this extension from the published methods: the two-pass Euclidean distance transform of Felzenszwalb and Huttenlocher (2012), the Zhang and Suen parallel thinning algorithm (1984), Douglas-Peucker line simplification (1973) and Catmull-Rom splines. No code or data from other projects is included.

The package carries no media, fonts or models: the letters come from the text layer's own font, through FormVFX.
