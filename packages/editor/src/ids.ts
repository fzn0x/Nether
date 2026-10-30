// Block IDs in the editor. Every block node has one, and no two in a note
// share one: a block made by typing, pasting or splitting gets a new ID,
// and a copy pasted next to its original gets its own. TipTap's Unique ID
// extension checks only what changed against itself, so a pasted copy of a
// block elsewhere in the note kept the original's ID; this checks the note.
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

export interface BlockIdOptions {
  /** The node types that are blocks with IDs. */
  readonly types: readonly string[];
  readonly generate: () => string;
}

export const blockIdsKey = new PluginKey("blockIds");

/**
 * Gives every block without an ID, or with one an earlier block has, a new
 * one. When Enter at the start of a block leaves an empty block before it
 * with the same ID, the block that keeps the text keeps the ID.
 */
export function fixBlockIds(state: EditorState, options: BlockIdOptions): Transaction | null {
  const blocks: { node: ProseMirrorNode; pos: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (options.types.includes(node.type.name)) blocks.push({ node, pos });
    return true;
  });
  const seen = new Set<string>();
  const ids = blocks.map(({ node }) => (typeof node.attrs.id === "string" ? node.attrs.id : null));
  for (let index = 0; index + 1 < blocks.length; index++) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (
      block !== undefined &&
      next !== undefined &&
      ids[index] !== null &&
      ids[index] === ids[index + 1] &&
      block.node.content.size === 0 &&
      next.node.content.size > 0 &&
      block.node.type === next.node.type
    ) {
      ids[index] = null;
    }
  }
  const tr = state.tr;
  let changed = false;
  for (const [index, { node, pos }] of blocks.entries()) {
    let id = ids[index] ?? null;
    if (id !== null && seen.has(id)) id = null;
    if (id === null) {
      do id = options.generate();
      while (seen.has(id) || ids.includes(id));
    }
    seen.add(id);
    if (node.attrs.id !== id) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
      changed = true;
    }
  }
  if (!changed) return null;
  return tr.setMeta(blockIdsKey, true).setMeta("addToHistory", false);
}

export const BlockIds = Extension.create<BlockIdOptions>({
  name: "blockIds",

  addOptions() {
    return { types: [], generate: () => crypto.randomUUID() };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...this.options.types],
        attributes: {
          id: {
            default: null,
            // A split leaves the new half without an ID, for the plugin to give it one.
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-id"),
            renderHTML: (attributes) =>
              typeof attributes.id === "string" ? { "data-id": attributes.id } : {},
          },
        },
      },
    ];
  },

  onCreate() {
    const tr = fixBlockIds(this.editor.state, this.options);
    if (tr !== null) this.editor.view.dispatch(tr);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdsKey,
        appendTransaction: (transactions, _before, state) =>
          transactions.some((transaction) => transaction.docChanged)
            ? fixBlockIds(state, this.options)
            : null,
      }),
    ];
  },
});
