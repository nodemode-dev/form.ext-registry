# HASHOUT_LOG

## 0.1.1 (2026-11-07)

- `tools/formpkg.py` copied again from the kit after the round lead's 07:47 update (it now refuses a missing `api`, `native: true` and malformed `entry` or `contributes`); the package was valid under both.
- formMCP 0.9.0 states `loaded` is Unix seconds in `docs/EXTENSIONS.md` and its demo shim now gives seconds; the 1e11 test stays for lists saved by older builds.
- formMCP's `files.save` confirms the name in its own dialog and saves into Downloads (no save dialog in the app); the README's permission line says so. Cancel there reaches the panel as a cancelled save.
- In formMCP's browser demo no app is installed, so the headless commands find nothing to snapshot or check; the integrator ran them end to end there (menu, CLI, MCP) and the comparison itself in the panel.

## 0.1.0 (2026-11-07)

- Capability chosen over the Call Profiler. formMCP's API 1 surface keeps the activity log, tracing and hooks away from extensions (`docs/EXTENSIONS.md`: "the safety settings, secrets, hooks, tracing ... are not open to extensions"), and `log.rs`'s `call` events carry name, app, tool, ok, ms, agent and transport but no payload size, so a profiler could only read a `log.jsonl` the person picks by hand and could never chart payloads. The tool list, on the other hand, is open (`tool_list`, `tool_load`), and formMCP keeps only the last list per app: `toolcache::remember` overwrites `tools/<app>.json` on every start, so nothing in formMCP shows what an update added, removed or changed.
- Snapshots from formMCP have names, descriptions (formMCP cuts them at 240 characters) and the read-only mark, no argument schemas, because `ToolLine` drops `inputSchema`. Arguments are compared only when both sides carry schemas, which means imported `tools/list` answers; the panel says so in a note instead of pretending.
- `readOnly` is `null` when the source does not say (a raw `tools/list` without `annotations`), so a missing annotation never reads as a change.
- Breaking means a call that worked before can fail now: tool removed or renamed, argument removed, new required argument, optional to required, type narrowed, enum value removed, a new enum where any value was taken. Caution: still works but may behave differently (default, limits, no longer read-only, extra arguments refused). Additive: new tool, new optional argument, widened type (integer to number counts as widened), new enum value. Note: descriptions.
- Rename detection pairs a removed and an added tool one to one when both have schemas and the schemas are identical (and either have arguments or the same description), or, without schemas, when the descriptions are identical and not empty.
- Nested objects and array items are compared to depth 5; deeper differences are reported once as "Nested arguments changed".
- Storage: one key `snapshots`, at most eight per app, 240 KB budget (the host caps 256 KB per extension). Over budget the oldest snapshot goes first; a single snapshot too big to store is kept for the session and labelled so. An unchanged list (same source, same tools) is not stored twice.
- "Now" is formMCP's last seen list read through `tool_list` and never stored unless the person presses Snapshot. `document.changed` with `tool_load`, `refresh` or `set_tool` drops the cached Now and compares again.
- `ext.activate` must be answered quickly (the host waits 30 s for it), so the headless commands return from the handler and finish with `ext.done`. The page waits 400 ms after `host.hello` for an activation before it reads the document for the panel, so a headless run does no panel work.
- `ui.resize` is sent first, before `host.hello` is answered, so the dialog has its final height before anything is filled in. The layout inside the frame is fixed by CSS; content only fills rows.
- `tool_list`'s `loaded` is seconds in the app (`toolcache.rs`) but milliseconds in formMCP's demo shim; `docs/EXTENSIONS.md` does not say. Values above 1e11 are read as milliseconds, found in the in-window run (a date in the year 58820).
- Stop on Load from App stops waiting; formMCP may still finish starting the app, and its `document.changed` event then refreshes Now.
- Reports: HTML is self-contained, light, print-friendly; JSON is `format: tool-diff-report` with both snapshots, and Tool Diff imports it again as two snapshots.
