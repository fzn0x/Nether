// A note's Yjs document, which holds the editor's content (ADR 0003): its
// blocks read out, and blocks written in as the few edits Yjs needs, so
// an edit merged from the note's file joins the edits made meanwhile in
// the app, character by character.
import type { BlockId, ContentBlock, JsonValue, PropertyEntry } from "@nether/core";
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

/** The parts of a note's document that hold its properties: each key's value, and the keys' order. */
export const propertiesField = "properties";
export const propertyOrderField = "propertyOrder";

/** A note's properties as its document holds them, in their order; keys not ordered go last, sorted. */
export function documentProperties(document: Y.Doc): PropertyEntry[] {
  const values = document.getMap<JsonValue>(propertiesField);
  const order = document.getArray<string>(propertyOrderField).toArray();
  const ordered = order.filter((key, index) => values.has(key) && order.indexOf(key) === index);
  const rest = [...values.keys()].filter((key) => !ordered.includes(key)).sort();
  return [...ordered, ...rest].map((key) => ({ key, value: values.get(key) ?? null }));
}

/** Changes a note's document to hold `entries` as its properties, changing only the keys that differ. */
export function setDocumentProperties(
  document: Y.Doc,
  entries: readonly PropertyEntry[],
  origin?: unknown,
): void {
  document.transact(() => {
    const values = document.getMap<JsonValue>(propertiesField);
    const wanted = new Map(entries.map((entry) => [entry.key, entry.value]));
    for (const key of [...values.keys()]) if (!wanted.has(key)) values.delete(key);
    for (const { key, value } of entries) {
      if (JSON.stringify(values.get(key)) !== JSON.stringify(value)) values.set(key, value);
    }
    const order = document.getArray<string>(propertyOrderField);
    const keys = entries.map((entry) => entry.key);
    if (JSON.stringify(order.toArray()) !== JSON.stringify(keys)) {
      order.delete(0, order.length);
      order.insert(0, keys);
    }
  }, origin);
}
