# 0052. Backups are the server's own files, restored at their schema, then migrated

- Status: Accepted
- Date: 2026-11-01

## Context

The [requirements](../requirements.md#apps-and-deployment) ask, in
Phase 3, for built-in, scheduled backups of the database and the files, to
disk or S3, with a documented restore procedure tested in CI; and for
migrations that run on their own and are safe to skip versions within one
major release.

The server keeps its data in PostgreSQL
([ADR 0031](0031-the-server-keeps-its-data-in-postgresql-and-is-set-up-with-a-code-from-its-log.md))
and its attachments on disk or in an S3-compatible bucket
([ADR 0039](0039-attachments-are-kept-by-their-hash-on-disk-or-in-an-s3-bucket.md)).
The usual backup of PostgreSQL is `pg_dump`, a program of its own whose
major version must be at least the server's, installed beside Nether, and
which knows nothing of the attachments.

## Decision

**A backup is a file the server writes itself**: gzipped JSON lines, a
header naming the format and the schema version, then each table, in the
order its foreign keys need, a line naming its columns and their types and
a line a row; then the sequences' values; then each attachment's bytes. It
is read in one read-only, repeatable-read transaction, so it holds what was
committed when it began. Columns the database works out, as search's
`tsvector`, are left out; its migrations' own record is too.

**A restore is into an empty database**: the database is migrated to the
schema version the backup names, its rows loaded in one transaction, rows a
migration put there replaced, sequences set, attachments put back, and then
migrated to this server's schema. A backup thus restores into the server
that made it and any later one of the major release. A database with data
is refused, so nothing is overwritten by mistake; a backup of a newer
schema is refused with what to do.

**Migrations take a version to stop at**, which a restore uses; without
it they go to the server's, every version in between in order, in one
transaction under one lock, as before.

**Scheduled backups** are off unless `NETHER_BACKUP` is `disk` or `s3`: one
every `NETHER_BACKUP_HOURS` (24), the newest `NETHER_BACKUP_KEEP` (7) kept.
A one-row table records when the last began; a node claims the next by
moving it on in one statement where it is due, so of several nodes one
makes each backup, and one that fails gives its claim back. Backups to S3
use the attachments' credentials, in a bucket and prefix of their own.

**An admin command**, `node dist/admin.js`, makes a backup now, lists
those kept, and restores one. CI runs the documented procedure as written:
a backup made with it from a real PostgreSQL, restored with it into a new
schema there, and the two compared; the server's tests restore a full
server, attachments included, and one made at an older schema.

## Alternatives

- **`pg_dump` and a copy of the attachments**: the standard tool, faster on
  large databases, but another program whose version must match, two
  procedures, and nothing to check that the attachments match the rows.
- **Backing up the attachments' bucket by the bucket's own means**: right
  for S3, which keeps its own copies, but not for a disk; a backup holding
  both is one thing to keep and restore.
- **Restoring into a database with data, merging**: what an admin may want
  after losing part of it, but a backup is all of a server; merging is a
  migration of its own.

## Consequences

- A backup is larger than `pg_dump`'s, its bytes in base64, then gzipped.
- Restoring holds one attachment in memory at a time, and the rows of one
  batch; a backup of any size restores.
- An admin who prefers `pg_dump` still can: nothing of the database is
  kept outside PostgreSQL but the attachments.
