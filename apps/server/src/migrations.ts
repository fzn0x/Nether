// The database's schema, as numbered migrations of plain SQL that run when
// the server starts (ADR 0031). They run in one transaction, under a lock
// every server node takes, so several starting at once apply each once, and
// a failed one leaves the database as it was. A server never starts on a
// database a newer server has migrated, whose schema it would not know.
import type { Database } from "./db.ts";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "accounts, workspaces and their members",
    sql: `
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        -- The address as it is compared: lowercase, so one person has one account.
        email_key text NOT NULL UNIQUE,
        name text NOT NULL,
        -- An argon2id hash, as its encoded string; none for an account that signs in otherwise.
        password_hash text,
        instance_admin boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- A workspace, also called a vault: the unit of sync, permission and encryption.
      CREATE TABLE workspaces (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        encryption text NOT NULL DEFAULT 'none' CHECK (encryption IN ('none', 'end-to-end')),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE memberships (
        workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE INDEX memberships_by_user ON memberships (user_id);
    `,
  },
  {
    version: 2,
    name: "sessions and invitations",
    sql: `
      -- A signed-in client. Only its token's SHA-256 is kept, so this table signs no one in.
      CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        -- The client's User-Agent, for its owner to tell their sessions apart.
        client text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        used_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );

      CREATE INDEX sessions_by_user ON sessions (user_id);

      CREATE TABLE invitations (
        id uuid PRIMARY KEY,
        token_hash text NOT NULL UNIQUE,
        workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
        -- When set, only this address may accept.
        email text,
        invited_by uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        accepted_by uuid REFERENCES users (id) ON DELETE SET NULL,
        accepted_at timestamptz
      );

      CREATE INDEX invitations_by_workspace ON invitations (workspace_id);
    `,
  },
  {
    version: 3,
    name: "sign-in codes",
    sql: `
      -- A code emailed to sign in with, kept as its SHA-256; one per account at a time.
      CREATE TABLE sign_in_codes (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        code_hash text NOT NULL,
        tries integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );

      CREATE INDEX sign_in_codes_by_user ON sign_in_codes (user_id);
    `,
  },
  {
    version: 4,
    name: "identities from OpenID Connect providers",
    sql: `
      -- Who an account is at an identity provider: its issuer and the subject it names.
      CREATE TABLE identities (
        issuer text NOT NULL,
        subject text NOT NULL,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (issuer, subject)
      );

      CREATE INDEX identities_by_user ON identities (user_id);

      -- A sign-in through the provider, from the app's start to the app's
      -- redeeming it. Only hashes of the state and the handoff code are kept.
      CREATE TABLE oidc_flows (
        id uuid PRIMARY KEY,
        state_hash text NOT NULL UNIQUE,
        nonce text NOT NULL,
        -- The server's PKCE verifier, for the provider.
        verifier text NOT NULL,
        -- Where the browser goes back to the app, and the app's own PKCE challenge.
        redirect text NOT NULL,
        challenge text NOT NULL,
        invitation_hash text,
        -- Set once the provider has answered.
        handoff_hash text UNIQUE,
        user_id uuid REFERENCES users (id) ON DELETE CASCADE,
        workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
    `,
  },
  {
    version: 5,
    name: "documents",
    sql: `
      -- Numbers each store of a document, so a client asks what changed since one.
      CREATE SEQUENCE document_seq;

      -- A workspace's Yjs documents, merged: its vault document, named vault,
      -- and each note's, named by the note's ID.
      CREATE TABLE documents (
        workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        name text NOT NULL,
        state bytea NOT NULL,
        seq bigint NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, name)
      );

      CREATE INDEX documents_by_seq ON documents (workspace_id, seq);
    `,
  },
  {
    version: 6,
    name: "end-to-end encryption",
    sql: `
      -- An account's key pair for encrypted workspaces: its public key, and its
      -- private key in a box only its recovery phrase opens, which the server cannot.
      CREATE TABLE user_keys (
        user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        public_key bytea NOT NULL,
        recovery_box bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- An encrypted workspace's key, as a client sealed it to each member's public key.
      CREATE TABLE workspace_keys (
        workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        version integer NOT NULL,
        sealed_key bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id, version)
      );

      -- An encrypted workspace's documents: each update as its client encrypted
      -- it, numbered from the documents' sequence; a snapshot replaces those before it.
      CREATE TABLE encrypted_updates (
        workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        name text NOT NULL,
        seq bigint NOT NULL,
        data bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, name, seq)
      );

      CREATE INDEX encrypted_updates_by_seq ON encrypted_updates (workspace_id, seq);
    `,
  },
  {
    version: 7,
    name: "attachments",
    sql: `
      -- A workspace's files, by the SHA-256 of their bytes, which the blob store keeps.
      CREATE TABLE attachments (
        workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        hash text NOT NULL,
        size bigint NOT NULL,
        content_type text,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, hash)
      );
    `,
  },
];

/** The schema version this server writes and reads. */
export const schemaVersion = migrations.length;

/** A database a newer server has migrated. */
export class NewerDatabase extends Error {
  readonly found: number;

  constructor(found: number) {
    super(
      `The database's schema is at version ${String(found)}, newer than this server's ${String(schemaVersion)}: run the newer server, or restore a backup.`,
    );
    this.name = "NewerDatabase";
    this.found = found;
  }
}

/** The lock every node takes to migrate, by a number of Nether's own. */
const migrationLock = 7_446_872_101;

/** Brings the database to this server's schema, and says from which version to which. */
export async function migrate(
  db: Database,
): Promise<{ readonly from: number; readonly to: number }> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [migrationLock]);
    await tx.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await tx.query("SELECT max(version) AS version FROM schema_migrations");
    const from = Number(rows[0]?.version ?? 0);
    if (from > schemaVersion) throw new NewerDatabase(from);
    for (const migration of migrations) {
      if (migration.version <= from) continue;
      await tx.query(migration.sql);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [
        migration.version,
        migration.name,
      ]);
    }
    return { from, to: schemaVersion };
  });
}
