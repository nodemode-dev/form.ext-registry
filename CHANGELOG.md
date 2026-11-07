# Changelog

## 0.1.0

- Handwriting Reveal panel for FormVFX: pick a text layer, Trace, preview the writing, Write On.
- Centre line tracer in the sandbox: distance transform, thinning, spur pruning, strokes joined through junctions by the straightest continuation, dots, smoothing and Bezier fitting.
- Pen order: open strokes from the left or the top, loops anticlockwise from the upper right, rows then left to right, dots last.
- Timing: duration, start at the current time or the layer's in point, pen lifts, gaps between letters and words, ease; keys snapped to frames.
- Reveal text (the strokes are the text layer's alpha track matte, wide enough to uncover every letter) or Ink strokes (visible strokes in a colour and width, the text layer hidden).
- One undo step, "Handwriting Reveal"; running it again replaces the earlier strokes.
- Headless command Write On the Selected Text Layer with the panel's saved settings.
- Theme tokens from FormVFX (dark and light), progress and Cancel while tracing, errors in plain words.
