---
title: Finding notes
description: How to open a note by its name with the quick switcher, and search the vault's notes by their words, tags, folders and properties.
---

## The quick switcher

Press Ctrl+O (Cmd+O on a Mac) and type part of a note's name, one of its
aliases, or its path, as `projects/road`. The best matches come first, and
with nothing typed, the notes you edited last. Press Enter to open the
highlighted note, the arrow keys to move between them, or Escape to close.

## Search

Press Ctrl+Shift+F (Cmd+Shift+F on a Mac), or choose **Search** in the
sidebar, and type. Nether finds the notes whose title or text has every
word you type, whatever their case or accents, the last word matching as
you type it, notes whose title matches first. Each note found shows the
text around a match.

| Type | To find notes |
| --- | --- |
| `plan steps` | with both words |
| `"next steps"` | with the phrase, its words in that order |
| `plan -draft` | with plan but not draft; `-"a phrase"` works too |
| `tag:project` or `#project` | with the tag, or a tag under it such as `#project/nether` |
| `path:Projects` | in a folder, or whose path has that text |
| `prop:status=done` or `[status:done]` | whose property has that value |
| `prop:due` or `[due]` | that have the property |

Filters go together with words, and each can be excluded with `-`:
`plan tag:project -path:Archive` finds notes about plans, tagged project,
outside the archive. Search works offline, from the index Nether keeps of
your vault on your computer.
