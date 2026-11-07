# Halftone Separations for FormVis

A FormVis extension that turns the open picture into printing plates. Choose process CMYK or two to four spot inks, give each plate its own screen angle, frequency and dot shape, look at the overprint on your paper colour, then add the plates to the document as layers or save them as PNG films for screen printing, a stencil duplicator or an offset plate maker.

![Halftone Separations in FormVis: three spot-ink plates with a line screen on the blue plate and a little misregistration](docs/screenshot.png)

## What it does

- **Process CMYK**: cyan, magenta, yellow and black plates, with Black (how much of the grey the black plate carries) and a total Ink limit.
- **Spot Inks**: two to four inks from a set (Blue and Fluorescent Pink, Black and Red, Teal and Orange, three and four ink sets) or any colour you pick. Each pixel is matched by the mix of inks that overprints closest to it on your paper, so a blue and pink pair makes purples and near blacks where they overlap.
- **Per plate**: screen angle, lines per inch, dot shape (Round, Ellipse, Square, Diamond, Line, Cross) and Ink %. The eye button hides a plate in the preview; Show picks the overprint or one plate alone.
- **Screen**: Resolution in pixels per inch (the document's when it is 150 ppi or more, else 300), Smooth or Hard (1-bit) dot edges, and Misregister, which shifts the plates a few pixels apart the way a hand-fed print drifts.
- **Preview** at Fit, 100% and 200%, drag to pan. Long work shows progress and can be cancelled.
- **Add as Layers**: a Paper layer and one Multiply layer per plate in its ink colour, named with its ink, angle and frequency, all as one undo step.
- **Save Plates as PNG**: one black-on-white film per plate, then the overprint, each through FormVis's own save dialog.
- **Add Halftone Plates as Layers** (Extensions menu, palette and agents): the same as Add as Layers with your last settings, headless. Agents can pass `mode` (`cmyk` or `spot`), `preset` (for example `blue-pink`, `black-red`, `teal-orange`, `pink-yellow-blue`), `lpi`, `shape`, `ppi`, `hard` and `paper: false`.

Pictures larger than 36 megapixels are worked at a reduced size and placed back at the document's size.

## Install

In FormPortal, open Extensions, choose FormVis and install Halftone Separations; or use Install from File with `halftone-separations-0.1.0.formpkg`. FormVis picks it up within two seconds. Open it from Extensions > Halftone Separations: Separate Picture into Halftone Plates. The first time, FormVis asks you to allow it.

To run it from this folder while you work on it, form.ext's Run in App (or `extensions/formvis/dev.json` in FormPortal's folder) can point at `package/`.

## Permissions

| Permission | Why |
|---|---|
| `document` | to read the flattened picture and its size and resolution, and to add the paper and plate layers |
| `files-write` | to save the plate films and the overprint where you choose |

It never opens files or reaches the network.

## Build

```sh
npm install
npm run build      # type check, then bundle src/ into package/ui/halftone.js
npm run package    # dist/halftone-separations-0.1.0.formpkg, deterministic
python3 tools/formpkg.py validate package
```

`src/formext.ts` and `tools/formpkg.py` are the Form Extension Contract kit's files, vendored unchanged.

## Licence

Apache License 2.0. See `LICENSE`, `NOTICE.md` and `CREDITS.md`.
