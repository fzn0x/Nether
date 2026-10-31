// Sync (ADR 0035). Each note's Yjs document, and each workspace's vault
// document, which lists its notes, syncs over one WebSocket per client at
// /api/sync, through Hocuspocus. A client signs each document in with its
// session's token: a workspace's members sync its documents, and its guests
// only read them. A document is kept in PostgreSQL as its state, numbered
// from one sequence each time it is stored, so a client that was away asks
// which documents changed since the last number it saw and syncs those
// alone; a client syncing the vault document hears of each note as it is
// stored. Storing a note keeps the state it replaces as a version, now and
// then (ADR 0041). Each sync unit (ADR 0042) has a vault document of its own;
// a document opens at its unit's level for the account, read-only below edit,
// and the list of stored documents names only those of the account's units.
import websocket from "@fastify/websocket";
import { Hocuspocus } from "@hocuspocus/server";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { type Database, readBytes, readCount, readText } from "./db.ts";
import { fail, uuidField } from "./http.ts";
import { indexNote, indexPaths } from "./search.ts";
import { sessionAccount, signedIn, accountOf } from "./sessions.ts";
import {
  type VaultEditor,
  accessible,
  general,
  unitOfDocument,
  vaultDocument,
  writesAt,
} from "./units.ts";
import { membership } from "./workspaces.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const namePattern = new RegExp(`^(${uuid})/(vault|vault\\.${uuid}|${uuid}(?:\\.comments)?)$`);

/**
 * A document's name: its workspace's ID, then `vault`, `vault.` and a unit's
 * ID, a note's ID, or a note's ID and `.comments` for its comments (ADR 0044).
 */
export interface DocumentName {
  readonly workspaceId: string;
  readonly document: string;
}

export function parseDocumentName(name: string): DocumentName | undefined {
  const match = namePattern.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { workspaceId: match[1], document: match[2] };
}

