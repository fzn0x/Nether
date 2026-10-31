---
title: Exporting notes
description: How to export a note, a folder or the whole vault as Markdown files, web pages or a PDF, and what each export holds.
---

Your notes are always plain Markdown files you can copy. Export gives you
them in other forms: a ZIP to send or archive, web pages to publish or read
anywhere, or a PDF to print.

## Exporting

Click **Export** at the top of a note, then choose:

- **What to export**: the note, the folder it is in with every note below
  it, or the whole vault.
- **As**: Markdown files, web pages, or a PDF. For a PDF, also the paper,
  A4 or Letter.

Click **Export** and choose where to save. The dialog shows how many notes
are done, and **Cancel** stops the export and leaves nothing behind. Once
it is saved, **Show in folder** opens the folder it is in.

## What each export holds

**Markdown files, in a ZIP.** The notes' files exactly as they are in the
vault, in their folders, with the images and other files they show. An
export of the whole vault takes every file the vault holds. When the notes
have [comments](../servers/#comments), `.nether/comments.json` holds them:
each note's threads, with the text each is on, and what each comment says,
who wrote it and when.

**Web pages, in a ZIP.** A page for each note, in the same folders, with
the files it shows beside it, and an `index.html` that lists every page.

- A link to a note in the export leads to its page, and to the heading it
  names; a link to a note outside the export shows as text.
- Embedded notes show in place.
- Math, highlighted code and Mermaid diagrams look as they do in Nether.
- The pages follow the reader's light or dark setting.
- `%%comments%%` are left out, as Obsidian's reading view leaves them out.

**A PDF.** Every note, in the order of their paths, each starting on a new
page, with its properties, math, code and diagrams. Links between notes in
the PDF lead to the note's first page.

A database's view exports as a CSV table from its toolbar; see
[Databases](../databases/#exporting-a-view-as-csv).
