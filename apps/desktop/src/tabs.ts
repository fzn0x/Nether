// Where notes are open (ADR 0046): one pane, or two side by side, each
// with its tabs and the one it shows, and the pane the keyboard is in.
// Opening a note shows it in the pane's tab, or in a new tab, or in the
// pane to the right; a note open in a pane's tab is shown there rather
// than opened twice. Closing a pane's last tab closes the pane, while
// another is open. Every change gives a new layout, the old one as it was.
import type { NoteId } from "@nether/core";

export interface Pane {
  /** The pane's own, kept while it is open, so what shows it stays with it when the other closes. */
  readonly key: number;
  readonly tabs: readonly NoteId[];
  /** The tab the pane shows. */
  readonly active: number;
}

export interface Layout {
  /** One pane, or two side by side. */
  readonly panes: readonly Pane[];
  /** The pane the keyboard is in, which commands act on. */
  readonly focused: number;
}

/** No notes open. */
export const emptyLayout: Layout = { panes: [{ key: 0, tabs: [], active: 0 }], focused: 0 };

/** The note a pane shows, if any. */
export function shownIn(pane: Pane | undefined): NoteId | undefined {
  return pane?.tabs[pane.active];
}

/** The note the focused pane shows, which commands about a note act on. */
export function activeNote(layout: Layout): NoteId | undefined {
  return shownIn(layout.panes[layout.focused]);
}

function withPane(layout: Layout, index: number, pane: Pane, focused = index): Layout {
  const panes = layout.panes.map((each, at) => (at === index ? pane : each));
  return { panes, focused };
}

/** A pane showing `id`: its tab when it has one, else in place of the tab it shows, or in a new one after it. */
function show(pane: Pane, id: NoteId, newTab: boolean): Pane {
  const open = pane.tabs.indexOf(id);
  if (open !== -1) return { ...pane, active: open };
  if (pane.tabs.length === 0) return { ...pane, tabs: [id], active: 0 };
  if (!newTab) {
    return { ...pane, tabs: pane.tabs.map((tab, at) => (at === pane.active ? id : tab)) };
  }
  const at = pane.active + 1;
  return { ...pane, tabs: [...pane.tabs.slice(0, at), id, ...pane.tabs.slice(at)], active: at };
}

function focusedPane(layout: Layout): Pane {
  return layout.panes[layout.focused] ?? { key: 0, tabs: [], active: 0 };
}

/** Opens a note in the focused pane, in place of the note it shows. */
export function openHere(layout: Layout, id: NoteId): Layout {
  return withPane(layout, layout.focused, show(focusedPane(layout), id, false));
}

/** Opens a note in a new tab of the focused pane. */
export function openInNewTab(layout: Layout, id: NoteId): Layout {
  return withPane(layout, layout.focused, show(focusedPane(layout), id, true));
}

/** Opens a note in the pane to the right, made the first time, in a new tab there after. */
export function openToTheRight(layout: Layout, id: NoteId): Layout {
  const [left, right] = layout.panes;
  if (left === undefined) return openHere(layout, id);
  if (right === undefined) {
    return { panes: [left, { key: left.key + 1, tabs: [id], active: 0 }], focused: 1 };
  }
  return withPane(layout, 1, show(right, id, true));
}

/** Shows a pane's tab, and puts the keyboard in that pane. */
export function chooseTab(layout: Layout, pane: number, tab: number): Layout {
  const chosen = layout.panes[pane];
  if (chosen === undefined || tab < 0 || tab >= chosen.tabs.length) return layout;
  return withPane(layout, pane, { ...chosen, active: tab });
}

/** Puts the keyboard in a pane. */
export function focusPane(layout: Layout, pane: number): Layout {
  return pane === layout.focused || layout.panes[pane] === undefined
    ? layout
    : { panes: layout.panes, focused: pane };
}

/** Shows the focused pane's next tab, or its previous with `step` -1, round its ends. */
export function cycleTab(layout: Layout, step: 1 | -1): Layout {
  const pane = layout.panes[layout.focused];
  if (pane === undefined || pane.tabs.length < 2) return layout;
  const next = (pane.active + step + pane.tabs.length) % pane.tabs.length;
  return withPane(layout, layout.focused, { ...pane, active: next });
}

/** Closes a pane's tab; the tab after it shows, or the one before at the end, and an emptied pane closes while another is open. */
export function closeTab(layout: Layout, pane: number, tab: number): Layout {
  const closing = layout.panes[pane];
  if (closing === undefined || tab < 0 || tab >= closing.tabs.length) return layout;
  const tabs = closing.tabs.filter((_, at) => at !== tab);
  if (tabs.length === 0 && layout.panes.length > 1) {
    const panes = layout.panes.filter((_, at) => at !== pane);
    const focused = layout.focused > pane ? layout.focused - 1 : layout.focused;
    return { panes, focused: Math.min(focused, panes.length - 1) };
  }
  const active =
    tab < closing.active || closing.active >= tabs.length
      ? Math.max(0, closing.active - 1)
      : closing.active;
  return withPane(layout, pane, { ...closing, tabs, active }, layout.focused);
}

/** Closes every tab of a note that is gone, as to the trash. */
export function closeNote(layout: Layout, id: NoteId): Layout {
  let next = layout;
  for (let pane = next.panes.length - 1; pane >= 0; pane--) {
    for (let tab = (next.panes[pane]?.tabs.length ?? 0) - 1; tab >= 0; tab--) {
      if (next.panes[pane]?.tabs[tab] === id) next = closeTab(next, pane, tab);
    }
  }
  return next;
}

/** Shows `to` in every tab that showed `from`, as a merged note's tabs show the note it went into; each pane shows a note once. */
export function replaceNote(layout: Layout, from: NoteId, to: NoteId): Layout {
  const panes = layout.panes.map((pane) => {
    if (!pane.tabs.includes(from)) return pane;
    const shown = shownIn(pane);
    const tabs = pane.tabs
      .map((tab) => (tab === from ? to : tab))
      .filter((tab, at, all) => all.indexOf(tab) === at);
    const now = shown === from ? to : shown;
    return { ...pane, tabs, active: Math.max(0, now === undefined ? 0 : tabs.indexOf(now)) };
  });
  return { panes, focused: layout.focused };
}

/** A layout as remembered, its notes kept only while the vault has them; the empty layout for anything else. */
export function readLayout(data: unknown, has: (id: NoteId) => boolean): Layout {
  if (typeof data !== "object" || data === null) return emptyLayout;
  const { panes, focused } = data as { panes?: unknown; focused?: unknown };
  if (!Array.isArray(panes)) return emptyLayout;
  const read: Pane[] = [];
  for (const pane of (panes as unknown[]).slice(0, 2)) {
    if (typeof pane !== "object" || pane === null) continue;
    const { tabs, active } = pane as { tabs?: unknown; active?: unknown };
    if (!Array.isArray(tabs)) continue;
    const shown = typeof active === "number" ? (tabs as unknown[])[active] : undefined;
    const kept = (tabs as unknown[]).filter(
      (tab, at, all): tab is NoteId =>
        typeof tab === "string" && has(tab as NoteId) && all.indexOf(tab) === at,
    );
    if (kept.length === 0) continue;
    const at = kept.indexOf(shown as NoteId);
    read.push({ key: read.length, tabs: kept, active: at === -1 ? 0 : at });
  }
  if (read.length === 0) return emptyLayout;
  const focus = typeof focused === "number" && focused < read.length ? focused : 0;
  return { panes: read, focused: focus };
}
