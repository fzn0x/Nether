# Changelog

All notable changes to Nether are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The foundations of Phase 0: the license, the product requirements, the
  roadmap, the architecture and the first five decision records.
- `@nether/core`, the data model of notes, blocks, properties, databases,
  views, links and workspaces, with stable IDs and a versioned JSON form.
- `@nether/server`, a Fastify server with a health check, configured by
  environment variables, with every enterprise feature off by default.
- `@nether/desktop`, a MyGO app for Windows, macOS and Linux whose window
  shows the Nether page.
- The documentation site at https://fzn0x.github.io/Nether/.
- `pnpm vault:generate`, which writes the reference vault of 50,000 notes
  that performance targets are measured on.
- `@nether/markdown`, which reads Markdown with Obsidian's syntax into
  Nether's blocks and writes notes back with every unchanged block byte for
  byte ([ADR 0006](docs/adr/0006-markdown-file-format.md)), and a page on the
  documentation site about how notes are stored as Markdown.
- The desktop app opens a folder as a vault, from a dialog, the list of
  recent vaults or its command line, lists its notes, shows a note's
  Markdown, and follows the changes other apps make to the folder
  ([ADR 0007](docs/adr/0007-vault-folder-and-local-index.md)).
- `@nether/storage`, the vault's index in SQLite, which brings itself up to
  date by size and modification time and keeps a note's ID when it moves.
- The note editor: notes open in a block editor that turns Markdown typed at
  the start of a line into blocks, and save back to their Markdown files as
  you type, rewriting only the blocks you changed.
- Rich blocks in the editor: a slash menu inserts any block; a handle beside
  each block drags it, or opens a menu that turns it into another type,
  moves, duplicates or deletes it, with a shortcut for each; math renders
  with KaTeX, code is highlighted, and Mermaid diagrams are drawn below their
  code, without the ELK layout, whose license is not compatible
  ([ADR 0009](docs/adr/0009-math-code-and-diagrams.md)).
- Images, PDFs, audio and video in notes, from the vault or the web, found
  by their links as Obsidian finds them; pasted and dropped files go in the
  vault's `attachments` folder, never over another file
  ([ADR 0010](docs/adr/0010-vault-files-in-notes.md)).
- Each note is a Yjs document, kept in the vault's index as you type
  before it is written to the file, as ADR 0003 decided. Another app's
  change to a note's file, made while Nether is open or closed, is merged
  into the note with what was typed meanwhile, character by character;
  nothing either side wrote is lost.
- Links between notes: `[[` suggests the vault's notes, by name, path or
  alias, and their headings after `#`; a link typed in full becomes a link;
  a link opens its note, and makes it when the vault has none by that name.
  Links find notes as Obsidian finds them. The vault's links are read in
  the background and kept, so a vault opens without reading every note
  again. A link to a heading or block opens the note there; `![[Note]]`
  embeds a note, its heading's section or a block, read only.
- The quick switcher, Ctrl+O, opens a note by its name, alias or path, and
  search, Ctrl+Shift+F, finds notes by their words and phrases, case and
  accents aside, filtered by tag, folder and property, with exclusions,
  each with the text around a match, offline.
- Beside each note, its outline and the notes that link to it, with the
  text around each link; a list of the vault's tags, nested ones under
  theirs, each showing its notes.
- Source mode: Ctrl+/ shows a note as its Markdown in a text editor, with
  find and replace and optional Vim keys, and goes back to blocks with
  nothing lost; a file's line endings stay as they are.
- Properties above each note, each with a type the vault remembers for its
  name, as Obsidian does, and an editor for that type: lists as chips,
  checkboxes, dates and numbers. They are written to the note's
  frontmatter, changing only the keys edited, and another app's changes
  merge with them key by key.
- Templates: Ctrl+N makes a note, blank or from any note, filling
  Obsidian's `{{title}}`, `{{date}}` and `{{time}}` variables, with formats
  and offsets, and putting the cursor at `{{cursor}}`. Today's note, and
  this week's and this month's when turned on, open with one click, made
  from their templates the first time. A vault moved from Obsidian starts
  from Obsidian's settings for them
  ([ADR 0011](docs/adr/0011-templates-and-periodic-notes.md)).
- The trash: Move to trash sends a note to the vault's `.trash` folder,
  with Restore offered at once. The Trash tab lists what was deleted,
  restores a note where it was as the same note, and deletes notes for
  good, one at a time or all at once. Notes are deleted for good after 30
  days, or as many as the vault sets.
- Export: a note, its folder or the whole vault, as its Markdown files with
  the files they show, as web pages that link to each other with an index,
  or as a PDF on A4 or Letter, each note on a new page, with math, code,
  diagrams and embedded notes drawn as in the app
  ([ADR 0012](docs/adr/0012-export-from-the-page.md)).
- Renaming a note from its name above it: every link to it, wiki or
  Markdown, in notes and in frontmatter, is rewritten to find it, keeping
  its heading, block and alias.
- The sidebar shows notes as folders, as pages within pages, or as a list.
  A note's pages are the notes in the folder beside it with its name, as
  Notion exports them ([ADR 0013](docs/adr/0013-pages-in-the-folder-beside-a-note.md)).
  The trees open and close by click or key; dragging a note or folder
  moves it, a page with its pages, with every link rewritten; **+** makes a
  note in a folder or a page.
- The command palette, Ctrl+P, runs any action by its name, and every
  command can have a keyboard shortcut, changed in the Keyboard shortcuts
  list and kept in the vault; new defaults give today's note Ctrl+Shift+D,
  renaming F2, export Ctrl+Shift+E and the template settings Ctrl+,.
