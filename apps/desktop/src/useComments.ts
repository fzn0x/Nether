// A note's comments while it is open (ADR 0044): its comments' document,
// held from the vault's index, and its threads as they change, here or
// through sync.
import type { NoteId } from "@nether/core";
import { type CommentThread, observeThreads, readThreads } from "@nether/editor";
import type { Vault } from "@nether/storage";
import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { noteComments } from "./noteComments.ts";

export interface OpenComments {
  /** The note's comments' document, which comments are made in. */
  readonly document: Y.Doc;
  /** Its threads, the oldest first. */
  readonly threads: readonly CommentThread[];
}

/** A note's comments, while `enabled`; undefined until they load, and otherwise. */
export function useComments(vault: Vault, id: NoteId, enabled: boolean): OpenComments | undefined {
  const [shown, setShown] = useState<OpenComments | undefined>();
  useEffect(() => {
    setShown(undefined);
    if (!enabled) return;
    let current = true;
    const stopped = () => !current;
    let stop: (() => void) | undefined;
    let release: (() => void) | undefined;
    noteComments(vault)
      .hold(id)
      .then((hold) => {
        if (stopped()) {
          hold.release();
          return;
        }
        release = () => {
          hold.release();
        };
        const show = () => {
          setShown({ document: hold.document, threads: readThreads(hold.document) });
        };
        stop = observeThreads(hold.document, show);
        show();
      })
      .catch(() => {
        // Not loaded from the index: the note shows no comments.
      });
    return () => {
      current = false;
      stop?.();
      release?.();
    };
  }, [vault, id, enabled]);
  return shown;
}
