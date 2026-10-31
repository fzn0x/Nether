// Where notes are open: tabs in one pane or two, opened, chosen, cycled,
// closed, followed through merges, and read back as remembered.
import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  type Layout,
  activeNote,
  chooseTab,
  closeNote,
  closeTab,
  cycleTab,
  emptyLayout,
  focusPane,
  openHere,
  openInNewTab,
  openToTheRight,
  readLayout,
  replaceNote,
} from "../src/tabs.ts";

const [a, b, c, d] = ["a", "b", "c", "d"] as NoteId[] as [NoteId, NoteId, NoteId, NoteId];
const one = (tabs: NoteId[], active = 0, key = 0): Layout => ({
  panes: [{ key, tabs, active }],
  focused: 0,
});

describe("opening notes", () => {
  it("opens a note in place of the one shown, or shows its tab when the pane has one", () => {
    expect(openHere(emptyLayout, a)).toEqual(one([a]));
    expect(openHere(one([a, b], 0), c)).toEqual(one([c, b], 0));
    expect(openHere(one([a, b], 0), b)).toEqual(one([a, b], 1));
  });

  it("opens a note in a new tab after the one shown", () => {
    expect(openInNewTab(one([a, b], 0), c)).toEqual(one([a, c, b], 1));
    expect(openInNewTab(one([a, b], 1), a)).toEqual(one([a, b], 0));
    expect(activeNote(openInNewTab(emptyLayout, a))).toBe(a);
  });

  it("opens a note to the right, making the pane the first time", () => {
    const split = openToTheRight(one([a]), b);
    expect(split).toEqual({
      panes: [
        { key: 0, tabs: [a], active: 0 },
        { key: 1, tabs: [b], active: 0 },
      ],
      focused: 1,
    });
    const again = openToTheRight(focusPane(split, 0), c);
    expect(again).toEqual({
      panes: [
        { key: 0, tabs: [a], active: 0 },
        { key: 1, tabs: [b, c], active: 1 },
      ],
      focused: 1,
    });
    // Opening here acts on the pane the keyboard is in.
    expect(openHere(focusPane(again, 0), d).panes[0]).toEqual({ key: 0, tabs: [d], active: 0 });
  });
});

describe("choosing and cycling tabs", () => {
  it("shows a tab, putting the keyboard in its pane", () => {
    const split = openToTheRight(one([a, b]), c);
    expect(chooseTab(split, 0, 1)).toEqual({
      panes: [{ key: 0, tabs: [a, b], active: 1 }, split.panes[1]],
      focused: 0,
    });
    expect(chooseTab(split, 0, 5)).toBe(split);
  });

  it("goes round the focused pane's tabs", () => {
    expect(cycleTab(one([a, b, c], 2), 1)).toEqual(one([a, b, c], 0));
    expect(cycleTab(one([a, b, c], 0), -1)).toEqual(one([a, b, c], 2));
    expect(cycleTab(one([a]), 1)).toEqual(one([a]));
  });
});

describe("closing tabs", () => {
  it("shows the tab after the closed one, or the one before at the end", () => {
    expect(closeTab(one([a, b, c], 1), 0, 1)).toEqual(one([a, c], 1));
    expect(closeTab(one([a, b, c], 2), 0, 2)).toEqual(one([a, b], 1));
    expect(closeTab(one([a, b, c], 2), 0, 0)).toEqual(one([b, c], 1));
    expect(closeTab(one([a]), 0, 0)).toEqual(one([]));
  });

  it("closes an emptied pane while another is open", () => {
    const split = openToTheRight(one([a]), b);
    expect(closeTab(split, 1, 0)).toEqual(one([a]));
    expect(closeTab(split, 0, 0)).toEqual({
      panes: [{ key: 1, tabs: [b], active: 0 }],
      focused: 0,
    });
  });

  it("closes every tab of a note that is gone", () => {
    const split = openToTheRight(one([a, b], 1), b);
    expect(closeNote(split, b)).toEqual(one([a]));
  });
});

describe("following merges", () => {
  it("shows the note merged into in place of the merged one, once in a pane", () => {
    expect(replaceNote(one([a, b, c], 1), b, d)).toEqual(one([a, d, c], 1));
    expect(replaceNote(one([a, b, c], 1), b, c)).toEqual(one([a, c], 1));
    expect(replaceNote(one([a, b, c], 0), c, a)).toEqual(one([a, b], 0));
  });
});

describe("readLayout", () => {
  const has = (id: NoteId) => id !== d;

  it("reads back a layout, leaving out notes the vault no longer has", () => {
    const layout = {
      panes: [
        { tabs: [a, d, b], active: 2 },
        { tabs: [d], active: 0 },
      ],
      focused: 1,
    };
    expect(readLayout(layout, has)).toEqual(one([a, b], 1));
  });

  it("reads anything else as no notes open", () => {
    expect(readLayout(undefined, has)).toBe(emptyLayout);
    expect(readLayout({ panes: "x" }, has)).toBe(emptyLayout);
    expect(readLayout({ panes: [{ tabs: [1, 2] }] }, has)).toBe(emptyLayout);
  });

  it("keeps two panes at most, each note once in a pane", () => {
    const layout = {
      panes: [
        { tabs: [a, a], active: 1 },
        { tabs: [b], active: 0 },
        { tabs: [c], active: 0 },
      ],
      focused: 2,
    };
    expect(readLayout(layout, has)).toEqual({
      panes: [
        { key: 0, tabs: [a], active: 0 },
        { key: 1, tabs: [b], active: 0 },
      ],
      focused: 0,
    });
  });
});
