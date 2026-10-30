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

## Boards, lists, galleries, calendars and timelines

**Layout** shows a view's rows another way, each with its own filter and
sort:

- A **board** has a column for each value of a select, multi-select,
  checkbox or person property, chosen under **Columns**, and a card for
  each row. Drag a card to another column, or choose its column in its
  **Move to** menu, and its value changes; **New in** a column adds a row
  with that column's value. A row with several values of a multi-select
  shows in each of their columns.
- A **list** shows each row's name, with its visible properties beside it.
- A **gallery** shows each row as a card, with a **Cover**: the image a file
  property names, as `[[photo.png]]` or a web address.

- A **calendar** shows a month, from Monday, with each row on the day of
  its **Date**: a date property, or the day the row was made or last
  edited. **+** on a day adds a row with that date; the arrows and
  **Today** move between months.
- A **timeline** shows six weeks, each row a bar from its **Date** to its
  **End**, another date property, or one day long without one. **Earlier**
  and **Later** move it four weeks.

Rows with no date are listed under a calendar or a timeline. To move a
row to another day, change its date in a table or in the row's
properties. Lists and galleries group by a property too. Relations between
databases, rollups and formulas come next.

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

## In Obsidian

Beside each database Nether keeps an
[Obsidian base](https://obsidian.md/help/bases), `Projects.base`, so Obsidian
shows the same rows and views: a table as a table, a board as a kanban, a
gallery as cards, a list as a list, and a calendar or a timeline as a table
of its dates. Nether writes it from the database whenever the database
changes, and moves it when you rename the database.

Change a view in Obsidian, show or hide a column, group it by another
property, change its filter, add a view or remove one, and Nether takes the
change the next time it shows the database. What only Obsidian has stays
in the base as you set it there: a sort, a cover image, a limit, a formula
or a map view. A filter that uses Obsidian's own functions, such as
`file.hasTag()`, stays in the base, and the view keeps its own filter in
Nether.

The [decision record](https://github.com/fzn0x/Nether/blob/main/docs/adr/0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)
has the details.
