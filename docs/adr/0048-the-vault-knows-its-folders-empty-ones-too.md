# 0048. The vault knows its folders, empty ones too

- Status: Accepted
- Date: 2026-11-01

## Context

The maintainer asked for a way to make a folder. A folder came only with a
note: writing `Projects/Plan` as a new note's name made `Projects`. The
sidebar's trees were made from the notes' paths alone
([ADR 0013](0013-pages-in-the-folder-beside-a-note.md)), so a folder with
no note in it, made in the app or by another one, did not show, and a
folder made empty did not either.

The [requirements](../requirements.md#databases-and-structure) ask that
notes live in folders, in the file system view, and that the file and page
views stay consistent.

## Decision

**The vault lists its folders.** `VaultFiles` gains `folders`, every
folder below one, empty ones too, hidden ones left out as hidden files
are; `makeFolder`, which refuses a hidden name and a name the vault has;
and `removeFolder`, which deletes only an empty folder. The Go service and
`MemoryFiles` both have them.

**`Vault` keeps the folders** as the disk has them, and tells those who
subscribe with `subscribeFolders`, apart from the notes' listeners, which
sync and the link index are: a folder is not a note.

- Opening the vault, and every reconcile, lists the folders alongside the
  files, at once rather than after them, so opening 50,000 notes takes no
  longer.
- A file written or moved into a folder makes it, as the disk does, and it
  stays when the file goes, until deleted.
- A folder another app makes, moves or deletes is followed by the watch.

**The trees show the folders** with the notes: a folder no note is in
shows, in both views, as one with notes does.

**Moving a folder moves it whole**: its files move, then the folders in it
no file is in are made where it went, and the folders it emptied are
deleted. Without this, a moved folder now left its empty shell behind.

**A folder's menu**, on a right click or Shift+F10: New note here, New
folder here, and Delete folder, which can be chosen only while the folder
is empty. **New folder** is in the File menu and at the top of the
sidebar, whose buttons become icons, each named, with a tooltip showing
its name and shortcut on hover and on keyboard focus.

## Alternatives

- **A placeholder note in each empty folder**, such as `.keep`: no change
  to the vault's model, but a file the user did not make, which Obsidian
  and Git would show.
- **Folders kept in Nether's own data**, not read from the disk: they
  would disagree with the disk whenever another app made or deleted one.
- **Deleting a folder with what is in it**, moving it all to the trash:
  more useful, but the trash holds files, not folders, and restores each
  where it was; left for when the trash keeps folders.

## Consequences

- Sync and export carry files, not folders: an empty folder is on its
  device alone, until a note is put in it.
- Folders that hold only images or other files now show in the sidebar,
  as they do in Obsidian.
- Listing the folders walks the vault a second time when it opens, beside
  the first.
- Amended 2026-11-01, at the maintainer's request: **Delete folder** also
  takes a folder with notes or files in it, after asking. It moves each to
  the trash, as the trash holds files, and deletes the emptied folders;
  restoring puts each file back, its folders made again with it.
