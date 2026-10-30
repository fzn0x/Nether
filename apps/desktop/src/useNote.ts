// One open note, as ADR 0003 has it: its Yjs document is the truth inside
// Nether, kept in the vault's index before an edit counts as saved, and its
// file is kept in step both ways. Edits are written to the file after a
// pause in typing, keeping every unchanged block's bytes. An edit another
// app makes to the file is merged into the document, block by block and
// character by character, so neither side's edits are lost. Source mode's
// text is written as typed, then merged into the document the same way.
import { type ContentBlock, type NoteId, type PropertyEntry, newBlockId } from "@nether/core";
import {
  documentBlocks,
  documentProperties,
  isEmptyDocument,
  setDocumentBlocks,
  setDocumentProperties,
} from "@nether/editor";
import {
  type ParsedMarkdown,
  alignBlocks,
  fingerprint,
  mergeBlocks,
  mergeProperties,
  parseMarkdown,
  serializeMarkdown,
} from "@nether/markdown";
import { ChangedOnDisk, type Vault } from "@nether/storage";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

/** Quiet time before a save, and the longest an edit waits while typing goes on. */
const quiet = 500;
const longest = 2000;
/** How often the document's updates go to the index, and how many rows it keeps before a snapshot. */
const persistEvery = 250;
const compactAfter = 100;

/** The origin of the document's edits that come from the note's file. */
const fromFile = Symbol("file");

export type NoteState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      /** The note's Yjs document, which the block editor edits. */
      readonly document: Y.Doc;
      /** The note's Markdown, as source mode shows it. */
      readonly text: string;
      /** Why the note's frontmatter cannot be read, when it cannot: its properties then stay as they are. */
      readonly frontmatterError?: string;
      /** Changes whenever the note's text is read again, to start source mode anew. */
      readonly version: number;
    }
  | { readonly status: "binary" }
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly error: Error };

interface Open {
  readonly document: Y.Doc;
  /** The file as last written or read: its parse, aligned to the document's IDs. */
  file: ParsedMarkdown;
  /** The hash of the file as last written or read. */
  hash: string;
  /** Whether the document has changed since the file was last written. */
  dirty: boolean;
  /** Source mode's text, waiting to be written. */
  text: string | undefined;
  firstPending: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  saving: Promise<void> | undefined;
  /** The document's updates waiting for the index; the number of the last stored, and the rows kept. */
  updates: Uint8Array[];
  seq: number;
  rows: number;
  persisting: Promise<void>;
  persistTimer: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
}

/** Whether a note has edits waiting for its file: text from source mode, or the document's. */
function waiting(note: Open): boolean {
  return note.dirty || note.text !== undefined;
}

