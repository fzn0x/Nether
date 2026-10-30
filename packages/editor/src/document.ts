// A note's Yjs document, which holds the editor's content (ADR 0003): its
// blocks read out, and blocks written in as the few edits Yjs needs, so
// an edit merged from the note's file joins the edits made meanwhile in
// the app, character by character.
import type { BlockId, ContentBlock } from "@nether/core";
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import type * as Y from "yjs";
import { fromEditor, toEditor } from "./convert.ts";
import { netherExtensions } from "./schema.ts";

/** The part of a note's document that holds its content, as ADR 0003 names it. */
export const contentField = "content";

let schema: Schema | undefined;

/** The editor's schema, made once. */
function editorSchema(): Schema {
  schema ??= getSchema(netherExtensions());
  return schema;
}

/** Whether a note's document holds no content yet, as for a note never opened. */
export function isEmptyDocument(document: Y.Doc): boolean {
  return document.getXmlFragment(contentField).length === 0;
}

/** A note's blocks as its document holds them; `newId` names a block that has no ID. */
export function documentBlocks(document: Y.Doc, newId: () => BlockId): ContentBlock[] {
  const fragment = document.getXmlFragment(contentField);
  if (fragment.length === 0) return [];
  const root = yXmlFragmentToProseMirrorRootNode(fragment, editorSchema());
  return fromEditor(root.toJSON() as Parameters<typeof fromEditor>[0], newId);
}

/**
 * Changes a note's document to hold `blocks`, in the fewest edits: blocks
 * that are the same stay as they are, and text changes inside a block as
 * the characters that differ. `origin` marks the Yjs transaction, so the
 * app can tell these edits from the editor's.
 */
export function setDocumentBlocks(
  document: Y.Doc,
  blocks: readonly ContentBlock[],
  origin?: unknown,
): void {
  const node = editorSchema().nodeFromJSON(toEditor(blocks));
  const source = {
    transact: (change: () => void) => {
      document.transact(change, origin);
    },
  };
  updateYFragment(source, document.getXmlFragment(contentField), node, {
    mapping: new Map(),
    isOMark: new Map(),
  });
}
