# 0021. Query blocks are Obsidian bases in a code block

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#databases-and-structure) ask for
"a block that shows a live query over any notes by folder, tag or property
(Dataview-style), rendered as table or list". A query lives in a note, so
it is written in the note's Markdown file, and the vault is still read by
Obsidian and other tools ([ADR 0006](0006-markdown-file-format.md)).

Obsidian has two ways to write such a query in a note. The Dataview
community plugin reads a `dataview` code block in its own query language.
Obsidian itself, since its Bases, shows a `base` code block: a base's YAML,
with filters and formulas as expressions, and views of the notes they find.
Nether's databases already write an Obsidian base beside each database
([ADR 0018](0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)),
and its formulas follow Obsidian's expressions
([ADR 0020](0020-formulas-in-a-language-nether-reads-and-runs-itself.md)).

## Decision

- **A query block is a `base` code block**, holding a base's YAML as
  Obsidian writes one: `filters`, `formulas`, `properties` for what a
  column is called, and `views`, each with its `type`, `name`, `order`,
  `sort`, `groupBy`, `limit`, `filters` and, for cards, `image`. The note's
  file holds the block as it is written, and Obsidian shows the same notes.
- **Filters and formulas are the formula language's expressions**, read
  and run by Nether's own interpreter, with Obsidian's `file.` values,
  `name`, `basename`, `path`, `folder`, `ext`, `ctime`, `mtime` and `tags`,
  and its functions `file.hasTag()`, `file.inFolder()` and
  `file.hasProperty()`. A filter is an expression, or `and`, `or` or `not`
  with a list of filters; the base's filters and the view's both hold.
  `file.name` is the file's name with its extension, as in Obsidian;
  formulas written before this read it without, which `file.basename` now
  is.
- **It finds among every note of the vault**, as the link index read them,
  their properties and tags, when the note shows and again whenever a note
  changes. Without the vault's property types, text that is a date reads as
  a date.
- **It shows notes, and writes nothing.** A view is a table, a list or
  cards, as a database's; another type, as Obsidian's map, shows as a
  table. Each note's name is first and opens it; values are changed in the
  notes. A hundred notes show at first, and a hundred more each time the
  user asks.
- **What goes wrong is said where the notes would be.** A block that cannot
  be read says why. A filter that fails for a note leaves the note out and
  says why, once; a formula that fails shows why in its cell.

## Alternatives

- **Dataview's language.** The best known in Obsidian, but a community
  plugin's, a second language beside the formulas, and one Obsidian itself
  does not read.
- **A query block of Nether's own**, as a block type in its document. No
  other app would show it, and the Markdown would hold Nether's syntax only
  Nether reads.
- **Filters as JavaScript**, as Dataview's `dataviewjs` blocks are. A query
  from a shared vault would run code: what ADR 0020 decided against.

## Consequences

- Obsidian's functions that the formula language does not have, such as
  `file.hasLink()`, `this` and list methods like `filter()`, are errors that
  say so until they are added; the documentation lists what a query can
  use.
- A query reads every note each time it runs. That is quick for the 50,000
  notes of the reference vault, and an index by folder or tag can come
  when a query needs one.
- The block is the note's text: it exports, imports and syncs as code does,
  and a Markdown tool without bases shows its YAML.