function sameProperties(a: readonly PropertyEntry[], b: readonly PropertyEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameBlocks(a: readonly ContentBlock[], b: readonly ContentBlock[]): boolean {
  return (
    a.length === b.length &&
    a.every((block, index) => {
      const other = b[index];
      return block.id === other?.id && fingerprint(block) === fingerprint(other);
    })
  );
}

export interface NoteDocument {
  readonly state: NoteState;
  readonly saveError: string | undefined;
  /** Takes source mode's text after a change and saves it after a pause. */
  readonly editText: (text: string) => void;
  /**
   * Saves what is waiting, then gives the note as saved to a new editor:
   * the other mode's, when the user switches between blocks and source.
   */
  readonly refresh: () => Promise<void>;
}

export function useNote(vault: Vault, id: NoteId): NoteDocument {
  const [state, setState] = useState<NoteState>({ status: "loading" });
  const [saveError, setSaveError] = useState<string | undefined>();
  const open = useRef<Open | undefined>(undefined);
  const version = useRef(0);

  const ready = useCallback((current: Open) => {
    version.current += 1;
    setState({
      status: "ready",
      document: current.document,
      text: current.file.source.text,
      version: version.current,
      ...(current.file.frontmatterError === undefined
        ? {}
        : { frontmatterError: current.file.frontmatterError }),
    });
  }, []);

  /** Sends the document's waiting updates to the index as one row, and compacts it now and then. */
  const persist = useCallback(
    (current: Open): Promise<void> => {
      clearTimeout(current.persistTimer);
      current.persistTimer = undefined;
      current.persisting = current.persisting.then(async () => {
        if (current.updates.length === 0) return;
        const batch = Y.mergeUpdates(current.updates);
        current.updates = [];
        await vault.documents.appendUpdates(id, [batch]);
        current.seq += 1;
        current.rows += 1;
        if (current.rows > compactAfter) {
          await vault.documents.compact(id, Y.encodeStateAsUpdate(current.document), current.seq);
          current.rows = 1;
        }
      });
      return current.persisting;
    },
    [vault, id],
  );

  /**
   * Merges the file's text as it is now into the document: what changed in
   * it since it was last written or read joins what changed in the document.
   */
  const mergeFile = useCallback(
    (current: Open, text: string, hash: string) => {
      const theirs = alignBlocks(parseMarkdown(text), current.file.content);
      const ours = documentBlocks(current.document, newBlockId);
      const merged = mergeBlocks(current.file.content, ours, theirs.content, newBlockId);
      // Properties merge key by key; a frontmatter that cannot be read keeps its own.
      const properties =
        theirs.frontmatterError === undefined
          ? mergeProperties(
              current.file.properties,
              documentProperties(current.document),
              theirs.properties,
            )
          : theirs.properties;
      current.document.transact(() => {
        setDocumentBlocks(current.document, merged, fromFile);
        setDocumentProperties(current.document, properties, fromFile);
      }, fromFile);
      current.file = theirs;
      current.hash = hash;
      // What the file lacks of the document is written back.
      current.dirty =
        !sameBlocks(merged, theirs.content) || !sameProperties(properties, theirs.properties);
      void vault.documents.setFileHash(id, hash);
    },
    [vault, id],
  );

  /** Writes what is waiting to the file: source mode's text, or the document. */
  const flush = useCallback(
    async (current: Open): Promise<void> => {
      if (!waiting(current)) return;
      if (current.saving !== undefined) {
        await current.saving;
        return flush(current);
      }
      clearTimeout(current.timer);
      current.firstPending = undefined;
      const bom = current.file.source.bom ? "﻿" : "";
      const typed = current.text;
      current.text = undefined;
      current.dirty = false;
      const blocks = typed === undefined ? documentBlocks(current.document, newBlockId) : undefined;
      const text =
        blocks === undefined
          ? bom + (typed ?? "")
          : serializeMarkdown(
              {
                // A frontmatter that cannot be read keeps its own properties.
                properties:
                  current.file.frontmatterError === undefined
                    ? documentProperties(current.document)
                    : current.file.properties,
                content: blocks,
              },
              { source: current.file.source, writeIds: current.file.writtenIds },
            ).text;
      if (text === bom + current.file.source.text) return;
      current.saving = (async () => {
        try {
          const written = await vault.write(id, text, current.hash);
          if (blocks === undefined) {
            // Source mode's text, merged into the document as the file it now is.
            mergeFile(current, written.text, written.hash);
          } else {
            current.file = alignBlocks(parseMarkdown(written.text), blocks);
            current.hash = written.hash;
            await vault.documents.setFileHash(id, written.hash);
          }
          setSaveError(undefined);
        } catch (error) {
          if (error instanceof ChangedOnDisk) {
            // Another app changed the file since it was read: merge its edit
            // into the document, then write the document.
            const disk = await vault.read(id);
            if (disk.missing !== true && disk.binary !== true) {
              mergeFile(current, disk.text, disk.hash);
              if (typed !== undefined) {
                // Then the text typed in source mode, against the file it was typed over.
                const theirs = alignBlocks(parseMarkdown(bom + typed), current.file.content);
                const merged = mergeBlocks(
                  current.file.content,
                  documentBlocks(current.document, newBlockId),
                  theirs.content,
                  newBlockId,
                );
                setDocumentBlocks(current.document, merged, fromFile);
              }
              current.dirty = true;
            }
          } else {
            if (typed === undefined) current.dirty = true;
            else current.text ??= typed;
            setSaveError(error instanceof Error ? error.message : String(error));
          }
        } finally {
          current.saving = undefined;
        }
      })();
      await current.saving;
      // Edits made, or merged, while the file was being written.
      if (waiting(current) && !current.closed) await flush(current);
    },
    [vault, id, mergeFile],
  );

  /** Saves after a pause, or soon while typing goes on. */
  const schedule = useCallback(
    (current: Open) => {
      const now = Date.now();
      current.firstPending ??= now;
      clearTimeout(current.timer);
      const wait = Math.max(0, Math.min(quiet, current.firstPending + longest - now));
      current.timer = setTimeout(() => void flush(current), wait);
    },
    [flush],
  );

  useEffect(() => {
    // Each run of this effect loads the note once; React may run it twice,
    // and only the run still current may change the document.
    const controller = new AbortController();
    // A function, so each await reads the signal again.
    const cancelled = () => controller.signal.aborted;
    void (async () => {
      try {
        const file = await vault.read(id);
        if (cancelled()) return;
        if (file.missing === true) {
          setState({ status: "missing" });
          return;
        }
        if (file.binary === true) {
          setState({ status: "binary" });
          return;
        }
        const stored = await vault.documents.document(id);
        if (cancelled()) return;
        const document = new Y.Doc();
        for (const update of stored.updates) Y.applyUpdate(document, update.data);
        const parsed = parseMarkdown(file.text);
        const current: Open = {
          document,
          file: parsed,
          hash: file.hash,
          dirty: false,
          text: undefined,
          firstPending: undefined,
          timer: undefined,
          saving: undefined,
          updates: [],
          seq: stored.updates[stored.updates.length - 1]?.seq ?? 0,
          rows: stored.updates.length,
          persisting: Promise.resolve(),
          persistTimer: undefined,
          closed: false,
        };
        // From here on, every change to the document goes to the index.
        document.on("update", (update: Uint8Array) => {
          current.updates.push(update);
          current.persistTimer ??= setTimeout(() => void persist(current), persistEvery);
        });
        if (isEmptyDocument(document)) {
          // A note opened for the first time: its document starts from its file.
          document.transact(() => {
            setDocumentBlocks(document, parsed.content, fromFile);
            setDocumentProperties(document, parsed.properties, fromFile);
          }, fromFile);
        } else {
          const ours = documentBlocks(document, newBlockId);
          const aligned = alignBlocks(parsed, ours);
          current.file = aligned;
          if (stored.fileHash === file.hash) {
            // The file is the document's last write: edits it lacks, as after a crash, are written.
            current.dirty =
              !sameBlocks(ours, aligned.content) ||
              (aligned.frontmatterError === undefined &&
                !sameProperties(documentProperties(document), aligned.properties));
          } else {
            // Another app changed the file while the note was closed.
            document.transact(() => {
              setDocumentBlocks(document, aligned.content, fromFile);
              setDocumentProperties(document, aligned.properties, fromFile);
            }, fromFile);
          }
        }
        void vault.documents.setFileHash(id, file.hash);
        open.current = current;
        ready(current);
      } catch (error) {
        if (!cancelled()) {
          setState({
            status: "failed",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    })();
    return () => {
      controller.abort();
      // Leaving the note saves what is waiting at once, then lets the document go.
      const current = open.current;
      if (current === undefined) return;
      open.current = undefined;
      void (async () => {
        await flush(current);
        current.closed = true;
        clearTimeout(current.timer);
        await persist(current);
        current.document.destroy();
      })();
    };
  }, [vault, id, ready, flush, persist]);

  // The editor's edits mark the document for writing to the file.
  useEffect(() => {
    if (state.status !== "ready") return;
    const current = open.current;
    if (current?.document !== state.document) return;
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === fromFile) return;
      current.dirty = true;
      schedule(current);
    };
    current.document.on("update", onUpdate);
    if (current.dirty) schedule(current);
    return () => {
      current.document.off("update", onUpdate);
    };
  }, [state, schedule]);

  // When another app changes the file, merge its edit into the document.
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
      if (current === undefined || current.saving !== undefined) return;
      void vault.read(id).then((file) => {
        if (
          file.missing === true ||
          file.binary === true ||
          file.hash === current.hash ||
          open.current !== current
        ) {
          return;
        }
        mergeFile(current, file.text, file.hash);
        if (current.dirty) schedule(current);
        // Source mode shows the file as it is now, unless typing is waiting to be saved.
        if (current.text === undefined) ready(current);
      });
    });
  }, [vault, id, mergeFile, schedule, ready]);

  const editText = useCallback(
    (text: string) => {
      const current = open.current;
      if (current === undefined) return;
      current.text = text;
      schedule(current);
    },
    [schedule],
  );

  const refresh = useCallback(async () => {
    const current = open.current;
    if (current === undefined) return;
    await flush(current);
    if (open.current === current) ready(current);
  }, [flush, ready]);

  return { state, saveError, editText, refresh };
}
