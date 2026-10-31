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
- Attachments sync: a vault's images, PDFs and other files go to the
  workspace once each and come to every computer that syncs it, are kept
  twice when changed on two computers at once, are encrypted for an
  encrypted workspace, and the sync line names any the server would not
  take ([ADR 0040](docs/adr/0040-attachments-sync-by-path-and-hash-in-the-vault-document.md)).
- Attachments on the server: files kept by the SHA-256 of their bytes,
  once per workspace, on the server's disk or in an S3-compatible bucket
  (MinIO, Garage, R2, S3), checked against their hash when sent, and
  served so they cannot run scripts
  ([ADR 0039](docs/adr/0039-attachments-are-kept-by-their-hash-on-disk-or-in-an-s3-bucket.md)).
- End-to-end encryption in the desktop app: an account turns it on in
  Servers and signing in, writing down the recovery phrase it shows once,
  and unlocks it on another computer with the phrase; Sync this vault makes
  encrypted workspaces and syncs them, and a member's app seals a
  workspace's key for the members waiting for it. The account's private
  key stays in the system's keychain.
- End-to-end encryption in `@nether/sync-client`: a 24-word recovery
  phrase that opens an account's private key, workspace keys sealed to
  each member, and every update of an encrypted workspace encrypted with
  XChaCha20-Poly1305 for its document before it leaves the device, synced
  through the server's relay; a device that cannot read an update stops
  rather than overwrite what it could not read.
- Encrypted workspaces on the server: accounts keep a public key and a
  private key only their recovery phrase opens, a workspace made encrypted
  holds its key sealed to each member, and its updates sync through
  `/api/relay`, which keeps them in order without reading them; Hocuspocus
  refuses them, so no note of one is ever stored in plain text
  ([ADR 0038](docs/adr/0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md)).
- Sync this vault, in the desktop app's command palette: a vault syncs
  with a workspace on a server it is signed in to, its notes sent there and
  made on every computer that opens the workspace into an empty folder,
  with their IDs, links and history. Edits made on two computers merge, a
  note moved or removed on one is moved or trashed on the other, edits made
  offline wait to be sent, and the foot of the sidebar tells how sync is
  going. The sync engine loads only for a linked vault.
- `@nether/sync-client`, which syncs a vault with a workspace: a document
  listing the workspace's notes by ID and path, compared with the vault's
  notes by what the two last agreed on, and each note's document, synced
  when it changes on either side and caught up by number after a device
  was away, with what a device knows kept for edits made offline
  ([ADR 0037](docs/adr/0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md)).
- Servers and signing in, in the desktop app's command palette: connect
  to a Nether server by its address and sign in with a password, a code
  it emails, or its single sign-on in the system's browser, which comes
  back to the app on a loopback address. Each session's token is kept in
  the system's keychain, never in a file, and the app's requests to a
  server go through Go, outside the page's CORS
  ([ADR 0036](docs/adr/0036-the-desktop-app-reaches-servers-through-go-and-keeps-tokens-in-the-keychain.md)).
- Sync on the server: Hocuspocus at `/api/sync`, on the API's port, syncs
  each note's Yjs document and each vault's list of notes for the members
  of their workspace, and read-only for its guests. Documents are kept in
  PostgreSQL, numbered each time they are stored, so a client asks which
  changed since it was last connected, and hears of each as it is stored
  ([ADR 0035](docs/adr/0035-the-server-syncs-through-hocuspocus-beside-its-api-and-numbers-each-store.md)).
- Signing in with an OpenID Connect provider, such as Keycloak, Okta or
  Microsoft Entra ID: the app opens the provider in the browser and gets a
  session through a code and its PKCE verifier, as RFC 8252 describes. The
  provider's identity links to the account its verified address names, an
  invitation makes an account for whoever it invites, and
  `NETHER_OIDC_SIGN_UP` lets everyone the provider signs in have one
  ([ADR 0034](docs/adr/0034-sign-in-with-openid-connect-through-the-server-and-back-to-the-app.md)).
- Signing in by email: a server with the admin's SMTP server, set by
  `NETHER_SMTP_URL` and `NETHER_MAIL_FROM`, emails a code of eight digits
  to an address that has an account, which signs in once within 15
  minutes. The link to sign in comes with the web app
  ([ADR 0033](docs/adr/0033-sign-in-by-email-with-a-code-and-the-link-with-the-web-app.md)).
- Signing in to the server: an email address and password give a session
  token, which lasts 30 days unused and 90 at most and is kept only as its
  hash. People see and end their sessions and change their passwords, and
  a workspace's owners and admins invite others, who accept with a new
  account or the one they are signed in to. Signing in is limited by
  address and by account, and `NETHER_TRUST_PROXY` names the proxies whose
  forwarded addresses to believe
  ([ADR 0032](docs/adr/0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md)).
