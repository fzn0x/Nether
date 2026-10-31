# 0029. A Logseq graph keeps its folders, and is written as Obsidian writes

- Status: Accepted
- Date: 2026-10-31

## Context

The requirements ask for an import from Logseq. A Logseq graph is a folder
of Markdown in an outline, every line a block:

- Pages are in `pages`, journals in `journals` named by date,
  `2026_10_30.md`, and files in `assets`, which pages link to as
  `../assets/photo.png`. Logseq's settings are in `logseq`.
- A page's namespace is written in its file's name, `area___project.md`, or
  in older graphs `area%2Fproject.md`.
- A page's properties are `key:: value` lines at its top; a block's, the
  same under it, among them its ID, `id:: 64f1…`.
- A block is referenced as `((64f1…))`, and embedded as `{{embed …}}`.
- Tasks start with a marker, `TODO`, `LATER`, `NOW`, `DONE`.
- A journal's title, which links name it by, follows the graph's format,
  `Oct 30th, 2026` by default.

The importers read sources and make plans
([ADR 0027](0027-imports-are-plans-made-from-sources-read-only.md)).

## Decision

- **The graph's folders stay as they are**, `pages`, `journals` and
  `assets`, in a folder named after the graph, so a page's links to its
  files still find them. Logseq's settings stay behind.
- **A namespace becomes folders**: `area___project.md` is
  `pages/area/project.md`, and links to `[[area/project]]` find it as
  Obsidian finds a path; a link to a file from a page whose folder changed
  so is written again to find it.
- **A journal is named by its date**, `journals/2026-10-30.md`, with the
  title Logseq gave it as its alias, in the graph's own format, and links
  that name it by that title are written as links to it with the title
  shown.
- **A page's properties become its frontmatter**, `tags` and `alias` as
  lists, the latter as `aliases`.
- **Blocks are written as Obsidian writes them**: a block's ID goes after
  the block as `^64f1…`; a reference to it, `((64f1…))`, is a link,
  `[[pages/Plan#^64f1…]]`, and an embed of it or of a page is an embed. A
  reference to a block the graph does not have stays as written, and the
  import says how many there are.
- **`TODO` and `LATER` become open tasks, `DONE` a done one**; other
  markers, as `NOW`, stay as words. A tag of several words, `#[[big idea]]`,
  becomes a link, as Logseq reads it.
- **Everything else stays as Logseq wrote it**: the outline, other block
  properties, which Obsidian's Dataview reads as fields, and code.

## Alternatives

- **Flattening the outline into paragraphs.** Logseq's notes are outlines,
  and a list is how Markdown writes one; flattening would lose the nesting.
- **Moving pages to the folder's top.** Shorter paths, but every link to a
  file would need writing again, where keeping the folders needs it only
  for namespaces.
- **Converting every block property.** Obsidian has no block properties;
  as `key:: value` lines they are still text, and Dataview reads them.

## Consequences

- A test imports a graph with properties, tasks, a block ID and references
  to it, embeds, namespaces in both forms, a journal and a link to it by
  title, code, and a file, and checks that every word reaches the vault.
- A graph whose journals are named otherwise than `yyyy_MM_dd` keeps their
  names.
- Logseq's whiteboards and drawings come over as files.
