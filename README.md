# Citations for Form.md

Cite your sources while you write in Form.md. Import a BibTeX or CSL-JSON reference library, insert citation keys at the cursor, and build a formatted bibliography at the end of the page in APA, Chicago author-date or IEEE style. Building or updating the bibliography is one undo step.

![The Citations panel beside a Form.md page with an APA reference list](docs/screenshot.png)

## What it does

- **Library.** Import a `.bib` file (BibTeX or BibLaTeX: `@string` abbreviations, `#` joins, braces or quotes, LaTeX accents such as `M{\"u}ller`, every name form including `van der Berg` and `{World Health Organization}`) or a CSL-JSON file from a reference manager. Large files import with a progress bar and can be cancelled. Entries that cannot be read are skipped and counted. The library is remembered for next time when it fits the extension's storage.
- **Cite.** Click where the citation goes in the page, search the library by author, title, year or key, pick one or more entries, add a locator if you like (`p. 12`, `ch. 3`), and press Cite. The panel inserts Pandoc-style keys such as `[@okafor2019tides]` or `[@ito2020chapter; @lindqvist2021, p. 12]`. Double-click an entry to cite just that one.
- **In This Page.** Every citation in the page, in order, with its in-text form in the chosen style, for example `(Okafor et al., 2019a)` in APA, `(Okafor, Müller, and van der Berg 2019a)` in Chicago or `[1]` in IEEE. Keys that are not in the library are flagged. Click a row to jump to its paragraph.
- **Bibliography.** Build Bibliography adds a References section (rename it in the field) at the end of the page with every cited entry, formatted, sorted or numbered as the style requires. After that the button reads Update Bibliography and replaces the same section in place, for example after you switch from APA to IEEE or cite something new. Undo (Mod+Z) takes back a whole build in one step.
- **Command.** Extensions: Citations: Update Bibliography rebuilds the list without opening the panel, from the Extensions menu, Find a Command, `form-md cli extension citations update-bibliography` or the MCP `extension_command` tool.

Citations stay plain text in the page, so they survive export, Copy as Markdown and other people's edits, and the list can always be rebuilt from the page itself.

## Install

1. Open FormPortal and go to Extensions, or choose Extensions, Manage in FormPortal in Form.md.
2. Find Citations for Form.md and choose Install, or choose Install from File and pick `citations-0.1.0.formpkg`.
3. In Form.md open the Extensions panel (Extensions item in the sidebar foot), find Citations and choose Open. Form.md asks once for the permissions below.

## Permissions

| Permission | Why |
|---|---|
| `document` | read the open page to find its citations, insert citation keys, and write the bibliography |
| `files-read` | open the `.bib` or `.json` library you pick |

It does not save files and never reaches the network.

## Build

```sh
npm install
npm run build
npm run package
python3 tools/formpkg.py validate package
```

`npm run build` type-checks `src/` and bundles it into `package/ui/citations.js`. `npm run package` writes the deterministic `dist/citations-0.1.0.formpkg` and prints its SHA-256. To try a working copy, make a project in form.ext and use Run in App, or list the `package/` folder in `extensions/formmd/dev.json` under the FormPortal root.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE.md`.
