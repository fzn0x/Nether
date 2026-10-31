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

## Making folders

Click the **New folder** icon at the top of the sidebar, or choose
**File**, then **New folder**, and give it a name; write `/` between names
to make folders inside folders at once, as `Projects/Website`. Right-click
a folder, or press Shift+F10 on it, for its menu:

- **New note here** and **New folder here** make one inside it.
- **Delete folder** deletes it while it is empty. A folder with notes or
  files in it stays: move them out, or move them to the trash, first.

A folder shows in the sidebar from the moment it is made, with or without
notes in it, and so do the vault's other folders, such as one that holds
only images. An empty folder is on this device alone: sync and export
carry notes and files, not folders, so a folder reaches another device
with the first note put in it.

The buttons at the top of the sidebar are icons: **New note**, **New
folder**, **New database**, and **Today**, **This week** and **This month**
when they are turned on. Point at one, or move to it with Tab, to see its
name and shortcut.

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
- Images and other files in a moving folder move with it, and so do the
  empty folders in it.
- Every link to what moved is rewritten to find it, as when you
  [rename a note](../links/#renaming-a-note).

## A note's menu

Right-click a note in any view, or press Shift+F10 or the menu key on it,
for what you can do with it without opening it first:

- **Open** it, **Open in new tab**, or **Open to the right**; see
  [Tabs and panes](#tabs-and-panes).
- **Rename…** it in its folder; links to it follow.
- **Make a copy** beside it, named as the next free `Name 2`, `Name 3`.
- **Move to…** a folder, found by typing its name; its pages go with it and
  links to it follow, as when you drag it.
- **Merge into…** another note, found by typing: its text goes after the
  other's, its properties join the other's (lists such as tags are joined),
  every link to it leads to the other, keeping the heading or block it
  named, and it moves to the trash.
- **Add tags…**: its tags as chips, and more typed in, the vault's tags
  offered as you type. They are kept in its `tags` property; tags written
  in its text stay where they are.
- **Bookmark** it, or **Remove bookmark**.
- **Copy link** as `[[Name]]`, **Copy path** in the vault, or **Copy full
  path** on disk.
- **Open in default app**, the one the system opens Markdown with, or
  **Show in system explorer**.
- **Export…** it, see its **Version history**, or **Move to trash**.

The arrow keys move through the menu, a letter goes to the next item
starting with it, Enter chooses, and Escape closes it.

## Bookmarks

Bookmarked notes show above the others, under **Bookmarks**, in the order
you bookmarked them; click the heading to close or open the list. Bookmark
a note from its menu, or the open note with **Bookmark the note** in the
command palette. Click a bookmark to open its note, right-click it for the
note's menu, or click its × to take the bookmark away.

A bookmark follows its note when you rename or move it. A note in the
trash keeps its bookmark, shown in grey, until it comes back.

Bookmarks are kept in `.nether/bookmarks.json`, in the vault's folder, in
the shape Obsidian uses; a vault from Obsidian starts with the bookmarks
it had there. Sync does not carry them to your other devices yet.

## Tabs and panes

Notes open in tabs above the note. Clicking a note in the sidebar shows it
in place of the note you were reading; Ctrl+click (Cmd+click on a Mac) or a
middle click opens it in a new tab. A note already open in a tab is shown
there, not opened twice.

**Open to the right**, in a note's menu or the command palette, shows a
note beside the one you are reading, in a second pane with its own tabs.
Click in a pane, or move into it with Tab, to work there: commands, links
and the sidebar open notes in that pane. Closing a pane's last tab closes
the pane.

| Key | Does |
| --- | --- |
| Ctrl+Tab and Ctrl+Shift+Tab | Show the next or previous tab (Control+Tab on a Mac) |
| Ctrl+W | Close the tab |
| ← and → on a tab | Show the tab before or after |
| Delete on a tab | Close it |

A middle click or a tab's × closes it too, and a right click opens the
note's menu. Your tabs are remembered for the vault on this device, and
come back when you open it again.
