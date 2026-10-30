// The vault's trash: its `.trash` folder, where removed files go as in
// Obsidian, and what Nether records of them in `.nether/trash.json`: where
// each was, when it went, and the note it was, so a restore puts it back as
// the same note. Files are deleted for good after a number of days, 30
// unless the vault says otherwise.
import type { NoteId } from "@nether/core";

/** A file in the vault's trash. */
export interface TrashItem {
  /** Where it is, in `.trash`. */
  readonly path: string;
  /** Where it was; its name in the trash when the vault does not know, as for a file another app put there. */
  readonly from: string;
  /** When it went to the trash, or when the vault first found it there, in milliseconds since 1970. */
  readonly deleted: number;
  /** The note it was, which it is again when restored. */
  readonly note?: NoteId;
}

/** What `.nether/trash.json` holds. */
export interface TrashRecord {
  /** How many days a file stays in the trash before it is deleted for good. */
  readonly keepDays: number;
  readonly items: readonly TrashItem[];
}

export const trashFolder = ".trash";

/** How many days a file stays in the trash unless the vault says otherwise. */
export const defaultKeepDays = 30;

function item(value: unknown): TrashItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { path, from, deleted, note } = value as Record<string, unknown>;
  if (typeof path !== "string" || !path.startsWith(`${trashFolder}/`)) return undefined;
  if (typeof from !== "string" || from === "") return undefined;
  if (typeof deleted !== "number" || !Number.isFinite(deleted)) return undefined;
  return { path, from, deleted, ...(typeof note === "string" ? { note: note as NoteId } : {}) };
}

/** Whether a number of days is one the trash can keep files for: a whole number from 1. */
export function isKeepDays(days: unknown): days is number {
  return typeof days === "number" && Number.isInteger(days) && days >= 1;
}

/** The trash's record from its JSON, leaving out what it cannot use. */
export function readTrashRecord(value: unknown): TrashRecord {
  if (typeof value !== "object" || value === null) {
    return { keepDays: defaultKeepDays, items: [] };
  }
  const { keepDays, items } = value as Record<string, unknown>;
  return {
    keepDays: isKeepDays(keepDays) ? keepDays : defaultKeepDays,
    items: Array.isArray(items) ? items.flatMap((entry) => item(entry) ?? []) : [],
  };
}

/** The `n`th path a file can take when its own is taken: `name.md`, then `name 2.md` and so on. */
export function numberedPath(path: string, n: number): string {
  if (n <= 1) return path;
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  return `${stem} ${String(n)}${ext}`;
}
