// A note syncing live while it is open (ADR 0043): the editor gets the
// awareness that shows where the others editing it are, and who this person
// is to them; closing the note, or another note opening, stops it.
import type { NoteCollaboration } from "@nether/editor";
import type { LiveNote } from "@nether/sync-client";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

/** What the vault's sync offers: a note's document syncing live. */
export type GoLive = (id: string, document: Y.Doc) => LiveNote;

export function useLive(
  live: GoLive | undefined,
  id: string,
  document: Y.Doc | undefined,
): NoteCollaboration | undefined {
  const [shown, setShown] = useState<NoteCollaboration | undefined>();
  useEffect(() => {
    if (live === undefined || document === undefined) return;
    const note = live(id, document);
    setShown({ awareness: note.awareness, user: note.editor });
    return () => {
      note.stop();
      setShown(undefined);
    };
  }, [live, id, document]);
  return shown;
}
