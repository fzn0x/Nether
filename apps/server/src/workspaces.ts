// Workspaces (ADRs 0032 and 0038): an account's place in one, and making
// one, encrypted from the client or not, owned by its maker. An encrypted
// workspace's key is sealed by clients to each member's public key; the
// server keeps the sealed copies, which it cannot open, and lists the
// members still waiting for theirs.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { type Database, type Queryable, readBytes, readNumber, readText } from "./db.ts";
import { fail, nameField, uuidField } from "./http.ts";
import { accountOf, signedIn } from "./sessions.ts";

export type Encryption = "none" | "end-to-end";

/** An account's place in a workspace. */
export interface Membership {
  readonly role: string;
  readonly encryption: Encryption;
}

/** An account's role in a workspace, and whether the workspace is encrypted. */
export async function membership(
  db: Queryable,
  userId: string,
  workspaceId: string,
): Promise<Membership | undefined> {
  const { rows } = await db.query(
    `SELECT m.role, w.encryption FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [workspaceId, userId],
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    role: readText(row, "role"),
    encryption: readText(row, "encryption") === "end-to-end" ? "end-to-end" : "none",
  };
}

/** Whether a role may change a workspace's notes. */
export function writes(role: string): boolean {
  return role !== "guest";
}

/** Bytes in base64, of at most a length; undefined when not. */
export function base64Bytes(text: string, max: number): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(text, "base64");
  return bytes.length === 0 || bytes.length > max ? undefined : new Uint8Array(bytes);
}

const base64Field = { type: "string", minLength: 4, maxLength: 1024 } as const;

/** A public key's bytes: X25519's 32. */
const publicKeyLength = 32;
/** A sealed workspace key or a private key's box: small, a few hundred bytes at most. */
const boxLimit = 256;

interface Keys {
  readonly publicKey: string;
  readonly recoveryBox: string;
}

interface NewWorkspace {
  readonly name: string;
  readonly encryption?: Encryption;
  readonly sealedKey?: string;
}

interface Sealed {
  readonly version: number;
  readonly sealedKey: string;
}

const workspaceParams = {
  type: "object",
  required: ["workspace"],
  properties: { workspace: uuidField },
} as const;

export function registerWorkspaces(app: FastifyInstance, db: Database): void {
  const account = signedIn(db);

  // An account's key pair: its public key, and its private key in a box only
  // its recovery phrase opens. Kept once; a second would strand the keys
  // sealed to the first.
  app.put<{ Body: Keys }>(
    "/api/me/keys",
    {
      schema: {
        body: {
          type: "object",
          required: ["publicKey", "recoveryBox"],
          additionalProperties: false,
          properties: { publicKey: base64Field, recoveryBox: base64Field },
        },
      },
      preHandler: account,
    },
    async (request, reply) => {
      const publicKey = base64Bytes(request.body.publicKey, publicKeyLength);
      const recoveryBox = base64Bytes(request.body.recoveryBox, boxLimit);
      if (publicKey?.length !== publicKeyLength || recoveryBox === undefined) {
        return fail(reply, 400, "That is not a public key and its private key's box.");
      }
      const { rows } = await db.query(
        `INSERT INTO user_keys (user_id, public_key, recovery_box) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
        [accountOf(request).id, publicKey, recoveryBox],
      );
      if (rows.length === 0) return fail(reply, 409, "This account has its keys already.");
      return reply.code(204).send();
    },
  );

  app.get("/api/me/keys", { preHandler: account }, async (request, reply) => {
    const { rows } = await db.query(
      "SELECT public_key, recovery_box FROM user_keys WHERE user_id = $1",
      [accountOf(request).id],
    );
    const row = rows[0];
    if (row === undefined) return fail(reply, 404, "This account has no keys yet.");
    return {
      publicKey: Buffer.from(readBytes(row, "public_key")).toString("base64"),
      recoveryBox: Buffer.from(readBytes(row, "recovery_box")).toString("base64"),
    };
  });

  app.post<{ Body: NewWorkspace }>(
    "/api/workspaces",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: nameField,
            encryption: { type: "string", enum: ["none", "end-to-end"] },
            sealedKey: base64Field,
          },
        },
      },
      preHandler: account,
    },
    async (request, reply) => {
      const me = accountOf(request);
      const encryption = request.body.encryption ?? "none";
      const sealed =
        request.body.sealedKey === undefined
          ? undefined
          : base64Bytes(request.body.sealedKey, boxLimit);
      if (encryption === "end-to-end" && sealed === undefined) {
        return fail(reply, 400, "An encrypted workspace needs its key, sealed to its maker.");
      }
      const outcome = await db.transaction(async (tx) => {
        if (encryption === "end-to-end") {
          const keys = await tx.query("SELECT 1 FROM user_keys WHERE user_id = $1", [me.id]);
          if (keys.rows.length === 0) return undefined;
        }
        const id = randomUUID();
        await tx.query("INSERT INTO workspaces (id, name, encryption) VALUES ($1, $2, $3)", [
          id,
          request.body.name.trim(),
          encryption,
        ]);
        await tx.query(
          "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
          [id, me.id],
        );
        if (sealed !== undefined && encryption === "end-to-end") {
          await tx.query(
            "INSERT INTO workspace_keys (workspace_id, user_id, version, sealed_key) VALUES ($1, $2, 1, $3)",
            [id, me.id, sealed],
          );
        }
        return id;
      });
      if (outcome === undefined) {
        return fail(
          reply,
          409,
          "Turn on encryption for this account before making an encrypted workspace.",
        );
      }
      return reply
        .code(201)
        .send({ id: outcome, name: request.body.name.trim(), role: "owner", encryption });
    },
  );

  // A member's own sealed copy of the workspace's key, at its latest version.
  app.get<{ Params: { workspace: string } }>(
    "/api/workspaces/:workspace/key",
    { schema: { params: workspaceParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const me = accountOf(request);
      const place = await membership(db, me.id, workspace);
      if (place === undefined) return fail(reply, 404, "This account is in no such workspace.");
      if (place.encryption === "none") return { encryption: "none" };
      const { rows } = await db.query(
        `SELECT version, sealed_key FROM workspace_keys WHERE workspace_id = $1 AND user_id = $2
          ORDER BY version DESC LIMIT 1`,
        [workspace, me.id],
      );
      const row = rows[0];
      if (row === undefined) {
        return fail(reply, 404, "No member has sealed this workspace's key for this account yet.");
      }
      return {
        encryption: "end-to-end",
        version: readNumber(row, "version"),
        sealedKey: Buffer.from(readBytes(row, "sealed_key")).toString("base64"),
      };
    },
  );

  // The members waiting for the key: they have a public key, and no copy of the latest version.
  app.get<{ Params: { workspace: string } }>(
    "/api/workspaces/:workspace/keyless",
    { schema: { params: workspaceParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const place = await membership(db, accountOf(request).id, workspace);
      if (place?.encryption !== "end-to-end") {
        return fail(reply, 404, "This account is in no such encrypted workspace.");
      }
      const { rows } = await db.query(
        `SELECT u.id, u.name, k.public_key,
                (SELECT max(version) FROM workspace_keys WHERE workspace_id = $1) AS version
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           JOIN user_keys k ON k.user_id = m.user_id
          WHERE m.workspace_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM workspace_keys w
               WHERE w.workspace_id = $1 AND w.user_id = m.user_id
                 AND w.version = (SELECT max(version) FROM workspace_keys WHERE workspace_id = $1))
          ORDER BY u.name`,
        [workspace],
      );
      return {
        members: rows.map((row) => ({
          userId: readText(row, "id"),
          name: readText(row, "name"),
          publicKey: Buffer.from(readBytes(row, "public_key")).toString("base64"),
          version: readNumber(row, "version"),
        })),
      };
    },
  );

  // A member who has the key seals it for one waiting; a copy kept is never replaced.
  app.put<{ Params: { workspace: string; user: string }; Body: Sealed }>(
    "/api/workspaces/:workspace/keys/:user",
    {
      schema: {
        params: {
          type: "object",
          required: ["workspace", "user"],
          properties: { workspace: uuidField, user: uuidField },
        },
        body: {
          type: "object",
          required: ["version", "sealedKey"],
          additionalProperties: false,
          properties: { version: { type: "integer", minimum: 1 }, sealedKey: base64Field },
        },
      },
      preHandler: account,
    },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const user = request.params.user.toLowerCase();
      const me = accountOf(request);
      const sealed = base64Bytes(request.body.sealedKey, boxLimit);
      if (sealed === undefined) return fail(reply, 400, "That is not a sealed key.");
      const held = await db.query(
        "SELECT 1 FROM workspace_keys WHERE workspace_id = $1 AND user_id = $2 AND version = $3",
        [workspace, me.id, request.body.version],
      );
      if (held.rows.length === 0) {
        return fail(reply, 403, "Only a member who has this version of the key may seal it.");
      }
      if ((await membership(db, user, workspace)) === undefined) {
        return fail(reply, 404, "The workspace has no such member.");
      }
      const { rows } = await db.query(
        `INSERT INTO workspace_keys (workspace_id, user_id, version, sealed_key) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING user_id`,
        [workspace, user, request.body.version, sealed],
      );
      if (rows.length === 0) return fail(reply, 409, "That member has this version of the key.");
      return reply.code(204).send();
    },
  );
}
