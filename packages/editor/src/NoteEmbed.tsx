// A note, or a part of one, embedded in another, as Obsidian embeds
// `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]`: its blocks,
// drawn by the same views as the note they come from, and shown again when
// that note changes. Embeds inside an embed go one level deeper at most, so
// notes that embed each other end. A block of another note embedded by its
// ID is a synced block (ADR 0023): it edits in place, and its edits are
// written to the note it comes from, so every note that embeds it shows
// them.
import { type ContentBlock, type LinkTarget, newBlockId } from "@nether/core";
import { Extension, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { fromEditor, toEditor } from "./convert.ts";
import type { NoteFiles } from "./files.ts";
import { blockIdsKey } from "./ids.ts";
import { LinkMenu, type NoteLinks } from "./LinkMenu.tsx";
import { netherExtensions } from "./schema.ts";
import { netherNodeViews } from "./views.tsx";
import type { EditorWords } from "./words.ts";

/** How many embeds deep a note shows; deeper ones show as their links. */
export const embedDepth = 2;

/** How long after typing stops a synced block's edit is written, as a note's own are. */
const saveDelay = 500;

/** A note, or a part of one, as an embed shows it. */
export interface EmbeddedNote {
  readonly title: string;
  readonly blocks: readonly ContentBlock[];
  /** Whether it is a synced block, which edits in place. */
  readonly synced?: boolean;
}

const lists = new Set(["bulletList", "orderedList", "taskList"]);

/** How many blocks of the note a document holds: its blocks, a list's items each one. */
export function rootBlocks(doc: ProseMirrorNode): number {
  let count = 0;
  doc.forEach((child) => {
    count += lists.has(child.type.name) ? child.childCount : 1;
  });
  return count;
}

/**
 * A synced block's editor holds its one block. Enter in the block's own
 * line breaks the line, as Shift+Enter does, and what would make a second
 * block, as a paste of two paragraphs, is not done: the embed names one
 * block, and would not show another.
 */
export const OneBlock = Extension.create({
  name: "oneBlock",
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.spec.code === true) return false;
        // The block's own line: a top-level textblock, or a top-level item's first line.
        const root = $from.node(1);
        const own = lists.has(root.type.name) ? $from.depth <= 3 : $from.depth <= 1;
        return own && editor.commands.setHardBreak();
      },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: (tr) => !tr.docChanged || rootBlocks(tr.doc) <= 1 })];
  },
});

function ReadOnlyBlocks(props: {
  readonly title: string;
  readonly blocks: readonly ContentBlock[];
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
  readonly links: NoteLinks | undefined;
  readonly depth: number;
}) {
  const { title, blocks, words, files, links, depth } = props;
  const editor = useEditor({
    extensions: [
      ...netherExtensions({ nodeViews: netherNodeViews(words, files, links, depth + 1) }),
      LinkMenu.configure({ links, words }),
    ],
    content: toEditor(blocks),
    editable: false,
    editorProps: {
      attributes: {
        class: "nether-editor note-embed-content",
        "aria-label": `${words.embeddedNote}: ${title}`,
        "aria-readonly": "true",
      },
    },
  });
  // The note changed: the embed shows it as it is now.
  const shown = useRef(blocks);
  useEffect(() => {
    if (shown.current === blocks) return;
    shown.current = blocks;
    editor.commands.setContent(toEditor(blocks), { emitUpdate: false });
  }, [editor, blocks]);
  return <EditorContent editor={editor} />;
}

