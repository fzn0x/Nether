# 0002. Edit notes with TipTap, and convert Markdown through our own syntax tree

- Status: Accepted
- Date: 2026-10-30

## Context

The editor is where people spend their time in Nether, and its document is
what the CRDT stores ([ADR 0003](0003-sync-yjs-hocuspocus.md) covers the
sync). The [requirements](../requirements.md#editor-and-writing) ask for:

- blocks with stable IDs that can be dragged, nested, duplicated and
  turned into another type, with slash commands and embeds;
- live Markdown shortcuts, and a round trip Markdown to Nether to Markdown
  that loses no text, links or frontmatter;
- Obsidian's syntax: wiki links, embeds, block references, tags,
  highlights, comments and callouts;
- real-time co-editing through Yjs;
- a license compatible with the AGPL ([ADR 0001](0001-license-agpl-and-dco.md)).

The candidates were TipTap and BlockNote, both built on ProseMirror, and
Lexical. A [spike](0002-editor-spike/) ran eight Markdown files through
each library's own, official Markdown support and checked what came back.
remark, a Markdown syntax tree rather than an editor, ran beside them as a
baseline for what a converter of our own could keep.

| Library | Exact bytes | Same rendering | Visible text | Link targets | Frontmatter | Obsidian syntax |
| --- | --- | --- | --- | --- | --- | --- |
| TipTap 3.32.1 | 2/8 | 6/8 | 7/8 | 3/3 | 0/1 | 1/3 |
| BlockNote 0.56.0 | 0/8 | 0/8 | 7/8 | 2/3 | 0/1 | 2/3 |
| Lexical 0.53.0 | 1/8 | 5/8 | 7/8 | 2/3 | 0/1 | 0/3 |
| remark 11 (baseline) | 5/8 | 8/8 | 8/8 | 3/3 | 1/1 | 2/3 |

What the outputs show:

- **No editor keeps frontmatter or Obsidian's syntax as shipped.** TipTap
  and remark escape wiki links and embeds (`\[\[Note\]\]`), which Obsidian
  then shows as text. All three editors changed the frontmatter: TipTap
  and BlockNote read it as a horizontal rule and paragraphs, and Lexical
  wrote the list `[review, weekly]` as `&#91;review, weekly&#93;`, which
  YAML reads as a string.
- **TipTap changes meaning in edge cases.** An escaped `1\.` lost its
  backslash and became a list item, `&copy;` became `&amp;copy;`, inline
  HTML was escaped, and footnotes were escaped. With its math extension it
  kept LaTeX intact.
- **BlockNote's export is lossy by design**, as its method name
  `blocksToMarkdownLossy` says. It turned every soft line break into a
  hard break, moved the second paragraph of a list item out of the item,
  and dropped link titles, table alignment and inline HTML. Its
  multi-column, AI and export packages are `GPL-3.0 OR PROPRIETARY`.
- **Lexical** has no table or footnote support in `@lexical/markdown`:
  the table survived only as lines of plain text. It wrote footnotes and
  inline HTML as numeric entities (`&#91;^1&#93;`), and turned the blank
  line of a quote into a nested quote.
- **remark** rendered all eight files the same as their inputs and kept
  the frontmatter. Its only breakage was Obsidian's syntax, which no
  plugin in the run knew.

## Decision

1. **The editor is TipTap 3**, on ProseMirror, using only its MIT-licensed
   packages. Nether defines its own schema: every block node carries a
   stable `blockId` attribute, and wiki links, embeds, callouts, toggles,
   columns, math and Mermaid get nodes of their own. Drag handles and the
   slash menu are built on TipTap's open-source extensions. Co-editing
   uses Yjs through TipTap's collaboration extension, which binds the
   editor to Yjs with `@tiptap/y-tiptap` (MIT).
2. **Markdown conversion belongs to `packages/markdown`, not to the
   editor.** It parses Markdown with remark and micromark into a syntax
   tree, with extensions of our own for Obsidian's syntax, and maps that
   tree to and from the editor's ProseMirror document. `@tiptap/markdown`
   is not used for files.
3. **The spike's corpus becomes the start of a round-trip test suite** in
   `packages/markdown`. A file must render the same and keep its text,
   links, frontmatter and Obsidian syntax after a round trip; that suite
   is the acceptance test for the Markdown fidelity requirement.
4. **Source mode is CodeMirror 6** editing the Markdown text itself.

## Alternatives

- **BlockNote.** It has the block experience out of the box (side menu,
  drag handles, slash menu, nesting) and Yjs support, and it is built on
  TipTap, so its ideas carry over. Its block model and lossy Markdown
  export conflict with plain files being the source of truth, its
  releases are still 0.x, where a minor version may break the API, and
  the package Nether would need for columns is dual-licensed.
- **Lexical.** MIT, fast and well maintained, with a Yjs binding. It is
  not ProseMirror, so it shares nothing with the ProseMirror ecosystem we
  draw on for Markdown and collaboration, and its Markdown support was
  the weakest in the spike.
- **TipTap's own Markdown support (`@tiptap/markdown`).** Using it would
  save a mapping layer, but it changed the meaning of escaped text and
  entities in the spike. Conversion is how Nether keeps its first
  principle, that users own their data, so it rests on remark, a mature
  syntax tree whose output rendered identically for every file.

## Consequences

- `packages/markdown` owns a mapping between remark's syntax tree and
  Nether's ProseMirror schema, in both directions, and the round-trip
  suite that guards it. New block types need a mapping and fixtures
  before they ship.
- remark normalizes style when it writes (bullet characters, emphasis
  markers, escapes): it kept the exact bytes of five files out of eight.
  Writing a whole file from the syntax tree would restyle files people
  edit elsewhere. [ADR 0003](0003-sync-yjs-hocuspocus.md) therefore writes
  back only the blocks that changed and keeps the bytes of the rest.
- TipTap sells Pro extensions and a hosted collaboration service; Nether
  uses neither, and the license scanner keeps their packages out.
- We would revisit this if ProseMirror with Yjs could not keep typing
  latency under 16 ms on large notes, or if TipTap's open-source packages
  changed license.
