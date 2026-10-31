# @nether/sync-client

Syncing a vault with a workspace on a Nether server, as
[ADR 0037](../../docs/adr/0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md)
has it: the vault document that lists the workspace's notes by ID and
path, and each note's Yjs document, through Hocuspocus, with what a device
knows kept between runs, so edits made offline are sent when it is back.

| File | What it does |
| --- | --- |
| `src/paths.ts` | The vault document's list of notes, and `reconcilePaths`: what to make, move or remove on each side, by what the two last agreed on |
| `src/units.ts` | The units an account opens ([ADR 0042](../../docs/adr/0042-spaces-and-shared-pages-are-sync-units-each-with-its-own-vault-document.md)), as the server lists them, and `unitForPath`: the unit whose area, a teamspace's folder, the private space's or a shared page's, holds a path |
| `src/files.ts` | The vault document's list of other files by path, hash and blob ([ADR 0040](../../docs/adr/0040-attachments-sync-by-path-and-hash-in-the-vault-document.md)), the paths sync takes, and `reconcileFiles`: what to send, fetch, remove or keep twice |
| `src/engine.ts` | `VaultSync`: asks for the account's units, and syncs each one's vault document; reconciles the list across them, each note in its path's unit, catches up on the notes stored since the last number seen, hears of each as it is stored, and syncs notes through the documents the app holds for them, over a channel; then reconciles other files, sending the bytes the server lacks and fetching those the vault lacks |
| `src/channel.ts` (live) | `HocuspocusChannel.live`: a note's document synced as it changes, with its awareness, while its editor is open ([ADR 0043](../../docs/adr/0043-a-note-open-in-the-editor-syncs-live-with-awareness-for-carets.md)) |
| `src/channel.ts` | The channel the engine syncs documents through, and `HocuspocusChannel`, for a workspace the server can read: one WebSocket for the vault document and the notes syncing |
| `src/relayChannel.ts` | `RelayChannel`, for an encrypted workspace ([ADR 0038](../../docs/adr/0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md)): subscribes after the last number applied, decrypts and applies; sends only this side's changes, encrypted, by the snapshot last sent; replaces a long log with a snapshot, and never after an update it could not read |
| `src/crypto.ts` | Keys and the 24-word recovery phrase, the private key's box, workspace keys sealed to members, and updates encrypted with XChaCha20-Poly1305 for their document, and files with a nonce derived from their bytes, with libsodium |

The engine knows a vault only through `SyncVault`, which the app gives it:
its notes' paths, their documents (the ones its editor shares), making,
moving and removing notes, and its other files' hashes and bytes. What a
device keeps goes through `SyncStore`.

The tests sync two devices through a real server on PGlite, encrypted
workspaces and files included, and check the server keeps nothing it can
read.

Roadmap: the desktop app's side and end-to-end encryption in Phase 3.