- Links to blocks from `[[Note#^`: the note's blocks are found by their
  text, and a block chosen without an ID gets one, written after it in
  its note's file as Obsidian writes them.
- Previews of web links: a link alone on its line shows as a card, and
  Show preview fetches the page's title, description and site, only then,
  keeping them in the vault; Open opens the page in the browser.
- Linux packages: an AppImage and a Flatpak, besides MyGO's Debian package
  and self-updating archive. Builds signed with an update key check for
  updates in the background, which the command palette turns off.
- The performance harness on the reference vault of 50,000 notes:
  `pnpm perf:bench` times search and parsing in Node.js, and
  `pnpm --filter @nether/desktop perf:ui` switching notes and typing in
  Chromium, and `tools/perf/desktop.ps1` times the desktop app's start,
  its memory and how soon it picks up a note another app writes, on
  Windows; they run before each phase's gate, not in CI
  ([ADR 0017](docs/adr/0017-measure-performance-before-each-gate-not-in-ci.md)).
- Each paragraph of a note reads in the direction of its own text, so a
  paragraph in Arabic or Hebrew starts at the right, and the interface
  lays itself out right to left in a language written so
  ([ADR 0015](docs/adr/0015-check-accessibility-and-lay-out-by-direction.md)).
- `nether ~/Notes Projects/Plan.md` opens the vault at the note named after
  it, by its path in the vault or on disk, before the note last open.
- `@nether/database`: a note is a database when its frontmatter's
  `database` key holds a schema of typed properties and views, named by
  their names; its rows are the notes in the folder beside it, and a view
  filters, sorts and groups them
  ([ADR 0018](docs/adr/0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md)).
- Databases in the app: **New database** makes a note whose rows are the
  notes beside it, shown below its text as a table. Properties are added
  and shown or hidden, rows added and opened, and values edited in their
  cells, each written to its row's frontmatter. Each view sorts by a
  column, filters by conditions, all or any, and groups by a property.
- Boards, lists and galleries: a view's layout shows its rows as a board
  with a column for each value of a select, multi-select, checkbox or
  person, its cards moved by dragging or by their Move to menu; as a list;
  or as a gallery of cards with a cover a file property names.
- Relations between databases: a property links a row to rows of another
  database, or both ways, the other row linking back; each end is a list
  of links in its row's frontmatter, kept in step as links are added and
  taken away
  ([ADR 0019](docs/adr/0019-relations-are-links-both-ways-and-rollups-are-worked-out.md)).
  Links in a database's views show as the names of the notes they name,
  and filters compare them so.
- Formulas: a property that works out each row's value from its others,
  in a small language Nether reads and runs itself, so a formula can do
  nothing but work out a value: arithmetic, text, dates and durations,
  logic, `if()` and a set of functions and methods, documented on the new
  Formulas page. A formula that cannot be read says why as it is written;
  one that fails for a row shows why in its cell
  ([ADR 0020](docs/adr/0020-formulas-in-a-language-nether-reads-and-runs-itself.md)).
- Rollups: a property that works out, from the rows a relation links to,
  their count, the count of their values, the sum, average, lowest or
  highest of a number, or the earliest or latest of a date, each time a
  view shows it, never written to a row's file.
- Calendars and timelines: a calendar shows a month with each row on the
  day of its date, and makes a row on a day; a timeline shows six weeks
  with each row a bar from its date to its end.
- An Obsidian base beside each database, `Projects.base`, so Obsidian shows
  its rows and views: written from the database when it changes, and
  moved with it. A view's columns, grouping and filter changed in
  Obsidian, and views added or removed there, come back to the database;
  what only Obsidian has, as a sort, a limit or a map, stays in the base.

### Changed

- On a vault of 50,000 notes the desktop app opens to the last note in
  about 1.2 s, down from 3.5 s, and settles at about 280 MB, down from
  0.5 to 1.2 GB. The vault shows as soon as its notes are listed, and its
  links load after the note it opens to, without the text around each
  link, which the backlinks panel reads for the notes it shows
  ([ADR 0014](docs/adr/0014-load-a-vaults-links-lean-and-after-its-note.md)).
  The vault's index moves to schema version 6.
- A note's backlinks are found among the notes that write its name or an
  alias, and a change to the vault looks only at the notes it touched, so
  typing, opening a note, and reading a large vault for the first time no
  longer work out every link in it again: on the reference vault, with the
  CPU at half speed, switching notes takes 65 ms where it took 101 ms, and
  each key shows in the next frame
  ([ADR 0016](docs/adr/0016-find-backlinks-by-the-names-links-write.md)).

### Fixed

- A dialog opened just after a note no longer loses its focus to the
  note's editor; dialogs keep focus while they are open.
- Every dialog opens with focus in it, so Escape closes the template
  settings too.
- Screen readers read rendered math as the math, not as a hint.
- Highlighted text in the dark theme, and tags and links in a note in
  the light theme, meet WCAG AA's contrast.
- While the link index read notes for the first time, the backlinks
  panel could miss the text around their links.
- A property emptied in Nether is written `key:`, as Obsidian writes it,
  not `key: null`, and a comment after a property's value stays when the
  value changes.
- An embed within a line of text, as `Today: ![[Roadmap]]`, counts as a
  link: the note it names lists it among its backlinks, and renaming that
  note rewrites it.

[Unreleased]: https://github.com/fzn0x/Nether/commits/main
