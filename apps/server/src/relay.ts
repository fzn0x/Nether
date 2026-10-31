// The relay of end-to-end encrypted workspaces (ADR 0038). Their clients
// encrypt every update, so the server cannot merge them as Hocuspocus
// does: it keeps each in order, numbered from the documents' sequence, and
// sends it to the document's other subscribers. A socket signs in with its
// session's token; then, in JSON with data in base64:
//
//   { type: "subscribe", name, after }  ->  { type: "updates", name, updates: [{ seq, data }] }…,
//                                           { type: "subscribed", name, seq }
//   { type: "push", id, name, data }    ->  { type: "pushed", id, seq }
//   { type: "compact", id, name, through, data }  ->  { type: "compacted", id }
//   { type: "unsubscribe", name }
//
// Each update a subscriber missed while subscribing waits until the ones
// stored before it are sent, so a subscriber's numbers only grow. Pushing a
// note tells the vault document's subscribers, as { type: "stored", document, seq }.
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { type Database, readBytes, readCount } from "./db.ts";
import { sessionAccount } from "./sessions.ts";
import { parseDocumentName } from "./sync.ts";
import { base64Bytes, membership, writes } from "./workspaces.ts";

/** The most updates one message carries. */
const batch = 500;
/** An update's largest size, as Hocuspocus allows: 16 MiB. */
const largest = 16 * 1024 * 1024;

interface Subscription {
  /** Whether the updates stored before it began have been sent. */
  ready: boolean;
  /** Updates pushed meanwhile, sent once it is ready. */
  readonly waiting: { seq: number; data: string }[];
}

interface Client {
  readonly socket: WebSocket;
  userId: string | undefined;
  readonly subscriptions: Map<string, Subscription>;
}

type Message = Readonly<Record<string, unknown>>;

