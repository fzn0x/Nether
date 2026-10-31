// A note's history on the server (ADR 0041): the states a note had before
// each spell of editing, which sync keeps for the workspaces the server can
// read. Members list them and fetch each as a Yjs state, which their app
// shows as Markdown; they are deleted once older than the admin keeps them
// (NETHER_HISTORY_DAYS).
import type { FastifyInstance } from "fastify";
import { type Database, readBytes, readCount, readTime } from "./db.ts";
import { fail, uuidField } from "./http.ts";
import { accountOf, signedIn } from "./sessions.ts";
import { membership } from "./workspaces.ts";

/** The most versions one answer lists, the latest. */
const listed = 200;

interface NoteParams {
  readonly workspace: string;
  readonly note: string;
}

interface VersionParams extends NoteParams {
  readonly version: string;
}

const noteParams = {
  type: "object",
  required: ["workspace", "note"],
  properties: { workspace: uuidField, note: uuidField },
} as const;

const versionParams = {
  type: "object",
  required: ["workspace", "note", "version"],
  properties: {
    workspace: uuidField,
    note: uuidField,
    version: { type: "string", pattern: "^[1-9][0-9]{0,15}$" },
  },
} as const;

export function registerVersions(app: FastifyInstance, db: Database): void {
  const account = signedIn(db);

  app.get<{ Params: NoteParams }>(
    "/api/workspaces/:workspace/documents/:note/versions",
    { schema: { params: noteParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      if ((await membership(db, accountOf(request).id, workspace)) === undefined) {
        return fail(reply, 404, "This account is in no such workspace.");
      }
      const { rows } = await db.query(
        `SELECT id, created_at FROM document_versions
         WHERE workspace_id = $1 AND name = $2
         ORDER BY created_at DESC, id DESC LIMIT ${String(listed)}`,
        [workspace, request.params.note.toLowerCase()],
      );
      return {
        versions: rows.map((row) => ({
          id: String(readCount(row, "id")),
          time: readTime(row, "created_at").toISOString(),
        })),
      };
    },
  );

  app.get<{ Params: VersionParams }>(
    "/api/workspaces/:workspace/documents/:note/versions/:version",
    { schema: { params: versionParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      if ((await membership(db, accountOf(request).id, workspace)) === undefined) {
        return fail(reply, 404, "This account is in no such workspace.");
      }
      const { rows } = await db.query(
        `SELECT state FROM document_versions
         WHERE id = $1 AND workspace_id = $2 AND name = $3`,
        [request.params.version, workspace, request.params.note.toLowerCase()],
      );
      if (rows.length === 0) return fail(reply, 404, "This note has no such version.");
      return (
        reply
          .header("content-type", "application/octet-stream")
          // A version never changes.
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(Buffer.from(readBytes(rows[0], "state")))
      );
    },
  );
}

/** Deletes the versions older than the server keeps them; gives how many. */
export async function purgeVersions(db: Database, days: number): Promise<number> {
  const { rows } = await db.query(
    "DELETE FROM document_versions WHERE created_at < now() - make_interval(days => $1) RETURNING id",
    [days],
  );
  return rows.length;
}
