// A menu at a point, as a right click or the keyboard's menu key opens
// one: its items in groups, the first focused. The arrow keys, Home and End
// move between items, a letter goes to the next item starting with it, and
// Enter or Space chooses one. Escape closes it and gives the focus back to
// what opened it; a click outside, or the window losing the focus or
// changing size, closes it too.
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  readonly label: string;
  readonly run: () => void;
  /** Whether the item deletes or removes something, and shows so. */
  readonly danger?: boolean;
}

/** An item, or a line between groups of items. */
export type MenuEntry = MenuItem | "separator";

/** Where a menu opens: at the pointer, or below an element the keyboard opened it from. */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

/** Where a menu opened from an element by the keyboard goes: below its start. */
export function pointBelow(element: Element): MenuPoint {
  const box = element.getBoundingClientRect();
  return { x: box.left + 16, y: box.bottom };
}

/** Whether a key opens a menu: the menu key, or Shift and F10. */
export function isMenuKey(event: { readonly key: string; readonly shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

export function ContextMenu(props: {
  readonly label: string;
  readonly at: MenuPoint;
  readonly entries: readonly MenuEntry[];
  readonly onClose: () => void;
}) {
  const { label, at, entries, onClose } = props;
  const menu = useRef<HTMLDivElement>(null);
  // What had the focus when the menu opened, which has it again when Escape closes it.
  const [opener] = useState(() => document.activeElement);
  const [place, setPlace] = useState(at);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  // Kept inside the window, flipped above or before the point when it does not fit after it.
  useLayoutEffect(() => {
    const element = menu.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    const x = at.x + width > innerWidth ? Math.max(0, at.x - width) : at.x;
    const y = at.y + height > innerHeight ? Math.max(0, at.y - height) : at.y;
    setPlace({ x, y });
    items()[0]?.focus();
  }, [at]);

  useEffect(() => {
    const close = () => {
      onClose();
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menu.current?.contains(event.target) !== true) close();
    };
    document.addEventListener("pointerdown", outside, true);
    addEventListener("blur", close);
    addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      removeEventListener("blur", close);
      removeEventListener("resize", close);
    };
  }, [onClose]);

  const closeAndReturn = () => {
    onClose();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items();
    const index = list.findIndex((item) => item === document.activeElement);
    const go = (next: number) => {
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(list.length - 1);
    else if (event.key === "Escape" || event.key === "Tab" || isMenuKey(event)) closeAndReturn();
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLocaleLowerCase();
      const after = [...list.slice(index + 1), ...list.slice(0, index + 1)];
      after.find((item) => item.textContent.trim().toLocaleLowerCase().startsWith(letter))?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={menu}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {entries.map((entry, index) =>
        entry === "separator" ? (
          <div key={`separator-${String(index)}`} role="separator" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={entry.danger === true ? "danger" : undefined}
            // The item under the pointer has the focus, so one item at a time shows as chosen.
            onMouseMove={(event) => {
              if (document.activeElement !== event.currentTarget) event.currentTarget.focus();
            }}
            onClick={() => {
              onClose();
              entry.run();
            }}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}
