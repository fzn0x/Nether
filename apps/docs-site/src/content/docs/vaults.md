---
title: Vaults
description: How Nether opens a folder of notes as a vault, what it adds to the folder, and where it keeps its index.
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
  again after you move or rename it.
- `.trash` holds the notes you delete in Nether, as Obsidian's trash does.
  They stay there for 30 days, and you can restore one by moving it back.

Nether never adds anything to your notes themselves. Opening a note does
not change its file.

Files and folders whose names start with a dot, such as `.obsidian` or
`.git`, are left out of the vault.

## Where the index lives

To open a large vault quickly, Nether keeps an index of it: the notes, their
sizes and dates, and the IDs that keep links working when a note moves. The
index is a database in Nether's own data folder, not in the vault, so a
sync tool or Git never carries it. Deleting it is safe: Nether builds it
again the next time it opens the vault.
