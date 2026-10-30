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

[Unreleased]: https://github.com/fzn0x/nether/commits/main
