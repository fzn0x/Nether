# 0039. Attachments are kept by their hash, on disk or in an S3-compatible bucket

- Status: Accepted
- Date: 2026-10-31

## Context

Notes embed images, PDFs, audio and video, kept beside them in the vault
as files ([ADR 0010](0010-vault-files-in-notes.md)). Sync
([ADR 0037](0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md))
carries notes' text, not those files. The
[requirements](../requirements.md#storage-sync-and-offline) ask for
attachments "Stored on local disk or S3-compatible storage; deduplicated
by content hash".

Several forces shape the design:

- **Hosting.** A small install keeps everything on one disk. A larger one,
  or several server nodes, keeps files in object storage: MinIO, Garage,
  Cloudflare R2 or Amazon S3.
- **Duplicates.** The same image is pasted into many notes, and every
  device that syncs a vault sends it.
- **Encryption.** An encrypted workspace's files must stay unreadable to
  the server too
  ([ADR 0038](0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md)).
- **Uploads.** A file anyone in a workspace sends could be a page with a
  script, which must not run when someone opens it.

## Decision

**A file is named by the SHA-256 of its bytes, within its workspace.**

- `PUT /api/workspaces/:id/attachments/:hash` takes the bytes, and the
  server checks they hash to the name.
- `HEAD` on the same address tells a client whether to send the file at
  all. `GET` gives it back.
- A file is kept once per workspace, however many notes and devices send
  it. The `attachments` table records its size and media type.
- Files are not shared across workspaces. A hash that answered in any
  workspace would tell someone outside it that a file exists there.
- An encrypted workspace's client sends ciphertext, named by the
  ciphertext's hash. The client-side encryption comes with attachments'
  sync, the next pull request.

**Two stores, one interface (`BlobStore`):**

| Store | Chosen by | Keeps a file at |
| --- | --- | --- |
| A folder on the server's disk | default, at `NETHER_STORAGE_PATH` | `<workspace>/<first two characters of the hash>/<hash>`, written to a temporary file and renamed into place, so no one reads half a file |
| An S3-compatible bucket | `NETHER_STORAGE=s3`, with its endpoint, bucket, region and keys | `<bucket>/<workspace>/<hash>`, addressed by path as MinIO, Garage and R2 expect, signed with AWS Signature Version 4 by `aws4fetch` (MIT, no dependencies) |

A file already stored is never written again.

**Files are served so they cannot act.** They are sent with their media
type, `nosniff`, and a content security policy of
`default-src 'none'; sandbox`, so an SVG or HTML file runs nothing and
loads nothing. They are cached as immutable, since a file's name is its
content.

**Uploads are limited.** `NETHER_ATTACHMENT_LIMIT`, 100 MiB by default,
caps one file. Guests may read files but not send them.

## Alternatives

- **The AWS SDK, or MinIO's client.** Both work, but the SDK's S3 client
  brings eleven packages and MinIO's thirteen, for four calls the server
  makes. aws4fetch signs the requests of the fetch the server already has.
- **Files in PostgreSQL.** Simple, and backed up with everything else, but
  large objects bloat the database and its backups, and object storage is
  what scales.
- **Files deduplicated across all workspaces.** It saves more space, and
  tells any member of any workspace whether a file exists anywhere on the
  server.
- **Files served as downloads only.** It is safe, but notes could not show
  images. The sandboxing policy makes inline serving safe instead.

## Consequences

- A file no note embeds any more stays stored. Collecting unreferenced
  files comes with version history and backups, which know what is still
  referenced.
- The next pull request syncs attachments: the vault document lists them by
  path and hash, and the engine sends and fetches them, encrypted for an
  encrypted workspace.
- `docker compose` will name a volume for the disk store, or a MinIO
  service for the S3 one.
