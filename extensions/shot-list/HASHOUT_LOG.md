# Hashout log

## 0.1.0 (2026-11-07)

**Why a shot list.** The two candidates were Beat Markers and a shot list. FormCut already finds beats
(`backend/app/rhythm.py`, `backend/app/music.py`, the inspector's Find beats that turns them into timeline snap
points, and the `media.beats` and `media.music` RPC and MCP tools). Nothing in FormCut makes a shot list, storyboard
or contact sheet: its exports are video, audio, GIF, captions and timeline interchange (OTIO, EDL, FCP XML).

**Frames come from the person's own files.** FormCut's `document.read` carries no pictures, and the sandbox cannot
reach the engine's thumbnail routes (`connect-src 'none'`, and an `<img>` from the app's origin would taint the canvas
the sheet is drawn on). So the panel asks for the source files through `files.open`, matches them to clips by file
name (then by name without extension), and decodes them in the frame with a `<video>` on a blob URL (`media-src
blob:` is allowed). A source the window cannot play (ProRes, HEVC on some systems) is named in the status line. Images
go through `createImageBitmap` on the Blob, not a fetch of the blob URL, because `connect-src 'none'` blocks that too.
If a later FormCut puts a `frame`, `thumbnail` or `poster` data URL on a clip or media item, the snapshot reader uses
it with no change.

**One layout, two renderers.** `sheet.ts` lays a page out as a list of rectangles, lines, text runs and images in
points; `render-canvas.ts` draws that list for the preview and the PNG, `pdf.ts` writes it as PDF operators. Text is
measured with the standard Helvetica widths in both, so what the preview truncates is what the PDF truncates. The PDF
uses the base fonts with WinAnsi encoding (real, selectable text, no embedded font); a character outside WinAnsi
prints as `?`. Frames go in as JPEG (DCTDecode), each written once and shared between pages.

**Notes.** Kept in the extension's storage under `notes:<project id>:<timeline id>`, saved 400 ms after typing.
Notes to markers writes `Shot N: note` at each noted shot's start, all ops in one `document.apply` (one undo step), and
skips a shot whose markers already carry that exact text, so pressing it twice adds nothing.

**Zero flash.** The whole panel is in `index.html`, its stylesheet included inline (the contract CSP allows inline
styles); script fills text and patches rows keyed by clip id. With a linked stylesheet the sandboxed frame laid out
once without it whenever the stylesheet came late (on a loaded machine), and Chrome recorded CLS 0.71 even though
that layout was not painted; inline, the first layout is the final one. The header stacks the timeline name over the
count so filling them in moves nothing.
