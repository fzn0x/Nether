# 0007. Keep a vault's ID in its folder and its index with the app

- Status: Accepted
- Date: 2026-10-30

## Context

On the desktop a vault is a folder the user chooses, often one Obsidian or
another app also uses. [ADR 0003](0003-sync-yjs-hocuspocus.md) gives every
note an ID that never appears in its file, keeps the index in SQLite, and
reconciles the folder with the index by size and modification time when
Nether starts; [ADR 0004](0004-desktop-on-mygo.md) puts the file system and
SQLite on the Go side of the app and the logic in the page. What remained
open: how Nether recognizes a vault it saw before, where the index lives,
what Nether writes into the folder, and where removed notes go.

## Decision

- **The vault's ID lives in the folder**, in `.nether/vault.json`
  (`{"id": "<UUID>", "format": 1}`), written the first time the folder is
  opened. The folder can move or be renamed and stay the same vault, and the
  ID is ready to name it when sync arrives. Nothing else is written into the
  folder, and no note's file changes when it is opened.
- **The index lives with the app**, not in the folder: one SQLite database
  per vault, named by the vault's ID, in the app's data folder. It holds,
  for each file, its path, size, modification time, the hash of the bytes
  last read or written, and for a Markdown file its note ID. The schema is
  versioned with SQLite's `user_version`; a newer schema refuses to open in
  an older Nether rather than being misread.
- **Hidden files and folders stay out**: names that start with a dot, such
  as `.obsidian`, `.git`, `.nether` and `.trash`, are never listed, indexed
  or watched.
- **Removed notes go to the vault's `.trash` folder**, as Obsidian's own
  trash does, under a name no other file there has. They stay readable by
  any app; the trash keeps them for 30 days, which the trash feature
  enforces.
- **A note keeps its ID through a move.** A rename the watch reports moves
  the note's record; a file that disappeared while another with the same
  size, modification time and kind appeared, while Nether watched or while
  it was closed, is taken for the same file moved, preferring the same name.
- **Writes are atomic and checked.** The Go side writes a temporary file
  beside the note, flushes it, and renames it over the note; the page passes
  the hash of what it last read, and a write over a file that changed since
  is refused so that the change can be merged first.
- **Paths stay inside the vault.** Every path the page passes is relative,
  separated by slashes, and checked: no `..`, no absolute path, and no
  folder that is a link leading out of the vault.

## Alternatives

- **The index in the vault folder**, as `.nether/index.db`. It would travel
  with the folder, but a file sync tool or Git would carry a binary
  database that changes on every edit, and two devices would fight over it.
- **The vault identified by its path.** Simple, but moving the folder would
  start a new index and give every note a new ID.
- **The system's trash** for removed notes. Each system's trash works
  differently, the files leave the vault, and Obsidian users expect
  `.trash`.

## Consequences

- Opening a vault Nether saw before reads no file: listing the folder and
  comparing sizes and times brings the index up to date. The reference
  vault of 50,000 notes lists in full within about two seconds of the
  window opening on the maintainer's machine; the performance harness at
  the end of Phase 1 measures this properly.
- A vault copied whole, `.nether` included, shares its ID with the original
  until sync tells them apart; sync's ADR must handle it.
- Deleting the app's data folder loses only the index and the note IDs,
  which the next open rebuilds; no note is lost.
