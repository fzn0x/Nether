# @nether/editor

The block and Markdown editor: Nether's schema on [TipTap](https://tiptap.dev)
and ProseMirror, as [ADR 0002](../../docs/adr/0002-editor-tiptap.md)
decided. Every block of the core model has a node, so a note opens without
losing anything, and every block node holds the block's stable ID. A slash
menu inserts blocks, a handle beside each block moves it or opens its menu,
and math, code and Mermaid diagrams render in place
([ADR 0009](../../docs/adr/0009-math-code-and-diagrams.md)). Images, PDFs,
audio and video show from the files the app finds for their links, and
files pasted or dropped into a note are embedded where they land
([ADR 0010](../../docs/adr/0010-vault-files-in-notes.md)).

```tsx
import { NoteEditor } from "@nether/editor";
import "@nether/editor/math.css";

<NoteEditor
  blocks={note.content}
  onChange={(blocks) => save(blocks)}
  label="Note text"
  files={{ url: (link) => urlOfFileIn(vault, link), attach: (file) => addToVault(file) }}
/>;
```

Every word the editor shows is in `src/words.ts`; an app passes its
language's words as `words`, and English is the default.

## How it is built

| File | What it does |
| --- | --- |
| `src/schema.ts` | The TipTap extensions of Nether's schema: StarterKit's blocks and marks, task lists, tables, toggles, and Nether's callouts, columns, math, images, files, bookmarks, embeds, wiki links, tags and raw Markdown |
| `src/ids.ts` | Block IDs: every block gets one, and no two blocks in a note share one, a pasted copy included |
| `src/convert.ts` | A note's blocks to the editor's document and back |
| `src/commands.ts` | The blocks the slash menu inserts and the block menu turns blocks into, and how the menu finds them by what is typed |
| `src/actions.ts` | Moving, duplicating, deleting and turning a whole block, and the shortcuts for the block that holds the caret |
| `src/SlashMenu.tsx` | The slash menu |
| `src/BlockHandle.tsx` | The handle beside each block, to drag it or open its menu |
| `src/views.tsx` | Math rendered with KaTeX and edited as LaTeX, code with its language, and Mermaid diagrams below their code |
| `src/files.ts` | What kind of file a link names and the URL it loads from, and files pasted or dropped into a note |
| `src/embeds.tsx` | Images, PDFs, audio and video in a note, and a field or file picker for blocks without one |
| `src/words.ts` | Every word the editor shows, in English |
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
Markdown typed at the start of a line into blocks. It also checks that every
command inserts a block the note keeps, and that moving, duplicating,
deleting and turning blocks, by function and by shortcut, leave a valid note
with unique IDs. The desktop app's end-to-end tests drive the slash menu,
the block handle and the math, code and diagram views in a browser.
