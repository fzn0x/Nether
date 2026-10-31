// Mentions on their way to the server (ADR 0045): a comment that mentions
// people tells the workspace's server, which tells them. A mention made
// offline, or while the server cannot be reached, waits in what the vault
// keeps on this device, and goes once it can. One the server refuses, as
// for someone who may no longer comment, is dropped.
import type { VaultSettings } from "@nether/storage";
import { type MentionNotice, ServerError } from "./server.ts";

const pendingKey = "notify.pending";

/** A mention waiting, with the workspace it is for. */
export interface PendingMention extends MentionNotice {
  readonly server: string;
  readonly workspaceId: string;
}

function isPending(value: unknown): value is PendingMention {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.server === "string" &&
    typeof item.workspaceId === "string" &&
    typeof item.note === "string" &&
    typeof item.thread === "string" &&
    Array.isArray(item.people) &&
    item.people.every((person) => typeof person === "string")
  );
}

async function readPending(store: VaultSettings): Promise<PendingMention[]> {
  const data = await store.setting(pendingKey);
  if (data === undefined) return [];
  try {
    const list: unknown = JSON.parse(new TextDecoder().decode(data));
    return Array.isArray(list) ? list.filter(isPending) : [];
  } catch {
    return [];
  }
}

async function writePending(store: VaultSettings, list: readonly PendingMention[]): Promise<void> {
  await store.setSetting(
    pendingKey,
    list.length === 0 ? undefined : new TextEncoder().encode(JSON.stringify(list)),
  );
}

/** Each store's work, one at a time, so a mention is never sent twice or lost. */
const queues = new WeakMap<VaultSettings, Promise<void>>();

function inTurn(store: VaultSettings, work: () => Promise<void>): Promise<void> {
  const next = (queues.get(store) ?? Promise.resolve()).then(work, work);
  queues.set(
    store,
    next.catch(() => undefined),
  );
  return next;
}

/** Whether a failure may pass: the server unreachable, busy, or failing for now. */
function passing(error: unknown): boolean {
  return (
    !(error instanceof ServerError) ||
    error.status === 0 ||
    error.status === 429 ||
    error.status >= 500
  );
}

/** Keeps a mention to send. */
export function queueMention(store: VaultSettings, mention: PendingMention): Promise<void> {
  return inTurn(store, async () => {
    await writePending(store, [...(await readPending(store)), mention]);
  });
}

/**
 * Sends the mentions waiting, in order, with `send`; keeps those that fail
 * for now, and stops at the first, as the rest would fail the same way.
 */
export function sendMentions(
  store: VaultSettings,
  send: (mention: PendingMention) => Promise<void>,
): Promise<void> {
  return inTurn(store, async () => {
    const waiting = await readPending(store);
    let sent = 0;
    for (const mention of waiting) {
      try {
        await send(mention);
      } catch (error) {
        if (passing(error)) break;
      }
      sent += 1;
    }
    // Mentions queued meanwhile wait their turn, so the list is as read.
    if (sent > 0) await writePending(store, waiting.slice(sent));
  });
}
