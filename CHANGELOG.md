# Changelog

## 0.1.0 (2026-11-07)

- First release for Form.md 0.50.0 (Form Extension Contract, API 1).
- Import a BibTeX or BibLaTeX `.bib` file (with `@string`, `#` joins, LaTeX accents and every name form) or a CSL-JSON file, with progress and Cancel; the library is remembered between sessions when it fits the extension's storage.
- Search the library and cite one or more entries with an optional locator at the cursor as `[@key]` or `[@a; @b, p. 12]`.
- In This Page lists every citation with its in-text form in the chosen style and flags keys the library does not have; clicking one selects its block.
- Build Bibliography adds an APA 7, Chicago author-date or IEEE reference list at the end of the page; Update Bibliography replaces it in place. Each is one undo step.
- Commands: Cite from Library (opens the panel) and Update Bibliography (runs without the panel).
