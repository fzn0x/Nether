# 0019. Relations are links, kept both ways, and rollups are worked out

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#databases-and-structure) ask to "link
rows between databases (two-way); roll up counts, sums, averages,
earliest/latest dates". [ADR 0018](0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)
keeps a database as a note and its rows as notes, each value in the row's
frontmatter, and `packages/core` already has a relation property: the
database it points to and, for two ways, the key of the property there
that points back. What a relation's value is in a row's file, how its two
ends stay in step, and where a rollup's value lives were not decided.

## Decision

**A relation's value is a list of links**, as Obsidian writes links in
properties: `client: ["[[Acme]]"]`. A link names a row as any link names a
note, by its name or its path, so Obsidian and other tools follow it, and a
renamed row keeps its relations as renaming rewrites links in frontmatter.
Nether writes the shortest link that finds the row from the row that holds
it.

**Two ways, both files.** When a relation has a `backlink`, a row given a
link gets the link back in the other row's property of that name, and a
link taken away is taken away there too, in that row's file: each end is a
plain property any tool reads, and neither depends on Nether to be seen.
Links are matched by the note they find, not their spelling. A two-way
relation made in the app adds its other end to the other database's schema.

**A rollup is worked out, never written.** A rollup property in a schema
names a relation of the same database, a property of the related rows, and
a function: `count`, `countValues`, `sum`, `average`, `min`, `max`,
`earliest` or `latest`. Its value is worked out for each row when a view
shows it, from what the link index read of the related rows, and is never
written to a row's file, where it would go stale whenever a related row
changed:

```yaml
- key: hours
  type: rollup
  rollup:
    relation: tasks
    property: estimate
    function: sum
```

Views filter, sort and group by a rollup as by any property. The Obsidian
base leaves rollup columns out, as Obsidian has no such property to show.

## Alternatives

- **Relations by note ID**, as `packages/core` holds them in memory. The
  IDs live in Nether's index, not in the files, so another tool, or Nether
  on another vault, could not follow them.
- **One end only**, the other found by searching the related database's
  links, as backlinks are. Notion keeps both, and a row read in Obsidian
  would not show what links to it.
- **Rollups written to the rows**, as Obsidian could then show them. Every
  change to a related row would have to rewrite every row that rolls it
  up, and a change made in another app would leave them wrong.

## Consequences

- A two-way change writes two files; if the second write fails, the two
  ends disagree until the next change to either, and a view shows each as
  its file has it.
- Rollups show only in Nether. A formula Obsidian can also read may come
  with formulas, later in Phase 2.
- A rollup of a rollup is not worked out; its value is empty.
