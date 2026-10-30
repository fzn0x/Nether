// A modal dialog's focus: it opens with focus in it, on what it focuses
// itself or else its first control; while it is open, focus that leaves
// it, by Tab or by an editor taking focus a frame late, comes back to
// where it was in the dialog; when it closes, focus goes back to where it
// was before.
import { type RefObject, useEffect } from "react";

const focusable =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModal(dialog: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const before = document.activeElement;
    const opened = dialog.current;
    if (opened !== null && !opened.contains(document.activeElement)) {
      (opened.querySelector<HTMLElement>(focusable) ?? opened).focus();
    }
    let last: HTMLElement | undefined;
    const onFocusIn = (event: FocusEvent) => {
      const element = dialog.current;
      if (element === null || !(event.target instanceof HTMLElement)) return;
      if (element.contains(event.target)) {
        last = event.target;
        return;
      }
      const back =
        last !== undefined && element.contains(last)
          ? last
          : (element.querySelector<HTMLElement>(focusable) ?? element);
      back.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      if (before instanceof HTMLElement) before.focus();
    };
  }, [dialog]);
}
