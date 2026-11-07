# HASHOUT_LOG

## 0.1.0 (2026-11-07)

- Capability chosen over the seamless pattern maker: FormVis already has Pattern Preview (View), Define Pattern, the Offset filter with wrap, pattern fill layers and the Patterns panel, so a pattern maker would mostly repeat it. It has a Color Halftone filter that rewrites one layer in place, but nothing that separates into plates, takes spot inks, sets a frequency in lpi against the resolution, picks a dot shape per plate, previews an overprint or writes plates out.
- Separation, CMYK: plain GCR from 1 minus the brightest channel, Black curve `k^(1/b) * b`, then a total ink limit that scales C, M and Y. It is not ICC-managed on purpose; the app's own colour service is not reachable through API 1, and the plates are for screens and duplicators, not proofing.
- Separation, spot: overprint model in encoded sRGB, `paper * product(1 - c_i * (1 - ink_i / paper))`, the same thing FormVis's Multiply layers draw, so the preview and the added layers agree. Coverages are solved per node of a 21 cubed LUT by coordinate descent with golden-section steps (five passes, edges tried), weighted toward green, then read back trilinearly.
- Screening: each dot shape is a 64 by 64 spot function turned into thresholds by rank, so a coverage of x inks exactly x of the cell. Smooth edges use a ramp one pixel wide; the coverage is stretched by `(1 + 1/k)` and lowered by `0.5/k` so the ramp does not lighten shadows or darken highlights.
- Workers are not available: the frame's CSP has `script-src 'self'` and the opaque origin cannot start a same-origin worker, so all work runs on the main thread in 64-row bands that yield every 12 ms through a MessageChannel. Cancel flips a flag the bands check.
- Input: `document.read` with `what: "image"` caps at 4096 px, so the picture is read in 2048 px tiles (boxes in document pixels). Above 36 megapixels it is worked at a reduced scale and placed back with `tool:place_image`'s `scale`.
- Output: `tool:draw_shape` for the paper (a shape layer, so a live selection is not touched), `layer.set` names it, then per plate `tool:place_image` and `layer.set { blend: multiply }` on the placed (active) layer, all in one `document.apply`.
- Headless command waits 350 ms after `host.hello` for `ext.activate`; a command activation skips the preview entirely.
- The dialog panel keeps four plate rows at a fixed height; unused rows are hidden in place or show Add ink, so switching sets never moves the controls below.
