# Phase 1 report: Local-first notes

- Date: 2026-10-31
- Gate: a 50,000-note vault edits offline within the
  [performance targets](../requirements.md#non-functional-requirements).
  Passed on cf01e6a
  ([run](https://github.com/fzn0x/Nether/actions/runs/41133963752)), where
  CI measures five of the targets; the desktop app's start, memory and
  pickup were measured on the maintainer's machine, below.

Phase 1 is done: the desktop app keeps a vault of Markdown notes, the
Obsidian core, within every target on the reference vault of 50,000 notes,
and every task on the [roadmap](../roadmap.md#phase-1-local-first-notes) is
ticked. Phase 2, databases and structure, starts now.

## What shipped

| Feature | Pull request | Notes |
| --- | --- | --- |
| Markdown to and from notes | [#3](https://github.com/fzn0x/Nether/pull/3) | Obsidian's syntax, unchanged blocks kept byte for byte ([ADR 0006](../adr/0006-markdown-file-format.md)) |
| The vault on disk | [#4](https://github.com/fzn0x/Nether/pull/4) | Folders opened as vaults, the SQLite index, other apps' changes followed ([ADR 0007](../adr/0007-vault-folder-and-local-index.md)) |
| The block editor | [#5](https://github.com/fzn0x/Nether/pull/5), [#6](https://github.com/fzn0x/Nether/pull/6) | TipTap, live Markdown shortcuts, the slash menu, the block handle, math, code and diagrams ([ADR 0009](../adr/0009-math-code-and-diagrams.md)) |
| Media in notes | [#7](https://github.com/fzn0x/Nether/pull/7) | Images, PDFs, audio and video, from the vault or the web ([ADR 0010](../adr/0010-vault-files-in-notes.md)) |
| Source mode | [#8](https://github.com/fzn0x/Nether/pull/8) | CodeMirror, with Vim keys that can be turned on |
| Yjs documents | [#9](https://github.com/fzn0x/Nether/pull/9) | One per note, merged with its file both ways |
| Links | [#10](https://github.com/fzn0x/Nether/pull/10), [#11](https://github.com/fzn0x/Nether/pull/11), [#21](https://github.com/fzn0x/Nether/pull/21), [#27](https://github.com/fzn0x/Nether/pull/27) | `[[` links and aliases, heading and block links, backlinks, tags, the outline, embeds of notes and blocks |
| Search | [#12](https://github.com/fzn0x/Nether/pull/12) | The quick switcher, and full-text search with FTS5 and operators |
| Properties | [#13](https://github.com/fzn0x/Nether/pull/13) | All ten types, kept in the frontmatter |
| Templates and periodic notes | [#14](https://github.com/fzn0x/Nether/pull/14) | Obsidian's variables and settings ([ADR 0011](../adr/0011-templates-and-periodic-notes.md)) |
| The trash | [#15](https://github.com/fzn0x/Nether/pull/15) | Restore, and deletion after 30 days or as set |
| Export | [#16](https://github.com/fzn0x/Nether/pull/16) | Markdown (ZIP), HTML and PDF ([ADR 0012](../adr/0012-export-from-the-page.md)) |
| Renaming | [#18](https://github.com/fzn0x/Nether/pull/18) | Every link to a note rewritten |
| Folders and pages | [#19](https://github.com/fzn0x/Nether/pull/19) | The file tree and the page tree, moved by drag ([ADR 0013](../adr/0013-pages-in-the-folder-beside-a-note.md)) |
| Keyboard | [#20](https://github.com/fzn0x/Nether/pull/20) | The command palette, and a shortcut for every action |
| Web link previews | [#22](https://github.com/fzn0x/Nether/pull/22) | Fetched only when asked |
| Desktop packages | [#23](https://github.com/fzn0x/Nether/pull/23) | AppImage, deb and Flatpak, and updates that can be turned off |
| Performance | [#25](https://github.com/fzn0x/Nether/pull/25), [#28](https://github.com/fzn0x/Nether/pull/28) | The harness, and the app within the targets on 50,000 notes ([ADR 0014](../adr/0014-load-a-vaults-links-lean-and-after-its-note.md), [ADR 0016](../adr/0016-find-backlinks-by-the-names-links-write.md)) |
| Accessibility and right to left | [#26](https://github.com/fzn0x/Nether/pull/26) | axe on every screen in CI, and layout by direction ([ADR 0015](../adr/0015-check-accessibility-and-lay-out-by-direction.md)) |

## Measured

On the reference vault of 50,000 notes, on cf01e6a: on the maintainer's
Windows 11 machine, and in the gate's CI run, which measures the first five
on every push.

| Target | Maintainer's machine | CI | Limit |
| --- | --- | --- | --- |
| Title search, p95 | 27.5 ms | 16.2 ms | 50 ms |
| Full-text search, p95 | 74.1 ms | 54.3 ms | 300 ms |
| Reading and parsing a note, p95 | 4.2 ms | 3 ms | 100 ms |
| Switching notes, click to frame, p95 | 34.8 ms | 37.1 ms | 100 ms |
| Typing, key to frame, p95 | 16 ms | 16 ms | 16 ms |
| Opening to the last note, median of 5 | 1.23 s | | 1.5 s |
| Idle memory after 60 s, median of 5 | 281 MB | | 300 MB |
| A note another app writes, in the index, median of 5 | 110 ms | | 2 s |

With the page's CPU slowed to half its speed, as on a slower laptop or CI
runner, switching notes takes 65 ms at the 95th percentile and typing
keeps to one frame; at a third of its speed, switching takes 117 ms.

Before the performance work the app took 3.5 s to show the vault and
settled between 530 MB and 1.2 GB; filling the full-text index grew with
the square of the notes.

## Deferred

- **The desktop app's start, memory and pickup in CI.** The script needs a
  vault the app has opened, closed with a note open, which a fresh runner
  has not; Phase 2 adds opening a note from the command line, and a
  Windows job that runs the script.
- **A cold start.** The start was measured warm, the vault in the system's
  cache; one just after the machine boots reads it from disk.
- **Vim keys in the block editor.** They work in source mode.
- **Databases to CSV**, with databases in Phase 2; the slash menu's plugin
  commands with the plugin API in Phase 4.
- **A screen reader pass by hand.** axe checks names, roles, contrast and
  focus on every screen; how the app sounds needs a person, before the
  first release.
- **Translations.** Every string is in one place to translate and the
  layout mirrors right to left, but English is the only language until
  Weblate or Crowdin is set up, with the first public release.
- **A content security policy for the desktop page**, still to be checked
  against MyGO's bridge in all three webviews; the web app gets one in
  Phase 3.
- **Signed updates.** The desktop app checks for updates once a
  maintainer makes a key with `go tool mygo keygen`, adds the private key
  to CI as `MYGO_UPDATER_PRIVATE_KEY`, and puts the public key in
  `mygo.json`.

## Known issues

- Typing's p95 is one frame, 16 ms, which is its limit, and idle memory
  is 19 MB under its target. A slow CI runner measured switching at 109 ms
  and typing at 24 ms before [#28](https://github.com/fzn0x/Nether/pull/28) stopped each change from working out
  every link again; on a machine three times slower than the maintainer's,
  switching still misses its target. A change that adds work per key, per
  save, per note opened or memory per note must say what it costs on the
  reference vault.
- For a few seconds after a large vault opens, backlinks, tags and
  searches by tag or property know no links.
- MyGO hands each reply to the page as a script, which keeps what it
  carried in the page's heap until V8 collects it; ADR 0014 lists what to
  revisit if memory slips again.
- Branches merged on GitHub stay there; deleting them is left to the
  maintainer.

## Plan for Phase 2: databases and structure

One feature per pull request, in this order:

1. The desktop app's start, memory and pickup measured in CI, on a
   Windows runner, as deferred above.
2. `packages/database`: a database as a note with a schema, its rows as
   notes with properties, and how both are stored as Markdown and
   frontmatter, in an ADR.
3. The table view, with each view's filters, sorts, grouping and visible
   properties.
4. The board, list and gallery views.
5. The calendar and timeline views.
6. Relations between databases, both ways, and rollups.
7. Formulas: a documented, sandboxed expression language, in an ADR.
8. Query blocks over notes by folder, tag or property.
9. Databases exported to CSV.
10. Synced blocks.
11. Unlinked mentions.
12. The graph view, with the library chosen in an ADR after a license
    check, smooth at 10,000 notes.
13. Themes and CSS snippets.
14. Importers: Obsidian vaults, Notion exports, Logseq, plain Markdown,
    HTML and CSV.

The gate: an Obsidian vault and a Notion export import with no lost text.
