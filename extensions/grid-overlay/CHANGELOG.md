# Changelog

## 0.1.1 (2026-11-09)

First release, for FormVis 2.1.1 (Form Extension Contract API 1). Package `grid-overlay-0.1.1.formpkg`, 17438 bytes, SHA-256 `efc02d03b1b3a717374356f5902b5ddfe2955ba99275949d6804e152ab35a87a`.

- Grid types: Rule of thirds (default), Square grid, Golden ratio, Triangular / isometric, Radial / center lines.
- Sizing by cell count (columns and rows, or square cells) or by print size (print width and cell size in inches or centimeters), with Center the grid.
- Lines: color, width, opacity, Solid, Dashed or Dotted, and Major / minor lines.
- Extras, off by default: diagonals in each cell, A B C / 1 2 3 cell labels, an edge outline, and a border band.
- Each grid is its own layer with its settings kept; selecting it loads them, Update Grid redraws it in place (position in the stack, visibility, opacity and blend kept), Delete Grid removes it, New adds another.
- Export for Print: a PNG with the print resolution written in, and an optional grayscale value copy.
- Headless command Add Grid Overlay for the Extensions menu, the palette and agents.
- The panel follows FormVis's theme and sizes its frame to its content.
