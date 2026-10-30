# Phase 0 report: Foundations

- Date: 2026-10-30
- Gate: CI is green on `main`, including a run of the server with every
  enterprise feature switched off. Passed on 6b06ff8
  ([run](https://github.com/fzn0x/Nether/actions/runs/40964445455)).

Phase 0 is done: the decisions, the repository, CI, the data model and the
reference vault are in place, and every task on the
[roadmap](../roadmap.md#phase-0-foundations) is ticked. Phase 1 can start
once the maintainer sets the dates of the phases.

## What shipped

| Task | Where | Notes |
| --- | --- | --- |
| License and contributions | [ADR 0001](../adr/0001-license-agpl-and-dco.md), [LICENSE](../../LICENSE) | AGPL-3.0-or-later for everything, DCO sign-offs, no CLA |
| Editor library | [ADR 0002](../adr/0002-editor-tiptap.md), [spike](../adr/0002-editor-spike/) | TipTap, with Markdown through remark; the spike ran 8 files through 4 libraries |
| CRDT and sync | [ADR 0003](../adr/0003-sync-yjs-hocuspocus.md) | Yjs per note, Hocuspocus, files kept in step both ways |
| Desktop app | [ADR 0004](../adr/0004-desktop-on-mygo.md) | MyGO 0.6.2, the shared UI in a web page |
| Server framework | [ADR 0005](../adr/0005-server-on-fastify.md) | Fastify |
| Monorepo | root | pnpm 10, Turborepo, strict TypeScript 6.0, ESLint 10 with typescript-eslint, Prettier, Vitest 5, Playwright, commitlint and lefthook |
| CI | [ci.yml](../../.github/workflows/ci.yml) | Lint, formatting, types, unit and end-to-end tests, license scan, the server run with enterprise features off, Go checks on Linux and Windows, desktop builds for three platforms |
| Project files | root | README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG, issue forms, pull request template, Dependabot |
| Core data model | [packages/core](../../packages/core/) | Notes, blocks, properties, databases, views, links, workspaces; 186 tests, 100% of lines and 94.6% of branches covered |
| Reference vault | [tools/vault-generator](../../tools/vault-generator/) | 50,000 notes, 62.2 MB, 246,135 links, in about 13 s; the same bytes on every platform |
| Server | [apps/server](../../apps/server/) | `GET /health`, environment configuration, the enterprise extension point |
| Desktop app | [apps/desktop](../../apps/desktop/) | A window that shows the page and asks Go for the version; 9.6 MB on Windows |
| Documentation site | [apps/docs-site](../../apps/docs-site/) | Live at https://fzn0x.github.io/Nether/ |

## Measured

On the maintainer's Windows 11 machine:

| What | Result |
| --- | --- |
| A MyGO window with a web page, to the page's load event | 687 ms on the first run, 282 to 292 ms after |
| Its idle memory, private working set of all 7 processes | 68 to 72 MB |
| The same window in MyGO's native UI | 72 to 84 ms to the first view, 15 MB |
| Generating the 50,000-note reference vault | 12 to 14 s |

## Deferred

- The packages and apps with no code yet hold a README that names their
  phase: the editor, Markdown, storage, sync, databases, search, graph,
  canvas, plugin API, AI, UI, web and mobile, the enterprise features and
  the deployment files.
- Measuring the performance targets on the reference vault starts in
  Phase 1, when there is a vault to open and notes to switch between.
- The desktop page has no content security policy yet: it must be checked
  against MyGO's bridge in all three webviews first.
- Release builds, signing and auto-updates come with the first release.
- Automated accessibility checks come with the first real interface, in
  Phase 1.

## Known issues

- Starlight warns while building the site that `/404` conflicts with its
  catch-all route; that is how it builds a custom 404 page, and the page
  works.
- pnpm leaves out `@emnapi` packages that only optional WASM bindings
  reach, which breaks `@astrojs/check`; the site type-checks with
  `astro sync` and `tsc` instead.
- Astro 7 needs Node.js 22.23.4 or newer, more than the 22.12 the rest of
  the repository needs.
- MyGO's file watcher holds 8,192 entries by default on Windows and Linux;
  Phase 1 must raise it for large vaults and measure the 2-second pickup.
- Dependabot opened #1 (MyGO 0.6.2 to 0.6.4) and #2 (`@types/node` 26,
  which Dependabot now ignores) for the maintainer to decide on.

## Plan for Phase 1: local-first notes

One feature per pull request, in this order:

1. `packages/markdown`: Markdown to and from Nether's documents through
   remark, with extensions for Obsidian's syntax, and the round-trip suite
   grown from the spike's corpus.
2. The vault on disk: the desktop's Go services for reading, writing and
   watching the folder, and the SQLite store of ADR 0003.
3. `packages/editor`: TipTap with Nether's schema and block IDs, live
   Markdown shortcuts, the slash menu, and source mode in CodeMirror.
4. Yjs documents per note, and files kept in step with them both ways.
5. Links, backlinks, aliases, tags and the outline.
6. The quick switcher and full-text search with FTS5.
7. Properties, templates, daily notes, the trash and export.
8. The app's interface: sidebar, command palette and keyboard shortcuts,
   designed and recorded in DESIGN.md.
9. The performance harness on the reference vault, which the gate runs.

The gate: a 50,000-note vault edits offline within the
[performance targets](../requirements.md#non-functional-requirements).
