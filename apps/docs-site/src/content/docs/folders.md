---
title: Folders and pages
description: How the sidebar shows notes in folders or as pages within pages, how to add a page inside another, and how to move notes and folders.
---

The sidebar shows a vault's notes three ways. Choose one above them:

- **Folders**: the vault's folders and the notes in them, as a file
  manager shows them.
- **Pages**: notes inside notes, as in Notion.
- **List**: every note, with the folder it is in.

## Pages inside pages

A note's pages are the notes in the folder beside it with its name. The
pages of `Projects.md` are the notes in the `Projects` folder, and the
pages of `Projects/Plan.md` those in `Projects/Plan`. A folder that no note
names shows as a folder.

To add a page inside a note, point at it in the Pages view and click **+**.
The new note goes in its folder, made then if it is the first. In the
Folders view, the **+** beside a folder makes a note in that folder.

Nothing else records which page is inside which, so the two views always
agree, and other apps, such as Obsidian, see ordinary folders. Notion's
Markdown export has the same shape.

## Opening and closing

Click a folder, or the arrow beside a page, to open or close it; click a
note to open it. With the keyboard:

| Key | Does |
| --- | --- |
| ↓ and ↑ | Move to the next or previous row |
| → | Open a folder or page, or move into it when open |
| ← | Close it, or move to the one it is in |
| Enter | Open the note, or open or close the folder |
| Home and End | Move to the first or last row |
| Shift+F10, or the menu key | Open the note's menu |

The note you have open shows in the tree, its folders opened. What you
open and close is remembered for the vault.

## Moving notes and folders

Drag a note or a folder onto a folder, or onto a page in the Pages view, to
move it there; drag it onto the space below the rows to move it to the top
of the vault.

- A page moves with its pages, and a folder with the page that names it, so
  pages stay inside their pages.
- Images and other files in a moving folder move with it.
- Every link to what moved is rewritten to find it, as when you
  [rename a note](../links/#renaming-a-note).

## A note's menu

Right-click a note in any view, or press Shift+F10 or the menu key on it,
for what you can do with it without opening it first:

- **Open** it.
- **Rename…** it in its folder; links to it follow.
- **Make a copy** beside it, named as the next free `Name 2`, `Name 3`.
- **Move to…** a folder, found by typing its name; its pages go with it and
  links to it follow, as when you drag it.
- **Add tags…**: its tags as chips, and more typed in, the vault's tags
  offered as you type. They are kept in its `tags` property; tags written
  in its text stay where they are.
- **Copy link** as `[[Name]]`, **Copy path** in the vault, or **Copy full
  path** on disk.
- **Open in default app**, the one the system opens Markdown with, or
  **Show in system explorer**.
- **Export…** it, see its **Version history**, or **Move to trash**.

The arrow keys move through the menu, a letter goes to the next item
starting with it, Enter chooses, and Escape closes it.
