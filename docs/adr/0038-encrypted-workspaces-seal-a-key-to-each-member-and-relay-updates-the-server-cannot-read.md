# 0038. Encrypted workspaces seal a key to each member, and the server relays updates it cannot read

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md) ask for end-to-end encryption:
"Optional per vault; content is encrypted on the client (libsodium); the
server stores only ciphertext; key recovery via a recovery phrase."
[ADR 0003](0003-sync-yjs-hocuspocus.md) sketched it: clients encrypt each
update, and the server stores and relays the ciphertext in order without
reading it. Sync now exists
([ADRs 0035](0035-the-server-syncs-through-hocuspocus-beside-its-api-and-numbers-each-store.md)
and [0037](0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md)),
and a workspace is the unit of sync, permission and encryption.

Several forces shape the design:

- **Hocuspocus reads updates.** It applies each update to a document,
  stores the merged state, and answers sync's handshake from it. It cannot
  do any of that with ciphertext.
- **People share workspaces.** Each member needs the workspace's key,
  which the server must never have.
- **People lose devices.** A person with a new computer and nothing else
  must still open their encrypted notes, with something they wrote down
  once.
- **The server stays useful.** It still keeps every update, tells clients
  what changed, and serves new devices, all without reading anything.

## Decision

### Keys

**Each account has a key pair.**

- It is an X25519 key pair (libsodium's `crypto_box`), which the client
  makes the first time its person turns on encryption.
- The public key is on the server, for others to seal keys to.
- The private key stays in each device's keychain, as session tokens do
  ([ADR 0036](0036-the-desktop-app-reaches-servers-through-go-and-keeps-tokens-in-the-keychain.md)).
- It is also backed up on the server, encrypted with a key only the
  recovery phrase gives. The server keeps that box, and cannot open it.

**The recovery phrase is 24 words.** They are BIP39's English list, the
standard that wallets and password managers use: 256 random bits that a
person can write down and type.

- The recovery key is BLAKE2b-256 of those bits, keyed by a constant of
  Nether's. The bits are random, so no slow hash is needed.
- The private key's box is XChaCha20-Poly1305. Its additional data names
  the account, so a box cannot be moved to another account.
- A new device, signed in, asks for the phrase, fetches the box, and opens
  the private key.

**Each encrypted workspace has a key.**

- It is a random 256-bit key, made by the client that creates the
  workspace.
- It is sealed to each member's public key (libsodium's `crypto_box_seal`),
  one sealed copy per member and key version.
- The server gives a member only their own sealed copy.
- A member who joins has no copy until a member who has the key, online,
  seals one for them. The server lists who lacks one. It cannot seal a key
  itself, and that is the point.
- Removing a member and rotating the key comes with workspace permissions,
  later in this phase. Until then, a removed member keeps what they had
  synced.

### Content

**Every Yjs update is encrypted before it leaves the device.**

- Each update of a document, the vault's list of notes included, is
  sealed with XChaCha20-Poly1305 under the workspace key, with a random
  nonce: `[format 1 byte][key version 4 bytes][nonce 24 bytes][ciphertext]`.
- Its additional data is the document's name, `<workspace id>/<document>`,
  so the server cannot move an update to another document undetected.
- Paths and titles live in the encrypted vault document. The server sees
  only the workspace's ID, random notes' IDs, sizes, and when they change.

### The relay

**The server relays encrypted workspaces' updates on a WebSocket of their
own, `/api/relay`.** Its protocol is JSON, with the data in base64:

| Message | Does |
| --- | --- |
| `auth` | signs the socket in with the session's token |
| `subscribe` a document `after` a number | sends the updates stored since, then each one as it comes |
| `push` an update | stores it, numbered from the same sequence as unencrypted documents, answers with its number, and sends it to the document's other subscribers |
| `compact` a document `through` a number, with a snapshot | replaces the updates up to that number with the snapshot, at that number, so the document's log stops growing |

- Members read; guests may not push or compact.
- Subscribers to the vault document hear of each note pushed, as with
  Hocuspocus.
- The list of documents changed since a number covers encrypted
  workspaces too, from the same sequence, so catching up is unchanged.
- Hocuspocus refuses encrypted workspaces' documents, so plaintext can
  never be stored for one by mistake.

**A workspace is encrypted or not from the day it is made.**
`POST /api/workspaces` creates one, encrypted when the creator has a key
pair and sends their sealed copy of its key. Moving notes between the two
kinds is an import, not a switch.

## Alternatives

- **Hocuspocus with encrypted updates as opaque messages.** Its stateless
  messages could carry them, but its handshake, storage and debounce would
  all go unused. It would be a relay with Hocuspocus's costs.
- **One key per account instead of per workspace.** Sharing a workspace
  would mean sharing an account's key.
- **A passphrase the person chooses, through a slow hash.** People choose
  weak ones. A phrase of 256 random bits needs no hash to be strong, and
  the BIP39 list makes it writable.
- **The server seals keys for new members.** It would have to hold the
  key, which defeats the encryption.
- **Encrypting files at rest instead.** The server would still read every
  update, and its admin every note.

## Consequences

- The server cannot search, publish or show the history of an encrypted
  workspace; those features say so. Version history may come from the
  clients, which can read it.
- A person who loses both every device and the phrase loses the
  workspace's content, unless another member seals the key again. The app
  says this when it shows the phrase.
- The server can withhold or replay updates, which it cannot forge.
  Yjs ignores replays, and withheld updates show as missing edits, not
  wrong ones.
- The sync engine gets a second way to sync documents, through the relay,
  with the updates it has sent and received kept per document. The desktop
  app gets the phrase's screens.