/** Whether a document is a note's comments, beside it (ADR 0044). */
export function isComments(document: string): boolean {
  return document.endsWith(".comments");
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

/**
 * Stores a document's state under a new number, and gives the number. For a
 * note, the state it replaces is first kept as a version when the note's
 * last version is ten minutes old, so its history has it as it was before
 * each spell of editing.
 */
export async function storeDocument(
  db: Database,
  workspaceId: string,
  document: string,
  state: Uint8Array,
): Promise<number> {
  return db.transaction(async (tx) => {
    // A vault document's paths are compared with the state it replaces (ADR 0050).
    const before = document.startsWith("vault")
      ? await tx.query("SELECT state FROM documents WHERE workspace_id = $1 AND name = $2", [
          workspaceId,
          document,
        ])
      : undefined;
    if (!document.startsWith("vault") && !isComments(document)) {
      await tx.query(
        `INSERT INTO document_versions (workspace_id, name, state)
         SELECT workspace_id, name, state FROM documents
         WHERE workspace_id = $1 AND name = $2 AND state <> $3
           AND NOT EXISTS (
             SELECT 1 FROM document_versions
             WHERE workspace_id = $1 AND name = $2
               AND created_at > now() - interval '10 minutes'
           )`,
        [workspaceId, document, state],
      );
    }
    const { rows } = await tx.query(
      `INSERT INTO documents (workspace_id, name, state, seq)
       VALUES ($1, $2, $3, nextval('document_seq'))
       ON CONFLICT (workspace_id, name)
         DO UPDATE SET state = excluded.state, seq = excluded.seq, updated_at = now()
       RETURNING seq`,
      [workspaceId, document, state],
    );
    // What search reads, kept with the state, so the two never disagree.
    if (before !== undefined) {
      const unit = document === "vault" ? general : document.slice("vault.".length);
      const old = before.rows[0] === undefined ? undefined : readBytes(before.rows[0], "state");
      await indexPaths(tx, workspaceId, unit, state, old);
    } else if (!isComments(document)) {
      await indexNote(tx, workspaceId, document, state);
    }
    return readCount(rows[0], "seq");
  });
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

/** What the rest of the server asks of sync. */
export interface SyncControl extends VaultEditor {
  /** Closes an account's connections, so its apps connect again and are checked anew. */
  disconnect(userId: string): void;
}

/** Whether a path is under a folder, `folder` ending with a slash, in any case. */
function under(path: string, folder: string): boolean {
  return path.toLowerCase().startsWith(folder.toLowerCase());
}

export async function registerSync(app: FastifyInstance, db: Database): Promise<SyncControl> {
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
      if (account === undefined || name === undefined || member?.encryption !== "none") {
        throw new Error("Sign in, as a member of this document's workspace.");
      }
      const unit = await unitOfDocument(db, name.workspaceId, name.document);
      const level = (await accessible(db, account.id, name.workspaceId)).levels.get(unit);
      // A document of a unit the account may not open is refused as one not there.
      if (level === undefined)
        throw new Error("Sign in, as a member of this document's workspace.");
      // A note's comments take comments from those who may comment, and edit or more.
      const writes = isComments(name.document) ? level !== "view" : writesAt(level);
      if (!writes) connectionConfig.readOnly = true;
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
      const seq = await storeDocument(
        db,
        name.workspaceId,
        name.document,
        Y.encodeStateAsUpdate(document),
      );
      if (name.document.startsWith("vault")) return;
      const stored: Stored = { type: "stored", document: name.document, seq };
      // Told only to those syncing the note's own unit.
      const unit = await unitOfDocument(db, name.workspaceId, name.document);
      hocuspocus.documents
        .get(`${name.workspaceId}/${vaultDocument(unit)}`)
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
      // Only the documents of the units the account opens: the others' names stay hidden.
      const opens = [...(await accessible(db, accountOf(request).id, workspace)).levels.keys()];
      const { rows } = await db.query(
        `SELECT name, seq FROM (
           SELECT name, seq FROM documents WHERE workspace_id = $1 AND seq > $2
           UNION ALL
           SELECT name, max(seq) AS seq FROM encrypted_updates
            WHERE workspace_id = $1 AND seq > $2 GROUP BY name
         ) stored
         WHERE CASE
                 WHEN name = 'vault' THEN $4
                 WHEN name LIKE 'vault.%' THEN substr(name, 7)
                 ELSE coalesce(
                   (SELECT unit_id::text FROM note_units n
                     WHERE n.workspace_id = $1
                       AND n.note = regexp_replace(stored.name, '[.]comments$', '')),
                   $4)
               END = ANY($5::text[])
         ORDER BY seq LIMIT $3`,
        [workspace, request.query.since ?? 0, pageSize + 1, general, opens],
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
  // A few seconds at most: a server stopping does not wait on a document
  // that will not unload, and says so.
  app.addHook("onClose", async () => {
    if (hocuspocus.getDocumentsCount() === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unloaded = await Promise.race([
      new Promise<boolean>((resolve) => {
        hocuspocus.configuration.extensions.push({
          async afterUnloadDocument({ instance }) {
            if (instance.getDocumentsCount() === 0) resolve(true);
            return Promise.resolve();
          },
        });
        hocuspocus.closeConnections();
        hocuspocus.flushPendingStores();
      }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, 5000);
      }),
    ]);
    clearTimeout(timer);
    if (!unloaded) {
      app.log.warn(
        { documents: hocuspocus.getDocumentsCount() },
        "Stopped after five seconds of waiting for open documents to be stored and closed",
      );
    }
  });

  /** Changes a vault document as a member's app would: those syncing it hear at once. */
  async function editVault(
    workspaceId: string,
    unit: string,
    change: (document: Y.Doc) => void,
  ): Promise<void> {
    const connection = await hocuspocus.openDirectConnection(
      `${workspaceId}/${vaultDocument(unit)}`,
      { userId: "" },
    );
    try {
      await connection.transact(change);
    } finally {
      // Let go, it is stored.
      await connection.disconnect();
    }
  }

  return {
    async merge(workspaceId, from, into) {
      let notes: [string, unknown][] = [];
      let files: [string, unknown][] = [];
      await editVault(workspaceId, from, (document) => {
        notes = [...document.getMap("notes").entries()];
        files = [...document.getMap("files").entries()];
      });
      await editVault(workspaceId, into, (document) => {
        const listed = document.getMap("notes");
        for (const [id, path] of notes) if (!listed.has(id)) listed.set(id, path);
        const kept = document.getMap("files");
        for (const [path, file] of files) if (!kept.has(path)) kept.set(path, file);
      });
    },

    async rename(workspaceId, unit, from, to) {
      await editVault(workspaceId, unit, (document) => {
        const notes = document.getMap<string>("notes");
        for (const [id, path] of [...notes.entries()]) {
          if (under(path, from)) notes.set(id, to + path.slice(from.length));
        }
        const files = document.getMap("files");
        for (const [path, file] of [...files.entries()]) {
          if (!under(path, from)) continue;
          files.delete(path);
          files.set(to + path.slice(from.length), file);
        }
      });
    },

    disconnect(userId) {
      for (const document of hocuspocus.documents.values()) {
        for (const connection of document.getConnections()) {
          const context = connection.context as Partial<SyncContext> | undefined;
          // The socket, with every document on it: the app connects again.
          if (context?.userId === userId) connection.webSocket.close(4403, "Access changed");
        }
      }
    },
  };
}
