---
title: Vaults
description: How Nether opens a folder of notes as a vault, what it adds to the folder, how deleted notes are kept and restored, and where it keeps its index.
---

A vault is a folder of notes on your computer. Any folder works: an empty
one, a folder of Markdown files, or an Obsidian vault, which Nether opens as
it is.

## Opening a vault

Open Nether and choose **Open a folder**. Nether reads the folder, lists its
notes, and remembers it under **Recent vaults** for next time. You can also
start Nether with a folder:

```sh
nether ~/Notes
```

Nether follows the folder while the vault is open: a note you add, change,
move or delete with another app shows up in Nether within moments.

## What Nether adds to the folder

Very little, and only out of sight:

- `.nether/vault.json` holds the vault's ID, so Nether knows the folder
  again after you move or rename it. Beside it, small JSON files keep the
  vault's settings, such as its property types and templates, and a record
  of its trash.
- `.trash` holds the notes you delete in Nether, as Obsidian's trash does.

Nether never adds anything to your notes themselves. Opening a note does
not change its file.

Files and folders whose names start with a dot, such as `.obsidian` or
`.git`, are left out of the vault.

## Deleting and restoring notes

**Move to trash**, at the top of a note, moves it to the vault's `.trash`
folder. The sidebar then says so, with **Restore** to put it straight back.

The **Trash** tab lists every note in the trash, the latest first, with the
folder it was in, when it was deleted and how many days it has left. From
there:

- **Restore** puts a note back where it was, as the same note: links to it
  and its history work as before. If another note has taken its place, it
  comes back beside it, as `Plan 2`.
- **Delete for good** deletes a note's file, after one more click to be
  sure. **Empty trash** does the same for every note in the trash.

Notes stay in the trash for 30 days, or as many as you set at the bottom of
the Trash tab, and are deleted for good when the vault next opens after
that. Notes another app put in `.trash`, such as Obsidian, show there too,
and their days count from when Nether first finds them.

## Where the index lives

To open a large vault quickly, Nether keeps an index of it: the notes, their
sizes and dates, and the IDs that keep links working when a note moves. The
index is a database in Nether's own data folder, not in the vault, so a
sync tool or Git never carries it. Deleting it is safe: Nether builds it
again the next time it opens the vault.
