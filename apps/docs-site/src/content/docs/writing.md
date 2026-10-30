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

## Blocks from the slash menu

Type `/` at the start of a line, or after a space, to open the list of
blocks: text, headings, lists, tasks, quotes, callouts, toggles, code, math,
diagrams, dividers, tables and columns. Keep typing to narrow it, as in
`/head` or `/todo`, then press Enter, or click a block. Escape closes the
menu and keeps the slash as text.

## Moving and changing blocks

Point at a block and a handle appears to its left. Drag the handle to move
the block, or click it for the block's menu, which turns a block of text
into a heading, a list, a quote or code, moves the block up or down,
duplicates it or deletes it. The menu works from the keyboard too: the
arrow keys move through it, Enter picks, Escape closes it.

Each of these has a shortcut for the block the caret is in. On a Mac, use
Cmd for Ctrl.

| Press | To |
| --- | --- |
| Ctrl+Shift+Up, Ctrl+Shift+Down | Move the block up or down |
| Ctrl+D | Duplicate the block |
| Ctrl+Alt+0 | Turn it into text |
| Ctrl+Alt+1 to Ctrl+Alt+6 | Turn it into a heading of that level |
| Ctrl+Shift+8, Ctrl+Shift+7, Ctrl+Shift+9 | Turn it into a bulleted, numbered or task list |
| Ctrl+Shift+B | Turn it into a quote |
| Ctrl+Alt+C | Turn it into code |

## Math, code and diagrams

Math is written in LaTeX, between `$` signs in a line, such as `$e^{i\pi}$`,
or between `$$` lines on its own. Click math, or select it and press Enter,
to edit its LaTeX; Escape, or Ctrl+Enter in display math, shows it again.

A code block highlights the code of the language in its corner, which you
can change there. A code block in the `mermaid` language draws its
[Mermaid](https://mermaid.js.org) diagram below the code, and says what is
wrong when it cannot. Nether draws diagrams with Mermaid's dagre layout:
it does not include the ELK layout, whose license is not compatible with
Nether's, so a diagram that asks for ELK shows an error instead.

## Images, PDFs, audio and video

Paste an image into a note, or drop files on it, and Nether adds them to
the vault's `attachments` folder and embeds them where they land, as
`![[Pasted image 20261030153000.png]]`. It never writes over a file: a
second `photo.png` becomes `photo 1.png`. The slash menu's Image and File
blocks take a path or a link, or a file you choose.

Nether finds the file a link names as Obsidian does, whatever the case of
its letters: at that path from the note's folder, then from the vault's
folder, then any file whose path ends with the link, the nearest to the
note first. So `![[photo.png]]` finds `attachments/photo.png` from any
note, and links written in either app find the same files.

| Write | To show |
| --- | --- |
| `![[photo.png]]` or `![](attachments/photo.png)` | An image |
| `![[photo.png\|300]]` or `![alt\|300](photo.png)` | An image 300 pixels wide |
| `![[paper.pdf]]` | A PDF, in the app's viewer |
| `![[talk.m4a]]`, `![[clip.mp4]]` | Audio or video, with a player |
| `![](https://example.com/photo.png)` | An image from the web |

A PDF's card can open it in your system's PDF app, and any other file's
card shows it in your file manager. On Linux, whose web view has no PDF
viewer, PDFs show as cards.

## Markdown source

Press Ctrl+/ (Cmd+/ on a Mac), or the **Markdown source** button above a
note, to see and edit the note as its Markdown, exactly as the file holds
it, frontmatter and all; press it again to go back to blocks. Nothing is
lost either way: what you change in one shows in the other, and the file
keeps its line endings. Notes stay in the mode you chose as you move
between them.

In source mode, Ctrl+F finds and replaces, Tab indents, and Escape then
Tab leaves the editor. Turn on **Vim keys** to edit with Vim's modes and
commands; Nether remembers the choice.

## What happens to your file

Nether rewrites only the blocks you change. The rest of the file keeps its
exact bytes, so a note you also edit in another app, or keep in Git, shows
only your real changes. See [Your notes as Markdown](../markdown/) for the
syntax Nether reads and writes.

Every change you make is kept in the vault's index on your computer as
you type, before it is written to the file, so a crash or a power cut
loses nothing.

If another app changes a note, whether Nether is open or not, Nether
merges that change into the note: what the other app changed and what
you typed meanwhile both stay, even in the same paragraph. A paragraph
both of you rewrote keeps both versions, one after the other, for you to
choose between. Sync your vault with one tool only, Nether's own sync or
another, so that no change arrives twice.
