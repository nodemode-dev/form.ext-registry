# Changelog

## 0.1.1 (2026-11-07)

Same extension as 0.1.0; packaging only. Verified in FormDeck 0.32.0, installed as FormPortal does and from `dev.json`.

- `tools/formpkg.py` is the contract kit's current copy, which requires `api: "1"`, refuses native packages and reports malformed manifests instead of raising.

Package: `rehearsal-coach-0.1.1.formpkg`, 12421 bytes, SHA-256 `5a5577353ddef2bdacba67bc6afc3802d95fbe1733f92a45a995a7861ac91b30`.

## 0.1.0 (2026-11-07)

First release, for FormDeck 0.32.0 (Form Extension Contract, API 1).

- Target talk length, split evenly or like the last run, with any slide's plan set by hand and hidden slides optional.
- Run-through in the editor: Start, Pause, Back, Next, Finish, Cancel, with keys; follows slide changes made in FormDeck.
- Live slide clock against its plan, elapsed and left time, pace against the plan, a bar per slide.
- Review of the run against the target and the previous run; the last five runs kept per deck.
- Write to notes and Remove from notes, each one undo step.
- Follows FormDeck's theme, dark and light.

Package: `rehearsal-coach-0.1.0.formpkg`, 12421 bytes, SHA-256 `f9d9891831c22eeaf99e2e6234f3c965f694dfc37867bcd090efd3eb0831b2d0`.
