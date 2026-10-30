# @nether/editor

The block and Markdown editor: Nether's schema on [TipTap](https://tiptap.dev)
and ProseMirror, as [ADR 0002](../../docs/adr/0002-editor-tiptap.md)
decided. Every block of the core model has a node, so a note opens without
losing anything, and every block node holds the block's stable ID.

```tsx
import { NoteEditor } from "@nether/editor";

<NoteEditor blocks={note.content} onChange={(blocks) => save(blocks)} label="Note text" />;
```

## How it is built

| File | What it does |
| --- | --- |
| `src/schema.ts` | The TipTap extensions of Nether's schema: StarterKit's blocks and marks, task lists, tables, toggles, and Nether's callouts, columns, math, images, files, bookmarks, embeds, wiki links, tags and raw Markdown |
| `src/ids.ts` | Block IDs: every block gets one, and no two blocks in a note share one, a pasted copy included |
| `src/convert.ts` | A note's blocks to the editor's document and back |
| `src/NoteEditor.tsx` | The editor for one note, in React |

The core model keeps each list item as a block of its own; the editor keeps
lists the ProseMirror way, items inside a list node, so that Enter, Tab and
Backspace in lists behave as people expect. The conversion turns one into
the other and back without loss. Inline code here combines with other
formatting, as Markdown allows (`**`bold code`**`); TipTap's own code mark
excludes every other mark.

## Tests

`pnpm test` checks the conversion block by block; a property test takes
hundreds of random notes, made of every block and inline type, to the
editor's document, checks each document against the schema, and back; and
in a browser document (jsdom) it checks the editor keeps every block and
its ID, reads its own HTML back as the same blocks, gives pasted copies new
IDs, keeps a block's ID with its text when Enter splits it, and turns
Markdown typed at the start of a line into blocks.
