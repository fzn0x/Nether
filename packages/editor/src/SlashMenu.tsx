// The slash menu: `/` at the start of a line or after a space opens a list
// of blocks to insert, which narrows as you type; the arrow keys and Enter
// pick one, Escape closes it. Focus stays in the note, and the note points
// screen readers at the highlighted block.
import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { type BlockCommand, blockCommands, findCommands } from "./commands.ts";
import { type EditorWords, englishWords } from "./words.ts";

export interface SlashMenuOptions {
  /** The commands the menu offers: the built-in blocks, and any a plugin adds. */
  readonly commands: readonly BlockCommand[];
  readonly words: EditorWords;
}

interface MenuHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

interface MenuProps {
  readonly editor: Editor;
  readonly items: readonly BlockCommand[];
  readonly choose: (command: BlockCommand) => void;
  readonly words: EditorWords;
}

let menus = 0;

const Menu = forwardRef<MenuHandle, MenuProps>(function Menu(props, ref) {
  const { editor, items, choose, words } = props;
  const [active, setActive] = useState(0);
  const [id] = useState(() => `slash-menu-${String(++menus)}`);
  const list = useRef<HTMLDivElement>(null);
  const optionId = (command: BlockCommand) => `${id}-${command.id}`;

  useEffect(() => {
    setActive(0);
  }, [items]);

  // The note keeps focus, and tells screen readers which block is highlighted.
  const current = items[active];
  useEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute("aria-controls", id);
    dom.setAttribute("aria-expanded", "true");
    if (current === undefined) dom.removeAttribute("aria-activedescendant");
    else {
      dom.setAttribute("aria-activedescendant", optionId(current));
      list.current?.querySelector(`#${optionId(current)}`)?.scrollIntoView({ block: "nearest" });
    }
  });
  useEffect(
    () => () => {
      const dom = editor.view.dom;
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-expanded");
      dom.removeAttribute("aria-activedescendant");
    },
    [editor],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + step + items.length) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (current !== undefined) choose(current);
        return current !== undefined;
      }
      return false;
    },
  }));

  return (
    <div className="slash-menu" id={id} role="listbox" aria-label={words.slashMenu} ref={list}>
      {items.length === 0 ? (
        <p className="slash-empty">{words.noBlocks}</p>
      ) : (
        items.map((item, index) => (
          <div
            key={item.id}
            id={optionId(item)}
            role="option"
            aria-selected={index === active}
            className="slash-item"
            // The note keeps focus, and so its selection, while the pointer picks.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onMouseMove={() => {
              if (index !== active) setActive(index);
            }}
            onClick={() => {
              choose(item);
            }}
          >
            {item.title}
          </div>
        ))
      )}
    </div>
  );
});

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
        // Not in code, where a slash is a slash.
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
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | undefined;
          let unmount: (() => void) | undefined;
          const menuProps = (props: SuggestionProps<BlockCommand, BlockCommand>): MenuProps => ({
            editor: props.editor,
            items: props.items,
            choose: (command) => {
              props.command(command);
            },
            words,
          });
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(Menu, { editor: props.editor, props: menuProps(props) });
              const element = renderer.element;
              element.classList.add("slash-menu-popup");
              unmount = props.mount(element);
            },
            onUpdate: (props) => {
              renderer?.updateProps(menuProps(props));
            },
            onKeyDown: (props: SuggestionKeyDownProps) =>
              renderer?.ref?.onKeyDown(props.event) ?? false,
            onExit: () => {
              unmount?.();
              renderer?.destroy();
              unmount = undefined;
              renderer = undefined;
            },
          };
        },
      }),
    ];
  },
});
