// A button shown as an icon, named by its label, which a tooltip shows on
// hover and on keyboard focus, with its shortcut. The tooltip stays while
// the pointer is on it and goes with Escape, and keeps inside the window.
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { formatKeys } from "./shortcuts.ts";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** A calendar's frame, which the periodic notes' icons mark within. */
const calendar = (
  <>
    <path d="M2.5 3.5h11v10h-11z" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </>
);

const icons = {
  newNote: (
    <>
      <path d="M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z" />
      <path d="M9 1.5V5h3.5M8 7.5v4.5M5.75 9.75h4.5" />
    </>
  ),
  newFolder: (
    <>
      <path d="M1.5 4a1 1 0 0 1 1-1h3.75l1.5 1.5h6.25a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11.5a1 1 0 0 1-1-1z" />
      <path d="M8 6.75v4.5M5.75 9h4.5" />
    </>
  ),
  newDatabase: (
    <>
      <path d="M2 2.5h12v11H2z" />
      <path d="M2 6h12M2 9.75h12M6 6v7.5" />
    </>
  ),
  dayNote: (
    <>
      {calendar}
      <path d="M7 9h2v2H7z" fill="currentColor" />
    </>
  ),
  weekNote: (
    <>
      {calendar}
      <path d="M4.5 10h7" strokeWidth={2} />
    </>
  ),
  monthNote: (
    <>
      {calendar}
      <path d="M5 9h.01M8 9h.01M11 9h.01M5 11.5h.01M8 11.5h.01M11 11.5h.01" strokeWidth={2} />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof icons;

export function Icon(props: { readonly name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...stroke}>
      {icons[props.name]}
    </svg>
  );
}

export function IconButton(props: {
  readonly icon: IconName;
  readonly label: string;
  /** Its shortcut, as the vault's hotkeys write it. */
  readonly keys?: string | undefined;
  /** The shortcut as `aria-keyshortcuts` has it. */
  readonly ariaKeys?: string | undefined;
  readonly disabled?: boolean;
  readonly hasPopup?: "dialog" | "menu";
  readonly onClick: () => void;
}) {
  const { icon, label, keys, ariaKeys, disabled = false, hasPopup, onClick } = props;
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
      <Icon name={icon} />
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
