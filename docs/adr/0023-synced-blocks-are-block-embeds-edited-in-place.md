# 0023. Synced blocks are block embeds, edited in place

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#editor-and-writing) ask for synced
blocks: "a block can be embedded in several notes; editing any copy
updates all". In Notion, a synced block is a container whose blocks show in
several pages and edit in any of them. Nether's notes are Markdown files
that Obsidian and other tools read
([ADR 0006](0006-markdown-file-format.md)), and Nether already embeds a
note, a heading's section or one block as Obsidian does: `![[Roadmap]]`,
`![[Roadmap#Next steps]]` and `![[Roadmap#^b1]]`, read only.

A block's text has to live in one file, or two copies of it drift apart
when another app edits one of them.

## Decision

- **A synced block is a block of another note embedded by its ID**,
  `![[Roadmap#^b1]]`. The block lives once, in its note, as Obsidian writes
  it; every note that embeds it holds only the link. Obsidian shows the
  same block in each of them.
- **It edits where it is embedded.** The embed holds an editor of its own
  for the block. Half a second after typing stops, or when the editor is
  left, the block is written to its note's file: that note is read, the
  block with the ID is replaced at whatever depth it is, and the file is
  written with every other byte as it was. If another app changed the file
  meanwhile, it is read again and the block written into it again.
- **Every embed follows its note.** An embed, synced or not, reads its note
  again whenever the note changes, by an edit in another embed, in the note
  itself or by another app. A synced block being edited keeps its own text
  until it is left, as its edit is the newer one.
- **The embed holds one block.** Enter in the block's own line breaks the
  line, and what would make a second block, as a paste of two paragraphs,
  is not done: the link names one block, and would not show a second. A
  block with children, as a list item, a quote or a callout, takes any
  blocks inside it, so a callout or quote with an ID is a synced block of
  many blocks.
- **The block keeps its ID**, whatever it is turned into, so its links and
  embeds still find it.
- **Only a block of another note is synced.** An embed of a block of the
  note it is in, of a heading's section or of a whole note, and an embed
  inside an embed, stay read only: the note's own editor edits its blocks,
  and a heading edited in place would no longer be the one its link names.

## Alternatives

- **Copies kept in step**: the block written into each note, with a marker
  that ties the copies together. Every file would hold the text, but the
  copies would part as soon as another app edited one of them, and
  Obsidian would show each copy as text of its own.
- **A synced block as a block type of Nether's own**, with its blocks in a
  file of their own. Notion's model, but a vault would then hold content
  that no other app shows.
- **Editing the source note's Yjs document from the embed.** Edits would
  merge character by character, but the note would have to be open twice,
  and its document is kept in step with its file only while its own
  editor has it ([ADR 0003](0003-sync-yjs-hocuspocus.md)). Writing the file goes
  through the merge every note already does when another app changes it.

## Consequences

- When the same block is edited in two places at once, the last write
  wins for that block; the rest of its note is merged as any edit from
  another app is.
- A heading's section or a whole note embedded is still read only, and
  opens from its title to be edited.
- With sync (Phase 3), a synced block's note syncs as any other note, and
  each device's embeds follow it.
