# 0013. Keep a page's pages in the folder beside it with its name

- Status: Accepted
- Date: 2026-10-30

## Context

The [requirements](../requirements.md) ask that notes can live in folders,
shown as a file tree, and be nested under other notes, shown as a page
tree, with both views consistent. A vault is a folder of Markdown files
that Obsidian and other tools open too (ADR 0006, ADR 0007), so nesting
must be something the files themselves say, not a record only Nether
keeps.

Two layouts are common:

- **Notion's export** writes a page as `Plan.md` and its pages in a folder
  `Plan/` beside it.
- **Obsidian's folder-note plugins** write the page inside its own folder,
  as `Plan/Plan.md` or `Plan/index.md`.

## Decision

- **A note's pages are the notes in the folder beside it with its name**:
  `Projects.md` holds the notes in `Projects/`, and so on down. A folder
  no note names is a plain folder in the page tree. Letter case aside, the
  names must match.
- **Both trees come from the paths alone.** The file tree shows folders
  and notes; the page tree folds each named folder into its note. Nothing
  else records nesting, so the two views cannot disagree, and other apps
  see ordinary folders.
- **A page and its folder move together.** Renaming or moving a note moves
  the folder with its name, and moving a folder moves the note that names
  it. Every file in the folder moves, images included, and every link to a
  moved note or file is rewritten to find it.
- **A new page inside a note is a note in its folder**, which is made when
  the first page is.

## Alternatives

- **The page inside its folder, `Plan/Plan.md`.** Plugins write it, but
  then a page with no pages must still be a folder, or change shape when
  its first page is added, and every page's path repeats its name.
- **Nesting recorded in properties**, such as a `parent` link. It works
  with no folders, but the file tree and the page tree could then say
  different things, and moving a note in another app would not move its
  pages.
- **Nesting kept only in Nether's index.** Invisible to every other app,
  and lost when the vault is opened elsewhere.

## Consequences

- Notion's Markdown export already has this shape, so the Phase 2 importer
  keeps its nesting by keeping its paths.
- A folder and a note with the same name beside each other always pair up;
  a vault that used such pairs for something else sees them nested.
- Moving a page with many pages rewrites links in many notes; the move
  waits for the link index, so it finds them all.
