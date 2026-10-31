// A button shown as an icon, named by its label, which a tooltip shows on
// hover and on keyboard focus, with its shortcut. The tooltip stays while
// the pointer is on it and goes with Escape, and keeps inside the window.
import { useLayoutEffect, useRef, useState } from "react";
import type { Icon } from "./icons.ts";
import { formatKeys } from "./shortcuts.ts";

export function IconButton(props: {
  readonly icon: Icon;
  readonly label: string;
  /** Its shortcut, as the vault's hotkeys write it. */
  readonly keys?: string | undefined;
  /** The shortcut as `aria-keyshortcuts` has it. */
  readonly ariaKeys?: string | undefined;
  readonly disabled?: boolean;
  readonly hasPopup?: "dialog" | "menu";
  readonly onClick: () => void;
}) {
  const { icon: Glyph, label, keys, ariaKeys, disabled = false, hasPopup, onClick } = props;
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  const [place, setPlace] = useState({ left: 0, top: 0 });

  // Below the button, from its start, moved back where it would leave the window.
  useLayoutEffect(() => {
    if (!shown || button.current === null || tip.current === null) return;
    const box = button.current.getBoundingClientRect();
    const width = tip.current.offsetWidth;
    const rtl = getComputedStyle(button.current).direction === "rtl";
    const start = rtl ? box.right - width : box.left;
    setPlace({
      left: Math.max(4, Math.min(start, innerWidth - width - 4)),
      top: box.bottom + 6,
    });
  }, [shown]);

  return (
    <button
      ref={button}
      type="button"
      className="icon-button"
      aria-label={label}
      aria-keyshortcuts={ariaKeys}
      aria-haspopup={hasPopup}
      disabled={disabled}
      onClick={() => {
        setShown(false);
        onClick();
      }}
      onMouseEnter={() => {
        setShown(true);
      }}
      onMouseLeave={() => {
        setShown(false);
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) setShown(true);
      }}
      onBlur={() => {
        setShown(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && shown) {
          event.stopPropagation();
          setShown(false);
        }
      }}
    >
      <Glyph className="icon" size={16} aria-hidden="true" />
      {shown ? (
        // Inside the button, so the pointer on it keeps it; its name is the button's label.
        <span ref={tip} className="tooltip" aria-hidden="true" style={place}>
          {label}
          {keys === undefined ? null : <kbd>{formatKeys(keys)}</kbd>}
        </span>
      ) : null}
    </button>
  );
}
