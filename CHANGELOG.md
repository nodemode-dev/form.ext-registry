# Changelog

## 0.1.0 (2026-11-07)

- First release. A FormEncoder dock panel, Extensions > Scrub Thumbnails: Make Scrub Thumbnails.
- Pick a video; set the interval, thumbnail width (height follows the picture), columns, rows per sheet, JPEG or WebP and quality, the file name and an optional URL prefix for the sheets.
- Draws the sprite sheets in the panel with progress and Cancel, and writes a WebVTT thumbnails track (`sheet.jpg#xywh=x,y,w,h` per interval).
- A test player: hover its bar to see the preview a web player will show, click to seek.
- Save ZIP (track and sheets in one file) or Save Track and Sheets (one dialog each; the track follows the names you choose).
- Remembers the settings. Permissions: `files-read`, `files-write`.
