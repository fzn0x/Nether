// Links between notes in the editor: `[[` opens a menu of the notes, and
// their headings after `#`, that the app finds for what is typed; a link
// opens its note on a click, or on Enter when it is selected.
import type { LinkTarget } from "@nether/core";
import { type Editor, Extension, type Range } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
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
}

/** The notes a note links to, which the app that shows it knows. */
export interface NoteLinks {
  /** What `[[` suggests for the text typed after it. */
  suggest(query: string): readonly LinkSuggestion[];
  /** Opens what a link names, making the note first when the vault has none by that name. */
  open(target: LinkTarget): void;
}

export interface LinkMenuOptions {
  readonly links: NoteLinks | undefined;
  readonly words: EditorWords;
}

export const linkMenuKey = new PluginKey("linkMenu");

/** Opens a selected link with Enter, as a click does. */
function openSelected(editor: Editor, links: NoteLinks): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "wikiLink")
    return false;
  links.open(selection.node.attrs.target as LinkTarget);
  return true;
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
        items: ({ query }) => [...links.suggest(query)],
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
          handleClickOn: (_view, _pos, node) => {
            if (node.type.name !== "wikiLink") return false;
            links.open(node.attrs.target as LinkTarget);
            return true;
          },
        },
      }),
    ];
  },
});
