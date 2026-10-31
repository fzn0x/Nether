// A pane's tabs above the note it shows (ADR 0046): each note open in the
// pane by its name, the one shown chosen. Clicking a tab shows it, its ×
// or a middle click closes it. From the keyboard, the arrows, Home and End
// move between tabs and show them, and Delete closes one; the note's menu
// opens on a right click or the menu key, as in the sidebar.
import type { NoteId } from "@nether/core";
import type { KeyboardEvent } from "react";
import { type MenuPoint, isMenuKey, pointBelow } from "./ContextMenu.tsx";
import { t } from "./messages.ts";
import type { Pane } from "./tabs.ts";

export function TabStrip(props: {
  readonly pane: Pane;
  /** What the strip is called: the open notes, and which pane when there are two. */
  readonly label: string;
  /** The ID of the panel that shows the chosen note, and of each tab, which the panel is named by. */
  readonly panelId: string;
  readonly tabId: (tab: number) => string;
  readonly titleOf: (id: NoteId) => string;
  readonly onChoose: (tab: number) => void;
  readonly onClose: (tab: number) => void;
  readonly onMenu: (id: NoteId, at: MenuPoint) => void;
}) {
  const { pane, label, panelId, tabId, titleOf, onChoose, onClose, onMenu } = props;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, tab: number, id: NoteId) => {
    const last = pane.tabs.length - 1;
    // Right to left, the tabs run towards the left, and so do the arrows.
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    let next: number | undefined;
    if (event.key === forward) next = tab === last ? 0 : tab + 1;
    else if (event.key === back) next = tab === 0 ? last : tab - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Delete") onClose(tab);
    else if (isMenuKey(event)) onMenu(id, pointBelow(event.currentTarget));
    else return;
    event.preventDefault();
    if (next === undefined) return;
    onChoose(next);
    // Once the strip shows the tab chosen.
    const target = tabId(next);
    requestAnimationFrame(() => document.getElementById(target)?.focus());
  };

  return (
    <div className="tab-strip" role="tablist" aria-label={label}>
      {pane.tabs.map((id, tab) => {
        const title = titleOf(id);
        const chosen = tab === pane.active;
        return (
          <div
            key={id}
            id={tabId(tab)}
            role="tab"
            className="tab"
            aria-selected={chosen}
            aria-controls={chosen ? panelId : undefined}
            aria-keyshortcuts="Delete"
            tabIndex={chosen ? 0 : -1}
            title={title}
            onClick={() => {
              onChoose(tab);
            }}
            onAuxClick={(event) => {
              // A middle click closes it, as in a browser.
              if (event.button !== 1) return;
              event.preventDefault();
              onClose(tab);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu(id, { x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
              onKeyDown(event, tab, id);
            }}
          >
            <span className="tab-title">{title}</span>
            {/* The keyboard closes a tab with Delete, so the × is for the pointer alone. */}
            <span
              className="tab-close"
              aria-hidden="true"
              title={t("closeTab", { name: title })}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab);
              }}
            >
              ×
            </span>
          </div>
        );
      })}
    </div>
  );
}
