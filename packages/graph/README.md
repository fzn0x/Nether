# @nether/graph

The link index: what each note links to, its tags, aliases and headings,
and, across the vault, the note each link names, backlinks and tags.

| File | What it does |
| --- | --- |
| `src/extract.ts` | `indexNote`: what the index keeps of a note, read from its parse: its wiki links, embeds and Markdown links to notes, each with its block's text; its tags, inline and from its properties; its aliases; its headings; and the block IDs its file writes |
| `src/graph.ts` | `LinkGraph`: every note's index in memory; a link names the note at that path as Obsidian finds files, or else the note with that alias; backlinks and tags across the vault, worked out again only after a change |

The desktop app keeps each note's index in the vault's SQLite index, with
the size and modification time of the file it read, and parses notes in a
web worker, so a vault opens without reading every note again.

Roadmap: backlinks, tags and the outline in the app in Phase 1, the graph
view and unlinked mentions in Phase 2.
