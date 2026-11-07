# HASHOUT_LOG

Decisions and the reasons for them. Code carries almost no comments; the why lives here.

## 0.1.0

### Why Handwriting Reveal and not Audio to Keyframes

FormVFX already has `keys.audioToKeyframes` (Convert Audio to Keyframes, Animation > Keyframe Assistant), which writes Left, Right and Both Channels sliders from the composition's audio. A handwriting reveal is missing: FormVFX can trace a glyph's outlines (Create Shapes from Text plus Trim Paths draws both edges of every stroke at once) and paint a hand-keyed Write-on, but nothing finds a letter's centre line, splits it into pen strokes or orders and times them.

### Reading the letters exactly

FormVFX has no query that returns glyph outlines, and the sandbox cannot reproduce its layout (rustybuzz shaping, tracking, leading, paragraph boxes, the font fallbacks). So the extension runs `layer.create {op: shapesFromText}` and `layer.tree` of the new layer in one `document.apply` named "Handwriting Reveal: read the letters", reads the paths, and undoes that step with `app.run edit.undo`. It checks the answer's `undone` label is its own and says what to do if it is not. The cost is that the redo stack is cleared, which the person sees as one extra step appearing and leaving in History. The text layer's `layer.tree` gives the text itself, used for word spacing.

### The tracer

- Each glyph is filled non-zero on a canvas at one scale for the whole layer (150 px for the tallest glyph), so stroke thickness compares across letters. Big glyphs are capped at 1400 px a side.
- Felzenszwalb and Huttenlocher's two-pass distance transform gives the half width under every pixel; Zhang and Suen thinning gives a one pixel skeleton.
- Pixels are classed by crossing number (transitions around the 8 neighbours), not by neighbour count, so the staircase corners thinning leaves are not taken for junctions. Junction pixels that touch are one node.
- Spurs (an end and a junction joined by fewer pixels than 1.6 times the junction's half width plus 2) are serifs and corner artefacts; they are removed, and a junction left with two edges is merged away. Six rounds at most.
- At a junction with three or more edges, edge ends are paired by the straightest continuation (direction measured about two half widths out), only when the turn is under about 57 degrees. Paired edges become one stroke, so an x is two strokes and a t's stem runs through its bar.
- A part of a glyph whose skeleton is shorter than its own thickness (the dot of an i, a full stop) becomes a short dash through its thickest point, drawn after the other strokes of the letter.
- Points are smoothed (two 1-2-1 passes), simplified by Douglas-Peucker at 0.7 raster px, and turned into Bezier tangents by Catmull-Rom (a sixth of the neighbour span).

### Pen order

Open strokes start at the left end when they are mostly horizontal (more than 1.5 times wider than tall), otherwise at the top end. Loops run anticlockwise on screen from the point nearest the upper right, as most hands write an o. Strokes in a letter are sorted by rows a sixth of the letter's height, then left to right, with dots last. Letters keep the layout order.

### Timing

Each stroke's share of the writing time goes with its length to the power 0.85, so short strokes are not too fast to see. Pen lifts sit between strokes of a letter, a letter gap between letters (doubled after a space). When the gaps would leave under 35 percent of the duration for writing, they shrink in proportion. Key times snap to the composition's frames; every stroke gets at least one frame.

### What gets written

One `document.apply` named "Handwriting Reveal":

- an empty shape layer `<text layer> Handwriting`, parented to the text layer with an identity transform, so its space is the text layer's own space, which is where Create Shapes from Text puts the outlines;
- per stroke a group with a Path, a Stroke (round cap and join) and a Trim Paths under it, End keyed 0 to 100 with the ease on both keys. Groups are added last stroke first because `shape.add` inserts non-operators at the top of a contents list; that makes the new group always `contents/#1`, so the ops address it without knowing its uid, and the finished layer lists Pen 1 at the top. `shape.add` inserts operators at the end, so the stroke is added before the path and the trim last, giving Path, Stroke, Trim Paths;
- Reveal text: the text layer gets the shape layer as an alpha track matte (`layer.setTrackMatte` hides the matte layer). Stroke width is twice the largest half width under the stroke plus a margin, so the whole letter is uncovered;
- Ink strokes: the strokes are visible in the chosen colour, at 1.8 times the median half width (or a set width), and the text layer is hidden;
- running it again on the same layer deletes the earlier `<name> Handwriting` layer in the same step.

A Trim Paths at End 0 draws nothing in FormVFX (`extract` returns no path for an empty range), so round caps leave no dot before a stroke starts.

### Permissions

`document` only. The extension never touches files or the network.
