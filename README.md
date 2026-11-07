# Scrub Thumbnails

A FormEncoder extension that makes the hover previews web players show over a seek bar. Pick a video, set how often and how big the thumbnails are, and it draws them into sprite sheets and writes the WebVTT thumbnails track that points into them, the format most web players read for seek previews. A test player in the panel shows the previews before you save, so you can see the result exactly as a viewer will.

![Scrub Thumbnails in FormEncoder's dock: settings, the test player showing a hover preview, the first sheet and the track](docs/screenshot.png)

## What it makes

- Sprite sheets `NAME-1.jpg`, `NAME-2.jpg`, ... (JPEG or WebP), each a grid of thumbnails, `columns` wide and up to `rows per sheet` tall.
- `NAME.vtt`, one cue per interval:

  ```
  WEBVTT

  00:00:00.000 --> 00:00:02.000
  NAME-1.jpg#xywh=0,0,160,90
  ```

  The URL is relative to the track by default; set **Sheet URL prefix** (for example `https://cdn.example.com/thumbs/`) when the sheets live elsewhere.
- **Save ZIP** saves the track and the sheets in one file. **Save Track and Sheets** saves each file through FormEncoder's own dialog; if you rename a sheet, the track is written with the name you chose.

Settings: interval (0.5 to 600 s), thumbnail width (the height follows the picture's shape), columns, rows per sheet, image type and quality, file name, URL prefix. They are remembered. Sheets stay within 8192 px a side and a run within 5000 thumbnails; the panel says what to change when a setting is out of range. Making the thumbnails shows progress and can be cancelled.

The panel decodes the video in FormEncoder's window, so it takes what a web view plays: H.264 or HEVC MP4, VP9 or AV1 WebM and similar. For a ProRes or DNx master, encode a web proxy in FormEncoder first (it says so if it cannot play the file). Long sources draw faster from a proxy with frequent key frames.

## Install

Through FormPortal: find Scrub Thumbnails in the catalogue (formai.studio's extension list) and install it for FormEncoder, or sideload `scrub-thumbnails-0.1.0.formpkg` with FormPortal's Install from File. FormEncoder picks it up without a restart: **Extensions > Scrub Thumbnails: Make Scrub Thumbnails** opens the panel in the right-hand dock. FormEncoder 0.7.0 or newer.

To run it from this folder, point form.ext's Run in App (or a `dev.json` in FormPortal's folder, see FormEncoder's `docs/EXTENSIONS.md`) at `package/`.

## Permissions

- `files-read`: to open the video you pick (FormEncoder's own file dialog).
- `files-write`: to save the sheets, the track or the ZIP where you choose.

It does not read or change the queue and never reaches the network.

## Build

```
npm install
npm run build      # typecheck, bundle src/ into package/ui/
npm run package    # python3 tools/formpkg.py build package -o dist
python3 tools/formpkg.py validate package
```

`src/formext.ts` and `tools/formpkg.py` come unchanged from the Form Extension Contract kit. Licence Apache-2.0; see `NOTICE.md` and `CREDITS.md`.
