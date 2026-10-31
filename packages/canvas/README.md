# @nether/canvas

The infinite whiteboard's file format and geometry
([ADR 0051](../../docs/adr/0051-canvases-are-json-canvas-files-drawn-with-the-page-s-own-elements.md)):
[JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) files read and written
as Obsidian keeps them, fields of other apps kept, and the sides, curves,
bounds and reading order the app draws and moves through.

- `readCanvas(text)` gives the canvas and what it had to leave out.
- `writeCanvas(canvas)` writes it tab-indented, one node or edge a line.
- `edgeGeometry`, `nodeAt`, `nodesInGroup`, `readingOrder` and the rest
  place what the app draws.
