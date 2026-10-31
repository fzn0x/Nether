// What a build of the app shows. Sync and collaboration wait for Phase 3's
// server to be ready to run, with `docker compose up`: until then their
// commands and menu show only in a build made with VITE_NETHER_SYNC=on, as
// the end-to-end tests make theirs. The web app, built with
// VITE_NETHER_TARGET=web, is its server's, so it always syncs (ADR 0053),
// and leaves out what a page in a browser cannot do yet.
import type { CommandId } from "./commands.ts";

/** What a build is made for. */
export interface Build {
  /** The web app, which its server serves. */
  readonly web: boolean;
  /** Whether sync and collaboration show. */
  readonly sync: boolean;
}

const web = import.meta.env.VITE_NETHER_TARGET === "web";

export const build: Build = { web, sync: web || import.meta.env.VITE_NETHER_SYNC === "on" };

export const syncShown = build.sync;

const syncCommands: ReadonlySet<CommandId> = new Set([
  "servers",
  "sync",
  "members",
  "spaces",
  "share",
  "notifications",
]);

/**
 * What the web app leaves out: linking a vault to a workspace, as each of
 * its vaults is one, and updates, which come with its server.
 */
const notOnTheWeb: ReadonlySet<CommandId> = new Set(["sync", "checkUpdates", "updateChecks"]);

/** Whether a build shows a command. */
export function shownIn(build: Build, id: CommandId): boolean {
  if (build.web && notOnTheWeb.has(id)) return false;
  return build.sync || !syncCommands.has(id);
}

/** Whether this build shows a command. */
export function commandShown(id: CommandId): boolean {
  return shownIn(build, id);
}

/**
 * A menu's commands a build shows, without the separators leaving some out
 * would put at its ends or side by side.
 */
export function shownEntries(
  ids: readonly (CommandId | "separator")[],
  shown: (id: CommandId) => boolean = commandShown,
): (CommandId | "separator")[] {
  const entries: (CommandId | "separator")[] = [];
  for (const id of ids) {
    if (id !== "separator") {
      if (shown(id)) entries.push(id);
    } else if (entries.length > 0 && entries.at(-1) !== "separator") {
      entries.push(id);
    }
  }
  if (entries.at(-1) === "separator") entries.pop();
  return entries;
}
