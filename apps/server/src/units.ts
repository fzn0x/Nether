// Sync units (ADR 0042): General, teamspaces, private spaces and shared
// pages, each with its own vault document and the people who may open it,
// at full access, edit, comment or view. Which unit a note is in is the
// server's record: a note it does not name is in General. A note moves
// between units only by a request the server checks.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { type Database, type Queryable, readText, readTextOrNull } from "./db.ts";
import { fail, uuidField } from "./http.ts";
import { accountOf, signedIn } from "./sessions.ts";
import { membership } from "./workspaces.ts";

export type Level = "view" | "comment" | "edit" | "full";

const levels: readonly Level[] = ["view", "comment", "edit", "full"];

/** General's key, beside the units' IDs. */
export const general = "general";

/** The higher of two levels; undefined is none. */
function higher(a: Level | undefined, b: Level | undefined): Level | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return levels.indexOf(a) >= levels.indexOf(b) ? a : b;
}

/** Whether a level may change a unit's notes. */
export function writesAt(level: Level | undefined): boolean {
  return level === "edit" || level === "full";
}

function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (levels as readonly string[]).includes(value);
}

/** A unit as the server keeps it. */
export interface Unit {
  readonly id: string;
  readonly kind: "team" | "private" | "page";
  readonly name: string | null;
  readonly ownerId: string | null;
  readonly rootNote: string | null;
  readonly parentId: string | null;
  readonly restricted: boolean;
}

function unitOf(row: Record<string, unknown>): Unit {
  const kind = readText(row, "kind");
  return {
    id: readText(row, "id"),
    kind: kind === "private" ? "private" : kind === "page" ? "page" : "team",
    name: readTextOrNull(row, "name"),
    ownerId: readTextOrNull(row, "owner_id"),
    rootNote: readTextOrNull(row, "root_note"),
    parentId: readTextOrNull(row, "parent_id"),
    restricted: row.restricted === true,
  };
}

/**
 * The units an account may open in a workspace, General's key among them,
 * each with its level; empty for one not in the workspace.
 */
export async function accessible(
  db: Queryable,
  userId: string,
  workspaceId: string,
): Promise<{ readonly levels: Map<string, Level>; readonly units: Map<string, Unit> }> {
  const found = new Map<string, Level>();
  const member = await membership(db, userId, workspaceId);
  if (member === undefined) return { levels: found, units: new Map() };
  const { rows } = await db.query(
    `SELECT u.id, u.kind, u.name, u.owner_id, u.root_note, u.parent_id, u.restricted, g.level
       FROM units u LEFT JOIN unit_grants g ON g.unit_id = u.id AND g.user_id = $2
      WHERE u.workspace_id = $1`,
    [workspaceId, userId],
  );
  const units = new Map(rows.map((row) => [readText(row, "id"), unitOf(row)]));
  const granted = new Map(
    rows.flatMap((row) => (isLevel(row.level) ? [[readText(row, "id"), row.level] as const] : [])),
  );
  // Guests never open General; everyone else has full access to it.
  if (member.role !== "guest") found.set(general, "full");
  const levelOf = (id: string | null, depth: number): Level | undefined => {
    if (id === null) return found.get(general);
    const unit = units.get(id);
    // A tree deeper than any vault's, or a loop, opens nothing.
    if (unit === undefined || depth > 64) return undefined;
    const grant = granted.get(id);
    if (unit.kind === "private") return unit.ownerId === userId ? "full" : undefined;
    if (unit.kind === "team") return member.role === "guest" ? undefined : grant;
    return unit.restricted ? grant : higher(grant, levelOf(unit.parentId, depth + 1));
  };
  for (const id of units.keys()) {
    const level = levelOf(id, 0);
    if (level !== undefined) found.set(id, level);
  }
  return { levels: found, units };
}

/** The unit a document belongs to: a vault document's own, or the one the record gives a note. */
export async function unitOfDocument(
  db: Queryable,
  workspaceId: string,
  document: string,
): Promise<string> {
  if (document === "vault") return general;
  if (document.startsWith("vault.")) return document.slice("vault.".length);
  const { rows } = await db.query(
    "SELECT unit_id FROM note_units WHERE workspace_id = $1 AND note = $2",
    [workspaceId, document],
  );
  return rows.length === 0 ? general : readText(rows[0], "unit_id");
}

