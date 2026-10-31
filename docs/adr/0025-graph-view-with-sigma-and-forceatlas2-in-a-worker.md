# 0025. The graph view with Sigma, laid out by ForceAtlas2 in a worker

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#linking-and-knowledge-graph) ask for
a "global and local graph of notes and links; filter by tag, folder,
property; handles 10,000 nodes smoothly". The architecture names Sigma.js
or Cytoscape.js. The graph shows in the desktop app's web view (WebView2 on
Windows, WebKit on macOS and Linux), and in Phase 3 in the web app, whose
pages will have a content security policy. Every dependency must have a
license compatible with AGPL-3.0, and the desktop app must still open in
under 1.5 s.

## Decision

- **Sigma draws the graph, with WebGL**, from a `graphology` graph, and
  **ForceAtlas2 lays it out** (`graphology-layout-forceatlas2`). All three
  are MIT. They load only when the graph first opens: 165 kB, 40 kB
  compressed, and the layout's worker, 78 kB.
- **Sigma 3**, the line maintained since December 2024 (3.0.3). Sigma 4.0
  came out on 8 October 2026 and had four patch releases in its first three
  weeks; Nether moves to it once it settles.
- **The layout runs in a worker of Nether's own**, a module from the same
  origin as the page, as the link index's is. ForceAtlas2's own worker is
  made from a `blob:` URL, which a strict content security policy refuses.
  Strong gravity keeps notes without links, and small groups, near the
  rest.
- **A large graph stays smooth by doing less while it moves.** Above 5,000
  links, the layout sends its places twice a second rather than ten times,
  as each update costs Sigma a frame, and the links hide while the notes are
  laid out and while the view zooms or pans.
- **The data is the link index's** (`graphData` in `@nether/graph`): a note
  for each note, and a link once from one note to another, as backlinks
  resolve them. Links to files, to notes the vault does not have, and
  within a note draw nothing. A local graph is the notes up to one, two or
  three links from the open note, either way. A filter is written as a
  search is, `tag:`, `path:` and `prop:` with words in names and paths, and
  the note a local graph is around stays whatever the filter.
- **It works from the keyboard and for screen readers** as a picture with
  words: the picture is named with how many notes and links it shows, a
  field finds a note and centres the view on it, a button opens it, and
  buttons zoom in, out and to the whole graph.

## Measured

`pnpm --filter @nether/desktop perf:graph` opens the graph of the 10,000
notes and 46,635 links of the reference vault in Chromium, drawing with the
GPU as WebView2 does. On the maintainer's machine (an RTX 3060), it shows
in about 505 ms, and the time between frames stays at 16.7 ms, 60 frames a
second, at the 95th percentile, while it is laid out and while it zooms.
Headless Chromium otherwise draws WebGL in software, where no WebGL
graph of that size is smooth; the harness asks for the GPU.

## Alternatives

- **Cytoscape.js.** MIT and full of features, but it draws on a 2D canvas,
  which slows well before 10,000 notes; its WebGL renderer is still
  experimental.
- **D3's force layout with SVG or a canvas.** Flexible, but every note
  would be drawn by the CPU on every frame, and its layout would run on
  the page's thread.
- **Laying the graph out before it shows.** The graph would appear in its
  final shape, but only after seconds for a large vault.

## Consequences

- The graph needs WebGL; where it cannot get it, the view says so instead
  of drawing.
- Each layout starts from where the notes were, so a change to the vault
  moves the graph a little rather than redrawing it from nothing.
- Frame times depend on the GPU: the harness is run on the maintainer's
  machine before each gate, not in CI
  ([ADR 0017](0017-measure-performance-before-each-gate-not-in-ci.md)).
