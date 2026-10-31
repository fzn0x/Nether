// The handle on the sidebar's edge that sets its width, as Obsidian's does:
// dragged with the pointer, which it shows on hover, or moved with the
// arrow keys as a window splitter, Home and End going to its ends, and a
// double click putting it back. The width is remembered on the device.
import { type KeyboardEvent, useCallback, useState } from "react";
import { t } from "./messages.ts";

const storageKey = "nether.sidebarWidth";
export const defaultWidth = 336;
const minWidth = 200;
const step = 16;

/** The widest the sidebar may be: half the window, and no more than 640 pixels. */
function maxWidth(): number {
  return Math.max(minWidth, Math.min(640, Math.round(innerWidth / 2)));
}

function clamp(width: number): number {
  return Math.round(Math.min(maxWidth(), Math.max(minWidth, width)));
}

function stored(): number {
  try {
    const value = Number(localStorage.getItem(storageKey));
    return Number.isFinite(value) && value > 0 ? clamp(value) : defaultWidth;
  } catch {
    return defaultWidth;
  }
}

function store(width: number): void {
  try {
    localStorage.setItem(storageKey, String(width));
  } catch {
    // Not remembered: the width holds until the app closes.
  }
}

/** The sidebar's width, as last set, and a function that sets and remembers it. */
export function useSidebarWidth(): readonly [number, (width: number) => void] {
  const [width, setWidth] = useState(stored);
  const change = useCallback((next: number) => {
    const kept = clamp(next);
    setWidth(kept);
    store(kept);
  }, []);
  return [width, change];
}

export function SidebarResizer(props: {
  readonly width: number;
  readonly onResize: (width: number) => void;
  /** The ID of the sidebar it sizes. */
  readonly controls: string;
}) {
  const { width, onResize, controls } = props;
  const [dragging, setDragging] = useState(false);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Right to left the sidebar is on the right, and grows towards the left.
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const grow = rtl ? "ArrowLeft" : "ArrowRight";
    const shrink = rtl ? "ArrowRight" : "ArrowLeft";
    if (event.key === grow) onResize(width + step);
    else if (event.key === shrink) onResize(width - step);
    else if (event.key === "Home") onResize(minWidth);
    else if (event.key === "End") onResize(maxWidth());
    else if (event.key === "Enter") onResize(defaultWidth);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className={`sidebar-resizer${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resizeSidebar")}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      title={t("resizeSidebarHint")}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onResize(defaultWidth);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const rtl = getComputedStyle(handle).direction === "rtl";
        const startX = event.clientX;
        const startWidth = width;
        setDragging(true);
        const move = (moved: PointerEvent) => {
          const delta = moved.clientX - startX;
          onResize(startWidth + (rtl ? -delta : delta));
        };
        const end = () => {
          setDragging(false);
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("pointercancel", end);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      }}
    />
  );
}
