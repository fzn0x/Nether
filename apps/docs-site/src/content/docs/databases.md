---
title: Databases
description: How to make a database of notes, give it properties, add rows, and sort, filter and group them, and how a database is written in your vault.
---

A database is a note whose rows are notes too. Each row has the database's
properties, such as a status or a due date, and a view shows the rows as a
table you can sort, filter and group. Nothing is kept anywhere but in your
notes' files, so the database is still there if you open the folder in
another app.

## Making a database

Run **New database** from the command palette (Ctrl+P, or Cmd+P on macOS).
Nether makes a note named _Untitled database_ in the folder of the note you
have open, and opens it: rename it as you rename any note. Below the note's
text is its table, with one column, each row's name.

- **Properties** lists the database's properties: tick one to show its
  column, or untick it to hide it. Add a property with its name and type:
  text, a number, a checkbox, a date, a link, a select, a multi-select, a
  person or a file.
- **New row** adds a row, a note named _Untitled_. Click a row's name to
  open it, write in it, and rename it.
- Type in a cell to change a row's value; it is saved when you press Enter
  or leave the cell, and Escape puts the value back. A value you type in a
  select becomes one of its options.

## Views

A database can have several views, shown as tabs above its table: **Add a
view** adds one. Each view keeps its own settings:

- **Sort** by clicking a column's name: once to sort from the lowest value,
  again to sort from the highest, a third time to stop. A select sorts in
  the order of its options, as a status goes from to do to done, and rows
  with no value go last either way.
- **Filter** keeps the rows that meet its conditions, all of them or any
  of them: a status that _is_ Done, a number _more than_ five, a date
  _before_ a day, a name that _contains_ a word, a value that _is empty_.
- **Group by** a property shows the rows under each of its values: a
  select's options in their order, then the rows with no value.

Boards, calendars, timelines, galleries and lists come next, with relations
between databases, rollups and formulas.

## How a database is written

A database is a note with a `database` property in its frontmatter, which
holds its properties and its views, and its rows are the notes in the
folder beside it with its name. A database named _Projects_ is:

```text
Projects.md          the database: its text, and its schema
Projects/
  Launch site.md     a row, with its values as properties
  Write docs.md
```

```yaml
---
database:
  properties:
    - key: Status
      type: select
      options:
        - name: Doing
        - name: Done
    - key: Due
      type: date
  views:
    - name: Table
      layout: table
      visible: [Status, Due]
      sorts:
        - property: Due
          direction: ascending
---
```

A row's values are ordinary properties in its frontmatter, `Status: Doing`,
which any Markdown tool reads. Notes in the folders below a row are the
row's own pages, not rows of the database. A view is named by its name, so
two views of one database have different names.

The [decision record](https://github.com/fzn0x/Nether/blob/main/docs/adr/0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)
has the details. Soon Nether also writes an Obsidian base beside each
database, so Obsidian shows its views too.
