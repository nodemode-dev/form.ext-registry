# NOTICE

Mail Merge for formpdf. Copyright 2026 nodemode. Licensed under the Apache License, Version 2.0 (see `LICENSE`).

## Third-party material

| Component | Licence | Source | Where |
|---|---|---|---|
| Form Extension Contract kit (`src/formext.ts`, `tools/formpkg.py`) | Apache-2.0 | nodemode | vendored unchanged |
| Helvetica character widths (WinAnsiEncoding, 32 to 255) | Adobe Core 14 AFM metrics, freely distributable | Adobe font metrics as shipped with PDF libraries | `src/pdf/font.ts`, used to place and fit text in field appearances; no font file is included |
| esbuild | MIT | https://github.com/evanw/esbuild | build tool only, not shipped |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript | build tool only, not shipped |

The extension ships no fonts, pictures or sample documents. The PDF reader and writer in `src/pdf/` are original work in this repository.

## Trademarks

PDF is used to name the file format. Other product names, where they appear, only describe a format or compatibility.
