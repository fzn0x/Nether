// The editor for one note, in React. It starts from the note's blocks and
// reports its blocks after every change; the caller decides when to save.
// The slash menu inserts blocks, the handle beside each block moves it or
// opens its menu, and rich blocks such as math render in place.
import { type ContentBlock, newBlockId } from "@nether/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { BlockKeys } from "./actions.ts";
import { BlockHandle } from "./BlockHandle.tsx";
import { blockCommands } from "./commands.ts";
import { fromEditor, toEditor } from "./convert.ts";
import { blockIdsKey } from "./ids.ts";
import { netherExtensions } from "./schema.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { netherNodeViews } from "./views.tsx";
import { type EditorWords, englishWords } from "./words.ts";

export interface NoteEditorProps {
  /** The note's blocks when the editor opens; later changes to it are not applied. */
  readonly blocks: readonly ContentBlock[];
  /** Called with the note's blocks after each change the user makes. */
  readonly onChange: (blocks: ContentBlock[]) => void;
  /** What an empty note shows. */
  readonly placeholder?: string;
  /** The accessible name of the editing area. */
  readonly label: string;
  readonly autofocus?: boolean;
  /** The editor's words in the app's language; English by default. */
  readonly words?: EditorWords;
}

export function NoteEditor(props: NoteEditorProps) {
  const {
    blocks,
    onChange,
    placeholder = "",
    label,
    autofocus = false,
    words = englishWords,
  } = props;
  // The latest callback, so the editor need not be made again when it changes.
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  const commands = useMemo(() => blockCommands(words), [words]);

  const editor = useEditor({
    extensions: [
      ...netherExtensions({ nodeViews: netherNodeViews(words) }),
      Placeholder.configure({ placeholder }),
      SlashMenu.configure({ commands, words }),
      BlockKeys,
    ],
    content: toEditor(blocks),
    autofocus,
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
      changed.current(fromEditor(current.getJSON(), () => newBlockId()));
    },
  });

  return (
    <div className="note-editor">
      <EditorContent editor={editor} />
      <BlockHandle editor={editor} commands={commands} words={words} />
    </div>
  );
}
