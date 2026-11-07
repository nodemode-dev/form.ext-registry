# Hashout log

Decisions and their reasons, newest last.

## 0.1.0

- **Why this capability.** FormEncoder has preview frames and contact sheets (`preview_frame`, `contact_sheet`, `formencoder frame --count`), but nothing that writes interval sprite sheets with a WebVTT thumbnails track, the asset web delivery needs beside the encode. Evidence searched: the command catalogue (`references/commands.md`), MCP tools (`references/tools.md`), the wiki, the code and the CHANGELOG (no `sprite`, `xywh`, `storyboard`, `trickplay` or thumbnails track).
- **Frames come from the window, not the engine.** FormEncoder's preview images are an HTTP route of the engine, not a command, so `app.run` cannot reach them, and the sandbox has `connect-src 'none'`. The panel therefore takes the video the person picks with `files.open` and decodes it with a `<video>` element from a `blob:` URL (`media-src blob:` is in the contract CSP), drawing each frame onto a canvas. No `document` permission is asked for, because nothing is read from or written to the queue.
- **Two video elements.** A hidden one seeks for drawing; the visible one is the test player, so drawing never moves what the person is watching.
- **Frame times.** Tile `i` is the frame at `i * interval` (clamped 40 ms before the end), and its cue runs from `i * interval` to the next interval or the duration. That matches what players expect: the preview at a time is the frame at the start of its cue.
- **Sheets.** Every sheet is named `NAME-n` (even when there is one) so a track's names never change when the length does. The last sheet is cropped to the tiles it holds. Limits: 8192 px a side (safe for canvas and decoders in every web view) and 5000 tiles.
- **Saving.** Save ZIP makes one dialog for everything (a stored ZIP written here; the images are already compressed). Save Track and Sheets saves the sheets first and writes the track last with the names the host reports, so a renamed sheet still matches.
- **Theme.** FormEncoder sends `--bg --panel --surface --text --muted --faint --accent --border --radius --ok --warn --danger --font-ui --font-mono`; the CSS has the dark values as fallbacks so the first paint is already right. Field rows copy FormEncoder's export settings grid (label column, 24 to 28 px controls, 12 px text, 11 px meta).
- **Testing on a loaded machine.** Seeks in 1080p H.264 with a 5 s GOP took several seconds each under heavy load; the README suggests a proxy with frequent key frames for long sources.
