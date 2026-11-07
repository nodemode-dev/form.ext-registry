# Changelog

## 0.1.1 (2026-11-07)

- The kit's current packager, which refuses packages without `api: "1"` or with `native: true`. The panel and commands are unchanged; checked in the real Form.md 0.50.0 window: inline citations at the cursor, Update replacing the previous list in one undo step, and the bibliography's italics, links and `[1]` labels.
- Package: `citations-0.1.1.formpkg`, 18424 bytes, SHA-256 `ab11d2dcabda8ce3695e3f7c52ad3d93562fe73ef5ed17aa295d5be5a769c1bf`.

## 0.1.0 (2026-11-07)

- First release for Form.md 0.50.0 (Form Extension Contract, API 1).
- Import a BibTeX or BibLaTeX `.bib` file (with `@string`, `#` joins, LaTeX accents and every name form) or a CSL-JSON file, with progress and Cancel; the library is remembered between sessions when it fits the extension's storage.
- Search the library and cite one or more entries with an optional locator at the cursor as `[@key]` or `[@a; @b, p. 12]`.
- In This Page lists every citation with its in-text form in the chosen style and flags keys the library does not have; clicking one selects its block.
- Build Bibliography adds an APA 7, Chicago author-date or IEEE reference list at the end of the page; Update Bibliography replaces it in place. Each is one undo step.
- Commands: Cite from Library (opens the panel) and Update Bibliography (runs without the panel).
- Package: `citations-0.1.0.formpkg`, 18423 bytes, SHA-256 `56036673a244d79ffd82dcecd836a51e4f2239c49efc4c5d79de490fbe4075f9`.
