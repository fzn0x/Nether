# 0051. Canvases are JSON Canvas files, drawn with the page's own elements

- Status: Accepted
- Date: 2026-11-01

## Context

The [requirements](../requirements.md#linking-and-knowledge-graph) ask, in
Phase 3, for a canvas: an infinite whiteboard holding note cards, text,
images, links and arrows, saved in the open
[JSON Canvas](https://jsoncanvas.org/spec/1.0/) format, and the
[non-functional requirements](../requirements.md#non-functional-requirements)
that it comply with that specification and that Obsidian read what Nether
writes. Obsidian keeps each canvas as a `.canvas` file in the vault.

Whiteboard libraries were weighed. Excalidraw (MIT) draws freehand and
keeps its own format; tldraw's license is not open source. Neither keeps
JSON Canvas, and both would be most of the app's size.

## Decision

**A canvas is a `.canvas` file of the vault**, in JSON Canvas 1.0: text,
file, link and group nodes, and edges between them, as Obsidian has them.
It is a file, not a note: it has no note ID, no Markdown and no
frontmatter, and syncs, moves and goes to the trash as attachments do
([ADR 0040](0040-attachments-sync-by-path-and-hash-in-the-vault-document.md)).

**`packages/canvas`** reads and writes the format, and does its geometry:

- Reading is lenient where the specification allows and strict where it
  does not: a node or edge it cannot use is left out and said so, and
  fields it does not know, as Obsidian's or a plugin's, are kept as they
  were, so a canvas round-trips.
- Writing is as Obsidian writes, tab-indented with one node or edge a
  line, so the two apps' files diff alike, and IDs are 16 hexadecimal
  digits, as Obsidian's.
- Its geometry gives the point on each side of a node, the side an edge
  leaves from when the file names none, the curve of an edge, the bounds
  of a canvas, and what is under a point.

**The desktop app draws a canvas with the page's own elements**: each node
a positioned element in a layer moved and scaled for panning and zooming,
the edges one SVG beneath them. Text nodes are Markdown; file nodes show a
note's title and its opening, or an image; link nodes their address;
groups their label. Canvases open in tabs beside notes, and show in the
sidebar's trees.

**The keyboard reaches everything**: nodes in reading order, top to bottom
and start to end, with Tab; the arrow keys move one; Enter edits a text
node or opens a note; Delete removes; and every node can be connected to
another from a list. A canvas can also be read as a list of its nodes and
the edges between them, for screen readers.

## Alternatives

- **Excalidraw** in the page: freehand drawing, which the requirement does
  not ask, in a format of its own, at several times the size.
- **A canvas drawn on a `<canvas>`**: faster at thousands of nodes, but
  text, editing, focus and screen readers would all be drawn by hand.
- **A canvas as a note**, Markdown with a canvas in a code block: it would
  have a note ID and links, but Obsidian would not open it as a canvas.

## Consequences

- Two devices that change one canvas at once keep both, the second as a
  conflict copy, as for any attachment; merging canvases as notes merge is
  left for later.
- Tabs hold canvases as well as notes, by their path.
- A canvas made in Obsidian opens in Nether, and the reverse.
