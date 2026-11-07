# HASHOUT_LOG

Newest first. Why the code is the way it is.

## 0.1.0 (2026-11-07) · first release

### Choice

FormWav already exports a bare Podcasting 2.0 chapters file from its Labels tab (titles and times only, `labels-pane.ts` `toChapters`), and already detects key and tempo (`detect-key`, `detect-bpm`), so the key-and-tempo candidate would have repeated most of what exists. Nothing in FormWav gives chapters a link or an image, hides one from the table of contents, writes ID3 CHAP or CTOC frames, or reads chapters back from a file: a search of `frontend/src`, `backend/app`, the docs, the HASHOUT_LOGs and the command catalogue for CHAP, CTOC, ID3, chapter links and chapter images found none. That is the gap this extension fills.

### src/session.ts · reading FormWav's snapshot

Reads `document.read` with `what: "session"` because it is the only answer with the session's length and the playhead as well as markers and regions with ids (FormWav's `docs/EXTENSIONS.md`). Times are taken from the `*_s` fields, falling back to the sample fields over `sample_rate`, so the `markers` answer works too.

### src/ops.ts · edits

Every edit is one `document.apply` call with FormWav's own reducer commands (`add-marker`, `set-marker`, `set-region`, `remove-marker`, `remove-region`, `add-region`), positions in samples at the session's rate, so each is one undo step under a clear label (Rename chapter, Move chapter, Add chapter, Remove chapter, Import chapters). The panel never keeps its own copy of titles or times; it re-reads after `document.changed`, debounced 120 ms, and patches rows by key, leaving a focused field alone.

### Where links and images live

Markers have a `comment` field, but FormWav's Labels tab shows it to the person, and an embedded image cannot sit there. So links, image links, embedded images and the table-of-contents flag go into the extension's own storage, by marker or region id. FormWav makes ids with `crypto.randomUUID()`, so ids from different sessions never collide and nothing needs a session key. Images are scaled to at most 480 px and stored as JPEG at quality 0.82 (11.6 KB for the 1200 x 900 test card) to fit the 256 KB the contract allows; a full store is reported in words.

### src/id3.ts · writing ID3 2.3, always

The first build kept a 2.4 tag as 2.4 and wrote CHAP in 2.4. ffprobe then listed three of four chapters: the one with an embedded image was missing. ffmpeg's chapter reader takes sub-frame sizes as plain 32-bit numbers even in a 2.4 tag, where they are sync-safe; the two agree only below 128 bytes, so any chapter with a picture is dropped by readers built that way. The tag is now always written as ID3 2.3, where the sizes are plain: a 2.3 tag's frames are copied byte for byte, and a 2.4 tag's frames are converted (frame flags dropped, grouping bytes, data-length indicators and unsynchronisation undone; text in UTF-8 or UTF-16BE re-encoded as Latin-1 or UTF-16 with a byte order mark for T*** frames, TXXX, WXXX, COMM, USLT and APIC; multiple text values joined with "/"). Compressed or encrypted 2.4 frames cannot be converted without zlib and are left out, and the result says how many. ID3 2.2 cannot carry chapters, so such a file is refused in words. Earlier CHAP and CTOC frames are replaced, not added to. The CTOC is top level and ordered, lists the chapters that are not hidden, and carries the episode title.

### src/mp3.ts · the file's length

The last chapter's end is the MP3's length. It comes from the Xing or Info frame count (or a VBRI header) when there is one, otherwise from walking every MPEG frame, yielding every megabyte so Cancel stays live. A chapter that starts after the MP3 ends stops the write, because it means the wrong file was chosen.

### src/main.ts · long work

Reading and writing a large MP3 goes through base64 both ways (the contract's `files.*` carry base64); decoding and encoding run in 768 KB chunks with a progress step and a cancel check between chunks. A 57.6 MB, 40-minute MP3 showed progress and cancelled with nothing saved. Headless commands wait for the panel's own start (hello, storage) before running, so they use the saved episode title; they report through `ui.notify` and end with `ext.done`.

### Look

Tokens from `host.hello` and `ext.theme` (the contract's seven plus FormWav's `--bg-tertiary`, `--text-secondary`, `--font-ui` and `--font-mono`), FormWav's density (12 px text, 11 px mono times, 24 and 28 px controls, 6 px radius, bordered cards on a 4 px step), region rows marked with the accent like FormWav's Labels tab. The progress row keeps its height when idle (visibility, not display), and `scrollbar-gutter: stable` keeps the width when the list grows past the panel, so nothing jumps.
