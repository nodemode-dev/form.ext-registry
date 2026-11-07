# Changelog

## 0.1.0

First release, for FormCut 2.14.0 (Form Extension Contract, API 1).

- A dock panel listing every picture clip of the active timeline (video, images, titles, nested timelines, devices)
  as a numbered shot, in timeline order, with its record in timecode, duration, track and source file.
- Frames taken inside the extension from the source files you pick (Add source files), matched to clips by file name;
  first, middle or last frame of each shot. Titles draw their own card. Progress and Cancel while frames are taken.
- Notes per shot, kept per project and timeline; notes from markers inside a shot are shown and printed with it.
- A sheet preview with pages, and Save PDF (A4 or Letter, landscape or portrait, 2 to 5 columns, 0 to 4 ruled note
  lines, real text) or Save PNG (one continuous sheet).
- Notes to markers: one marker per noted shot, added in one `document.apply`, so one Undo takes them all back.
- Clicking a shot's frame selects the clip in FormCut and moves the playhead to it.
- A headless command, Save Shot List as PDF.
