// The editor for one note, in React. It starts from the note's blocks and
// reports its blocks after every change; the caller decides when to save.
// The slash menu inserts blocks, the handle beside each block moves it or
// opens its menu, and rich blocks such as math render in place. With others
// editing the note at once, their carets and selections show, each with
// their name (ADR 0043). The text its comment threads are on is highlighted
// (ADR 0044).
import { type ContentBlock, newBlockId } from "@nether/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { BlockKeys } from "./actions.ts";
import { BlockHandle } from "./BlockHandle.tsx";
import { blockCommands } from "./commands.ts";
import {
  CommentHighlights,
  blockAnchor,
  commentHighlightsKey,
  selectionAnchor,
  threadRange,
} from "./commentHighlights.ts";
import type { CommentAnchor, CommentThread } from "./comments.ts";
import { fromEditor, toEditor } from "./convert.ts";
import { contentField } from "./document.ts";
import { FileDrop, type NoteFiles } from "./files.ts";
import { blockIdsKey } from "./ids.ts";
import { LinkMenu, type NoteLinks } from "./LinkMenu.tsx";
import { type NotePart, findPart } from "./parts.ts";
import type { LinkPreviews } from "./previews.tsx";
import { netherExtensions } from "./schema.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { netherNodeViews } from "./views.tsx";
import { type EditorWords, englishWords } from "./words.ts";
import type * as Y from "yjs";

/** Others editing the note at once, and who this person is to them. */
export interface NoteCollaboration {
  /** What carries where each person is: a y-protocols awareness of the note's document. */
  readonly awareness: unknown;
  readonly user: { readonly name: string; readonly color: string };
}

/** The note's comment threads in its editor, with `document`. */
export interface NoteCommentsView {
  /** The threads to highlight. */
  readonly threads: readonly CommentThread[];
  /** The thread shown in the comments panel: highlighted more, and scrolled to. */
  readonly active: string | undefined;
  /** Called with a thread when its highlighted text is clicked. */
  readonly onActivate: (thread: string) => void;
  /**
   * Called with an anchor to start a thread on: the selection's, or the
   * block's. Absent where this person may not comment.
   */
  readonly onComment?: ((anchor: CommentAnchor) => void) | undefined;
  /** Changes when the app asks to comment on the selection, as its command does. */
  readonly request: number;
}

export interface NoteEditorProps {
  /**
   * The note's blocks when the editor opens, when no `document` holds them;
   * later changes to them are not applied.
   */
  readonly blocks?: readonly ContentBlock[];
  /**
   * The note's Yjs document, which then holds the content: the editor shows
   * what it holds, edits it, and shows the changes others make to it.
   */
  readonly document?: Y.Doc;
  /** Called with the note's blocks after each change the user makes. */
  readonly onChange?: (blocks: ContentBlock[]) => void;
  /** What an empty note shows. */
  readonly placeholder?: string;
  /** The accessible name of the editing area. */
  readonly label: string;
  readonly autofocus?: boolean;
  /** The editor's words in the app's language; English by default. */
  readonly words?: EditorWords;
  /** Finds the files the note links to, and adds those pasted or dropped into it. */
  readonly files?: NoteFiles;
  /** Suggests the notes `[[` links to, and opens the note a link names. */
  readonly links?: NoteLinks;
  /** Whether the note can be edited; read only, it shows no menus or handles. */
  readonly editable?: boolean;
  /** Previews of the note's web links, fetched when the user asks. */
  readonly previews?: LinkPreviews;
  /**
   * A heading or block to go to, as a link to a part of the note asks, or a
   * place in a block's text: the caret goes there and it scrolls into view.
   * A new `key` goes again.
   */
  readonly focus?: NotePart & { readonly key: number };
  /** Others editing at once, with `document`: the editor is made again when it changes. */
  readonly collaboration?: NoteCollaboration;
  /** The note's comment threads, with `document`. */
  readonly comments?: NoteCommentsView;
}

