# Podcast Chapters for FormWav

A FormWav extension that turns the markers and regions of a session into podcast chapters, with titles, links and images, and saves them the two ways podcast apps read chapters:

- **a Podcasting 2.0 chapters file** (`.json`, version 1.2.0), the file a feed links with `<podcast:chapters>`;
- **ID3 chapters inside the MP3** (CHAP frames with a title, a link and an embedded image, and a CTOC table of contents), which apps read straight from the episode file.

![The Chapters panel in FormWav's dock](docs/screenshot.png)

## What it does

- Every marker in the session is a chapter that runs to the next one; every region is a chapter with its own end. The panel lists them by time and follows the session as you edit, undo and redo.
- Rename a chapter or type a new start time (each is one step in FormWav's undo history), add a chapter at the playhead, remove one.
- Give a chapter a link, an image link (for the JSON file), an embedded image (for the MP3, scaled to at most 480 px), and hide it from the table of contents.
- Name the episode and the podcast; both go into the JSON file and the episode title into the MP3's table of contents.
- Plain-word checks before you publish: a chapter with no title, a link that is not a web address, two chapters less than a second apart, a chapter after the session's end, a first chapter that does not start at 0:00.
- **Save JSON** saves the chapters file through FormWav's save dialog.
- **Write into MP3** asks for the episode's MP3 (export it from FormWav first), and saves a copy named `<file> (chapters).mp3`. The audio bytes are not touched; the tag is written as ID3 2.3, which podcast apps read most widely; the file's other tags (title, artist, cover art, comments) are kept, converted from 2.4 where needed; any chapters it had are replaced. The file's length is read from its MPEG frames, and a chapter that starts after the end of the MP3 stops the write with a plain question ("Is this the right file?"). Progress shows, and Cancel stops it with nothing saved.
- **Import JSON** and **Read MP3** add the chapters of a chapters file, or of an MP3's ID3 tag, to the session as markers and regions in one undo step, with their links, images and table-of-contents setting.
- The Extensions menu and the palette also have **Save Chapters JSON** and **Write Chapters into an MP3** as commands that run without opening the panel, and **Edit Chapters**, which opens it. A command that runs without a panel is stopped by FormWav after 120 s, file dialogs included, so for a long episode use Write into MP3 in the panel, which has no limit and can be cancelled.

Links, image links, embedded images and the episode names are kept in the extension's own storage in FormWav (256 KB), by marker id; titles and times live in the session itself. Embedded images take about 10 to 40 KB each, so a few dozen fit; for more, use image links.

## Install

- **Through FormPortal**: open FormPortal, go to Extensions, find Podcast Chapters for FormWav and install it (or choose Install from file and pick `podcast-chapters-0.1.0.formpkg`). In FormWav, open Extensions > Extensions panel, press Open on Podcast Chapters, and allow its permissions when asked.
- **From this folder while developing**: with form.ext's Run in App, or by listing `package/` in `extensions/formwav/dev.json` under FormPortal's folder (see FormWav's `docs/EXTENSIONS.md`). FormWav picks it up within 2 s, with the source Development.

Needs FormWav 2.24.0 or later.

## Permissions, and why

| Permission | Why |
|---|---|
| `document` | to read the session's markers, regions, length and playhead, and to add, rename, move and remove markers and regions |
| `files-read` | to open the MP3 you choose to tag or read, a chapters file to import, and an image to embed |
| `files-write` | to save the chapters file and the tagged copy of the MP3 where you choose |

It does not reach the network.

## Build

```sh
npm install          # esbuild 0.25.10 and TypeScript 5.9.3, pinned
npm run build        # type-checks src/ and bundles it into package/ui/chapters.js
npm run package      # dist/podcast-chapters-0.1.0.formpkg, with its SHA-256 and size
python3 tools/formpkg.py validate package
```

`src/formext.ts` and `tools/formpkg.py` come unchanged from the Form Extension Contract kit.

## Licence

Apache-2.0. See LICENSE and NOTICE.md.
