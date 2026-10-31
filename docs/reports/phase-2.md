# Phase 2 report: Databases and structure

- Date: 2026-10-31
- Gate: an Obsidian vault and a Notion export import with no lost text.
  Passed on 3368f9c: a vault of the reference generator's 50,000 notes
  imports with every note byte for byte as it was, and a Notion export of
  nested pages, a database and its rows imports with every word of every
  page in the vault.

Phase 2 is done: Nether has the Notion core beside the Obsidian one, with
databases kept as notes and Obsidian bases, and every task on the
[roadmap](../roadmap.md#phase-2-databases-and-structure) is ticked. Phase
3, self-hosted sync and collaboration, the first public release, starts
now.

## What shipped

| Feature | Pull request | Notes |
| --- | --- | --- |
| Opening at a note | [#30](https://github.com/fzn0x/Nether/pull/30) | `nether <vault> <note>`, which the desktop measurements start from |
| Performance outside CI | [#31](https://github.com/fzn0x/Nether/pull/31) | The harnesses run on a maintainer's machine before each gate ([ADR 0017](../adr/0017-measure-performance-before-each-gate-not-in-ci.md)) |
| Databases | [#32](https://github.com/fzn0x/Nether/pull/32), [#33](https://github.com/fzn0x/Nether/pull/33), [#34](https://github.com/fzn0x/Nether/pull/34) | A note with a schema, its rows the notes beside it, an Obsidian base kept in step both ways ([ADR 0018](../adr/0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)) |
| Six views | [#33](https://github.com/fzn0x/Nether/pull/33), [#35](https://github.com/fzn0x/Nether/pull/35), [#36](https://github.com/fzn0x/Nether/pull/36) | Table, board, gallery, list, calendar and timeline, each with its filters, sorts, groups and properties |
| Relations and rollups | [#37](https://github.com/fzn0x/Nether/pull/37), [#38](https://github.com/fzn0x/Nether/pull/38) | Links kept both ways in both rows' files; rollups worked out, never written ([ADR 0019](../adr/0019-relations-are-links-both-ways-and-rollups-are-worked-out.md)) |
| Formulas | [#39](https://github.com/fzn0x/Nether/pull/39) | A documented language with its own parser and interpreter ([ADR 0020](../adr/0020-formulas-in-a-language-nether-reads-and-runs-itself.md)) |
| Query blocks | [#40](https://github.com/fzn0x/Nether/pull/40) | Obsidian's `base` code blocks, run live over every note ([ADR 0021](../adr/0021-query-blocks-are-obsidian-bases-in-a-code-block.md)) |
| CSV export | [#41](https://github.com/fzn0x/Nether/pull/41) | A view as it shows ([ADR 0022](../adr/0022-a-database-exports-to-csv-as-its-view-shows-it.md)) |
| Synced blocks | [#42](https://github.com/fzn0x/Nether/pull/42) | Block embeds edited in place, written to their notes ([ADR 0023](../adr/0023-synced-blocks-are-block-embeds-edited-in-place.md)) |
| Unlinked mentions | [#43](https://github.com/fzn0x/Nether/pull/43) | Found through the index, linked where written ([ADR 0024](../adr/0024-unlinked-mentions-found-by-the-index-and-linked-where-written.md)) |
| The graph view | [#44](https://github.com/fzn0x/Nether/pull/44) | Sigma with WebGL, ForceAtlas2 in a worker, smooth at 10,000 notes ([ADR 0025](../adr/0025-graph-view-with-sigma-and-forceatlas2-in-a-worker.md)) |
| Themes and CSS snippets | [#46](https://github.com/fzn0x/Nether/pull/46) | Light, dark or as the system, per vault; themes set the design tokens ([ADR 0026](../adr/0026-themes-and-snippets-are-css-files-of-the-vault.md)) |
| Importers | [#47](https://github.com/fzn0x/Nether/pull/47), [#48](https://github.com/fzn0x/Nether/pull/48), [#49](https://github.com/fzn0x/Nether/pull/49), [#50](https://github.com/fzn0x/Nether/pull/50) | Obsidian vaults and Markdown byte for byte, Notion, Logseq, web pages and CSV ([ADRs 0027 to 0030](../adr/0027-imports-are-plans-made-from-sources-read-only.md)) |
| A fix | [#45](https://github.com/fzn0x/Nether/pull/45) | Two quick adds to a list cell both kept |

## The gate

- **An Obsidian vault.** `apps/desktop/test/importGate.test.ts` imports a
  vault of the reference generator's notes, written as Obsidian writes
  them, through the app's own import, and compares every note in the
  vault afterwards with its file: with `NETHER_GATE_NOTES=50000`, all
  50,000 come over byte for byte, in 3.4 s.
- **A Notion export.** `packages/markdown/test/notion.test.ts` imports an
  export laid out as Notion writes one: nested pages, a database with its
  `_all` table and its rows' pages, links in text, in a table and to a
  heading, an image, a link to a page the export lacks, code, and a line of
  the table with no page. Every word of every page reaches the vault; the
  row properties, the database's types and the links are checked as they
  should be written.

## Measured

On the maintainer's Windows 11 machine, on 3368f9c, as
[ADR 0017](../adr/0017-measure-performance-before-each-gate-not-in-ci.md)
has the harnesses run before each gate: the reference vault of 50,000
notes, and for the graph a reference vault of 10,000 notes and their
46,635 links.

| Target | Phase 2 | Phase 1 | Limit |
| --- | --- | --- | --- |
| Title search, p95 | 22.9 ms | 27.5 ms | 50 ms |
| Full-text search, p95 | 77.8 ms | 74.1 ms | 300 ms |
| Reading and parsing a note, p95 | 4 ms | 4.2 ms | 100 ms |
| Switching notes, click to frame, p95 | 35.6 ms | 34.8 ms | 100 ms |
| Typing, key to frame, p95 | 16 ms | 16 ms | 16 ms |
| Opening to the last note, median of 5 | 1.23 s | 1.23 s | 1.5 s |
| Idle memory after 60 s, median of 5 | 292 MB | 281 MB | 300 MB |
| A note another app writes, in the index, median of 5 | 116 ms | 110 ms | 2 s |
| The graph of 10,000 notes, shown | 502 ms | | 3 s |
| The graph, frames while laid out, p95 | 16.8 ms | | 33.4 ms |
| The graph, frames while zooming, p95 | 16.7 ms | | 33.4 ms |

The graph was drawn with the GPU, an RTX 3060, as WebView2 draws it. The
gate's import of the 50,000 notes took 3.4 s.

## Deferred

- **Formulas and rollups in the Obsidian base.** They show in Nether only,
  until Obsidian's functions are checked against Nether's
  ([ADR 0020](../adr/0020-formulas-in-a-language-nether-reads-and-runs-itself.md)).
- **Query blocks' other Obsidian functions**, as `file.hasLink()`, `this`
  and list methods like `filter()`; they say so where a query uses them.
- **Editing a heading's section or a whole note where it is embedded.**
  Synced blocks edit in place; those embeds open their note.
- **Select and multi-select from Notion**, which its CSV writes as text,
  and its relations and people, which import as the text Notion writes.
- **Sigma 4**, three weeks old when the graph shipped; the graph moves to
  it once it settles.
- **A directory of community themes in the app**, with the plugin
  directory in Phase 4; until then a theme is a CSS file put in the vault.
- **From Phase 1, still deferred**: a content security policy for the
  desktop page, a screen reader pass by hand, translations, and signed
  updates.

## Known issues

- Idle memory grew 11 MB over the phase, to 292 MB of 300, and one of the
  five runs idled at 299.2 MB. Sync adds its own memory in Phase 3, so the
  phase starts by finding where those 11 MB went.
- The import of a real Notion workspace's export has not been tried: the
  gate's export is laid out as Notion documents and writes its exports,
  and Notion's formats for dates other than its default import as text.
- The graph's frame times were measured on one machine's GPU; an
  integrated GPU draws more slowly, and a large graph hides its links while
  it moves to keep up.
- What the app loads at start grew by 32 kB, 9 kB compressed, over the
  phase; the HTML importer's parser and the graph load only when used.
- When the same synced block is edited in two places at once, the last
  write wins for that block.
- Merged branches stay on GitHub; deleting them is left to the maintainer.

## Plan for Phase 3: self-hosted sync and collaboration

The first public release. One feature per pull request, in this order:

1. Headroom in the desktop app's memory: find what Phase 2 added to it at
   idle, before sync adds its own.
2. The server's data model in PostgreSQL, with migrations that run on
   start, and the first-run setup that makes the admin account.
3. Accounts: email and password with argon2id, magic links and OIDC, with
   rate limits.
4. Sync: the Hocuspocus server, Yjs updates kept in PostgreSQL, and the
   desktop app's provider with its offline queue, so a vault syncs between
   devices with no conflict dialogs for text.
5. End-to-end encryption, per vault, with libsodium and a recovery phrase.
6. Attachments on disk or in S3-compatible storage, deduplicated by hash.
7. Version history with a diff, and its retention.
8. Workspaces, teamspaces and private spaces; roles and page permissions
   inherited down the page tree; guests.
9. Real-time co-editing with live cursors.
10. Comments and threads; mentions and notifications, by email through
   the admin's SMTP.
11. The web app, served by the server, installable as a PWA, with its
    content security policy.
12. Workspace search on the server, by permission.
13. The canvas, in the JSON Canvas format.
14. Task assignment: the person property, and "assigned to me".
15. Backups to disk or S3, with the restore tested in CI; migrations safe
    across versions.
16. `docker compose up` with PostgreSQL, Redis and storage.

The gate: `docker compose up` works, and two users co-edit offline and
online with no lost edits.
