// A note's history in the desktop app (ADR 0041): the versions this
// computer keeps, and those the server keeps of a note in a workspace it
// can read; what changed between one and the note now, with long runs of
// unchanged lines folded away; and putting a version back through the
// note's document, so the editor and sync take it as they take any edit.
import { type NoteId, newBlockId } from "@nether/core";
import { documentBlocks, documentProperties } from "@nether/editor";
import { type DiffPart, diffLines, serializeMarkdown } from "@nether/markdown";
import type { Vault } from "@nether/storage";
import * as Y from "yjs";
import { t } from "./messages.ts";
import { noteDocuments, whenLoaded } from "./noteDocuments.ts";
import { noteVersionState, noteVersions } from "./server.ts";
import type { VaultLink } from "./sync.ts";

/** A version as the history lists it, kept on this computer or on the server. */
export interface ListedVersion {
  readonly key: string;
  /** When the note last had it, in milliseconds since 1970. */
  readonly time: number;
  readonly where: "here" | "server";
  /** Its text, as Markdown. */
  text(): Promise<string>;
}

/** The versions this computer keeps of a note, the latest first. */
export async function localVersions(vault: Vault, id: NoteId): Promise<ListedVersion[]> {
  return (await vault.versions(id)).map((version) => ({
    key: `here:${String(version.id)}`,
    time: version.time,
    where: "here",
    text: async () => (await vault.versionText(version.id)) ?? "",
  }));
}

/**
 * The versions the server keeps of a note, the latest first: none for an
 * encrypted workspace, whose server cannot read its notes.
 */
export async function serverVersions(
  fetcher: typeof fetch,
  link: VaultLink,
  token: string,
  id: NoteId,
): Promise<ListedVersion[]> {
  if (link.encrypted === true) return [];
  const listed = await noteVersions(fetcher, link.server, token, link.workspaceId, id);
  return listed.map((version) => ({
    key: `server:${version.id}`,
    time: version.time,
    where: "server",
    text: async () =>
      markdownOf(
        await noteVersionState(fetcher, link.server, token, link.workspaceId, id, version.id),
      ),
  }));
}

/** A note's document state as the Markdown Nether writes for it. */
function markdownOf(state: Uint8Array): string {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, state);
    return serializeMarkdown({
      properties: documentProperties(document),
      content: documentBlocks(document, newBlockId),
    }).text;
  } finally {
    document.destroy();
  }
}

/** A row of a diff as shown: lines kept, removed or added, or unchanged lines folded away. */
export type DiffRow = DiffPart | { readonly kind: "folded"; readonly count: number };

/** The unchanged lines shown on each side of a change. */
const context = 3;

/** A text without the byte order mark it may start with, which no one sees. */
function withoutBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/**
 * What changed from a version to the note now, with each run of unchanged
 * lines longer than the context around the changes folded; nothing when
 * the two are the same.
 */
export function historyDiff(version: string, now: string): DiffRow[] {
  const parts = diffLines(withoutBom(version), withoutBom(now));
  if (parts.every((part) => part.kind === "same")) return [];
  const rows: DiffRow[] = [];
  parts.forEach((part, index) => {
    if (part.kind !== "same") {
      rows.push(part);
      return;
    }
    // Lines kept after the change before, and before the change after.
    const after = index === 0 ? 0 : context;
    const before = index === parts.length - 1 ? 0 : context;
    // Folding a single line would hide nothing.
    if (part.lines.length <= after + before + 1) {
      rows.push(part);
      return;
    }
    if (after > 0) rows.push({ kind: "same", lines: part.lines.slice(0, after) });
    rows.push({ kind: "folded", count: part.lines.length - after - before });
    if (before > 0)
      rows.push({ kind: "same", lines: part.lines.slice(part.lines.length - before) });
  });
  return rows;
}

/**
 * Puts a version's text back as the note's, keeping the note as it is now
 * as a version first. The text goes in as source mode's does: written to
 * the file, and merged into the document the editor and sync share.
 */
export async function restoreVersion(vault: Vault, id: NoteId, text: string): Promise<void> {
  await vault.saveVersion(id);
  const hold = noteDocuments(vault).open(id);
  try {
    await whenLoaded(hold.note);
    const { state } = hold.note.snapshot;
    if (state.status !== "ready") throw new Error(t("historyCannotRestore"));
    hold.note.editText(withoutBom(text));
    await hold.note.refresh();
  } finally {
    hold.release();
  }
}
