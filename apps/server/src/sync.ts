// Sync (ADR 0035). Each note's Yjs document, and each workspace's vault
// document, which lists its notes, syncs over one WebSocket per client at
// /api/sync, through Hocuspocus. A client signs each document in with its
// session's token: a workspace's members sync its documents, and its guests
// only read them. A document is kept in PostgreSQL as its state, numbered
// from one sequence each time it is stored, so a client that was away asks
// which documents changed since the last number it saw and syncs those
// alone; a client syncing the vault document hears of each note as it is
// stored.
import websocket from "@fastify/websocket";
import { Hocuspocus } from "@hocuspocus/server";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { type Database, readBytes, readCount, readText } from "./db.ts";
import { fail, uuidField } from "./http.ts";
import { sessionAccount, signedIn, accountOf } from "./sessions.ts";
import { membership } from "./workspaces.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const namePattern = new RegExp(`^(${uuid})/(vault|${uuid})$`);

/** A document's name: its workspace's ID, then `vault` or the note's ID. */
export interface DocumentName {
  readonly workspaceId: string;
  readonly document: string;
}

export function parseDocumentName(name: string): DocumentName | undefined {
  const match = namePattern.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { workspaceId: match[1], document: match[2] };
}

/** What a sync connection knows of who opened it. */
interface SyncContext {
  readonly userId: string;
}

/** What the vault document's clients hear when a note's document is stored. */
export interface Stored {
  readonly type: "stored";
  readonly document: string;
  readonly seq: number;
}

/** The most documents one answer lists; a client asks again from the last. */
const pageSize = 1000;

interface Changes {
  readonly since?: number;
}

/** The headers of a Node request, as a fetch Request has them. */
function headersOf(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) headers.append(name, item);
    }
  }
  return headers;
}

export async function registerSync(app: FastifyInstance, db: Database): Promise<void> {
  // A note's update may be large, as a pasted image's data is; 16 MiB at most.
  await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

  async function role(userId: string, workspaceId: string): Promise<string | undefined> {
    const { rows } = await db.query(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );
    return rows.length === 0 ? undefined : readText(rows[0], "role");
  }

  const hocuspocus = new Hocuspocus<SyncContext>({
    quiet: true,
    // Stored after two seconds without a change, and at least every ten.
    debounce: 2000,
    maxDebounce: 10_000,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const name = parseDocumentName(documentName);
      const account = token === "" ? undefined : await sessionAccount(db, token);
      const member =
        name === undefined || account === undefined
          ? undefined
          : await membership(db, account.id, name.workspaceId);
      // One answer for each, so a refusal tells nothing of the workspace. An
      // encrypted workspace syncs through the relay, never here, so its
      // notes are never stored in plain text.
      if (account === undefined || member?.encryption !== "none") {
        throw new Error("Sign in, as a member of this document's workspace.");
      }
      if (member.role === "guest") connectionConfig.readOnly = true;
      return { userId: account.id };
    },

    async onLoadDocument({ documentName, document }) {
      const name = parseDocumentName(documentName);
      if (name === undefined) return document;
      const { rows } = await db.query(
        "SELECT state FROM documents WHERE workspace_id = $1 AND name = $2",
        [name.workspaceId, name.document],
      );
      if (rows.length > 0) Y.applyUpdate(document, readBytes(rows[0], "state"));
      return document;
    },

    async onStoreDocument({ documentName, document }) {
      const name = parseDocumentName(documentName);
      if (name === undefined) return;
      const { rows } = await db.query(
        `INSERT INTO documents (workspace_id, name, state, seq)
         VALUES ($1, $2, $3, nextval('document_seq'))
         ON CONFLICT (workspace_id, name)
           DO UPDATE SET state = excluded.state, seq = excluded.seq, updated_at = now()
         RETURNING seq`,
        [name.workspaceId, name.document, Y.encodeStateAsUpdate(document)],
      );
      if (name.document === "vault") return;
      const stored: Stored = {
        type: "stored",
        document: name.document,
        seq: readCount(rows[0], "seq"),
      };
      hocuspocus.documents
        .get(`${name.workspaceId}/vault`)
        ?.broadcastStateless(JSON.stringify(stored));
    },
  });

  app.get("/api/sync", { websocket: true }, (socket, request) => {
    const connection = hocuspocus.handleConnection(
      socket,
      new Request(new URL(request.url, "http://nether"), { headers: headersOf(request.headers) }),
    );
    socket.on("message", (data: Buffer) => {
      connection.handleMessage(new Uint8Array(data));
    });
    socket.on("close", (code: number, reason: Buffer) => {
      connection.handleClose({ code, reason: reason.toString("utf8") });
    });
  });

  // Which of a workspace's documents changed since a number, in order.
  app.get<{ Params: { workspace: string }; Querystring: Changes }>(
    "/api/workspaces/:workspace/documents",
    {
      schema: {
        params: {
          type: "object",
          required: ["workspace"],
          properties: { workspace: uuidField },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { since: { type: "integer", minimum: 0 } },
        },
      },
      preHandler: signedIn(db),
    },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      if ((await role(accountOf(request).id, workspace)) === undefined) {
        return fail(reply, 404, "This account is in no such workspace.");
      }
      const { rows } = await db.query(
        `SELECT name, seq FROM documents WHERE workspace_id = $1 AND seq > $2
         UNION ALL
         SELECT name, max(seq) AS seq FROM encrypted_updates
          WHERE workspace_id = $1 AND seq > $2 GROUP BY name
         ORDER BY seq LIMIT $3`,
        [workspace, request.query.since ?? 0, pageSize + 1],
      );
      const page = rows.slice(0, pageSize);
      return {
        documents: page.map((row) => ({
          name: readText(row, "name"),
          seq: readCount(row, "seq"),
        })),
        more: rows.length > pageSize,
      };
    },
  );

  // Closing the server stores every document first, as Hocuspocus's own does.
  app.addHook("onClose", async () => {
    if (hocuspocus.getDocumentsCount() === 0) return;
    await new Promise<void>((resolve) => {
      hocuspocus.configuration.extensions.push({
        async afterUnloadDocument({ instance }) {
          if (instance.getDocumentsCount() === 0) resolve();
          return Promise.resolve();
        },
      });
      hocuspocus.closeConnections();
      hocuspocus.flushPendingStores();
    });
  });
}
