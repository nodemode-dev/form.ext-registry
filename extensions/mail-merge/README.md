# Mail Merge for formpdf

Fill a PDF form once for every row of a spreadsheet. Mail Merge matches the columns of a CSV to the form fields of the PDF open in formpdf, shows any row on the page before you commit, and saves one filled PDF per row (in a zip) or one combined PDF with every row.

![Mail Merge in formpdf's Extensions tab, previewing the first row of a telescope loan form](docs/screenshot.png)

It is an extension for formpdf 0.59.0 or later, built on the Form Extension Contract, API 1. formpdf itself fills one form at a time (Fill Forms and Sign, or one XFDF record); Mail Merge adds the many-records job.

## What it does

1. **Form.** Reads the open PDF's fields from formpdf, and makes the copies from the open PDF as it is now, with every applied change. Use another PDF file loads any other PDF with form fields instead. (In an app that cannot hand over the open file, Mail Merge asks you to choose it once.)
2. **Data.** Choose a CSV, or paste rows. The first line names the columns. Commas, semicolons, tabs or bars; UTF-8, UTF-16 or Windows-1252.
3. **Match fields.** Columns are matched to fields by name (`Borrower Name` finds `borrower_name`, `Email` finds `borrower_email`). Change any match: a column, keep the form's value, or clear it.
4. **Preview.** Step through rows. A sketch of the page shows each value where it lands; click a box to find its match. Values that do not fit are named in plain words: not one of a list's choices, longer than the field allows, not yes or no for a check box. Next problem jumps to the next row with one. Fill the open PDF with this row puts the row into the document in formpdf as one change that Undo takes back, so you see it exactly as formpdf draws it.
5. **Make PDFs.** One PDF per row in a zip, named from columns (`{Borrower Name}`, plus `{row}` and `{file}`), or one combined PDF in which each row keeps its own fields (`row1.name`, `row2.name`). Pick rows (`1-10, 15`), and Flatten to make the values part of the page. Long runs show progress and can be cancelled; nothing is saved until you choose where.

Check boxes take yes, y, true, 1, x, on or checked (and no, false, 0, off or empty); radio buttons and lists take a choice's name or export value. Text, multi-line, comb, check box, radio, drop-down and list fields are filled, with appearances drawn so every viewer shows the values. Matches and output choices are remembered per form.

## Install

- **FormPortal:** open FormPortal, find Mail Merge under formpdf's extensions, and Install. Or choose Install from File and pick `mail-merge-0.1.0.formpkg`.
- In formpdf, open the Extensions tab (or Extensions > Mail Merge: Fill the Form from a CSV). The first time, formpdf asks you to allow what the extension needs.

## Permissions and why

| Permission | Why |
|---|---|
| `document` | Read the open PDF's name and fields, fill the open PDF with one row when you ask, and follow changes to it |
| `files-read` | Open the CSV and the PDF file you choose |
| `files-write` | Save the zip or the combined PDF where you choose |

No network. Everything runs in formpdf's sandboxed panel on your computer.

## Build

```sh
npm install
npm run build
npm run package
python3 tools/formpkg.py validate package
```

`npm run build` type-checks `src/` and bundles it into `package/ui/`. `npm run package` writes `dist/mail-merge-0.1.0.formpkg` and prints its SHA-256. To run it from this folder in formpdf, add it to `extensions/formpdf/dev.json` under FormPortal's folder (form.ext's Run in App does this), then Extensions > Reload Extensions.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE.md`.