export function registerRelay(app: FastifyInstance, db: Database): void {
  /** Each document's subscribers. */
  const subscribers = new Map<string, Set<Client>>();

  function send(client: Client, message: object): void {
    if (client.socket.readyState === client.socket.OPEN)
      client.socket.send(JSON.stringify(message));
  }

  function refuse(client: Client, id: unknown, message: string): void {
    send(client, { type: "error", ...(typeof id === "string" ? { id } : {}), message });
  }

  /** Sends an update to a document's subscribers but one, as each is ready for it. */
  function relay(name: string, update: { seq: number; data: string }, except?: Client): void {
    for (const client of subscribers.get(name) ?? []) {
      if (client === except) continue;
      const subscription = client.subscriptions.get(name);
      if (subscription === undefined) continue;
      if (subscription.ready) send(client, { type: "updates", name, updates: [update] });
      else subscription.waiting.push(update);
    }
  }

  /** The account's place in a document's workspace, if the document is an encrypted workspace's. */
  async function place(client: Client, name: unknown) {
    if (client.userId === undefined || typeof name !== "string") return undefined;
    const parsed = parseDocumentName(name);
    if (parsed === undefined) return undefined;
    const found = await membership(db, client.userId, parsed.workspaceId);
    if (found?.encryption !== "end-to-end") return undefined;
    return { ...found, ...parsed };
  }

  const refused = "Sign in, as a member of this document's encrypted workspace.";

  async function subscribe(client: Client, message: Message): Promise<void> {
    const { name } = message;
    const after = typeof message.after === "number" && message.after >= 0 ? message.after : 0;
    const found = await place(client, name);
    if (found === undefined || typeof name !== "string") {
      refuse(client, undefined, refused);
      return;
    }
    // Subscribed first, so nothing pushed while the stored updates are read is lost.
    const subscription: Subscription = { ready: false, waiting: [] };
    client.subscriptions.set(name, subscription);
    let listeners = subscribers.get(name);
    if (listeners === undefined) {
      listeners = new Set();
      subscribers.set(name, listeners);
    }
    listeners.add(client);
    let last = after;
    for (;;) {
      const { rows } = await db.query(
        `SELECT seq, data FROM encrypted_updates WHERE workspace_id = $1 AND name = $2 AND seq > $3
          ORDER BY seq LIMIT $4`,
        [found.workspaceId, found.document, last, batch],
      );
      if (rows.length === 0) break;
      const updates = rows.map((row) => ({
        seq: readCount(row, "seq"),
        data: Buffer.from(readBytes(row, "data")).toString("base64"),
      }));
      last = updates[updates.length - 1]?.seq ?? last;
      send(client, { type: "updates", name, updates });
      if (rows.length < batch) break;
    }
    const later = subscription.waiting.splice(0).filter((update) => update.seq > last);
    if (later.length > 0) send(client, { type: "updates", name, updates: later });
    subscription.ready = true;
    send(client, { type: "subscribed", name, seq: Math.max(last, ...later.map((u) => u.seq)) });
  }

  async function push(client: Client, message: Message): Promise<void> {
    const { id, name } = message;
    const found = await place(client, name);
    if (found === undefined || typeof name !== "string") {
      refuse(client, id, refused);
      return;
    }
    if (!writes(found.role)) {
      refuse(client, id, "A guest may read this workspace, not change it.");
      return;
    }
    const data = typeof message.data === "string" ? base64Bytes(message.data, largest) : undefined;
    if (data === undefined) {
      refuse(client, id, "That is not an update.");
      return;
    }
    const { rows } = await db.query(
      `INSERT INTO encrypted_updates (workspace_id, name, seq, data)
       VALUES ($1, $2, nextval('document_seq'), $3) RETURNING seq`,
      [found.workspaceId, found.document, data],
    );
    const seq = readCount(rows[0], "seq");
    send(client, { type: "pushed", id, seq });
    relay(name, { seq, data: message.data as string }, client);
    if (found.document !== "vault") {
      const vault = `${found.workspaceId}/vault`;
      for (const listener of subscribers.get(vault) ?? []) {
        if (listener !== client) send(listener, { type: "stored", document: found.document, seq });
      }
    }
  }

  async function compact(client: Client, message: Message): Promise<void> {
    const { id, name, through } = message;
    const found = await place(client, name);
    if (found === undefined || typeof name !== "string") {
      refuse(client, id, refused);
      return;
    }
    if (!writes(found.role)) {
      refuse(client, id, "A guest may read this workspace, not change it.");
      return;
    }
    const data = typeof message.data === "string" ? base64Bytes(message.data, largest) : undefined;
    if (data === undefined || typeof through !== "number" || !Number.isSafeInteger(through)) {
      refuse(client, id, "That is not a snapshot.");
      return;
    }
    const done = await db.transaction(async (tx) => {
      // Only over what is there: a snapshot replaces stored updates, up to one
      // of them; anything else changes nothing.
      const { rows } = await tx.query(
        `SELECT 1 FROM encrypted_updates WHERE workspace_id = $1 AND name = $2 AND seq = $3
          FOR UPDATE`,
        [found.workspaceId, found.document, through],
      );
      if (rows.length === 0) return false;
      await tx.query(
        "DELETE FROM encrypted_updates WHERE workspace_id = $1 AND name = $2 AND seq <= $3",
        [found.workspaceId, found.document, through],
      );
      await tx.query(
        "INSERT INTO encrypted_updates (workspace_id, name, seq, data) VALUES ($1, $2, $3, $4)",
        [found.workspaceId, found.document, through, data],
      );
      return true;
    });
    if (!done) {
      refuse(client, id, "A snapshot must replace the updates up to one stored.");
      return;
    }
    send(client, { type: "compacted", id });
  }

  app.get("/api/relay", { websocket: true }, (socket) => {
    const client: Client = { socket, userId: undefined, subscriptions: new Map() };
    // Messages are handled in order, one at a time.
    let queue = Promise.resolve();
    socket.on("message", (raw: Buffer) => {
      queue = queue
        .then(async () => {
          let message: Message;
          try {
            message = JSON.parse(raw.toString("utf8")) as Message;
          } catch {
            socket.close(4400, "Not JSON");
            return;
          }
          if (message.type === "auth") {
            const account =
              typeof message.token === "string"
                ? await sessionAccount(db, message.token)
                : undefined;
            if (account === undefined) {
              socket.close(4401, "Sign in first");
              return;
            }
            client.userId = account.id;
            send(client, { type: "ready" });
            return;
          }
          if (client.userId === undefined) {
            socket.close(4401, "Sign in first");
            return;
          }
          if (message.type === "subscribe") await subscribe(client, message);
          else if (message.type === "push") await push(client, message);
          else if (message.type === "compact") await compact(client, message);
          else if (message.type === "unsubscribe" && typeof message.name === "string") {
            client.subscriptions.delete(message.name);
            subscribers.get(message.name)?.delete(client);
          } else {
            refuse(client, message.id, "That is not a message the relay knows.");
          }
        })
        .catch((error: unknown) => {
          app.log.error({ err: error }, "The relay could not handle a message");
          socket.close(1011, "Server error");
        });
    });
    socket.on("close", () => {
      for (const name of client.subscriptions.keys()) {
        const listeners = subscribers.get(name);
        listeners?.delete(client);
        if (listeners?.size === 0) subscribers.delete(name);
      }
    });
  });
}