- The server keeps its data in PostgreSQL, set by `NETHER_DATABASE_URL`,
  and brings the database to its schema as it starts. A server with no
  account writes a setup code to its log, and `POST /api/setup` with that
  code makes the admin account, its password an argon2id hash, and the
  first workspace
  ([ADR 0031](docs/adr/0031-the-server-keeps-its-data-in-postgresql-and-is-set-up-with-a-code-from-its-log.md)).
- Web pages import as notes named by their titles, their text as
  Markdown, their styles and scripts left behind; the HTML parser loads
  only to import
  ([ADR 0030](docs/adr/0030-web-pages-import-through-the-syntax-tree-tools.md)).
- A Logseq graph imports with its folders, its page properties as
  frontmatter, namespaces as folders, journals named by their dates with
  Logseq's titles as aliases, block IDs and references, embeds and tasks
  written as Obsidian writes them, and every other line as it was
  ([ADR 0029](docs/adr/0029-a-logseq-graph-keeps-its-folders-and-is-written-as-obsidian-writes.md)).
- A Notion export, Markdown and CSV in a ZIP file or in parts, imports as
  pages without Notion's IDs in their names, its databases as databases
  whose rows have their properties as frontmatter, and its links as wiki
  links, with every word of every page kept
  ([ADR 0028](docs/adr/0028-a-notion-export-becomes-pages-and-databases-without-ids.md)).
- Import, in the command palette: an Obsidian vault or a folder of
  Markdown comes over byte for byte with its files, Markdown files as
  notes, and CSV tables as databases, each line a note with its cells
  typed as all its column's values read, into a folder the vault does not
  have yet; the desktop app reads what is imported and never writes it
  ([ADR 0027](docs/adr/0027-imports-are-plans-made-from-sources-read-only.md)).
- Themes and CSS snippets: Appearance, in the command palette, shows a
  vault light, dark or as the system, with a theme from its
  `.nether/themes` folder and the snippets turned on from
  `.nether/snippets`, kept in the vault; the page's `data-mode` says which
  it shows, and themes set Nether's design tokens
  ([ADR 0026](docs/adr/0026-themes-and-snippets-are-css-files-of-the-vault.md)).
- The graph view, Ctrl+G: the vault's notes and their links, every note's or
  those up to three links around the open note, kept to a filter written
  as a search is; drawn by Sigma with WebGL and laid out by ForceAtlas2 in a
  worker, smooth with 10,000 notes, and usable from the keyboard
  ([ADR 0025](docs/adr/0025-graph-view-with-sigma-and-forceatlas2-in-a-worker.md)).
  `pnpm --filter @nether/desktop perf:graph` measures it.
- Unlinked mentions: beside a note, under its backlinks, the notes that
  write its name or an alias without linking it, each mention on its line;
  **Link** makes one a link, changing only its words in the file
  ([ADR 0024](docs/adr/0024-unlinked-mentions-found-by-the-index-and-linked-where-written.md)).
- Synced blocks: a block of another note embedded by its ID,
  `![[Roadmap#^b1]]`, edits in place, and its edits are written to the block
  in its note, so every note that embeds it shows them. Every embed now
  follows its note as it changes, and read-only embeds are named for screen
  readers
  ([ADR 0023](docs/adr/0023-synced-blocks-are-block-embeds-edited-in-place.md)).
- A database's view exports as CSV from its toolbar: the rows it keeps, in
  its order, with the properties it shows, as UTF-8 that spreadsheets read
  ([ADR 0022](docs/adr/0022-a-database-exports-to-csv-as-its-view-shows-it.md)).
- Query blocks: a `base` code block in a note, written as Obsidian writes a
  base, shows the notes its filters find anywhere in the vault, by folder,
  tag or property, as a table, a list or cards, with its own formulas,
  sorts, groups and limits, and finds them again as notes change; the
  formula language gains Obsidian's `file.hasTag()`, `file.inFolder()` and
  `file.hasProperty()`, and `file.folder`, `file.ext` and `file.tags`
  ([ADR 0021](docs/adr/0021-query-blocks-are-obsidian-bases-in-a-code-block.md)).
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

- The database view, query blocks, and the import and appearance dialogs
  with the importers, load when a note or the user first needs them, not
  when the app opens: what it loads at start is 52 kB smaller, below
  Phase 1's, and it idles in less memory.
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

- Stopping sync no longer waits for ever when it stops while a note is
  still loading to sync: the note is not synced once sync has stopped.
- A note moved while sync was still fetching other notes stays where it
  was moved, where sync could move it back to where it came from.
- The desktop app keeps what the relay knows of each document of an
  encrypted workspace between runs, where each start asked for every
  update again.
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
- Two values added one after another to a database's relation or
  multi-select cell are both kept: the second no longer writes the list
  as the cell showed it before the first was read back.

[Unreleased]: https://github.com/fzn0x/Nether/commits/main
