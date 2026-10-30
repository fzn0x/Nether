# 0006. Write notes as Obsidian-flavored Markdown, and mark Nether's own blocks with HTML

- Status: Accepted
- Date: 2026-10-30

## Context

A note on the desktop is a `.md` file in the user's vault, and the first
[principle](../requirements.md#principles) is that every note exports as
standard Markdown with YAML frontmatter, with no loss of text. The
requirements ask that Markdown output stay readable by Obsidian and other
Markdown tools, and that a round trip from Markdown through Nether and back
lose no text, links or frontmatter.

[ADR 0002](0002-editor-tiptap.md) put the conversion in
`packages/markdown`, on remark's syntax tree. [ADR 0003](0003-sync-yjs-hocuspocus.md)
asks that a write change only the blocks that changed. What remained open
is the format itself: which syntax Nether reads, and how it writes the
blocks Markdown has no syntax for (columns, toggles, bookmarks, underline,
plugin blocks). The agent rules ask for an ADR for anything that defines
the vault's file format.

## Decision

### What Nether reads

CommonMark and GFM (tables, task lists, strikethrough with `~~`, autolinks,
footnotes), YAML frontmatter, and Obsidian's syntax, each by Obsidian's
rules:

| Syntax | Read as |
| --- | --- |
| `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]`, `[[Note#^id]]`, `[[#Heading]]` | A wiki link; `[[Note^id]]` is read too |
| `![[Note]]`, `![[image.png\|300]]` on a line of its own | An embed, keeping the text after the pipe |
| `#tag`, `#area/project` after white space | A tag: letters, digits, marks, `_`, `-`, `/`, not only digits |
| `==text==` | A highlight |
| `%%text%%`, and `%%` on a line of its own to the next `%%` | A comment, inline or over several lines |
| `$x$`, `$$` blocks | Math; `$` opens only before a non-space and closes after one, not before a digit, so `$5 and $10` is text |
| `> [!kind]+ Title` | A callout, with its fold and title |
| ` ^id` at the end of a block, or `^id` on its own line after a table, list or quote | The block's ID |

What Nether cannot map, such as HTML blocks, footnote definitions and
link definitions, becomes a raw block or raw inline that is written back
byte for byte.

### What Nether writes

Blocks that did not change keep their exact bytes, and so does the space
between blocks that stayed side by side. A block that changed is written
with the markers the file already uses (its bullet, emphasis, strong, fence
and rule characters), and an edited list item takes the bullet or number
style of its list. Frontmatter changes only at the keys whose values
changed, keeping comments, order and layout. A block's ID is written as
`^id` only when something links to, embeds or comments on it, and an ID the
file had stays.

Blocks Markdown has no syntax for are written so that any Markdown tool
shows their content:

| Block | Written as |
| --- | --- |
| Columns | `<!-- columns -->`, then `<!-- column 40% -->` before each column, then `<!-- /columns -->` |
| Toggle | `<details>` with a `<summary>`, the content after a blank line, then `</details>` |
| Bookmark | An autolink alone in its paragraph: `<https://example.com>` |
| Underline | `<u>text</u>` |
| Line break in a table cell | `<br>`, as Obsidian writes it |
| A plugin's block | A code block named by the block's type, `plugin-id/type`, holding its data as JSON |
| Image width | Obsidian's `![alt\|300](src)` |

Text that would read as syntax is escaped (`\#`, `\==`, `\%%`, `\$`, `\^`),
and a note that opens with a rule and has another `---` line later writes
that rule as `***`, so that it never reads as frontmatter.

## Alternatives

- **Notion's export style**, columns and toggles written one after the
  other as plain content. Nothing would mark where a column or a toggle
  starts, so they would be lost the next time the file is read.
- **Directives** (`:::columns`) or **Obsidian plugins' syntax** for columns.
  Directives are not CommonMark and show as stray colons in other apps;
  plugin syntax ties the file to one plugin.
- **IDs for every block in the file.** Linking would never need a rewrite,
  but every line of every note would end in `^id`.
- **Rewriting the whole file on each save**, as remark does. Simpler, but
  remark normalizes style, so editing one line would restyle files that
  people also edit elsewhere.

## Consequences

- Files stay readable everywhere: the HTML markers are comments or common
  HTML that GitHub, VS Code and Obsidian render, and the content between
  them is plain Markdown.
- `packages/markdown` holds a round-trip suite: fourteen files run through
  parse and write, and property tests write and read back thousands of
  random notes made of every block and inline type. A change to the format
  updates them and this record.
- Some shapes cannot be told apart in Markdown and are not kept: an empty
  paragraph, two maths side by side (`$a$$b$`), spaces at the ends of a
  callout's title or a table cell, a tag glued to the word before it, or
  formatting that starts right after a tag with punctuation. The editor's
  input rules avoid making them.
- Changing any of these markers is a change to the vault format: it needs
  a migration and a new record.
