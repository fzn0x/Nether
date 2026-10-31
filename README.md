<p align="center">
  <img src="docs/assets/mark.svg" width="96" height="96" alt="Nether's mark: an N whose diagonal links two notes">
</p>

# Nether: Local-first note taking app that you truly own

[![CI](https://github.com/fzn0x/Nether/actions/workflows/ci.yml/badge.svg)](https://github.com/fzn0x/Nether/actions/workflows/ci.yml)
[![Docs](https://github.com/fzn0x/Nether/actions/workflows/pages.yml/badge.svg)](https://fzn0x.github.io/Nether/)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](#license)

Nether is self-hostable and local-first note taking app combining both
Notion and Obsidian features. You can import your Obsidian vaults and
Notion exports. Self-hosting is available for enterprise.

> [!NOTE]
> Nether is in early development. [Version 0.0.1](https://github.com/fzn0x/Nether/releases/latest),
> a developer preview of the desktop app for Windows, macOS and Linux, keeps
> your notes on your computer; sync and collaboration come later.
> [Phase 0](docs/reports/phase-0.md), [Phase 1](docs/reports/phase-1.md)
> and [Phase 2](docs/reports/phase-2.md) of six are done: the desktop app
> keeps a vault of Markdown notes with the block editor, links, backlinks,
> tags, search, templates and export, and databases with six views,
> relations, rollups, formulas, query blocks, synced blocks, the graph,
> themes and importers from Obsidian, Notion, Logseq, HTML and CSV, within
> the performance targets on 50,000 notes. Phase 3, sync and
> collaboration, the first public release, is under way, and the
> [roadmap](docs/roadmap.md#phase-3-self-hosted-sync-and-collaboration)
> ticks it off as it lands. Watch the repository to follow along.

[Documentation](https://fzn0x.github.io/Nether/) ·
[Roadmap](docs/roadmap.md) · [Requirements](docs/requirements.md) ·
[Architecture](docs/architecture.md) · [Decisions](docs/adr/)

## What Nether is built to do

- **Keep your notes as files.** Every note is a Markdown file with YAML
  frontmatter in a folder you choose, readable by Obsidian and any text
  editor, and export never loses text.
- **Add structure when you want it.** Any note can have typed properties,
  and notes become databases with table, board, calendar, timeline,
  gallery and list views, relations, rollups and formulas.
- **Work offline.** The desktop app needs no account and no server, and
  edits from several devices merge without conflict dialogs, through
  CRDTs.
- **Run on your server, or on none.** One `docker compose up` brings sync,
  sharing, publishing and real-time co-editing, and end-to-end encryption
  keeps the server from reading your notes.
- **Keep all of it free.** One license, the AGPL-3.0-or-later, covers
  everything, enterprise features such as single sign-on and audit logs
  included: no paid editions, no license keys, no telemetry.
- **Bring your own AI.** Any OpenAI-compatible endpoint, Anthropic, or a
  local model, set up by you, and nothing when none is.

## Roadmap

| Phase | What it delivers | Complete |
| --- | --- | :---: |
| 0. Foundations | Decisions, the repository, CI, the data model, a 50,000-note test vault | ✅ |
| 1. Local-first notes | The desktop app: a vault on disk, the block and Markdown editor, links and backlinks, tags, search, templates, export | ✅ |
| 2. Databases and structure | Databases with six views, relations, rollups, formulas, synced blocks, the graph view, importers from Obsidian and Notion | ✅ |
| 3. Sync and collaboration | The first public release: the server, end-to-end encrypted sync, co-editing, comments, permissions, the web app, the canvas, backups | ❌ |
| 4. Platform | Plugins in a sandbox, bring-your-own AI, publishing, the REST API, the web clipper, automations | ❌ |
| 5. Enterprise, mobile and scale | Single sign-on, SCIM, audit logs, data policies, high availability, the Helm chart, mobile apps | ❌ |

Each phase ends with a gate it must pass before the next one starts; the
[roadmap](docs/roadmap.md) lists them, and the
[requirements](docs/requirements.md) give every feature its acceptance
criteria.

## How it is built

| Part | Built with |
| --- | --- |
| Apps and shared packages | TypeScript, in a pnpm and Turborepo monorepo |
| Editor | TipTap on ProseMirror, with Markdown converted through remark ([ADR 0002](docs/adr/0002-editor-tiptap.md)) |
| Sync | Yjs CRDTs, one document per note, through Hocuspocus ([ADR 0003](docs/adr/0003-sync-yjs-hocuspocus.md)) |
| Desktop app | [MyGO](https://github.com/egoist/mygo) in Go, showing the shared UI in the system's webview ([ADR 0004](docs/adr/0004-desktop-on-mygo.md)) |
| Server | Fastify on Node.js, with PostgreSQL, Redis or Valkey, and S3-compatible storage ([ADR 0005](docs/adr/0005-server-on-fastify.md)) |

The [architecture](docs/architecture.md) shows how the parts fit together.

## Develop

You need Node.js 24, pnpm 10 and, for the desktop app, Go 1.27.

```sh
pnpm install
pnpm test                               # unit tests
pnpm --filter @nether/desktop dev       # the desktop app
pnpm vault:generate                     # the 50,000-note reference vault
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest: every check, how work is
organized, and how commits are signed off.

## License

Copyright (C) 2026 the Nether contributors.

Nether is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the
Free Software Foundation, either version 3 of the License, or (at your
option) any later version. See [LICENSE](LICENSE).

The enterprise features in [`enterprise/`](enterprise/) are under the same
license and just as free; [ADR 0001](docs/adr/0001-license-agpl-and-dco.md)
explains why, and why contributions come under the DCO.
