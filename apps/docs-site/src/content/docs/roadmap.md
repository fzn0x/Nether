---
title: Roadmap
description: The six phases Nether ships in, and the test each one must pass.
---

Nether ships in six phases. Each ends with a usable app and a gate, a test
that must pass before the next phase starts. Phases have no fixed dates.

| Phase | What it delivers | Gate |
| --- | --- | --- |
| 0. Foundations | Decisions, the repository, CI, the data model, a 50,000-note test vault | CI passes, including a server run with every enterprise feature off |
| 1. Local-first notes | The desktop app: a vault on disk, the block and Markdown editor, links, backlinks, tags, search, templates, export | A 50,000-note vault edits offline within the performance targets |
| 2. Databases and structure | Databases with six views, relations, rollups, formulas, synced blocks, the graph view, themes, importers | An Obsidian vault and a Notion export import with no lost text |
| 3. Sync and collaboration | The server, end-to-end encrypted sync, history, co-editing, comments, permissions, the web app, the canvas, backups | `docker compose up` works, and two people co-edit offline and online with no lost edits |
| 4. Platform | Plugins in a sandbox, bring-your-own AI, share links, publishing, the REST API, the web clipper, automations | Third-party plugins run sandboxed, and a published site loads on a custom domain |
| 5. Enterprise, mobile and scale | Single sign-on, SCIM, audit logs, data policies, high availability, the Helm chart, mobile apps, integrations | A self-hosted install runs air-gapped with single sign-on and audit logs on, and no license key |

Phase 3 is the first public release: sync and self-hosting are what set
Nether apart from both Notion and Obsidian.

The [roadmap in the repository](https://github.com/fzn0x/nether/blob/main/docs/roadmap.md)
tracks the current phase task by task.
