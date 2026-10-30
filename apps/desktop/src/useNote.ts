// One open note: its Markdown read and parsed, the editor's changes written
// back after a pause in typing, and changes other apps make picked up. A
// save writes only over the file it read; when the file changed meanwhile,
// the edits are kept in a conflict copy beside it, so nothing is lost,
// until the merge that sync brings (ADR 0003).
import type { ContentBlock, NoteId } from "@nether/core";
import {
  type ParsedMarkdown,
  type Source,
  parseMarkdown,
  serializeMarkdown,
} from "@nether/markdown";
import { ChangedOnDisk, type Vault, folderOf } from "@nether/storage";
import { useCallback, useEffect, useRef, useState } from "react";

/** Quiet time before a save, and the longest an edit waits while typing goes on. */
const quiet = 500;
const longest = 2000;

export type NoteState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly blocks: readonly ContentBlock[]; readonly version: number }
  | { readonly status: "binary" }
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly error: Error };

interface Open {
  parsed: ParsedMarkdown;
  source: Source;
  /** The hash of the file as last read or written. */
  hash: string;
  pending: ContentBlock[] | undefined;
  firstPending: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  saving: Promise<void> | undefined;
}

function stamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export interface NoteDocument {
  readonly state: NoteState;
  /** Where the edits that met another app's were kept, when they did. */
  readonly conflict: string | undefined;
  readonly saveError: string | undefined;
  /** Takes the editor's blocks after a change and saves them after a pause. */
  readonly edit: (blocks: ContentBlock[]) => void;
}

export function useNote(vault: Vault, id: NoteId): NoteDocument {
  const [state, setState] = useState<NoteState>({ status: "loading" });
  const [conflict, setConflict] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const open = useRef<Open | undefined>(undefined);
  const version = useRef(0);

  const load = useCallback(async () => {
    try {
      const file = await vault.read(id);
      if (file.missing === true) {
        setState({ status: "missing" });
        return;
      }
      if (file.binary === true) {
        setState({ status: "binary" });
        return;
      }
      const parsed = parseMarkdown(file.text);
      open.current = {
        parsed,
        source: parsed.source,
        hash: file.hash,
        pending: undefined,
        firstPending: undefined,
        timer: undefined,
        saving: undefined,
      };
      version.current += 1;
      setState({ status: "ready", blocks: parsed.content, version: version.current });
    } catch (error) {
      setState({
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [vault, id]);

  const flush = useCallback(async (): Promise<void> => {
    const current = open.current;
    if (current?.pending === undefined) return;
    if (current.saving !== undefined) {
      await current.saving;
      return flush();
    }
    const blocks = current.pending;
    current.pending = undefined;
    current.firstPending = undefined;
    const written = serializeMarkdown(
      { properties: current.parsed.properties, content: blocks },
      { source: current.source, writeIds: current.parsed.writtenIds },
    );
    if (written.text === (current.source.bom ? "﻿" : "") + current.source.text) return;
    current.saving = (async () => {
      try {
        const file = await vault.write(id, written.text, current.hash);
        current.source = written.source;
        current.hash = file.hash;
        setSaveError(undefined);
      } catch (error) {
        if (error instanceof ChangedOnDisk) {
          // Another app changed the file since it was read: keep these edits
          // beside it, then show what is on disk now.
          const note = vault.note(id);
          const folder = note === undefined ? "" : folderOf(note.path);
          const name = `${note?.title ?? "Note"} (conflict ${stamp(new Date())}).md`;
          const copy = await vault.create(folder === "" ? name : `${folder}/${name}`, written.text);
          setConflict(copy.path);
          await load();
        } else {
          current.pending ??= blocks;
          setSaveError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        current.saving = undefined;
      }
    })();
    await current.saving;
  }, [vault, id, load]);

  const edit = useCallback(
    (blocks: ContentBlock[]) => {
      const current = open.current;
      if (current === undefined) return;
      current.pending = blocks;
      const now = Date.now();
      current.firstPending ??= now;
      clearTimeout(current.timer);
      const wait = Math.max(0, Math.min(quiet, current.firstPending + longest - now));
      current.timer = setTimeout(() => void flush(), wait);
    },
    [flush],
  );

  useEffect(() => {
    void load();
    return () => {
      // Leaving the note saves what is pending at once.
      const current = open.current;
      clearTimeout(current?.timer);
      void flush();
    };
  }, [load, flush]);

  // When another app changes the file, read it again, unless edits are waiting:
  // their save finds the change and keeps both.
  useEffect(() => {
    let modified = vault.note(id)?.modified;
    return vault.subscribe(() => {
      const note = vault.note(id);
      if (note === undefined) {
        setState({ status: "missing" });
        return;
      }
      if (note.modified === modified) return;
      modified = note.modified;
      const current = open.current;
      if (current === undefined || current.pending !== undefined || current.saving !== undefined)
        return;
      void vault.read(id).then((file) => {
        if (
          file.hash !== current.hash &&
          open.current === current &&
          current.pending === undefined
        ) {
          void load();
        }
      });
    });
  }, [vault, id, load]);

  return { state, conflict, saveError, edit };
}
