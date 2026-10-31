# 0022. A database exports to CSV as its view shows it

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#sharing-and-publishing) ask that
databases export to CSV, and the first principle says databases export to
CSV and Markdown, so their data is never locked in. A database's rows are
already Markdown files with frontmatter
([ADR 0018](0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)),
which every export of notes holds; CSV is for spreadsheets and the other
tools that read a table. Notion exports a database as CSV, and Obsidian a
base's view.

A CSV file has a few choices of its own that spreadsheets disagree on: the
encoding, the line endings, what a list or a link is in a cell, and which
rows and columns go in.

## Decision

- **A view exports as it shows**: the rows its filter keeps, in its sort's
  order, with a first column of the rows' names and then the properties
  the view shows, in its order. **Export CSV** in the view's toolbar saves
  it where the user chooses, named after the database and the view.
- **Values as a person reads them.** Text, numbers and dates as the row
  writes them; a checkbox as `true` or `false`; a list's items between
  commas; a link, as a relation's, as the name of the note it names. A
  rollup's and a formula's value as they work out, and an empty cell for a
  formula that fails.
- **The file is RFC 4180's**: a header line, commas between cells, a cell
  in double quotes with its quotes doubled when it holds a comma, a quote
  or a line break, and each line ended by CRLF. It is UTF-8 after a byte
  order mark, which Excel needs to read anything but ASCII, and which
  other tools skip.
- **The desktop app saves it as it saves a PDF**: the user chooses where,
  and the file is written beside it and takes its place when whole.

## Alternatives

- **Every row and every property, whatever the view.** Notion's first
  exports did this. A view is how the user chose to see the database, and
  a view that shows everything is one click away.
- **Links as written, `[[Clients/Acme]]`.** They would come back as
  relations into Nether, but a spreadsheet would show the brackets. The
  Markdown files keep the links; the CSV is for reading.
- **Cells starting with `=`, `+`, `-` or `@` prefixed with `'`**, against
  spreadsheets running them as formulas. It changes the values, and every
  tool that reads the file back would have to undo it. A cell that only
  looks like a formula, as `-3` or `+1 555`, would be changed too.
- **No byte order mark.** Excel would then read UTF-8 as the system's code
  page, and names in any script but Latin would come out garbled.

## Consequences

- Exporting a whole database is a view that shows every property and no
  filter.
- Importing a CSV, a later feature, skips the byte order mark and reads
  lists by their commas.
- A spreadsheet may run a cell written as a formula when it opens the
  file; the export writes the value as the row holds it.
