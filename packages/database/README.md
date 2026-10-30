# @nether/database

Databases: a note whose frontmatter's `database` key holds a schema of
typed properties and views, as
[ADR 0018](../../docs/adr/0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)
has it, and whose rows are the notes in the folder beside it.

- `readDatabase`, `databaseOf` and `writeDatabase` read a schema from a
  note's frontmatter, checked as `@nether/core` checks it, and write it
  back; a view's name names it, and `viewIdOf` gives it an ID.
- `rowsOf` and `rowValue` find a database's rows and their values, with
  `$title`, `$created` and `$updated` from their files.
- `runView` keeps the rows a view's filter matches, in its sorts' order,
  grouped by its property, as `matches`, `sortRows` and `groupRows` do one
  at a time.

Roadmap: Phase 2, databases and structure.
