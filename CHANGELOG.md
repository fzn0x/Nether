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
- The documentation site at https://fzn0x.github.io/nether/.
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
  you type, rewriting only the blocks you changed. An edit that meets a
  change another app made is kept in a conflict copy beside the note.
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
- Source mode: Ctrl+/ shows a note as its Markdown in a text editor, with
  find and replace and optional Vim keys, and goes back to blocks with
  nothing lost; a file's line endings stay as they are.

[Unreleased]: https://github.com/fzn0x/nether/commits/main
