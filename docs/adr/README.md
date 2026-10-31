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
| [0025](0025-graph-view-with-sigma-and-forceatlas2-in-a-worker.md) | The graph view with Sigma, laid out by ForceAtlas2 in a worker | Accepted |
| [0026](0026-themes-and-snippets-are-css-files-of-the-vault.md) | Themes and snippets are CSS files of the vault | Accepted |
| [0027](0027-imports-are-plans-made-from-sources-read-only.md) | Imports are plans, made from sources only read | Accepted |
| [0028](0028-a-notion-export-becomes-pages-and-databases-without-ids.md) | A Notion export becomes pages and databases without their IDs | Accepted |
| [0029](0029-a-logseq-graph-keeps-its-folders-and-is-written-as-obsidian-writes.md) | A Logseq graph keeps its folders, and is written as Obsidian writes | Accepted |
| [0030](0030-web-pages-import-through-the-syntax-tree-tools.md) | Web pages import through the syntax-tree project's HTML tools | Accepted |
| [0031](0031-the-server-keeps-its-data-in-postgresql-and-is-set-up-with-a-code-from-its-log.md) | The server keeps its data in PostgreSQL, and is set up with a code from its log | Accepted |
| [0032](0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md) | Sessions are bearer tokens kept as hashes, and accounts come by invitation | Accepted |
| [0033](0033-sign-in-by-email-with-a-code-and-the-link-with-the-web-app.md) | Sign in by email with a code now, and with a link once the web app can open one | Accepted |
| [0034](0034-sign-in-with-openid-connect-through-the-server-and-back-to-the-app.md) | Sign in with OpenID Connect through the server, and hand the session back to the app | Accepted |
| [0035](0035-the-server-syncs-through-hocuspocus-beside-its-api-and-numbers-each-store.md) | The server syncs documents through Hocuspocus beside its API, and numbers each store | Accepted |
| [0036](0036-the-desktop-app-reaches-servers-through-go-and-keeps-tokens-in-the-keychain.md) | The desktop app reaches servers through Go, and keeps their tokens in the system's keychain | Accepted |
| [0037](0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md) | A vault syncs through a document of its paths and its notes' documents, by what each device last agreed | Accepted |
| [0038](0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md) | Encrypted workspaces seal a key to each member, and the server relays updates it cannot read | Accepted |
| [0039](0039-attachments-are-kept-by-their-hash-on-disk-or-in-an-s3-bucket.md) | Attachments are kept by their hash, on disk or in an S3-compatible bucket | Accepted |
| [0040](0040-attachments-sync-by-path-and-hash-in-the-vault-document.md) | Attachments sync by path and hash in the vault document | Accepted |
| [0041](0041-a-notes-history-is-its-earlier-texts-kept-before-each-spell-of-editing.md) | A note's history is its earlier texts, kept before each spell of editing | Accepted |
| [0042](0042-spaces-and-shared-pages-are-sync-units-each-with-its-own-vault-document.md) | Spaces and shared pages are sync units, each with its own vault document | Accepted |
| [0043](0043-a-note-open-in-the-editor-syncs-live-with-awareness-for-carets.md) | A note open in the editor syncs live, with awareness for carets | Accepted |
