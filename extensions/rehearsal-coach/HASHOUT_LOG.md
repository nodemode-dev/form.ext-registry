# HASHOUT_LOG

## 1. Why a rehearsal coach and not Chart from Data (0.1.0)

FormDeck already has native charts with an editable grid, Paste table and a linked .xlsx or .csv that refreshes (`ui/dialogs-insert.ts`, `editor/chart-links.ts`), so Chart from Data would repeat the app. It also has Rehearse Timings and Speech Rehearsal in the show, but nothing for a target talk length, a per-slide plan, comparison across runs or timings in the notes. The evidence is in the sidecar DEV_PLAN.

## 2. Plan arithmetic only (0.1.0)

FormDeck's CLAUDE.md declines content analysis, scoring and ranking. The plan is therefore the person's target split evenly or in proportion to their own last run, with any slide set by hand. `spread` rounds to whole seconds and hands the leftover seconds to the largest remainders so the plan adds up to the target exactly. Slides missing from the last run get the average of the ones that are there.

## 3. Rehearsing in the editor (0.1.0)

The dock panel cannot be seen during the full-screen show, so the run happens in the editor: Next and Back call `app.run go-to-slide { number }`, and `selection.changed` moves the clock when the person changes slides in FormDeck. The clock accumulates on a slide change (`moveTo`), so time is never counted twice and pausing stops it exactly.

## 4. One notes line, replaced in place (0.1.0)

`mergeNotes` touches only the first line that starts with `Rehearsal Coach:`; a new line goes after one blank line at the end. Writing twice changes nothing (the panel says so), a new run replaces the line, and Remove takes it out and trims trailing blank lines. All slides go in one `document.apply` with a single `apply-ops` op, so Undo takes the whole write back. The deck is read again just before writing, so notes typed since the last read are kept.

## 5. CSS inlined into the page (0.1.0)

With a `<link>` stylesheet the sandboxed frame painted once before the sheet applied (body with the default 8 px margin), a 0.30 CLS. `tools/build.mjs` inlines the minified CSS into `package/ui/index.html`; the contract CSP allows inline style. CLS is 0, also under 4x CPU throttling. The Hidden checkbox label is fixed text (a changing count in it shifted the row).

## 6. Storage per deck (0.1.0)

`storage.set` is per extension, so keys are `deck:<deck.id>` holding `{ plan, runs }`, with at most five runs, well inside the 256 KB limit.
