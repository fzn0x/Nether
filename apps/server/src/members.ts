// A workspace's members: who is in it, and at which role. Owners change
// anyone's role and remove anyone; admins change and remove members and
// guests; anyone may leave. A workspace always keeps an owner. A change
// closes the account's open sync connections, so its apps connect again
// and every document is checked anew: one removed reads nothing more, and
// one made a guest only reads.
import type { FastifyInstance } from "fastify";
import { type Database, type Queryable, readText, readTime } from "./db.ts";
import { fail, uuidField } from "./http.ts";
import { accountOf, signedIn } from "./sessions.ts";
import { membership } from "./workspaces.ts";

const roles = ["owner", "admin", "member", "guest"] as const;
type Role = (typeof roles)[number];

interface WorkspaceParams {
  readonly workspace: string;
}

interface MemberParams extends WorkspaceParams {
  readonly user: string;
}

interface RoleChange {
  readonly role: Role;
}

const workspaceParams = {
  type: "object",
  required: ["workspace"],
  properties: { workspace: uuidField },
} as const;

const memberParams = {
  type: "object",
  required: ["workspace", "user"],
  properties: { workspace: uuidField, user: uuidField },
} as const;

const roleBody = {
  type: "object",
  required: ["role"],
  additionalProperties: false,
  properties: { role: { type: "string", enum: roles } },
} as const;

const noWorkspace = "This account is in no such workspace.";
const noMember = "This workspace has no such member.";
const lastOwner = "A workspace keeps at least one owner: make another member an owner first.";

/** Whether an admin may act on a role: members and guests, not owners or other admins. */
function adminMay(role: string): boolean {
  return role === "member" || role === "guest";
}

/** The workspace's owners, locked until the transaction ends, so two changes cannot leave none. */
async function owners(tx: Queryable, workspace: string): Promise<number> {
  const { rows } = await tx.query(
    "SELECT user_id FROM memberships WHERE workspace_id = $1 AND role = 'owner' FOR UPDATE",
    [workspace],
  );
  return rows.length;
}

/**
 * The members' routes. `changed` hears of each account whose place in a
 * workspace changed, to close its connections.
 */
export function registerMembers(
  app: FastifyInstance,
  db: Database,
  changed: (userId: string) => void,
): void {
  const account = signedIn(db);

  app.get<{ Params: WorkspaceParams }>(
    "/api/workspaces/:workspace/members",
    { schema: { params: workspaceParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const place = await membership(db, accountOf(request).id, workspace);
      if (place === undefined) return fail(reply, 404, noWorkspace);
      if (place.role === "guest") {
        return fail(reply, 403, "A guest sees what is shared with them, not who else is here.");
      }
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.email, m.role, m.created_at
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = $1
          ORDER BY lower(u.name), lower(u.email)`,
        [workspace],
      );
      return {
        members: rows.map((row) => ({
          id: readText(row, "id"),
          name: readText(row, "name"),
          email: readText(row, "email"),
          role: readText(row, "role"),
          joinedAt: readTime(row, "created_at").toISOString(),
        })),
      };
    },
  );

  app.patch<{ Params: MemberParams; Body: RoleChange }>(
    "/api/workspaces/:workspace/members/:user",
    { schema: { params: memberParams, body: roleBody }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const user = request.params.user.toLowerCase();
      const { role } = request.body;
      const me = await membership(db, accountOf(request).id, workspace);
      if (me === undefined) return fail(reply, 404, noWorkspace);
      if (me.role !== "owner" && me.role !== "admin") {
        return fail(reply, 403, "Only the workspace's owners and admins change roles.");
      }
      const outcome = await db.transaction(async (tx) => {
        const count = await owners(tx, workspace);
        const { rows } = await tx.query(
          "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
          [workspace, user],
        );
        if (rows.length === 0) return [404, noMember] as const;
        const current = readText(rows[0], "role");
        if (me.role === "admin" && !(adminMay(current) && adminMay(role))) {
          return [403, "An admin changes members and guests; owners change the rest."] as const;
        }
        if (current === "owner" && role !== "owner" && count === 1)
          return [409, lastOwner] as const;
        if (current !== role) {
          await tx.query(
            "UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2",
            [workspace, user, role],
          );
        }
        return current === role ? "same" : "changed";
      });
      if (typeof outcome !== "string") return fail(reply, outcome[0], outcome[1]);
      if (outcome === "changed") changed(user);
      return { id: user, role };
    },
  );

  app.delete<{ Params: MemberParams }>(
    "/api/workspaces/:workspace/members/:user",
    { schema: { params: memberParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const user = request.params.user.toLowerCase();
      const myId = accountOf(request).id;
      const me = await membership(db, myId, workspace);
      if (me === undefined) return fail(reply, 404, noWorkspace);
      const leaving = user === myId;
      const outcome = await db.transaction(async (tx) => {
        const count = await owners(tx, workspace);
        const { rows } = await tx.query(
          "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
          [workspace, user],
        );
        if (rows.length === 0) return [404, noMember] as const;
        const role = readText(rows[0], "role");
        const allowed = leaving || me.role === "owner" || (me.role === "admin" && adminMay(role));
        if (!allowed) {
          return [403, "Owners remove anyone, admins remove members and guests."] as const;
        }
        if (role === "owner" && count === 1) return [409, lastOwner] as const;
        await tx.query("DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2", [
          workspace,
          user,
        ]);
        // An encrypted workspace's key is not given to them again, nor its
        // spaces and pages opened, should they join again.
        await tx.query("DELETE FROM workspace_keys WHERE workspace_id = $1 AND user_id = $2", [
          workspace,
          user,
        ]);
        await tx.query(
          `DELETE FROM unit_grants WHERE user_id = $2
             AND unit_id IN (SELECT id FROM units WHERE workspace_id = $1)`,
          [workspace, user],
        );
        return undefined;
      });
      if (outcome !== undefined) return fail(reply, outcome[0], outcome[1]);
      changed(user);
      return reply.code(204).send();
    },
  );
}
