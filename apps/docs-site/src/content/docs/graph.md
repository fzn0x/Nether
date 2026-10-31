---
title: The graph
description: How the graph view shows your notes and the links between them, around one note or kept to a tag, folder or property, and how to use it from the keyboard.
---

The graph shows your notes as dots and the links between them as lines,
so you can see which notes gather together and which stand alone. Open it
with **Open the graph** in the command palette, or Ctrl+G (Cmd+G on
macOS). It takes the place of the note; **Back to** the note's name returns
to it.

A note's dot is bigger the more links it has, and the note you came from is
in the accent color. Point at a dot to see its links alone, and click it to
open the note. Scroll to zoom, and drag to move around.

## Every note, or the notes around one

**Every note** shows the whole vault. **The notes around** the note you came
from shows it and the notes up to one, two or three links away, whichever
way the links go: choose how many under **Links away**.

A link counts once from one note to another, whatever heading or block it
names. Links to files, to notes the vault does not have, and within a note
draw nothing.

## Filtering

Type in **Filter** as you search, to keep the notes it names:

| Write | To keep |
| --- | --- |
| `tag:project` | Notes with the tag, or a tag below it |
| `path:Projects` | Notes whose path has the text |
| `prop:status` or `prop:status=active` | Notes with the property, or with that value |
| `roadmap` | Notes with the word in their name or path |
| `-tag:archive` | Notes without the tag |

Only the links between notes the filter keeps are drawn. Around a note,
the note itself stays, whatever the filter.

## From the keyboard

**Find a note** finds a note in the graph by its name, an alias or its
path, and centres the view on it; **Open** and its name opens it. **Zoom
in**, **Zoom out** and **Show all** move the view, and **Arrange again**
lays the notes out again from where they are.

## Large vaults

The graph draws with the GPU, so ten thousand notes still move smoothly. A
graph with many links shows them once its notes are in place, and hides
them while you zoom or move, then draws them again. Where the system has no
WebGL, the graph says it cannot be drawn.
