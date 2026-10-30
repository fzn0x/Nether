// The menu that opens as you type in a note, for the slash menu's blocks
// and for the notes `[[` links to: it narrows as you type, the arrow keys
// and Enter pick, Escape closes it. Focus stays in the note, which points
// screen readers at the highlighted choice.
import type { Editor } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/** A choice as the menu shows it. */
export interface MenuChoice {
  /** Tells the choice apart from the others, for its element's ID. */
  readonly key: string;
  readonly title: string;
  /** Shown after the title, quieter: a note's folder, or the note an alias is for. */
  readonly detail?: string;
}

interface MenuHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

interface MenuProps<T> {
  readonly editor: Editor;
  readonly items: readonly T[];
  readonly describe: (item: T) => MenuChoice;
  readonly choose: (item: T) => void;
  readonly label: string;
  readonly empty: string;
}

let menus = 0;

const Menu = forwardRef<MenuHandle, MenuProps<unknown>>(function Menu(props, ref) {
  const { editor, items, describe, choose, label, empty } = props;
  const [active, setActive] = useState(0);
  const [id] = useState(() => `note-menu-${String(++menus)}`);
  const list = useRef<HTMLDivElement>(null);
  const optionId = (item: unknown) => `${id}-${describe(item).key.replace(/[^\w-]/g, "_")}`;

  useEffect(() => {
    setActive(0);
  }, [items]);

  // The note keeps focus, and tells screen readers which choice is highlighted.
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
    <div className="slash-menu" id={id} role="listbox" aria-label={label} ref={list}>
      {items.length === 0 ? (
        <p className="slash-empty">{empty}</p>
      ) : (
        items.map((item, index) => {
          const { key, title, detail } = describe(item);
          return (
            <div
              key={key}
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
              {title}
              {detail === undefined ? null : <span className="slash-detail">{detail}</span>}
            </div>
          );
        })
      )}
    </div>
  );
});

/** Shows a Suggestion plugin's choices in the menu, positioned and dismissed by the plugin. */
export function popupMenu<T>(options: {
  readonly describe: (item: T) => MenuChoice;
  readonly label: string;
  readonly empty: string;
}): NonNullable<SuggestionOptions<T, T>["render"]> {
  return () => {
    let renderer: ReactRenderer<MenuHandle, MenuProps<unknown>> | undefined;
    let unmount: (() => void) | undefined;
    const menuProps = (props: SuggestionProps<T, T>): MenuProps<unknown> => ({
      editor: props.editor,
      items: props.items,
      describe: (item) => options.describe(item as T),
      choose: (item) => {
        props.command(item as T);
      },
      label: options.label,
      empty: options.empty,
    });
    return {
      onStart: (props: SuggestionProps<T, T>) => {
        renderer = new ReactRenderer(Menu, { editor: props.editor, props: menuProps(props) });
        const element = renderer.element;
        element.classList.add("slash-menu-popup");
        unmount = props.mount(element);
      },
      onUpdate: (props: SuggestionProps<T, T>) => {
        renderer?.updateProps(menuProps(props));
      },
      onKeyDown: (props: SuggestionKeyDownProps) => renderer?.ref?.onKeyDown(props.event) ?? false,
      onExit: () => {
        unmount?.();
        renderer?.destroy();
        unmount = undefined;
        renderer = undefined;
      },
    };
  };
}
