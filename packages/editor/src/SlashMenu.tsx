// The slash menu: `/` at the start of a line or after a space opens a list
// of blocks to insert, which narrows as you type. Not in code, where a
// slash is a slash.
import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { type BlockCommand, blockCommands, findCommands } from "./commands.ts";
import { popupMenu } from "./PopupMenu.tsx";
import { type EditorWords, englishWords } from "./words.ts";

export interface SlashMenuOptions {
  /** The commands the menu offers: the built-in blocks, and any a plugin adds. */
  readonly commands: readonly BlockCommand[];
  readonly words: EditorWords;
}

export const slashMenuKey = new PluginKey("slashMenu");

export const SlashMenu = Extension.create<SlashMenuOptions>({
  name: "slashMenu",

  addOptions() {
    return { commands: blockCommands(englishWords), words: englishWords };
  },

  addProseMirrorPlugins() {
    const { commands, words } = this.options;
    return [
      Suggestion<BlockCommand, BlockCommand>({
        editor: this.editor,
        pluginKey: slashMenuKey,
        char: "/",
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.spec.code !== true,
        items: ({ query }) => findCommands(query, commands),
        command: ({
          editor,
          range,
          props: command,
        }: {
          editor: Editor;
          range: Range;
          props: BlockCommand;
        }) => {
          editor.chain().focus().deleteRange(range).run();
          command.run(editor);
        },
        render: popupMenu<BlockCommand>({
          describe: (command) => ({ key: command.id, title: command.title }),
          label: words.slashMenu,
          empty: words.noBlocks,
        }),
      }),
    ];
  },
});
