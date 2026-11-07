# Changelog

## 0.1.0

First release, for formpdf 0.59.0 and the Form Extension Contract, API 1.

- A Mail Merge panel in formpdf's Extensions tab, and the command Mail Merge: Fill the Form from a CSV.
- Reads the open PDF's fields from formpdf; loads a CSV (comma, semicolon, tab or bar, UTF-8, UTF-16 or Windows-1252) or pasted rows.
- Matches columns to fields by name, with a list to change each match: a column, keep the form's value, or clear it.
- Preview of any row: a page sketch with each value where it lands, the values with any problem in plain words (not one of the choices, too long, not yes or no), Next problem, and Fill the open PDF with this row as one undoable change.
- Make PDFs: one filled PDF per row in a zip, named from columns, or one combined PDF with each row's fields kept apart; a row range; Flatten; progress and Cancel.
- Text, multi-line, comb, check box, radio, drop-down and list fields, with appearances drawn so every viewer shows the values.
- Remembers the matches and output choices for each form.
