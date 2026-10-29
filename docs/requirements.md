# Requirements

What Nether must do: the principles that settle conflicts between
requirements, every planned feature with its acceptance criteria and the
[roadmap](roadmap.md) phase that delivers it, and the targets that apply
to all of them. A feature is done only when its requirement is met and
covered by tests.

## Principles

When two requirements conflict, the higher principle wins.

1. **Users own their data.** Every note can be exported as standard Markdown with YAML frontmatter, plus attachments, at any time, with no loss of text. Databases export to CSV and Markdown. No feature may lock content in a proprietary format.
2. **Local-first, server-optional.** The desktop app works fully offline with no account. A server adds sync, collaboration, sharing and publishing; it is never required for writing.
3. **Self-hosting is a first-class path.** One `docker compose up` must start a working server. The hosted cloud runs the same code as the self-hosted build.
4. **Fast on large workspaces.** Opening the app, switching notes and searching must stay fast at 50,000 notes ([targets](#non-functional-requirements)).
5. **Structure is optional.** A note starts as plain writing. Properties, database views and templates are added when the user wants them, never forced.
6. **Extensible by default.** Core features use the same plugin API that third-party plugins use, wherever practical.
7. **Private by default.** No telemetry unless the user opts in. End-to-end encryption is available for sync.
8. **AI is bring-your-own.** Nether never ships a hard dependency on one AI vendor. Users or admins configure any OpenAI-compatible endpoint, Anthropic, or a local model.

## Editions

Nether is fully open source: one codebase, one license
([AGPL-3.0-or-later](../LICENSE)), and every feature is free, the
enterprise features included. There are no paid editions, no license keys
and no features held back for payment.

| Distribution | Who runs it | What it includes |
| --- | --- | --- |
| Desktop only | Individuals, no server | Every local feature |
| Self-hosted server | Individuals, teams and companies, including air-gapped networks | Every feature below, enterprise features included |
| Hosted service (optional, later) | The project or community providers | Managed hosting of the same code; no extra features |

The tables below mark each feature's edition. **CE** (Community) features
are on for everyone. **EE** (Enterprise) features serve organizations: they
are free and under the same license, live in [`enterprise/`](../enterprise/)
only to keep the code organized, and stay off until an admin switches them
on in the admin console or with an environment variable. They need no
license key, have no seat limit and never phone home. Core code never
depends on them.

## Features

### Editor and writing

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Block editor | Every paragraph, heading, list item, image or embed is a block with a stable ID; blocks can be dragged, nested, duplicated, turned into another type | CE | 1 |
| Markdown fidelity | Typing Markdown syntax converts live; round-trip Markdown → Nether → Markdown loses no text, links or frontmatter | CE | 1 |
| Source mode | Toggle any note to raw Markdown (CodeMirror) and back without losing formatting | CE | 1 |
| Slash commands | `/` opens a searchable menu of every block type and plugin command | CE | 1 |
| Rich blocks | Headings, lists, checklists, quotes, callouts, toggles, columns, dividers, tables, code blocks with syntax highlighting, LaTeX math, Mermaid diagrams | CE | 1 |
| Embeds | Images, PDF, audio, video, web links with previews, and other notes or single blocks | CE | 1 |
| Synced blocks | A block can be embedded in several notes; editing any copy updates all | CE | 2 |
| PDF annotation | Highlight and comment on PDFs; highlights become linkable blocks | CE | 4 |
| Keyboard-first | Every action has a shortcut; command palette (Ctrl/Cmd+P); optional Vim mode | CE | 1 |
| Daily and periodic notes | One click creates today's (or this week's/month's) note from a template | CE | 1 |
| Templates | Any note can be a template; variables for date, title, cursor; template picker on new note | CE | 1 |

### Linking and knowledge graph

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Wiki links | `[[` autocompletes note titles; links use note IDs internally so renames never break them | CE | 1 |
| Block and heading links | `[[Note#Heading]]` and `[[Note^block-id]]` link to and embed parts of notes | CE | 1 |
| Backlinks panel | Shows every note linking here, with context lines | CE | 1 |
| Unlinked mentions | Lists notes that mention this title without linking; one click converts to a link | CE | 2 |
| Aliases | A note can have alternate names that resolve in links and search | CE | 1 |
| Tags | `#tag` and nested `#area/project` tags, with a tag browser | CE | 1 |
| Graph view | Global and local graph of notes and links; filter by tag, folder, property; handles 10,000 nodes smoothly | CE | 2 |
| Canvas | Infinite whiteboard holding note cards, text, images, links and arrows; saved in the open JSON Canvas format | CE | 3 |
| Outline | Sidebar outline of the current note's headings | CE | 1 |

### Databases and structure

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Properties | Any note can have typed properties (text, number, select, multi-select, date, checkbox, URL, person, relation, file), stored as YAML frontmatter on disk | CE | 1 |
| Databases | A database is a collection of notes sharing a schema; it can be a full page or inline in another note | CE | 2 |
| Views | Table, board (kanban), calendar, timeline (Gantt), gallery, list; each view has its own filters, sorts, grouping and visible properties | CE | 2 |
| Relations and rollups | Link rows between databases (two-way); roll up counts, sums, averages, earliest/latest dates | CE | 2 |
| Formulas | Formula property with a documented, sandboxed expression language (math, text, date, logic, references to other properties) | CE | 2 |
| Query blocks | A block that shows a live query over any notes by folder, tag or property (Dataview-style), rendered as table or list | CE | 2 |
| Folders and nested pages | Notes can live in folders (file system view) and be nested under other notes (page tree view); both views stay consistent | CE | 1 |
| Buttons and automations | Buttons that create notes, set properties or run plugin actions; database triggers ("when status = Done, set Completed date") | CE | 4 |

### Search

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Quick switcher | Fuzzy search note titles and aliases; results in under 50 ms at 50,000 notes | CE | 1 |
| Full-text search | Search contents with operators (`tag:`, `path:`, `prop:`, quotes, `-exclude`); works offline | CE | 1 |
| Workspace search on server | Searches everything the user can access across shared spaces, respecting permissions | CE | 3 |
| Semantic search | Optional; uses the configured AI embedding provider; off by default | CE | 4 |

### Storage, sync and offline

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Local vault | Desktop stores notes as `.md` files in a user-chosen folder; edits made by other apps are picked up within 2 seconds | CE | 1 |
| No-account mode | Desktop app is fully usable with no server and no sign-up | CE | 1 |
| Multi-device sync | Changes sync through the user's Nether server; offline edits merge automatically via CRDT with no conflict dialogs for text | CE | 3 |
| End-to-end encryption | Optional per vault; content is encrypted on the client (libsodium); the server stores only ciphertext; key recovery via a recovery phrase | CE | 3 |
| Version history | Browse and restore any previous version of a note, with a diff view; retention configurable by the admin | CE | 3 |
| Attachments | Stored on local disk or S3-compatible storage; deduplicated by content hash | CE | 3 |
| Trash | Deleted notes go to trash for 30 days (configurable) before permanent deletion | CE | 1 |

### Collaboration

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Real-time co-editing | Several users edit the same note at once with live cursors and selections; latency under 200 ms on the same region | CE | 3 |
| Comments and threads | Comment on any text range or block; reply, resolve, reopen | CE | 3 |
| Mentions and notifications | `@person` notifies them in-app and by email (SMTP configured by admin) | CE | 3 |
| Workspaces and teamspaces | A workspace holds members; teamspaces group notes for a team; private spaces per user | CE | 3 |
| Roles and page permissions | Workspace roles (owner, admin, member, guest); per-page full access, edit, comment, view; permissions inherit down the page tree | CE | 3 |
| Guests | Invite external people to specific pages only | CE | 3 |
| Task assignment | Person property + "assigned to me" view across all databases | CE | 3 |

### Sharing and publishing

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Share links | Link with view, comment or edit access; optional expiry and password | CE | 4 |
| Publish to web | Publish a note or a whole folder as a public site served by the user's server; custom domain; SEO metadata; respects links between published pages only | CE | 4 |
| Export | Note, folder or workspace to Markdown (ZIP), HTML, PDF; databases to CSV | CE | 1 |
| Import | From Obsidian vault (folder of `.md`), Notion export (Markdown + CSV ZIP), Logseq, plain Markdown, HTML, CSV | CE | 2 |

### AI (bring your own)

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Provider settings | User or admin configures an OpenAI-compatible endpoint, Anthropic, or a local model (Ollama, vLLM); keys are stored encrypted and never sent to Nether's servers | CE | 4 |
| Writing assist | Rewrite, summarize, translate, continue, fix grammar on a selection | CE | 4 |
| Ask your notes | Q&A over notes the user can access, citing source notes and blocks | CE | 4 |
| Build with AI | Generate a database schema, template or project plan from a description; the user previews before anything is created | CE | 4 |
| Off switch | AI features are hidden entirely when no provider is configured; admins can disable AI per workspace | CE | 4 |

### Extensibility

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Plugin API | Versioned TypeScript SDK: commands, block types, views, sidebar panels, settings tabs, Markdown post-processors, database property types | CE | 4 |
| Plugin sandbox | Plugins declare permissions (network, file system, vault read/write); the user approves them at install; untrusted plugins run isolated | CE | 4 |
| Plugin and theme directory | A community registry (GitHub-backed index file) browsable in the app | CE | 4 |
| Themes and CSS snippets | Light/dark themes, community themes, user CSS snippets | CE | 2 |
| Public REST API and webhooks | Token-authenticated API for notes, databases and search; webhooks on create/update/delete | CE | 4 |
| Integrations | GitHub, Slack, Google Drive and Calendar (CalDAV/ICS first) as plugins; admins supply their own OAuth app credentials | CE | 5 |
| Web clipper | Browser extension (Chrome, Firefox) that saves a page or selection as Markdown to a chosen note or database | CE | 4 |

### Apps and deployment

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Desktop apps | Windows, macOS (Intel + Apple Silicon), Linux (AppImage, deb, Flatpak); auto-update that can be disabled | CE | 1 |
| Web app | Full editor in the browser, served by the server; installable as a PWA | CE | 3 |
| Mobile apps | iOS and Android with offline editing, quick capture and share sheet | CE | 5 |
| One-command self-host | `docker compose up` starts server, Postgres, Redis and storage with sane defaults; first-run setup creates the admin account | CE | 3 |
| Kubernetes | Official Helm chart with horizontal scaling of the sync service | CE | 5 |
| Backups | Built-in scheduled backup of database and files to disk or S3; documented restore procedure tested in CI | CE | 3 |
| Upgrades | Database migrations run automatically and are safe to skip versions within one major release | CE | 3 |

### Enterprise features (free and open source)

| Feature | Requirement | Edition | Phase |
| --- | --- | --- | --- |
| Enterprise switch | Admins turn each enterprise feature on or off in the admin console or by environment variable; no license key, seat limit or phone-home ([Editions](#editions)) | EE | 5 |
| SSO | SAML 2.0 and enforced OIDC login; tested against Keycloak, Okta, Microsoft Entra ID | EE | 5 |
| SCIM and LDAP | Automatic user and group provisioning and deprovisioning | EE | 5 |
| Audit logs | Every sign-in, permission change, share, export and deletion logged; searchable; export to SIEM via syslog or webhook | EE | 5 |
| Data policies | Retention rules, legal hold, restrict public sharing and export per workspace | EE | 5 |
| Advanced permissions | Custom roles, group-based access, domain-restricted sharing | EE | 5 |
| Admin console | Usage analytics, workspace management, security settings in one place | EE | 5 |
| High availability | Multi-node deployment with documented failover; zero-downtime upgrades | EE | 5 |
| Private AI endpoint enforcement | Admin locks AI to an approved internal model endpoint for the whole organization | EE | 5 |

## Non-functional requirements

These apply to every feature. CI measures the performance targets on a
reference vault of 50,000 notes.

| Area | Requirement |
| --- | --- |
| Startup | Desktop app opens to the last note in under 1.5 s (cold) on a mid-range laptop |
| Note switching | Open any note in under 100 ms; typing latency under 16 ms |
| Search | Title search under 50 ms; full-text under 300 ms |
| Memory | Desktop idle memory under 300 MB with a 50,000-note vault |
| Server sizing | A single 2 vCPU / 4 GB server handles 200 active users |
| Reliability | No data loss on crash, power cut or network drop; every write is durable locally before sync |
| Security | OWASP ASVS Level 2 for the server; argon2id password hashing; rate limiting; CSP on web; signed release binaries; `SECURITY.md` with a disclosure process |
| Privacy | No telemetry by default; opt-in anonymous crash reports only |
| Accessibility | WCAG 2.2 AA; full keyboard navigation; screen-reader labels on every control |
| Internationalization | All UI strings translatable from day one; right-to-left layout support; English first, community translations via Weblate or Crowdin |
| Testing | Unit tests for core packages (≥ 80% coverage on `core`, `markdown`, `database`); Playwright end-to-end tests for main flows; CRDT fuzz tests for sync |
| Compatibility | Markdown output readable by Obsidian and standard Markdown tools; JSON Canvas spec compliant |
| Documentation | User guide, self-hosting guide, admin guide, plugin developer guide, API reference, each updated in the same PR as the feature |