/** A unit's vault document's name, after the workspace's ID. */
export function vaultDocument(unit: string): string {
  return unit === general ? "vault" : `vault.${unit}`;
}

/** Whether a text has a control character, below the space. */
function hasControl(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) < 0x20) return true;
  }
  return false;
}

/** A name a top-level folder can have on every system, and not `Private`, which private spaces take. */
function isFolderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !/[/\\:*?"<>|]/.test(name) &&
    !hasControl(name) &&
    !name.startsWith(".") &&
    !name.endsWith(".") &&
    !name.endsWith(" ") &&
    name.trim() === name &&
    name.toLowerCase() !== "private"
  );
}

interface WorkspaceParams {
  readonly workspace: string;
}

interface UnitParams extends WorkspaceParams {
  readonly unit: string;
}

interface GrantParams extends UnitParams {
  readonly user: string;
}

interface NoteParams extends WorkspaceParams {
  readonly note: string;
}

const workspaceParams = {
  type: "object",
  required: ["workspace"],
  properties: { workspace: uuidField },
} as const;

const unitParams = {
  type: "object",
  required: ["workspace", "unit"],
  properties: { workspace: uuidField, unit: uuidField },
} as const;

const grantParams = {
  type: "object",
  required: ["workspace", "unit", "user"],
  properties: { workspace: uuidField, unit: uuidField, user: uuidField },
} as const;

const noteParams = {
  type: "object",
  required: ["workspace", "note"],
  properties: { workspace: uuidField, note: uuidField },
} as const;

const nameBody = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

const levelBody = {
  type: "object",
  required: ["level"],
  additionalProperties: false,
  properties: { level: { type: "string", enum: levels } },
} as const;

const placeBody = {
  type: "object",
  required: ["unit"],
  additionalProperties: false,
  properties: {
    unit: { type: "string", pattern: `^(general|${uuidField.pattern.slice(1, -1)})$` },
  },
} as const;

const noWorkspace = "This account is in no such workspace.";
const noUnit = "This account has no such space or page here.";
const badName =
  "A teamspace's name is its folder's: it has none of / \\ : * ? \" < > |, does not start with a dot, and is not Private.";

/** What the account may see of a unit, and how its app syncs it. */
function shown(id: string, unit: Unit | undefined, level: Level) {
  return {
    id,
    kind: unit?.kind ?? "general",
    level,
    document: vaultDocument(id),
    ...(unit?.kind === "team" ? { name: unit.name } : {}),
    ...(unit?.kind === "private" ? { folder: "Private" } : {}),
    ...(unit?.kind === "page" ? { rootNote: unit.rootNote, restricted: unit.restricted } : {}),
  };
}

/**
 * The units' routes. `changed` hears of each account whose access changed,
 * to close its connections, so its apps ask for their units again.
 */
