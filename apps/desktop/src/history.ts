// A note's history in the desktop app (ADR 0041): what changed between one
// of its versions and the note now, with long runs of unchanged lines
// folded away, and putting a version back through the note's document, so
// the editor and sync take it as they take any edit.
import type { NoteId } from "@nether/core";
import { type DiffPart, diffLines } from "@nether/markdown";
import type { Vault } from "@nether/storage";
import { t } from "./messages.ts";
import { noteDocuments, whenLoaded } from "./noteDocuments.ts";

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
