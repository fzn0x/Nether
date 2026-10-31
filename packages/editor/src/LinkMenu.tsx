// Links between notes in the editor: `[[` opens a menu of the notes, and
// their headings after `#`, that the app finds for what is typed; a link
// opens its note, and a tag the notes with it, on a click, or on Enter
// when it is selected.
import type { ContentBlock, LinkTarget } from "@nether/core";
import { type Editor, Extension, type Range } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { ReactNode } from "react";
import { popupMenu } from "./PopupMenu.tsx";
import { type EditorWords, englishWords } from "./words.ts";

/** A note, or a part of one, that `[[` can link to. */
export interface LinkSuggestion {
  /** Tells it apart from the other suggestions. */
  readonly key: string;
  readonly title: string;
  /** Shown after the title: the note's folder, or the note an alias or heading is in. */
  readonly detail?: string;
  readonly target: LinkTarget;
  /** The text the link shows, as `[[Roadmap|Plan]]` shows Plan. */
  readonly alias?: string;
  /** Called when the link goes in, as to write the `^id` of a block the link names. */
  readonly onChoose?: () => void;
}

/** The notes a note links to, which the app that shows it knows. */
export interface NoteLinks {
  /** What `[[` suggests for the text typed after it. */
  suggest(query: string): readonly LinkSuggestion[];
  /**
   * What `[[` suggests once it names a note's blocks, as `[[Note#^` and then
   * text to find a block by, read from the note; undefined for other text.
   */
  suggestBlocks?(query: string): Promise<readonly LinkSuggestion[]> | undefined;
  /** Opens what a link names, making the note first when the vault has none by that name. */
  open(target: LinkTarget): void;
  /** Shows the notes with a tag, as a tag in a note does when clicked. */
  openTag?(name: string): void;
  /**
   * The note, or the part of one, an embed names, with its title, for the
   * embed to show; undefined when the vault has no such note or part.
   * `synced` is true for a block of another note, which edits in place.
   */
  embed?(target: LinkTarget): Promise<
    | {
        readonly title: string;
        readonly blocks: readonly ContentBlock[];
        readonly synced?: boolean;
      }
    | undefined
  >;
  /**
   * Writes a synced block, edited where it is embedded, to the note it
   * comes from; rejects with why it could not.
   */
  saveEmbed?(target: LinkTarget, block: ContentBlock): Promise<void>;
  /** Calls `listener` whenever the note an embed comes from changes; returns what stops it. */
  watchEmbed?(target: LinkTarget, listener: () => void): () => void;
  /**
   * What a `base` code block shows below its code: the notes its query
   * finds, as Obsidian shows a base embedded in a note.
   */
  renderQuery?(source: string): ReactNode;
}

export interface LinkMenuOptions {
  readonly links: NoteLinks | undefined;
  readonly words: EditorWords;
}

export const linkMenuKey = new PluginKey("linkMenu");

/** Opens what a link or tag names; false for other nodes. */
function openNode(node: ProseMirrorNode, links: NoteLinks): boolean {
  if (node.type.name === "wikiLink") {
    links.open(node.attrs.target as LinkTarget);
    return true;
  }
  if (node.type.name === "tag" && links.openTag !== undefined) {
    links.openTag(String(node.attrs.name));
    return true;
  }
  return false;
}

/** Opens a selected link or tag with Enter, as a click does. */
function openSelected(editor: Editor, links: NoteLinks): boolean {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && openNode(selection.node, links);
}

export const LinkMenu = Extension.create<LinkMenuOptions>({
  name: "linkMenu",

  addOptions() {
    return { links: undefined, words: englishWords };
  },

  addKeyboardShortcuts() {
    const { links } = this.options;
    if (links === undefined) return {};
    return { Enter: ({ editor }) => openSelected(editor, links) };
  },

  addProseMirrorPlugins() {
    const { links, words } = this.options;
    if (links === undefined) return [];
    return [
      Suggestion<LinkSuggestion, LinkSuggestion>({
        editor: this.editor,
        pluginKey: linkMenuKey,
        char: "[[",
        // Titles have spaces, and a link can follow any character.
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.spec.code !== true,
        items: async ({ query }) => [
          ...((await links.suggestBlocks?.(query)) ?? links.suggest(query)),
        ],
        command: ({
          editor,
          range,
          props: choice,
        }: {
          editor: Editor;
          range: Range;
          props: LinkSuggestion;
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikiLink",
              attrs: { target: choice.target, alias: choice.alias ?? null },
            })
            .run();
          choice.onChoose?.();
        },
        render: popupMenu<LinkSuggestion>({
          describe: (choice) => ({
            key: choice.key,
            title: choice.title,
            ...(choice.detail === undefined ? {} : { detail: choice.detail }),
          }),
          label: words.linkMenu,
          empty: words.noNotes,
        }),
      }),
      new Plugin({
        key: new PluginKey("linkClicks"),
        props: {
          handleClickOn: (_view, _pos, node) => openNode(node, links),
        },
      }),
    ];
  },
});
