# Changelog

## 0.1.1 (2026-11-07)

- The headless commands' notice no longer shows the extension's name twice (FormWav already puts it first).
- `tools/formpkg.py` is the kit's newer copy.
- Checked inside FormWav 2.24.0, installed as FormPortal installs it and from a development folder.

## 0.1.0 (2026-11-07)

First release, for FormWav 2.24.0 (Form Extension Contract, API 1).

- Chapters panel: every marker and region in the session is a chapter, listed by time. Edit a chapter's title and start time (each one undo step in FormWav), add one at the playhead, remove one, and give it a link, an image link, an embedded image and a place in the table of contents or not. Episode title and podcast name.
- Checks in plain words: a chapter with no title, a link that is not a web address, a chapter less than a second after the one before it, one after the session's end, a first chapter that is not at the start.
- Save JSON: a Podcasting 2.0 chapters file (version 1.2.0) with `title`, `podcastName`, and per chapter `startTime`, `endTime` (regions), `title`, `url`, `img` and `toc: false`.
- Write into MP3: choose the episode's MP3 and save a copy with ID3 CHAP frames (title, link, embedded image) and a CTOC table of contents, written as ID3 2.3; the file's other tags are kept (a 2.4 tag is converted), the audio bytes are untouched, earlier chapters are replaced. Progress and Cancel.
- Import JSON and Read MP3: add chapters from a chapters file or an MP3's ID3 chapters as markers and regions in one undo step, with their links, images and table-of-contents flag.
- Headless commands in the Extensions menu and palette: Save Chapters JSON, Write Chapters into an MP3; Edit Chapters opens the panel.
