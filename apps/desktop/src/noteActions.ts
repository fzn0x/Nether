// What a note's menu does that is more than a call: a copy of the note
// beside it, its full path on disk, the vault's folders to move it to, and
// its tags, read and written in its frontmatter through its document, as
// the editor and sync change it.
import type { JsonValue, NoteId, PropertyEntry } from "@nether/core";
import { documentProperties, setDocumentProperties } from "@nether/editor";
import { type NoteEntry, type Vault, folderOf, numberedPath } from "@nether/storage";
import { t } from "./messages.ts";
import { noteDocuments, whenLoaded } from "./noteDocuments.ts";

/** Copies a note beside it, as `Name 2`, then `Name 3`, as the vault names files that meet, and returns the copy. */
export async function copyNote(vault: Vault, id: NoteId): Promise<NoteEntry> {
  const note = vault.note(id);
  if (note === undefined) throw new Error(t("missingNote"));
  const { text } = await vault.read(id);
  for (let n = 2; ; n++) {
    const path = numberedPath(note.path, n);
    if (vault.noteAt(path) === undefined && vault.fileInfo(path) === undefined) {
      return vault.create(path, text);
    }
  }
}

/** A file's full path on disk, written as the vault's folder writes its own. */
export function fullPath(root: string, path: string): string {
  const windows = root.includes("\\");
  const separator = windows ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  return `${base}${separator}${windows ? path.replaceAll("/", "\\") : path}`;
}

/** Every folder of the vault, the top as "", each after the folders it is in. */
export function vaultFolders(files: readonly string[]): string[] {
  const folders = new Set([""]);
  for (const file of files) {
    for (let folder = folderOf(file); folder !== ""; folder = folderOf(folder)) {
      if (folders.has(folder)) break;
      folders.add(folder);
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

/** The frontmatter key that holds a note's tags: `tags` as the note writes it. */
function tagsKey(entries: readonly PropertyEntry[]): string {
  return entries.find((entry) => entry.key.toLowerCase() === "tags")?.key ?? "tags";
}

/** The tags a frontmatter value names: a list, or one string of them. */
export function tagsOf(value: JsonValue | undefined): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  return items.flatMap((item) => {
    const tag = typeof item === "string" ? cleanTag(item) : "";
    return tag === "" ? [] : [tag];
  });
}

/** A tag as frontmatter keeps it: no `#`, and no spaces, which end a tag. */
export function cleanTag(typed: string): string {
  return typed.trim().replace(/^#+/, "").replace(/\s+/g, "-");
}

/** The note's properties with `tags` as given: none removes the key, a new one goes last. */
export function withTags(
  entries: readonly PropertyEntry[],
  tags: readonly string[],
): PropertyEntry[] {
  const key = tagsKey(entries);
  if (tags.length === 0) return entries.filter((entry) => entry.key !== key);
  const value = [...tags];
  return entries.some((entry) => entry.key === key)
    ? entries.map((entry) => (entry.key === key ? { key, value } : entry))
    : [...entries, { key, value }];
}

/** Runs `change` on a note's document, held while it runs, as the editor and sync hold it. */
async function changeDocument<T>(
  vault: Vault,
  id: NoteId,
  change: (entries: readonly PropertyEntry[]) => {
    readonly entries?: PropertyEntry[];
    readonly result: T;
  },
): Promise<T> {
  const hold = noteDocuments(vault).open(id);
  try {
    await whenLoaded(hold.note);
    const { state } = hold.note.snapshot;
    if (state.status !== "ready") throw new Error(t("tagsCannotChange"));
    if (state.frontmatterError !== undefined) throw new Error(state.frontmatterError);
    const { entries, result } = change(documentProperties(state.document));
    if (entries !== undefined) setDocumentProperties(state.document, entries);
    return result;
  } finally {
    hold.release();
  }
}

/** A note's tags in its frontmatter. */
export function noteTags(vault: Vault, id: NoteId): Promise<string[]> {
  return changeDocument(vault, id, (entries) => ({
    result: tagsOf(entries.find((entry) => entry.key === tagsKey(entries))?.value),
  }));
}

/** Sets a note's tags in its frontmatter, the other properties as they are. */
export function setNoteTags(vault: Vault, id: NoteId, tags: readonly string[]): Promise<void> {
  return changeDocument(vault, id, (entries) => ({
    entries: withTags(entries, tags),
    result: undefined,
  }));
}
