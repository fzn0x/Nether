# 0027. Imports are plans, made from sources only read

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#sharing-and-publishing) ask for
imports from an Obsidian vault, a Notion export (Markdown and CSV in a
ZIP), Logseq, plain Markdown, HTML and CSV, and the Phase 2 gate asks that
an Obsidian vault and a Notion export import with no lost text. What is
imported lies outside the vault: a folder, a ZIP file or files the user
chooses. Each source writes its notes differently, but every import ends
the same way, as notes and files in the vault.

## Decision

- **An importer only reads, and plans.** It is given a source, the files
  of what was chosen by their paths in it and a way to read their text,
  and gives a plan: the notes to make, each with its path and Markdown,
  the files to copy, and what it could not bring over as it was. The
  importers live in `@nether/markdown`, which the architecture gives
  import and export, and are tested without a vault or a disk.
- **The app carries the plan out**, in a folder named after what was
  chosen that the vault does not have yet, or, for a table, under a name
  it does not have: nothing already in the vault is changed or written
  over. Each note is made through the vault, as any note is; each other
  file is copied in by the desktop app, without the page holding its
  bytes. The user can cancel, keeping what was made.
- **The desktop app opens what is imported read only**: a folder, its
  hidden files and folders left out as a vault's are, such as `.obsidian`;
  a ZIP file, without folders, hidden files or paths that would leave it;
  or chosen files. Text must be UTF-8.
- **A folder of Markdown, as an Obsidian vault, comes over byte for byte**:
  every note's text as it is, every other file beside it, every path as it
  was under the new folder, so links by name or relative path still find
  what they named. Obsidian's settings stay behind.
- **A CSV table becomes a database**
  ([ADR 0018](0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)):
  a note with the columns as properties, and a note for each line, named by
  its first cell. A column's type is the one every value in it reads as,
  a number, a date, a checkbox or a web address, else text, so no value
  changes as it is read; a name a file cannot hold is kept as the row's
  alias, and cells past the header's columns get columns of their own.
- **Notion, Logseq and HTML** follow as importers of their own, on the
  same sources and plans.

## Alternatives

- **Opening an Obsidian vault as a vault, and nothing more.** Nether does
  that already; importing is for bringing notes into a vault that has its
  own.
- **Converting notes through Nether's model**, parsing and writing each
  one again. It would change how the user wrote things Nether writes
  otherwise; the Markdown is already what Nether keeps.
- **A package of its own for importers.** The architecture puts import in
  `@nether/markdown`, and the importers need nothing more than it has.

## Consequences

- A link by name in the imported notes can find a note of that name the
  vault already had; Obsidian resolves names the same way.
- A large import makes its notes one at a time through the vault, which
  the link index then reads as it reads any new note.
- Every importer is tested as a plan from files, apart from the app.