export function registerUnits(
  app: FastifyInstance,
  db: Database,
  changed: (userId: string) => void,
): void {
  const account = signedIn(db);

  app.get<{ Params: WorkspaceParams }>(
    "/api/workspaces/:workspace/units",
    { schema: { params: workspaceParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      if ((await membership(db, accountOf(request).id, workspace)) === undefined) {
        return fail(reply, 404, noWorkspace);
      }
      const { levels: found, units } = await accessible(db, accountOf(request).id, workspace);
      return {
        units: [...found].map(([id, level]) => shown(id, units.get(id), level)),
      };
    },
  );

  app.post<{ Params: WorkspaceParams; Body: { readonly name: string } }>(
    "/api/workspaces/:workspace/teamspaces",
    { schema: { params: workspaceParams, body: nameBody }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const me = accountOf(request).id;
      const place = await membership(db, me, workspace);
      if (place === undefined) return fail(reply, 404, noWorkspace);
      if (place.role === "guest") return fail(reply, 403, "Guests make no teamspaces.");
      if (place.encryption !== "none") {
        return fail(reply, 409, "An encrypted workspace has no teamspaces yet.");
      }
      const { name } = request.body;
      if (!isFolderName(name)) return fail(reply, 400, badName);
      const made = await db.transaction(async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO units (id, workspace_id, kind, name) VALUES ($3, $1, 'team', $2)
           ON CONFLICT DO NOTHING RETURNING id`,
          [workspace, name, randomUUID()],
        );
        if (rows.length === 0) return undefined;
        const id = readText(rows[0], "id");
        await tx.query(
          "INSERT INTO unit_grants (unit_id, user_id, level) VALUES ($1, $2, 'full')",
          [id, me],
        );
        return id;
      });
      if (made === undefined) return fail(reply, 409, "A teamspace has that name already.");
      changed(me);
      return reply
        .code(201)
        .send({ id: made, kind: "team", name, level: "full", document: vaultDocument(made) });
    },
  );

  /** A unit the account has full access to, or the reply's refusal. */
  async function managed(userId: string, workspace: string, unit: string) {
    const { levels: found, units } = await accessible(db, userId, workspace);
    const level = found.get(unit);
    const kept = units.get(unit);
    if (level === undefined || kept === undefined) return [404, noUnit] as const;
    if (level !== "full") return [403, "Only those with full access change it."] as const;
    return kept;
  }

  app.patch<{ Params: UnitParams; Body: { readonly name: string } }>(
    "/api/workspaces/:workspace/teamspaces/:unit",
    { schema: { params: unitParams, body: nameBody }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const unit = await managed(
        accountOf(request).id,
        workspace,
        request.params.unit.toLowerCase(),
      );
      if (!("id" in unit)) return fail(reply, unit[0], unit[1]);
      if (unit.kind !== "team") return fail(reply, 404, noUnit);
      const { name } = request.body;
      if (!isFolderName(name)) return fail(reply, 400, badName);
      const { rows } = await db.query(
        `UPDATE units SET name = $3 WHERE id = $1 AND workspace_id = $2
           AND NOT EXISTS (SELECT 1 FROM units WHERE workspace_id = $2 AND kind = 'team'
                             AND lower(name) = lower($3) AND id <> $1)
         RETURNING id`,
        [unit.id, workspace, name],
      );
      if (rows.length === 0) return fail(reply, 409, "A teamspace has that name already.");
      return { id: unit.id, name };
    },
  );

  app.delete<{ Params: UnitParams }>(
    "/api/workspaces/:workspace/teamspaces/:unit",
    { schema: { params: unitParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const unit = await managed(
        accountOf(request).id,
        workspace,
        request.params.unit.toLowerCase(),
      );
      if (!("id" in unit)) return fail(reply, unit[0], unit[1]);
      if (unit.kind !== "team") return fail(reply, 404, noUnit);
      const { rows: people } = await db.query(
        "SELECT user_id FROM unit_grants WHERE unit_id = $1",
        [unit.id],
      );
      // Its notes would fall to General, where everyone sees them: move or delete them first.
      const { rows } = await db.query(
        `DELETE FROM units WHERE id = $1
           AND NOT EXISTS (SELECT 1 FROM note_units WHERE unit_id = $1)
         RETURNING id`,
        [unit.id],
      );
      if (rows.length === 0) {
        return fail(reply, 409, "The teamspace still has notes: move or delete them first.");
      }
      for (const person of people) changed(readText(person, "user_id"));
      return reply.code(204).send();
    },
  );

  app.put<{ Params: GrantParams; Body: { readonly level: Level } }>(
    "/api/workspaces/:workspace/units/:unit/grants/:user",
    { schema: { params: grantParams, body: levelBody }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const user = request.params.user.toLowerCase();
      const unit = await managed(
        accountOf(request).id,
        workspace,
        request.params.unit.toLowerCase(),
      );
      if (!("id" in unit)) return fail(reply, unit[0], unit[1]);
      if (unit.kind === "private")
        return fail(reply, 400, "A private space is its member's alone.");
      const them = await membership(db, user, workspace);
      if (them === undefined) return fail(reply, 404, "This workspace has no such member.");
      if (them.role === "guest" && unit.kind === "team") {
        return fail(reply, 400, "Guests join pages, not teamspaces.");
      }
      await db.query(
        `INSERT INTO unit_grants (unit_id, user_id, level) VALUES ($1, $2, $3)
         ON CONFLICT (unit_id, user_id) DO UPDATE SET level = excluded.level`,
        [unit.id, user, request.body.level],
      );
      changed(user);
      return { user, level: request.body.level };
    },
  );

  app.delete<{ Params: GrantParams }>(
    "/api/workspaces/:workspace/units/:unit/grants/:user",
    { schema: { params: grantParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const user = request.params.user.toLowerCase();
      const unit = await managed(
        accountOf(request).id,
        workspace,
        request.params.unit.toLowerCase(),
      );
      if (!("id" in unit)) return fail(reply, unit[0], unit[1]);
      const outcome = await db.transaction(async (tx) => {
        const { rows } = await tx.query(
          "SELECT user_id, level FROM unit_grants WHERE unit_id = $1 FOR UPDATE",
          [unit.id],
        );
        const theirs = rows.find((row) => readText(row, "user_id") === user);
        if (theirs === undefined)
          return [404, "This person has no access of their own here."] as const;
        const full = rows.filter((row) => row.level === "full").length;
        // A teamspace keeps someone who can manage it.
        if (unit.kind === "team" && theirs.level === "full" && full === 1) {
          return [409, "A teamspace keeps someone with full access."] as const;
        }
        await tx.query("DELETE FROM unit_grants WHERE unit_id = $1 AND user_id = $2", [
          unit.id,
          user,
        ]);
        return undefined;
      });
      if (outcome !== undefined) return fail(reply, outcome[0], outcome[1]);
      changed(user);
      return reply.code(204).send();
    },
  );

  app.put<{ Params: WorkspaceParams }>(
    "/api/workspaces/:workspace/private",
    { schema: { params: workspaceParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const me = accountOf(request).id;
      const place = await membership(db, me, workspace);
      if (place === undefined) return fail(reply, 404, noWorkspace);
      if (place.role === "guest") return fail(reply, 403, "Guests have no private space.");
      if (place.encryption !== "none") {
        return fail(reply, 409, "An encrypted workspace has no private spaces yet.");
      }
      await db.query(
        `INSERT INTO units (id, workspace_id, kind, owner_id)
         VALUES ($3, $1, 'private', $2) ON CONFLICT DO NOTHING`,
        [workspace, me, randomUUID()],
      );
      const { rows } = await db.query(
        "SELECT id FROM units WHERE workspace_id = $1 AND kind = 'private' AND owner_id = $2",
        [workspace, me],
      );
      const id = readText(rows[0], "id");
      changed(me);
      return { id, kind: "private", folder: "Private", level: "full", document: vaultDocument(id) };
    },
  );

  app.put<{ Params: NoteParams; Body: { readonly unit: string } }>(
    "/api/workspaces/:workspace/notes/:note/unit",
    { schema: { params: noteParams, body: placeBody }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const note = request.params.note.toLowerCase();
      const target = request.body.unit.toLowerCase();
      const { levels: found } = await accessible(db, accountOf(request).id, workspace);
      if (found.size === 0) return fail(reply, 404, noWorkspace);
      const current = await unitOfDocument(db, workspace, note);
      // Leaving one unit and entering another both change notes.
      if (!writesAt(found.get(current)) || !writesAt(found.get(target))) {
        return fail(reply, 403, "Moving a note takes edit access where it is and where it goes.");
      }
      if (target === general) {
        await db.query("DELETE FROM note_units WHERE workspace_id = $1 AND note = $2", [
          workspace,
          note,
        ]);
      } else {
        await db.query(
          `INSERT INTO note_units (workspace_id, note, unit_id) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, note) DO UPDATE SET unit_id = excluded.unit_id`,
          [workspace, note, target],
        );
      }
      return { note, unit: target };
    },
  );
}
