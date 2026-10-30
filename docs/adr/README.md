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
