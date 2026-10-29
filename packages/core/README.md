# @nether/core

The data model that every client and the server share: notes, blocks,
properties, databases, views, links and workspaces, with stable IDs and a
versioned JSON form. It has no dependencies, and runs wherever the Web
Crypto API does: browsers, Node.js and the desktop webviews.

## The model

| Type | What it is |
| --- | --- |
| `Note` | A page, a database or a database's row: a title, properties, content blocks, an optional parent in the page tree, timestamps |
| `ContentBlock` | A block with a stable `BlockId`: paragraph, heading, list and task items, quote, callout, toggle, code, math, divider, table, columns, image, file, bookmark, embed, database, raw Markdown, or a plugin's `plugin-id/type` |
| `Inline` | A block's text: text with marks (bold, italic, underline, strike, code, highlight, comment, link), hard breaks, wiki links, tags, inline math, raw Markdown |
| `PropertyEntry` | A note's frontmatter key and its JSON value, in order |
| `DatabaseSchema` | The schema a database note gives its rows: typed properties and views |
| `View` | A table, board, calendar, timeline, gallery or list, with its filter, sorts and grouping |
| `Link` | A wiki link, an embed or a relation, from a note (and block) to a target |
| `Workspace` | A vault: the unit of sync, permission and encryption |

Notes, workspaces and views have UUIDs (version 7, so they sort by creation
time). Block IDs are short, as Obsidian writes them after `^`, and unique
within their note.

## Reading and writing

Everything that crosses a boundary is checked. `noteFromJson` accepts any
value, checks it field by field and returns a copy with its fields in a
fixed order; a problem throws a `ModelError` whose `path` names the value,
such as `note.content[2].attrs.level`.

```ts
import { createNote, newBlockId, parseNote, serializeNote } from "@nether/core";

const note = createNote({
  title: "Weekly review",
  properties: [{ key: "status", value: "In progress" }],
  content: [{ id: newBlockId(), type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
});

const json = serializeNote(note); // {"format": "nether.note", "version": 1, "note": {...}}
const same = parseNote(json);
```

`serializeNote` writes the same text for equal notes. Files carry a format
and a version; a newer version than this code knows is refused rather than
misread.

## Development

```sh
pnpm --filter @nether/core test       # Vitest, with coverage of at least 80%
pnpm --filter @nether/core typecheck
```