function SyncedBlock(props: {
  readonly target: LinkTarget;
  readonly title: string;
  readonly block: ContentBlock;
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
  readonly links: NoteLinks | undefined;
  /** Writes the block, edited, to its note. */
  readonly save: (target: LinkTarget, block: ContentBlock) => Promise<void>;
  readonly depth: number;
}) {
  const { target, title, block, words, files, links, save, depth } = props;
  const [failed, setFailed] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The editor's content after its last edit, waiting to be written.
  const edits = useRef<JSONContent | undefined>(undefined);
  // The block as last loaded or written, so a write of what is there is not made.
  const written = useRef(JSON.stringify(block));
  const loaded = useRef(block);

  const write = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const content = edits.current;
    edits.current = undefined;
    if (content === undefined) return;
    const [edited] = fromEditor(content, () => newBlockId());
    if (edited === undefined) return;
    // The block keeps the ID its embeds name, whatever it was turned into.
    const next = { ...edited, id: block.id } as ContentBlock;
    const text = JSON.stringify(next);
    if (text === written.current) return;
    written.current = text;
    save(target, next).then(
      () => {
        setFailed(undefined);
      },
      (error: unknown) => {
        setFailed(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const editor = useEditor({
    extensions: [
      ...netherExtensions({ nodeViews: netherNodeViews(words, files, links, depth + 1) }),
      LinkMenu.configure({ links, words }),
      OneBlock,
    ],
    content: toEditor([block]),
    editorProps: {
      attributes: {
        class: "nether-editor synced-block-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": `${words.syncedBlock} ${title}`,
      },
    },
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta(blockIdsKey) === true) return;
      edits.current = current.getJSON();
      clearTimeout(timer.current);
      timer.current = setTimeout(write, saveDelay);
    },
    onBlur: write,
  });

  // Leaving the note writes what is waiting.
  useEffect(() => write, []);

  // The note changed, by another embed of the block or another app: the
  // block shows it, unless it is being written here, whose edit is newer.
  useEffect(() => {
    if (loaded.current === block) return;
    loaded.current = block;
    if (editor.isFocused || edits.current !== undefined) return;
    written.current = JSON.stringify(block);
    editor.commands.setContent(toEditor([block]), { emitUpdate: false });
  }, [editor, block]);

  return (
    <>
      <EditorContent editor={editor} />
      {failed === undefined ? null : (
        <p className="embed-failed" role="alert">
          {words.syncFailed} {failed}
        </p>
      )}
    </>
  );
}

export function NoteEmbed(props: {
  readonly target: LinkTarget;
  /** The link as written, which the embed shows above its content. */
  readonly label: string;
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
  readonly links: NoteLinks | undefined;
  readonly depth: number;
  /** Whether the note the embed is in can be edited, and so its synced blocks. */
  readonly editable: boolean;
}) {
  const { target, label, words, files, links, depth, editable } = props;
  const [note, setNote] = useState<EmbeddedNote | "loading" | "missing">("loading");
  const [changes, setChanges] = useState(0);
  const key = JSON.stringify(target);

  // Each change to the note the embed comes from reads it again.
  useEffect(
    () =>
      links?.watchEmbed?.(target, () => {
        setChanges((count) => count + 1);
      }),
    // The target is compared by its JSON, which `key` holds.
    [key, links],
  );

  useEffect(() => {
    let current = true;
    const loading = links?.embed?.(target) ?? Promise.resolve(undefined);
    void loading.then(
      (found) => {
        if (current) setNote(found ?? "missing");
      },
      () => {
        if (current) setNote("missing");
      },
    );
    return () => {
      current = false;
    };
  }, [key, links, changes]);

  if (note === "loading") return <p className="embed-loading">{label}</p>;
  if (note === "missing") {
    return (
      <p className="missing-file" role="note">
        {words.missingNote}: <span className="missing-link">{label}</span>
      </p>
    );
  }
  const [block] = note.blocks;
  const save = links?.saveEmbed?.bind(links);
  const synced =
    note.synced === true &&
    editable &&
    depth === 0 &&
    note.blocks.length === 1 &&
    block !== undefined &&
    save !== undefined;
  return (
    <figure className={synced ? "note-embed synced-block" : "note-embed"}>
      <figcaption>
        <button
          type="button"
          className="note-embed-title"
          onClick={() => {
            links?.open(target);
          }}
        >
          {note.title}
        </button>
      </figcaption>
      {synced ? (
        <SyncedBlock
          target={target}
          title={note.title}
          block={block}
          words={words}
          files={files}
          links={links}
          save={save}
          depth={depth}
        />
      ) : (
        <ReadOnlyBlocks
          title={note.title}
          blocks={note.blocks}
          words={words}
          files={files}
          links={links}
          depth={depth}
        />
      )}
    </figure>
  );
}
