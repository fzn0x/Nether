// A note's comment threads in its editor (ADR 0044): the text each thread
// the app shows is on is highlighted, the active one more, and clicking a
// highlight makes its thread active. A new thread's anchor is made from a
// range of the editor's document, as Yjs relative positions in the note's
// document, so it follows the text through everyone's edits; where that
// text is gone, the thread's block stands in for it.
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";
import type { CommentAnchor, CommentThread } from "./comments.ts";

/** The longest quote a thread keeps of the text it is on. */
const quoteLength = 300;

/** What the highlights show: the threads, and the one active. */
export interface CommentHighlightState {
  readonly threads: readonly CommentThread[];
  readonly active: string | undefined;
}

interface PluginState extends CommentHighlightState {
  readonly decorations: DecorationSet;
}

export const commentHighlightsKey = new PluginKey<PluginState>("commentHighlights");

export interface CommentHighlightOptions {
  /** Called with a thread when its highlighted text is clicked. */
  readonly onActivate: (thread: string) => void;
  /** Starts a thread on the selection, as its shortcut asks; whether it did. */
  readonly onComment: (state: EditorState) => boolean;
}

/** The block a position is in: the nearest node around it with an ID. */
function blockAt(doc: ProseMirrorNode, position: number): { id: string; pos: number } | undefined {
  const resolved = doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth);
    if (typeof node.attrs.id === "string")
      return { id: node.attrs.id, pos: resolved.before(depth) };
  }
  return undefined;
}

/** A block's text, from its start to its end, by its ID. */
function blockRange(doc: ProseMirrorNode, id: string): { from: number; to: number } | undefined {
  let found: { from: number; to: number } | undefined;
  doc.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (node.attrs.id === id) {
      found = { from: pos + 1, to: pos + node.nodeSize - 1 };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * An anchor for a range of the editor's document: undefined when the range
 * is empty, or the editor is not bound to a Yjs document.
 */
export function commentAnchor(
  state: EditorState,
  from: number,
  to: number,
): CommentAnchor | undefined {
  const sync = ySyncPluginKey.getState(state);
  if (sync === undefined || to <= from) return undefined;
  const { type, binding } = sync;
  const position = (at: number) =>
    Y.encodeRelativePosition(absolutePositionToRelativePosition(at, type, binding.mapping));
  return {
    start: position(from),
    end: position(to),
    block: blockAt(state.doc, from)?.id,
    quote: state.doc.textBetween(from, to, " ", " ").slice(0, quoteLength),
  };
}

/** An anchor for what is selected, or, with nothing selected, for the block the caret is in. */
export function selectionAnchor(state: EditorState): CommentAnchor | undefined {
  const { from, to, empty } = state.selection;
  if (!empty) return commentAnchor(state, from, to);
  const block = blockAt(state.doc, from);
  const range = block === undefined ? undefined : blockRange(state.doc, block.id);
  return range === undefined ? undefined : commentAnchor(state, range.from, range.to);
}

/** An anchor for the whole of the block at a position, as its menu comments on it. */
export function blockAnchor(state: EditorState, pos: number): CommentAnchor | undefined {
  const node = state.doc.nodeAt(pos);
  if (node === null) return undefined;
  return commentAnchor(state, pos + 1, pos + node.nodeSize - 1);
}

/** Where a thread is in the editor's document now: its range, or its block's, or nowhere. */
export function threadRange(
  state: EditorState,
  anchor: CommentAnchor,
): { from: number; to: number } | undefined {
  const sync = ySyncPluginKey.getState(state);
  if (sync !== undefined) {
    const position = (bytes: Uint8Array) => {
      try {
        return relativePositionToAbsolutePosition(
          sync.doc,
          sync.type,
          Y.decodeRelativePosition(bytes),
          sync.binding.mapping,
        );
      } catch {
        return null;
      }
    };
    const from = position(anchor.start);
    const to = position(anchor.end);
    if (from !== null && to !== null && to > from && to <= state.doc.content.size) {
      return { from, to };
    }
  }
  return anchor.block === undefined ? undefined : blockRange(state.doc, anchor.block);
}

function decorate(state: EditorState, shown: CommentHighlightState): DecorationSet {
  const decorations: Decoration[] = [];
  for (const thread of shown.threads) {
    const range = threadRange(state, thread.anchor);
    if (range === undefined) continue;
    const active = thread.id === shown.active;
    decorations.push(
      Decoration.inline(
        range.from,
        range.to,
        {
          class: active ? "comment-highlight active" : "comment-highlight",
          "data-thread": thread.id,
        },
        { thread: thread.id },
      ),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

/** Whether a transaction is the Yjs binding showing what changed in the note's document. */
function fromDocument(meta: unknown): boolean {
  return (
    typeof meta === "object" &&
    meta !== null &&
    (meta as { isChangeOrigin?: unknown }).isChangeOrigin === true
  );
}

export const CommentHighlights = Extension.create<CommentHighlightOptions>({
  name: "commentHighlights",

  addOptions() {
    return { onActivate: () => undefined, onComment: () => false };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-m": () => this.options.onComment(this.editor.state),
    };
  },

  addProseMirrorPlugins() {
    const { onActivate } = this.options;
    return [
      new Plugin<PluginState>({
        key: commentHighlightsKey,
        state: {
          init: (_config, state) => ({
            threads: [],
            active: undefined,
            decorations: DecorationSet.create(state.doc, []),
          }),
          apply: (tr, value, _old, state) => {
            const shown = tr.getMeta(commentHighlightsKey) as CommentHighlightState | undefined;
            if (shown !== undefined) return { ...shown, decorations: decorate(state, shown) };
            if (!tr.docChanged) return value;
            // The document changed from the note's: the threads are found
            // anew. Edits made here move them as they move the text.
            if (fromDocument(tr.getMeta(ySyncPluginKey))) {
              return { ...value, decorations: decorate(state, value) };
            }
            return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => commentHighlightsKey.getState(state)?.decorations,
          handleClick: (view, pos) => {
            const found = commentHighlightsKey.getState(view.state)?.decorations.find(pos, pos);
            const thread = (found?.[0]?.spec as { thread?: unknown } | undefined)?.thread;
            if (typeof thread === "string") onActivate(thread);
            return false;
          },
        },
      }),
    ];
  },
});
