// The app's menus, above the sidebar: each a button that opens its items,
// the commands of the palette in groups, each with its shortcut. Left and
// Right move between the menus, and Down, Enter or Space opens one; in an
// open menu, Left and Right open the one beside it. With a menu open, the
// pointer moving onto another opens that one instead.
import { type KeyboardEvent, useRef, useState } from "react";
import { ContextMenu, type MenuEntry, type MenuPoint } from "./ContextMenu.tsx";
import type { Icon } from "./icons.ts";

export interface Menu {
  readonly label: string;
  readonly icon: Icon;
  readonly entries: readonly MenuEntry[];
}

export function MenuBar(props: { readonly label: string; readonly menus: readonly Menu[] }) {
  const { label, menus } = props;
  const bar = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ readonly index: number; readonly at: MenuPoint }>();
  // The menu the keyboard is on, with the bar's one tab stop.
  const [current, setCurrent] = useState(0);

  const button = (index: number) =>
    bar.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[index];

  const show = (index: number) => {
    const target = button(index);
    if (target === undefined) return;
    const box = target.getBoundingClientRect();
    setCurrent(index);
    target.focus();
    setOpen({ index, at: { x: box.left, y: box.bottom + 2 } });
  };

  const wrap = (index: number) => (index + menus.length) % menus.length;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    let next: number | undefined;
    if (event.key === forward) next = wrap(index + 1);
    else if (event.key === back) next = wrap(index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = menus.length - 1;
    else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      show(index);
    } else return;
    event.preventDefault();
    if (next === undefined) return;
    setCurrent(next);
    button(next)?.focus();
  };

  const shown = open === undefined ? undefined : menus[open.index];

  return (
    <div ref={bar} className="menu-bar" role="menubar" aria-label={label}>
      {menus.map((menu, index) => (
        <button
          key={menu.label}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open?.index === index}
          tabIndex={index === current ? 0 : -1}
          onClick={() => {
            if (open?.index === index) setOpen(undefined);
            else show(index);
          }}
          onMouseEnter={() => {
            if (open !== undefined && open.index !== index) show(index);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
        >
          <menu.icon className="menu-icon" size={15} aria-hidden="true" />
          {menu.label}
        </button>
      ))}
      {open === undefined || shown === undefined ? null : (
        <ContextMenu
          key={open.index}
          label={shown.label}
          at={open.at}
          entries={shown.entries}
          anchor={bar.current}
          onClose={() => {
            setOpen(undefined);
          }}
          onSide={(step) => {
            show(wrap(open.index + step));
          }}
        />
      )}
    </div>
  );
}
