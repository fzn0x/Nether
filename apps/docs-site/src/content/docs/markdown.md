---
title: Your notes as Markdown
description: How Nether stores notes as plain Markdown files, what syntax it reads, and how it writes what Markdown has no syntax for.
---

Every note in Nether is a Markdown file in a folder you choose, with its
properties as YAML frontmatter at the top. You can open, edit, copy and
back up those files with any other app.

## Nether keeps your files as you wrote them

When you edit a note, Nether rewrites only the blocks you changed. Every
other paragraph, list and table keeps its exact bytes, down to the blank
lines between them, and properties change only at the keys you edited, with
their comments and order kept. A block Nether writes anew uses the markers
your file already uses, such as `*` or `-` for bullets.

## Obsidian's syntax works as in Obsidian

Nether reads what Obsidian writes, by Obsidian's rules:

| You write | You get |
| --- | --- |
| `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]`, `[[Note#^id]]` | A link to a note, a heading or a block |
| `![[Note]]`, `![[image.png\|300]]` | The note, block or image shown in place |
| `#tag`, `#area/project` | A tag |
| `==text==` | Highlighted text |
| `%%text%%` | A comment, hidden in the note |
| `$x^2$` and `$$` blocks | Math |
| `> [!tip] Title` | A callout; `[!tip]-` starts it folded |
| ` ^id` at the end of a block | An ID that links can point to |

## What Markdown has no syntax for

Some blocks exist only in Nether. They are written so that any Markdown app
still shows their content:

- **Columns** are marked with HTML comments, which other apps hide, so the
  columns show one after the other:

  ```md
  <!-- columns -->
  <!-- column 60% -->
  The wide column.
  <!-- column 40% -->
  The narrow one.
  <!-- /columns -->
  ```

- **Toggles** use `<details>` and `<summary>`, which GitHub and Obsidian
  draw as toggles too.
- **Bookmarks**, links shown with a preview, are a link alone on its line:
  `<https://example.com>`.
- **Underline** is `<u>text</u>`, and a line break in a table cell is `<br>`.

Anything Nether does not know, such as an HTML block or a footnote, stays in
the file exactly as written.
