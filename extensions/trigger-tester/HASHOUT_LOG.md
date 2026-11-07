# HASHOUT log

Context for decisions that the code does not say out loud.

## 0.1.0

- **Why BM25 over name and description only.** Agents choose a skill by its front matter, never by its body, so the body is left out on purpose (formskills' own Search already covers bodies). The name is counted twice because it is short and agents weigh it heavily. Word pairs are indexed too, so "colour profile" beats two loose words.
- **IDF follows the scope.** The model is rebuilt from the skills in scope, so a word shared by every FormVis skill counts for little in "Chosen app" and for a lot in "All apps". That matches what an agent sees: only the skills installed beside each other compete.
- **Stemmer.** A dozen suffix rules (plurals, -ing, -ed, -ly, a trailing e, doubled consonants) and `colour` to `color`. Good enough to join "export", "exports" and "exporting"; no dictionary, no network, nothing to licence.
- **Verdicts.** Contested when the runner-up scores 80% or more of the winner. Weak when the winner matched a single word and scored under 4.0: in a library of about twenty skills a rare word alone gives an IDF near 3.8, which is a lucky hit, not a trigger. No match under 0.5.
- **Overlaps from two sources.** Contested prompts show fights you have evidence for; description similarity (unigram TF-IDF cosine at 0.3 or more) shows fights waiting to happen even before you write prompts.
- **Copies.** Only copies whose `edited` list holds `SKILL.md` are read (one `edit-read` each), because only those can have a different description. This is the one long step, so it shows progress and Cancel.
- **Saving a description.** The released `SKILL.md` (or the copy, when one exists) is read first with `app.run` (`read-file` or `edit-read`, no step), then one `document.apply` holds `edit-start` and `edit-write`, so formskills shows one Undo for the whole change. Only the `description:` key in the front matter is replaced, block scalars and quoted multi-line values included; everything else is kept byte for byte. A value with `: `, ` #` or a leading indicator is double-quoted.
- **Headless `rank`.** Returns the JSON report through `ext.done` instead of saving a file, because a save needs the person's dialog and agents want the data.
- **No flash.** `index.html` holds every region at its final size: the lists sit inside a fixed scrolling area, counters have tabular figures and a minimum width, and Cancel is disabled rather than hidden. The first paint follows `prefers-color-scheme` with formskills' own light and dark values, so the frame matches before `host.hello` answers.