export function NoteEditor(props: NoteEditorProps) {
  const {
    blocks = [],
    document,
    onChange,
    placeholder = "",
    label,
    autofocus = false,
    words = englishWords,
    files,
    links,
    editable = true,
    focus,
    previews,
    collaboration,
    comments,
  } = props;
  // The latest callbacks, so the editor need not be made again when they change.
  const changed = useRef(onChange);
  const commented = useRef(comments);
  useEffect(() => {
    changed.current = onChange;
    commented.current = comments;
  }, [onChange, comments]);
  /** Starts a thread on an anchor, where comments are offered; whether it did. */
  const comment = (anchor: CommentAnchor | undefined): boolean => {
    const start = commented.current?.onComment;
    if (anchor === undefined || start === undefined) return false;
    start(anchor);
    return true;
  };

  const commands = useMemo(() => blockCommands(words), [words]);

  const editor = useEditor(
    {
      extensions: [
        ...netherExtensions({
          nodeViews: netherNodeViews(words, files, links, 0, previews),
          history: document === undefined,
        }),
        ...(document === undefined
          ? []
          : [Collaboration.configure({ document, field: contentField })]),
        ...(document === undefined || collaboration === undefined
          ? []
          : [
              CollaborationCaret.configure({
                provider: { awareness: collaboration.awareness },
                user: collaboration.user,
              }),
            ]),
        ...(document === undefined
          ? []
          : [
              CommentHighlights.configure({
                onActivate: (thread) => {
                  commented.current?.onActivate(thread);
                },
                onComment: (state) => comment(selectionAnchor(state)),
              }),
            ]),
        FileDrop.configure({ files }),
        Placeholder.configure({ placeholder }),
        SlashMenu.configure({ commands, words }),
        LinkMenu.configure({ links, words }),
        BlockKeys,
      ],
      ...(document === undefined ? { content: toEditor(blocks) } : {}),
      autofocus,
      editable,
      editorProps: {
        attributes: {
          class: "nether-editor",
          "aria-label": label,
          role: "textbox",
          "aria-multiline": "true",
        },
      },
      onUpdate: ({ editor: current, transaction }) => {
        // IDs the editor gives blocks as it loads, and other changes kept out of
        // the undo history, are not the user's edits.
        if (
          transaction.getMeta(blockIdsKey) === true ||
          transaction.getMeta("addToHistory") === false
        ) {
          return;
        }
        changed.current?.(fromEditor(current.getJSON(), () => newBlockId()));
      },
      // Others' carets come with a new editor: the content is the document's, and stays.
    },
    [collaboration],
  );

  // The threads' highlights follow the threads, and the active one is scrolled to.
  const threads = comments?.threads;
  const active = comments?.active;
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(commentHighlightsKey, { threads: threads ?? [], active }),
    );
  }, [editor, threads, active]);
  useEffect(() => {
    const thread = threads?.find((each) => each.id === active);
    if (thread === undefined || editor.isDestroyed) return;
    const range = threadRange(editor.state, thread.anchor);
    if (range === undefined) return;
    const { node } = editor.view.domAtPos(range.from);
    (node instanceof Element ? node : node.parentElement)?.scrollIntoView({ block: "nearest" });
    // Scrolled to when it becomes active, not as the threads change.
  }, [editor, active]);

  // The app's command comments on the selection; a request made before this editor does nothing.
  const request = comments?.request;
  const handledRequest = useRef(request);
  useEffect(() => {
    if (request === handledRequest.current) return;
    handledRequest.current = request;
    comment(selectionAnchor(editor.state));
  }, [editor, request]);

  // Goes to the heading or block a link names.
  const focusKey = focus?.key;
  useEffect(() => {
    if (focus === undefined) return;
    const position = findPart(editor.state.doc, focus);
    if (position === undefined) return;
    editor.chain().focus().setTextSelection(position).scrollIntoView().run();
    // A new key, not a new object, asks to go again.
  }, [editor, focusKey]);

  return (
    <div className="note-editor">
      <EditorContent editor={editor} />
      {editable ? (
        <BlockHandle
          editor={editor}
          commands={commands}
          words={words}
          onComment={
            comments?.onComment === undefined
              ? undefined
              : (pos) => {
                  comment(blockAnchor(editor.state, pos));
                }
          }
        />
      ) : null}
    </div>
  );
}
