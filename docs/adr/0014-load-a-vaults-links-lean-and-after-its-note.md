# 0014. Load a vault's links lean, and after the note it opens to

- Status: Accepted; how it finds backlinks is superseded by [0016](0016-find-backlinks-by-the-names-links-write.md), and where the targets are measured by [0017](0017-measure-performance-before-each-gate-not-in-ci.md)
- Date: 2026-10-31

## Context

The Phase 1 gate asks that a vault of 50,000 notes stays within the
[performance targets](../requirements.md#non-functional-requirements): among
them, the desktop app opens to the last note in under 1.5 s, and stays under
300 MB once idle. The link index keeps what it read of each note in the
vault's SQLite index ([ADR 0007](0007-vault-folder-and-local-index.md)), so
opening a vault reads no note, but it still loaded every note's row before
the vault showed. On the reference vault the app took 3.5 s to show the
vault and settled between 530 MB and 1.2 GB.

Measuring the page's heap, its allocations and the replies of MyGO's bridge
([ADR 0004](0004-desktop-on-mygo.md)) found where the time and memory went:

- The rows held 63 MB, 39 MB of it the text around each link, which only
  the backlinks panel shows.
- MyGO hands each reply to the page as a script. V8 compiles it and keeps
  every string in it in its old generation, which only a full collection
  frees, and an idle page gets none: the garbage of loading stayed.
- Every part of the rows that loaded changed the graph, and each change
  worked out every backlink again. Working them out once allocated 300 MB,
  most of it in resolving a quarter of a million links one at a time.
- The note view was a `React.lazy` component: it waits on its first render
  even when its code is there, and React then holds back what it waited for
  a further 300 ms.
- Go keeps the memory it frees for a while, and the replies of a large
  vault took tens of megabytes.

## Decision

- **The vault shows as soon as its notes are listed.** The link index loads
  once the note the vault opens to shows, or at once when it opens to none,
  or after 3 s should that note not show. Until then the backlinks panel and
  the tag list are empty.
- **An index row is two parts**: its data, which loads with the vault, and
  its detail, read only for the notes that need it. The link index writes
  the text around each link to the detail (schema version 6), the backlinks
  panel reads it for the first 100 notes that link to the note open, and the
  graph holds each link without it. A row from before is split once as it
  loads, without reading the note again.
- **The rows load a page of 2,000 at a time**, the page drawing between
  them, and the graph takes them all as one change.
- **Backlinks are worked out once per name.** A link that is a name alone,
  which one file has or none, names the same note from every note, as
  Obsidian finds files; the graph resolves each such name once, and keeps
  only the notes that link to each note, working out their links to it when
  asked.
- **A save moves only its own note's backlinks.** An edit that keeps every
  path and alias leaves every other link naming what it named, so the
  graph takes the note out of the backlinks of what it linked to and puts
  it in those of what it links to now. Working every backlink out again
  took 150 ms a save, and the keys typed meanwhile waited for it.
- **Memory is shared where notes are alike**: one empty list for every
  note's empty lists, and a path alone in the path index where it is the
  only one under a key.
- **The note view's code loads with the vault**, by a dynamic import the
  view waits for itself, not through `React.lazy`.
- **The Go side hands back its freed memory** (`Desktop.Settle`, which runs
  `debug.FreeOSMemory`) once the vault has opened and its notes are read.
- **The targets are measured in three harnesses**: in Node.js the searches
  and parsing, in Chromium switching notes and typing, both in CI, and in the
  desktop app on Windows its start, its memory and how soon it picks up a
  note another app writes, from the points it records in the file
  `NETHER_TRACE` names ([tools/perf](../../tools/perf/)). Memory is the
  private working set of the app's whole process tree, as Task Manager
  counts it.

## Alternatives

- **Rows over HTTP instead of the bridge**, from the app's loopback server
  or a scheme of its own, parsed as JSON with no script to compile. It would
  leave the least garbage, but it is a second way to the vault's index, with
  its own access checks, and MyGO's frontend handler is not one an app can
  wrap. Revisit if the targets slip again.
- **A page of rows as one JSON text**, built by SQLite. Measured: it left
  more in the heap, not less, since one character outside ASCII makes the
  whole text take two bytes a character.
- **Forcing a garbage collection**, as allocating a large buffer would. It
  relies on how V8 decides to collect, which changes without notice.
- **Moving headings, block IDs and properties to the detail too.** They are
  a sixth of the data, and the outline, `[[Note#` and searches by property
  read them for any note; not worth the round trips yet.

## Consequences

- On the reference vault the app opens to the last note in about 1.2 s and
  settles at about 290 MB; the [Phase 1 report](../reports/phase-1.md) has
  the numbers.
- For a few seconds after a large vault opens, backlinks, tags and searches
  by tag or property know no links. Renaming and moving notes wait for the
  index, as they did.
- A link that is a name alone resolves as before; links with a folder, and
  names more than one file has, are still worked out from each note.
- Schema version 6 cannot be opened by an older Nether, as ADR 0007 has it.
- Desktop memory is only 10 MB under its target: a feature that keeps
  something for every note must say what it costs on the reference vault,
  and the desktop harness must run before each phase's gate.
