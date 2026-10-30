# 0018. A database is a note, with an Obsidian base beside it

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#databases-and-structure) ask for
databases: "a collection of notes sharing a schema", shown as a full page
or inline in another note, with six kinds of view, relations, rollups and
formulas. The [architecture](../architecture.md) says a database is a note
with a schema and its rows are notes with properties, so everything stays a
note, as in Obsidian; `packages/core` holds that model, with typed
properties and views, since Phase 0. What it does not say is how a database
is written in the vault's files, which every database a person makes will
then keep.

Obsidian has databases of its own since 1.9:
[Bases](https://obsidian.md/help/bases/syntax), YAML files ending `.base`
whose filters find any notes in the vault, with table, cards, list, map and
(since 1.14) kanban views. A base is not a note, its property types are the
vault's, and it has no calendar, timeline, select colors, relations or
rollups. The maintainer chose to keep Nether's databases as notes, and to
keep an Obsidian base beside each, so a vault moved between the two apps
shows its databases in both.

## Decision

**The database is a note.** `Projects.md` is a database when its
frontmatter has a `database` key holding its schema:

```yaml
---
database:
  properties:
    - key: status
      type: select
      options:
        - name: Doing
          color: blue
        - name: Done
          color: green
    - key: due
      type: date
    - key: client
      type: relation
      relation:
        database: "[[Clients]]"
  views:
    - name: Board
      layout: board
      groupBy: status
      visible: [due]
    - name: All
      layout: table
      visible: [status, due, client]
      sorts:
        - property: due
          direction: ascending
---
```

- Properties are a list, in the order they show, each with its key in the
  rows' frontmatter and its type, as `packages/core` defines them.
- A view has no ID in the file: its **name, unique in the database, names
  it**, as it does in Obsidian (`![[Projects.base#Board]]`). In memory a
  view gets an ID made from its name.
- A note or database is named by a **link**, as Obsidian writes links in
  properties: a relation's database is `"[[Clients]]"`, found as any link
  is, and a note ID only in memory.
- The note's text is the database's page, written like any other.

**Its rows are its pages**: the notes in the folder beside it with its name,
`Projects/`, but not the notes in folders below that, which are pages of the
rows ([ADR 0013](0013-pages-in-the-folder-beside-a-note.md)). A row's values
are its frontmatter, as on any note; a key the schema has takes its type,
and other keys stay as they are. `$title` is the row's name, `$created` and
`$updated` its file's times.

**An Obsidian base beside it.** Nether writes `Projects.base` next to
`Projects.md`, made from the schema, and writes it again when the schema
changes:

```yaml
filters:
  and:
    - file.folder == "Projects"
    - file.ext == "md"
views:
  - type: kanban
    name: Board
    groupBy:
      property: status
      direction: ASC
    order:
      - file.name
      - due
  - type: table
    name: All
    order:
      - file.name
      - status
      - due
      - client
```

- A table, board, gallery and list become a `table`, `kanban`, `cards` and
  `list` view; a calendar and a timeline, which Obsidian has not, a `table`
  of their dates. Filters are written as Obsidian's expressions where they
  can be, and `order` is the view's visible properties after the name.
- Nether writes only the keys Obsidian documents: the base's `filters`,
  and each view's `type`, `name`, `order`, `groupBy` and `filters`.
  **Every other key is kept as it was**, and so is every view Nether did
  not make, such as a map: a sort, a cover image or a formula set in
  Obsidian survives Nether writing the base again.
- **An edit in Obsidian comes back.** When the base changes and Nether did
  not write it, Nether reads it against the schema, matching views by
  name: a view's order, grouping and filters come back to the view; a
  table, kanban, cards or list view added in Obsidian becomes a view of the
  database, and a view removed there is removed. What Nether cannot read,
  such as a filter with Obsidian functions it has not, stays in the base,
  and the view keeps its own.
- A database shown inline in a note is written `![[Projects.base#Board]]`,
  as Obsidian embeds a base's view, so it shows in both.

## Alternatives

- **A database as a base alone**, a `.base` file with Nether's extras in
  keys of its own. Obsidian would show it, but a database would not be a
  note, as the architecture has it, and its rows would be whatever its
  filters found, not its own notes.
- **A database note alone.** One file, nothing to keep in step, but
  Obsidian would show its rows as notes and none of its views.
- **The schema in a file of its own**, as `.nether/databases.json`. It
  would keep the note's frontmatter short, but a database copied or
  exported without that file would lose its schema.
- **View IDs in the file.** Stable across renames, but a UUID on every
  view, and Obsidian, which names views, has none to give its new views.

## Consequences

- Two files describe one database. The note wins: the base is written
  from it, and only what maps cleanly comes back.
- Obsidian reads `database` as a property it has no type for, and shows it
  as such; it changes it only when someone edits that property there.
- View names must be unique in a database, and renaming a view in Obsidian
  comes back as one view removed and one added, which loses what the base
  cannot hold, such as a calendar's date property.
- Relations, rollups and formulas, later in Phase 2, extend the schema in
  the same frontmatter; formulas follow Nether's own language, and those
  Obsidian can also read are written to the base's `formulas`.
- `packages/database` reads and writes the schema, finds a database's rows
  and runs its views; the base comes in its own pull request.
