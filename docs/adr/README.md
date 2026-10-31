# Architecture Decision Records

Each significant decision gets a record here: `NNNN-title.md`, numbered in
order, with its context, the decision, the alternatives considered and the
consequences. A record is never rewritten to change its decision; a newer
record supersedes it and says so. Start a new one from
[template.md](template.md).

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-license-agpl-and-dco.md) | License the whole repository under the AGPL-3.0-or-later, with the DCO | Accepted |
| [0002](0002-editor-tiptap.md) | Edit notes with TipTap, and convert Markdown through our own syntax tree | Accepted |
| [0003](0003-sync-yjs-hocuspocus.md) | Sync notes as Yjs documents through Hocuspocus, and keep Markdown files in step | Accepted |
| [0004](0004-desktop-on-mygo.md) | Build the desktop app on MyGO, with the shared UI in a web page | Accepted |
| [0005](0005-server-on-fastify.md) | Run the server on Fastify | Accepted |
| [0006](0006-markdown-file-format.md) | Write notes as Obsidian-flavored Markdown, and mark Nether's own blocks with HTML | Accepted |
| [0007](0007-vault-folder-and-local-index.md) | Keep a vault's ID in its folder and its index with the app | Accepted |
| [0008](0008-allow-mit-0.md) | Allow MIT-0 among the permissive licenses | Accepted |
| [0009](0009-math-code-and-diagrams.md) | Render math with KaTeX, code with lowlight, and diagrams with Mermaid without ELK | Accepted |
| [0010](0010-vault-files-in-notes.md) | Serve a vault's media to the page from a loopback server, and find files as Obsidian does | Accepted |
| [0011](0011-templates-and-periodic-notes.md) | Fill templates with Obsidian's variables, and start from Obsidian's settings | Accepted |
| [0012](0012-export-from-the-page.md) | Export notes from the page's own HTML, and let the app write the files | Accepted |
| [0013](0013-pages-in-the-folder-beside-a-note.md) | Keep a page's pages in the folder beside it with its name | Accepted |
| [0014](0014-load-a-vaults-links-lean-and-after-its-note.md) | Load a vault's links lean, and after the note it opens to | Accepted, partly superseded by 0016 and 0017 |
| [0015](0015-check-accessibility-and-lay-out-by-direction.md) | Check every screen with axe, and lay out by direction, not by side | Accepted |
| [0016](0016-find-backlinks-by-the-names-links-write.md) | Find backlinks by the names links write | Accepted |
| [0017](0017-measure-performance-before-each-gate-not-in-ci.md) | Measure performance before each phase's gate, not in CI | Accepted |
| [0018](0018-a-database-is-a-note-with-an-obsidian-base-beside-it.md) | A database is a note, with an Obsidian base beside it | Accepted |
| [0019](0019-relations-are-links-both-ways-and-rollups-are-worked-out.md) | Relations are links, kept both ways, and rollups are worked out | Accepted |
| [0020](0020-formulas-in-a-language-nether-reads-and-runs-itself.md) | Formulas in a language Nether reads and runs itself | Accepted |
| [0021](0021-query-blocks-are-obsidian-bases-in-a-code-block.md) | Query blocks are Obsidian bases in a code block | Accepted |
| [0022](0022-a-database-exports-to-csv-as-its-view-shows-it.md) | A database exports to CSV as its view shows it | Accepted |
| [0023](0023-synced-blocks-are-block-embeds-edited-in-place.md) | Synced blocks are block embeds, edited in place | Accepted |
| [0024](0024-unlinked-mentions-found-by-the-index-and-linked-where-written.md) | Unlinked mentions are found by the index and linked where written | Accepted |
