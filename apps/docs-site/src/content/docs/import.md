---
title: Importing
description: How to bring an Obsidian vault, a folder of Markdown, Markdown files or CSV tables into your vault, and what each import makes.
---

Run **Import…** from the command palette (Ctrl+P, or Cmd+P on macOS),
choose what to import, then **Choose and import…** and pick it in your
system's dialog. Nether shows how far it has come, and **Cancel** stops it,
keeping what it has made. When it is done, it says what it made and opens
the first note when you click **Open**.

An import never changes what your vault already has: it goes in a folder
of its own, named after what you chose, or with a number after the name
when the vault has that folder already. Nether only reads what you import.

## An Obsidian vault, or a folder of Markdown

Choose the folder. Every note comes over exactly as it is written, and
every other file, such as images, PDFs and canvases, beside it, in the same
folders, so links between them still work. Obsidian's settings, in its
`.obsidian` folder, and other hidden files stay behind.

To work in an Obsidian vault as it is, without copying it, open its folder
as a vault instead: Nether reads Obsidian's notes as they are.

## Markdown files

Choose one or more `.md` files. Each becomes a note, as it is written, in a
folder named **Imported**.

## CSV tables

Choose one or more `.csv` files. Each becomes a [database](../databases/),
named after its file, with a note for each line of the table, named by its
first cell, in the folder beside it:

- Every other column is a property of the database, and each line's cells
  are its note's values.
- A column whose every value is a number, a date (`2026-11-15`), true or
  false (also yes or no), or a web address gets that type; any other is
  text, so no value changes as it is read.
- A name a file cannot hold, as one with `/` or `:`, is shortened for the
  file, and kept whole as the note's alias. Two lines with the same name
  become `Name` and `Name 2`.
- Cells past the header's columns get columns of their own, named
  `Column 7` and so on, and the import says so.

Notion exports, Logseq graphs and web pages come next.
