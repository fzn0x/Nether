// One open note for the page: the note's document, open through the
// vault's open notes (noteDocuments.ts), which the editor shares with
// whatever else holds the note, and its state as it changes.
import type { NoteId } from "@nether/core";
import type { Vault } from "@nether/storage";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { type NoteSnapshot, type OpenNote, noteDocuments } from "./noteDocuments.ts";

export type { NoteState } from "./noteDocuments.ts";

export interface NoteDocument extends NoteSnapshot {
  /** Takes source mode's text after a change and saves it after a pause. */
  readonly editText: (text: string) => void;
  /**
   * Saves what is waiting, then gives the note as saved to a new editor:
   * the other mode's, when the user switches between blocks and source.
   */
  readonly refresh: () => Promise<void>;
}

const loading: NoteSnapshot = { state: { status: "loading" }, saveError: undefined };

export function useNote(vault: Vault, id: NoteId): NoteDocument {
  const [held, setHeld] = useState<OpenNote | undefined>();
  useEffect(() => {
    const hold = noteDocuments(vault).open(id);
    setHeld(hold.note);
    return () => {
      hold.release();
    };
  }, [vault, id]);
  // The note held is the one asked for once the effect has run; until
  // then, as when the note changes, it is loading.
  const note = held?.id === id ? held : undefined;
  const subscribe = useCallback(
    (listener: () => void) => note?.subscribe(listener) ?? (() => undefined),
    [note],
  );
  const snapshot = useSyncExternalStore(subscribe, () => note?.snapshot ?? loading);
  const editText = useCallback(
    (text: string) => {
      note?.editText(text);
    },
    [note],
  );
  const refresh = useCallback(async () => {
    await note?.refresh();
  }, [note]);
  return { ...snapshot, editText, refresh };
}
