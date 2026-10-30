// What can be done to a whole block: move it up or down among its
// siblings, duplicate it, delete it, or turn it into another type. The
// block menu runs these on the block beside its handle, and the keyboard
// shortcuts on the block that holds the caret, so nothing needs a drag.
import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import type { BlockCommand } from "./commands.ts";

export interface BlockAt {
  readonly node: ProseMirrorNode;
  readonly pos: number;
}

const listItems = new Set(["listItem", "taskItem"]);
/** The list each list command makes. */
const lists: Readonly<Record<string, string>> = {
  bulletList: "bulletList",
  numberedList: "orderedList",
  taskList: "taskList",
};
/** Parts of a block, which stand for the block around them. */
const parts = new Set([
  "tableRow",
  "tableHeader",
  "tableCell",
  "calloutTitle",
  "detailsSummary",
  "detailsContent",
]);
const cells = new Set(["tableHeader", "tableCell"]);

function blockAround($pos: ResolvedPos): BlockAt | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    const parent = $pos.node(depth - 1);
    if (parts.has(node.type.name) || cells.has(parent.type.name)) continue;
    // A list item's first line stands for the item.
    if (listItems.has(parent.type.name) && $pos.index(depth - 1) === 0) continue;
    return { node, pos: $pos.before(depth) };
  }
  return null;
}

/** The node at `pos`, if `pos` is still in the note: a menu's block may have gone. */
function nodeAt(editor: Editor, pos: number): ProseMirrorNode | null {
  const { doc } = editor.state;
  return pos >= 0 && pos < doc.content.size ? doc.nodeAt(pos) : null;
}

/** The block the caret is in, or the block selected. */
export function currentBlock(editor: Editor): BlockAt | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) return { node: selection.node, pos: selection.from };
  return blockAround(selection.$from);
}

/**
 * Moves the block at `pos` above the sibling before it, or below the one
 * after it, keeping the caret where it was in the block. Does nothing at
 * either end, or where the swap would break what the parent may hold, such
 * as a callout's title, which stays first.
 */
export function moveBlock(editor: Editor, pos: number, direction: -1 | 1): boolean {
  const { state } = editor;
  const node = nodeAt(editor, pos);
  if (node === null) return false;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const otherIndex = index + direction;
  if (otherIndex < 0 || otherIndex >= parent.childCount) return false;
  const other = parent.child(otherIndex);
  const swapped = parent.content.replaceChild(index, other).replaceChild(otherIndex, node);
  if (!parent.type.validContent(swapped)) return false;
  const newPos = direction < 0 ? pos - other.nodeSize : pos + other.nodeSize;
  const { selection } = state;
  const tr = state.tr;
  if (direction < 0) {
    tr.delete(pos, pos + node.nodeSize).insert(newPos, node);
  } else {
    tr.insert(pos + node.nodeSize + other.nodeSize, node).delete(pos, pos + node.nodeSize);
  }
  if (selection instanceof NodeSelection && selection.from === pos) {
    tr.setSelection(NodeSelection.create(tr.doc, newPos));
  } else if (selection.from >= pos && selection.to <= pos + node.nodeSize) {
    tr.setSelection(
      TextSelection.create(tr.doc, newPos + (selection.from - pos), newPos + (selection.to - pos)),
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Puts a copy of the block right after it; the copy gets IDs of its own. */
export function duplicateBlock(editor: Editor, pos: number): boolean {
  const node = nodeAt(editor, pos);
  if (node === null) return false;
  const after = pos + node.nodeSize;
  const tr = editor.state.tr.insert(after, node);
  tr.setSelection(
    node.isAtom ? NodeSelection.create(tr.doc, after) : Selection.near(tr.doc.resolve(after + 1)),
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Deletes the block, and the list or other block around it if that is left empty. */
export function deleteBlock(editor: Editor, pos: number): boolean {
  const node = nodeAt(editor, pos);
  if (node === null) return false;
  editor.view.dispatch(editor.state.tr.deleteRange(pos, pos + node.nodeSize).scrollIntoView());
  return true;
}

/** Whether the block menu can turn the block into another type. */
export function canTurn(node: ProseMirrorNode): boolean {
  return (
    node.isTextblock || (listItems.has(node.type.name) && node.firstChild?.isTextblock === true)
  );
}

/**
 * Turns the block at `pos` into what the command makes. A list item turned
 * into anything but another list leaves its list first.
 */
export function turnBlockInto(editor: Editor, pos: number, command: BlockCommand): boolean {
  const node = nodeAt(editor, pos);
  if (node === null || command.turns === undefined || !canTurn(node)) return false;
  // The caret goes into the block's line of text, where the command acts.
  const isItem = listItems.has(node.type.name);
  if (isItem && lists[command.id] === editor.state.doc.resolve(pos).parent.type.name) return true;
  editor.commands.setTextSelection(isItem ? pos + 2 : pos + 1);
  if (isItem && command.turns !== "list") {
    editor.chain().focus().liftListItem(node.type.name).run();
    if (command.id === "text") return true;
  }
  command.run(editor);
  return true;
}

/** Keyboard shortcuts for the block that holds the caret. */
export const BlockKeys = Extension.create({
  name: "blockKeys",

  addKeyboardShortcuts() {
    const on = (action: (editor: Editor, block: BlockAt) => boolean) => () => {
      const block = currentBlock(this.editor);
      return block !== null && action(this.editor, block);
    };
    return {
      "Mod-Shift-ArrowUp": on((editor, block) => moveBlock(editor, block.pos, -1)),
      "Mod-Shift-ArrowDown": on((editor, block) => moveBlock(editor, block.pos, 1)),
      "Mod-d": on((editor, block) => duplicateBlock(editor, block.pos)),
    };
  },
});
