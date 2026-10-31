# 0028. A Notion export becomes pages and databases without their IDs

- Status: Accepted
- Date: 2026-10-31

## Context

The Phase 2 gate asks that a Notion export import with no lost text. Notion
exports a workspace, or a part of one, as Markdown and CSV in a ZIP file,
which a large export splits into ZIP files inside it:

- Every page is a Markdown file, and every folder, named with the page's
  32-character ID: `Plan 0123…cdef.md`. A page's subpages are in a folder
  beside it with its name, as Nether keeps them
  ([ADR 0013](0013-pages-in-the-folder-beside-a-note.md)).
- A page starts with its title as a `#` heading.
- A database is a CSV table beside a folder of its rows, and newer exports
  add a second table, `_all.csv`, with every property where the first has
  only the view's. Each row is a page that starts with its properties, one
  `Key: Value` line each, in Notion's own formats: `October 30, 2026` for a
  date, `Yes` and `No` for a checkbox.
- Links between pages are Markdown links to the files' paths, relative and
  encoded: `[Plan](Plan%200123…cdef.md)`.

The importers read sources and make plans
([ADR 0027](0027-imports-are-plans-made-from-sources-read-only.md)).

## Decision

- **Names lose their IDs.** Every page, folder and table is named as Notion
  titled it, without the ID; two of the same name in one folder become
  `Plan` and `Plan 2`, a page and its folder of subpages, or a database's
  tables and its folder of rows, keeping one name between them. The import
  goes in a folder named `Notion`.
- **A page's title line goes**, as its note's name holds the title. A
  title a file's name cannot hold, as `Plan: Q3/Q4`, is kept as the note's
  alias.
- **A database becomes a database**
  ([ADR 0018](0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)):
  a note from its fullest table, `_all.csv` when there is one, with a
  property for each column, typed as every value in it reads, a number, a
  date, a checkbox or a web address, else text. Each row's property lines,
  those that name a column of its database, become its frontmatter, a date
  written as rows write dates, `2026-10-30`, and `Yes` as `true`; the rest
  of the row's page stays as it is. A line of the table without a page
  becomes a row of its own.
- **Links become wiki links** to where their page, database or file now
  is, by its path in the vault, keeping their text as an alias, their
  heading, and their bar escaped in a table: `[[Notion/Plan|our plan]]`. An
  image becomes an embed. A link to a page the export does not have stays
  as Notion wrote it, and the import says how many there are. Links in code
  are code.
- **Everything else in a page stays as Notion wrote it**, byte for byte;
  its files are copied beside it.
- **A ZIP file inside the ZIP is opened as part of it**, so an export in
  parts imports as one.

## Alternatives

- **Keeping the IDs in the names.** No two names could clash, but every
  note and link would carry 32 characters nobody reads.
- **Keeping Markdown links**, with their paths rewritten. Obsidian and
  Nether read wiki links as links to notes everywhere, for backlinks,
  renames and the graph; a Markdown link to a note is read in fewer places.
- **Typing select and multi-select columns.** Notion's CSV writes a
  multi-select as text between commas, as it writes any text with commas;
  guessing would split text that was never a list. They import as text,
  which the user can change to a select in the database.

## Consequences

- A test imports an export of nested pages, a database with an `_all`
  table and rows, links in text and tables, an image and a missing page,
  and checks that every word of every page reaches the vault: the gate's
  "no lost text".
- Relations and people import as the text Notion writes for them.
- Notion's formats for dates other than its default, as `30/10/2026`,
  import as text.
