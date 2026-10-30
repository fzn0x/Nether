# 0016. Find backlinks by the names links write

- Status: Accepted
- Date: 2026-10-31

## Context

The [performance targets](../requirements.md#non-functional-requirements)
ask that a note opens in under 100 ms and a key shows in under 16 ms on a
vault of 50,000 notes, and CI measures both on every push. After
[ADR 0014](0014-load-a-vaults-links-lean-and-after-its-note.md), the graph
kept the notes that link to each note, worked out for the whole vault
whenever the backlinks panel asked after a change; a save moved only the
saved note's own entries. A new note, a move or a changed alias still meant
working out every one of a quarter of a million links again, about 150 ms,
and the first reading of a vault adds notes 100 at a time: the panel worked
everything out again 500 times, on the main thread, while notes were opened.

Around it, every change to the vault made the link index look at all
50,000 notes for the ones that changed, and the vault rebuilt its list of
notes. The first read of each note counted as such a change, as it kept
the file's hash, so opening a note set off both. A CI runner slower than
the maintainer's machine
measured switching notes at 109 ms and typing at 24 ms. With the page's CPU
slowed to half its speed, the maintainer's machine measured 101 ms and
24 ms.

## Decision

- **The graph keeps, for each name a link writes, the notes that write
  it.** The name is the last part of the file the link names, lowercased
  with `.md` on, as the path index lowercases it, then without `.md`; a
  final sigma counts as any other. It depends only on the note's own links,
  so a note's change, move or first reading changes only its own entries.
- **A note's backlinks are worked out when asked for**, from the notes that
  write its name or one of its aliases: their links that find the note,
  resolved as any link is. Nothing is kept of which note each link finds.
- **The path index is kept as notes come, move and go**
  (`LinkIndex.add` and `LinkIndex.remove`), not built again; aliases are
  worked out again only when one changes or its note goes.
- **The vault tells its listeners which notes a change touched**, and the
  link index looks only at those. A change that only learns a file's hash,
  as the first read of a note does, tells no one: what they see of a file
  is its path, note, size and time.
- **The vault's list of notes finds a changed note by its path**, in the
  sorted list, and replaces it there.

## Alternatives

- **Keeping which note each link finds, updated as notes come.** A new
  note can change what other notes' links find, as a second file of the
  same name or a new alias does; finding those links needs the same index
  by name, and keeping both costs memory the desktop app has little of.
- **Asking for backlinks less often while the index reads.** Each time
  would still be a task of 150 ms or more, and a click landing in one waits
  for it.
- **Working them out in slices between frames.** Less blocking, but every
  change would still cost a pass over every link.

## Consequences

- With the page's CPU at half speed, switching notes on the reference vault
  takes 65 ms at the 95th percentile, down from 101 ms, and typing keeps to
  one frame. Without the map of every note's backlinks, the desktop app
  idles at 281 MB, down from 290 MB, the medians of five runs.
- A note's backlinks cost a resolve for each link of each note that writes
  its name: for a note thousands link to, as a daily note may be, that is
  thousands of resolves each time the panel asks.
- The graph view in Phase 2 needs every link resolved: it works them out
  itself, or keeps them then, measured against the memory target.
- How ADR 0014 found backlinks, once per name and moved in place on a save,
  is superseded; the rest of it stands.
