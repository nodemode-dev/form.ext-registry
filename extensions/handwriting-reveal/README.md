# Handwriting Reveal

A FormVFX extension that writes a text layer on by hand. It traces the centre line of every letter in the layer's own font, puts the strokes in the order a pen draws them, lets you play the writing in the panel, and then adds animated strokes that either reveal the real text through a track matte or draw it as ink. Everything it adds is one undo step.

![Handwriting Reveal in its panel, tracing and writing on a text layer](docs/screenshot.png)

Version 0.1.0 · Apache-2.0 · needs FormVFX 0.54.0 or newer · Form Extension Contract API 1

## What it does

1. Choose a text layer in the panel (it follows the layer you select in the Timeline) and press Trace.
2. The letters are read from FormVFX exactly as it lays them out, then each one is traced to a single line: thick strokes become one pen stroke, crossings are passed straight through, serifs are dropped, and dots stay dots.
3. The preview shows the letters being written. Turn on Lines to see each stroke's centre line and where the pen starts.
4. Set the timing: Duration, Start (the current time or the layer's in point), Pen lift between strokes, the gap Between letters (doubled at a space) and Ease.
5. Choose a style:
   - **Reveal text**: the strokes become the text layer's alpha track matte, so the real text, with its font, colour, stroke and effects, appears as it is written.
   - **Ink strokes**: the strokes are drawn in a colour and width you choose (or the font's own weight) and the text layer is hidden.
6. Press Write On. FormVFX gets a shape layer named `<layer> Handwriting`, parented to the text layer, with one group per stroke (Pen 1, Pen 2 and so on), each with a Path, a round-capped Stroke and a Trim Paths whose End is keyed from 0 to 100. Edit the keys like any others. Write On again replaces it; Edit > Undo removes it.

From the Extensions menu, **Handwriting Reveal: Write On the Selected Text Layer** does the same without the panel, with the panel's last settings.

## Install

Through FormPortal: open FormPortal, find Handwriting Reveal under FormVFX in Extensions, and install it. FormVFX picks it up within two seconds; open it from Extensions > Extensions Panel or from the Extensions menu. To install a downloaded `handwriting-reveal-0.1.0.formpkg`, use FormPortal's Install from File.

For development, point FormVFX at this folder's `package/` with form.ext's Run in App, or write `extensions/formvfx/dev.json` under FormPortal's folder yourself (see FormVFX's `docs/EXTENSIONS.md`).

## Permissions

- `document`: read the composition and the text layer, and add the strokes. That is all it asks for: it opens no files, saves no files and never reaches the network.

While tracing, the extension briefly runs Create Shapes from Text and undoes it, because that is the only way to get the letters exactly as FormVFX draws them. You may see a step appear and leave in History; the project ends up as it was.

## Build

```
npm install
npm run build
npm run package
python3 tools/formpkg.py validate package
```

`build` type-checks `src/` and bundles it into `package/ui/`; `package` writes the deterministic `dist/handwriting-reveal-0.1.0.formpkg` and prints its SHA-256.

## Limits

- Fonts whose letters join (script faces) are traced, but joins become pen lifts.
- The layout at the current time is traced; text animators that move letters are not followed.
- The strokes follow the text layer's transform through parenting. 3D text layers have not been tried yet.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE.md`.
