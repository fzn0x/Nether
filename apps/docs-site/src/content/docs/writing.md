---
title: Writing notes
description: How to write in Nether's editor, the Markdown you can type to make blocks and formatting, and how your notes are saved.
---

Select a note in your vault and start typing. Nether saves as you write,
half a second after you pause and at least every two seconds while you keep
going, back to the note's Markdown file.

## Markdown as you type

Type Markdown at the start of a line, and it becomes the block it stands
for:

| Type | To get |
| --- | --- |
| `# `, `## ` up to `###### ` | A heading of that level |
| `- ` or `* ` | A bulleted list |
| `1. ` | A numbered list |
| `[ ] ` or `[x] ` | A task, open or done |
| `> ` | A quote |
| ` ``` ` and a space, or a language such as ` ```ts ` | A code block |
| `---` | A divider |

Formatting works the same way around words: `**bold**`, `*italic*`,
`~~struck~~`, `==highlighted==` and `` `code` ``.

In a list, Enter starts the next item, Tab moves an item in, and Shift+Tab
moves it back out.

## What happens to your file

Nether rewrites only the blocks you change. The rest of the file keeps its
exact bytes, so a note you also edit in another app, or keep in Git, shows
only your real changes. See [Your notes as Markdown](../markdown/) for the
syntax Nether reads and writes.

If another app changes a note while you are editing it, Nether does not
overwrite that change: your version is saved beside it, as
`Note (conflict 2026-10-30 153000).md`, and the note shows what is on disk.
