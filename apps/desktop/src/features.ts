// What a build of the app shows that a release does not yet. Sync and
// collaboration wait for Phase 3's server to be ready to run, with
// `docker compose up`: until then their commands and menu show only in a
// build made with VITE_NETHER_SYNC=on, as the end-to-end tests make theirs.
import type { CommandId } from "./commands.ts";

export const syncShown = import.meta.env.VITE_NETHER_SYNC === "on";

const syncCommands: ReadonlySet<CommandId> = new Set([
  "servers",
  "sync",
  "members",
  "spaces",
  "share",
  "notifications",
]);

/** Whether a build shows a command: those of sync only where sync shows. */
export function commandShown(id: CommandId): boolean {
  return syncShown || !syncCommands.has(id);
}
