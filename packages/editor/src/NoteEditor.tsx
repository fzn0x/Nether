// The editor for one note, in React. It starts from the note's blocks and
// reports its blocks after every change; the caller decides when to save.
// The slash menu inserts blocks, the handle beside each block moves it or
// opens its menu, and rich blocks such as math render in place.
import { type ContentBlock, newBlockId } from "@nether/core";
import Collaboration from "@tiptap/extension-collaboration";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { BlockKeys } from "./actions.ts";
import { BlockHandle } from "./BlockHandle.tsx";
import { blockCommands } from "./commands.ts";
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
  } = props;
  // The latest callback, so the editor need not be made again when it changes.
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  const commands = useMemo(() => blockCommands(words), [words]);

  const editor = useEditor({
    extensions: [
      ...netherExtensions({
        nodeViews: netherNodeViews(words, files, links, 0, previews),
        history: document === undefined,
      }),
      ...(document === undefined
        ? []
        : [Collaboration.configure({ document, field: contentField })]),
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
  });

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
      {editable ? <BlockHandle editor={editor} commands={commands} words={words} /> : null}
    </div>
  );
}
