// A note, or a part of one, embedded in another, as Obsidian embeds
// `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]`: its blocks, read
// only, drawn by the same views as the note they come from. Embeds inside
// an embed go one level deeper at most, so notes that embed each other end.
import type { ContentBlock, LinkTarget } from "@nether/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { toEditor } from "./convert.ts";
import type { NoteFiles } from "./files.ts";
import { LinkMenu, type NoteLinks } from "./LinkMenu.tsx";
import { netherExtensions } from "./schema.ts";
import { netherNodeViews } from "./views.tsx";
import type { EditorWords } from "./words.ts";

/** How many embeds deep a note shows; deeper ones show as their links. */
export const embedDepth = 2;

/** A note, or a part of one, as an embed shows it. */
export interface EmbeddedNote {
  readonly title: string;
  readonly blocks: readonly ContentBlock[];
}

function ReadOnlyBlocks(props: {
  readonly blocks: readonly ContentBlock[];
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
  readonly links: NoteLinks | undefined;
  readonly depth: number;
}) {
  const { blocks, words, files, links, depth } = props;
  const editor = useEditor({
    extensions: [
      ...netherExtensions({ nodeViews: netherNodeViews(words, files, links, depth + 1) }),
      LinkMenu.configure({ links, words }),
    ],
    content: toEditor(blocks),
    editable: false,
    editorProps: { attributes: { class: "nether-editor note-embed-content" } },
  });
  return <EditorContent editor={editor} />;
}

export function NoteEmbed(props: {
  readonly target: LinkTarget;
  /** The link as written, which the embed shows above its content. */
  readonly label: string;
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
  readonly links: NoteLinks | undefined;
  readonly depth: number;
}) {
  const { target, label, words, files, links, depth } = props;
  const [note, setNote] = useState<EmbeddedNote | "loading" | "missing">("loading");
  const key = JSON.stringify(target);

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
    // The target is compared by its JSON, which `key` holds.
  }, [key, links]);

  if (note === "loading") return <p className="embed-loading">{label}</p>;
  if (note === "missing") {
    return (
      <p className="missing-file" role="note">
        {words.missingNote}: <span className="missing-link">{label}</span>
      </p>
    );
  }
  return (
    <figure className="note-embed">
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
      <ReadOnlyBlocks
        blocks={note.blocks}
        words={words}
        files={files}
        links={links}
        depth={depth}
      />
    </figure>
  );
}
