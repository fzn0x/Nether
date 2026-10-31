---
title: Query blocks
description: How a query block in a note shows the notes it finds across the vault, by folder, tag or property, and every setting it can have.
---

A query block shows, in a note, the notes of your vault that it finds: the
projects in a folder, the notes with a tag, the tasks whose status is
active. It is a code block in the language `base`, written as Obsidian
writes a base, so Obsidian shows the same notes. Below its code, Nether
shows them as a table, a list or cards, and finds them again whenever a
note changes.

````markdown
```base
filters:
  and:
    - file.inFolder("Projects")
    - status != "done"
views:
  - type: table
    name: Open projects
    order: [file.name, status, due]
    sort:
      - property: due
        direction: ASC
```
````

To make one, type `/query` and press Enter: the block it makes shows the
ten notes changed last, and you change its code from there. Typing
` ```base ` and a space at the start of a line makes an empty one. A query
block only shows notes: click a note's name to open it, and change its
values in the note.

## Filters

`filters` decides which notes the block finds. A filter is an expression of
the [formula language](../formulas/) that holds for the notes it keeps, or
`and`, `or` or `not` with a list of filters: `and` keeps the notes all of
them hold for, `or` those any of them holds for, and `not` those none of
them holds for. Without `filters`, a block finds every note.

| Write | To find the notes |
| --- | --- |
| `file.inFolder("Projects")` | In the folder Projects, or a folder in it |
| `file.hasTag("project")` | With the tag `#project`, or a tag below it, as `#project/web` |
| `file.hasProperty("due")` | With a property `due`, even an empty one |
| `status == "active"` | Whose property `status` is `active` |
| `due < today()` | Whose `due` date has passed |
| `file.mtime > now() - "1 week"` | Changed in the last week |

A note's property is read by its name, as `status`, or as `note.status`,
and `note["Due date"]` for a name with spaces. Text written as a date,
`2026-11-15`, reads as a date. A note's `file.` values are its `name` with
its extension, `basename` without it, `path`, `folder`, `ext`, `tags` and
`mtime`.

## Formulas

`formulas` names expressions worked out for each note, which views can
show, sort by and filter on as `formula.` and their name:

```yaml
formulas:
  total: price * count
views:
  - type: table
    order: [file.name, price, formula.total]
```

A formula that cannot be worked out for a note shows **Error:** and why in
that note's cell.

## Views

`views` is a list of views, and a block with more than one shows a tab for
each. A block without views shows a table of the notes' names. A view can
have:

| Setting | What it does |
| --- | --- |
| `type` | `table`, `list` or `cards`; another type, as Obsidian's `map`, shows as a table |
| `name` | The view's name on its tab |
| `order` | The properties it shows after each note's name, in order: `status`, `note.status`, `formula.total`, `file.mtime` |
| `filters` | A filter of its own, which holds as well as the block's |
| `sort` | A list of `property` and `direction`, `ASC` or `DESC`; notes without a value go last |
| `groupBy` | A `property` and `direction`, to show the notes in a group for each value |
| `limit` | How many notes it shows at most |
| `image` | For cards: the property that names a card's image, a file of the vault or a web address |

`properties` names the columns, by the property they show:

```yaml
properties:
  note.status:
    displayName: State
```

A view shows a hundred notes at first, and the button below them shows a
hundred more.

## When a block cannot be shown

A block Nether cannot read, as one whose YAML is broken or whose filter is
not an expression, says why in place of its notes. A filter that cannot be
worked out for a note, as a method the value does not have, leaves that
note out, and the block says why for the first such note.

## What Obsidian has that Nether does not yet

Nether reads the functions and methods on the [Formulas](../formulas/)
page, which are most of what queries use. Obsidian's others, such as
`file.hasLink()`, `this`, `link()` and list methods like `filter()`, are
errors that say so, until Nether has them.
