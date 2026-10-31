# @nether/sync-client

Syncing a vault with a workspace on a Nether server, as
[ADR 0037](../../docs/adr/0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md)
has it: the vault document that lists the workspace's notes by ID and
path, and each note's Yjs document, through Hocuspocus, with what a device
knows kept between runs, so edits made offline are sent when it is back.

| File | What it does |
| --- | --- |
| `src/paths.ts` | The vault document's list of notes, and `reconcilePaths`: what to make, move or remove on each side, by what the two last agreed on |
| `src/engine.ts` | `VaultSync`: one WebSocket for the vault document and the notes syncing; reconciles the list, catches up on the notes stored since the last number seen, hears of each as it is stored, and syncs notes through the documents the app holds for them |

The engine knows a vault only through `SyncVault`, which the app gives it:
its notes' paths, their documents (the ones its editor shares), and making,
moving and removing notes. What a device keeps goes through `SyncStore`.

The tests sync two devices through a real server on PGlite.

Roadmap: the desktop app's side and end-to-end encryption in Phase 3.
