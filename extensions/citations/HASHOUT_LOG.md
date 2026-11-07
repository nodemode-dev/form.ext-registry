# HASHOUT_LOG

## 2026-11-07: v0.1.1

`tools/formpkg.py` is copied again from the kit after the 07:47 contract update: it now refuses a package without `api: "1"` or with `native: true`, and reports malformed `entry` and `contributes` instead of raising. The package itself is unchanged in content; only its version moves.

Checked in the real form.md 0.50.0 window (built client, 4x CPU): `doc.select` then `doc.insertText` with `at: cursor` puts the citation inline in the person's paragraph (form.md 0.50.0 makes single-paragraph text at the cursor inline); `doc.insertMarkdown` and `doc.replaceBlock` return the new block ids, so Update replaces the previous list and one Undo brings it back; `*italic*`, `<url>` autolinks and `\[1\]` labels import as italics, links and plain `[1]` text, with no list made.

## 2026-11-07: v0.1.0

Citations are Pandoc-style text, `[@key]`, `[@a; @b, p. 12]`, `[see @key]`. Keeping them as plain text in the page means they survive Copy as Markdown, export, other people's edits and other tools, and the panel can always rebuild the bibliography from the page itself. Only bracketed keys count, so an e-mail address or an @mention is never read as a citation. Code and math blocks are skipped.

Inserting at the cursor is two ops in one `document.apply`: `doc.select` collapses the person's last selection to its end, then `doc.insertText` with `at: cursor`. A space is put before the citation when the character before the cursor is not a space or an opening bracket. The editor does not have focus while the panel does, so the cursor-based `editor.*` commands are not used.

The bibliography section is remembered per page as the block ids that the last build returned (`bib.<page id>` in extension storage). An update replaces the first of those blocks with the new Markdown and deletes the rest, all in one apply, so Undo brings the previous list back in one step. When none of the remembered ids exist any more (another browser, cleared storage), the last heading whose text equals the heading field, plus the paragraphs and lists under it, is taken as the section. Otherwise the section is appended at the end.

Order and labels: APA and Chicago sort by first author's family name (accents folded), then year, then title, and add a, b to the year when the same in-text names and year repeat. IEEE numbers by first citation in the page. Only cited entries are listed. Keys not in the library are reported, never invented.

APA 7: up to 20 authors, then the first 19, an ellipsis and the last; `&` before the last; in text one or two names, three or more as `et al.`; a report's publisher is left out when it is the same as its group author. Chicago author-date (17th): first author inverted, up to ten listed, more as the first seven and `et al.`; in text up to three names. IEEE: initials first, up to six listed, more as the first and `et al.`; DOI as `doi:`; web pages end with `[Online]. Available:` and the address.

Markdown: field text is escaped for CommonMark; titles in italics use `*`; addresses are autolinks `<...>` so underscores in them are not escaped; IEEE labels are written `\[1\]` so they show as `[1]` without making a list.

Storage: the extension has 256 KB. The library is stored only when its JSON is under 200 KB, leaving room for preferences and the per-page section ids; a bigger library works for the session and the panel says it must be imported again next time.

Parsing yields to the page every 12 ms so the panel stays responsive and Cancel works; a cancelled import leaves the previous library as it was.

Permissions: on a first open the host may not have granted consent yet when `host.hello` arrives, so each activation asks `host.hello` again while `document` is missing.

Theme: the panel's colours are its own `--c-*` names that resolve to Form.md's tokens (`--sheet`, `--surface`, `--text-muted`, ...), then to the contract's minimum tokens (`--panel`, `--bg`, `--muted`), then to built-in values that follow the system colour scheme until `host.hello` arrives. `body` paints its own background so the frame never shows an opaque default canvas.
