# @nether/search

Search as people type it: `parseQuery` reads words, "quoted phrases",
-exclusions, and filters by tag (`tag:name`, `#name`), path
(`path:folder`) and property (`prop:key=value`, Obsidian's `[key:value]`),
each maybe excluded. `ftsMatch` writes the words and phrases as an FTS5
expression, quoted so nothing typed reads as FTS5 syntax, the last word a
prefix while it is typed.

The clients keep each note's title and text in SQLite's FTS5, in the
vault's index (`@nether/storage`), and apply the filters from the link
index (`@nether/graph`). The server will search with PostgreSQL in Phase 3.
