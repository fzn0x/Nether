// The handle beside the block under the pointer: drag it to move the block,
// or click it for the block's menu, which turns the block into another
// type, moves it, duplicates it or deletes it. The menu works from the
// keyboard too, and each of its actions also has a shortcut (actions.ts).
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  type BlockAt,
  canTurn,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  turnBlockInto,
} from "./actions.ts";
import type { BlockCommand } from "./commands.ts";
import type { EditorWords } from "./words.ts";

export function BlockHandle(props: {
  readonly editor: Editor;
  readonly commands: readonly BlockCommand[];
  readonly words: EditorWords;
}) {
  const { editor, commands, words } = props;
  const [target, setTarget] = useState<BlockAt | undefined>();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);

  const lock = (locked: boolean) => {
    editor.view.dispatch(editor.state.tr.setMeta("lockDragHandle", locked));
  };

  const close = () => {
    setOpen(false);
    lock(false);
    editor.commands.focus();
  };

  // The first action takes focus when the menu opens; a click elsewhere closes it.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && handle.current?.contains(event.target) === true) return;
      setOpen(false);
      lock(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
    };
  });

  const act = (action: (block: BlockAt) => boolean) => () => {
    if (target !== undefined) action(target);
    close();
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  const turns =
    target !== undefined && canTurn(target.node)
      ? commands.filter((command) => command.turns !== undefined)
      : [];

  return (
    <DragHandle
      editor={editor}
      nested
      onNodeChange={({ node, pos }) => {
        if (!open) setTarget(node === null ? undefined : { node, pos });
      }}
    >
      <div className="block-handle" ref={handle}>
        <button
          type="button"
          className="block-grip"
          aria-label={words.blockHandle}
          aria-haspopup="menu"
          aria-expanded={open}
          // Out of the tab order: the keyboard has the shortcuts.
          tabIndex={-1}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            if (target === undefined) return;
            editor.view.dispatch(
              editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, target.pos)),
            );
            lock(true);
            setOpen(true);
          }}
        >
          <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
            {[3, 8, 13].flatMap((y) => [
              <circle key={`a${String(y)}`} cx="2.5" cy={y} r="1.5" />,
              <circle key={`b${String(y)}`} cx="7.5" cy={y} r="1.5" />,
            ])}
          </svg>
        </button>
        {open ? (
          <div
            className="block-menu"
            role="menu"
            aria-label={words.blockMenu}
            ref={menu}
            onKeyDown={onMenuKey}
          >
            {turns.length > 0 ? (
              <div role="group" aria-label={words.turnInto}>
                <p className="block-menu-heading" aria-hidden="true">
                  {words.turnInto}
                </p>
                {turns.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    role="menuitem"
                    onClick={act((block) => turnBlockInto(editor, block.pos, command))}
                  >
                    {command.title}
                  </button>
                ))}
                <hr />
              </div>
            ) : null}
            <button
              type="button"
              role="menuitem"
              aria-keyshortcuts="Control+Shift+ArrowUp Meta+Shift+ArrowUp"
              onClick={act((block) => moveBlock(editor, block.pos, -1))}
            >
              {words.moveUp}
            </button>
            <button
              type="button"
              role="menuitem"
              aria-keyshortcuts="Control+Shift+ArrowDown Meta+Shift+ArrowDown"
              onClick={act((block) => moveBlock(editor, block.pos, 1))}
            >
              {words.moveDown}
            </button>
            <button
              type="button"
              role="menuitem"
              aria-keyshortcuts="Control+D Meta+D"
              onClick={act((block) => duplicateBlock(editor, block.pos))}
            >
              {words.duplicate}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={act((block) => deleteBlock(editor, block.pos))}
            >
              {words.remove}
            </button>
          </div>
        ) : null}
      </div>
    </DragHandle>
  );
}
