import { describe, expect, it } from "vitest";
import {
  ariaKeys,
  canBeShortcut,
  commandFor,
  eventKeys,
  formatKeys,
  readHotkeys,
  resolveHotkeys,
} from "../src/shortcuts.ts";

const key = (
  name: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers });

describe("eventKeys", () => {
  it("writes Ctrl as Mod elsewhere, and Cmd as Mod on a Mac", () => {
    expect(eventKeys(key("f", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+F");
    expect(eventKeys(key("f", { metaKey: true, shiftKey: true }), true)).toBe("Mod+Shift+F");
    expect(eventKeys(key("k", { ctrlKey: true }), true)).toBe("Ctrl+K");
    expect(eventKeys(key("k", { metaKey: true }), false)).toBe("Meta+K");
  });

  it("names keys that are not letters as the browser does", () => {
    expect(eventKeys(key("F2"), false)).toBe("F2");
    expect(eventKeys(key("/", { ctrlKey: true }), false)).toBe("Mod+/");
    expect(eventKeys(key(" ", { altKey: true }), false)).toBe("Alt+Space");
    expect(eventKeys(key("ArrowUp", { ctrlKey: true, altKey: true }), false)).toBe(
      "Mod+Alt+ArrowUp",
    );
  });

  it("is nothing while only modifiers are down", () => {
    expect(eventKeys(key("Control", { ctrlKey: true }), false)).toBeUndefined();
    expect(eventKeys(key("Shift", { shiftKey: true }), false)).toBeUndefined();
    expect(eventKeys(key("Dead"), false)).toBeUndefined();
  });
});

describe("formatKeys", () => {
  it("writes a shortcut as the platform does", () => {
    expect(formatKeys("Mod+Shift+F", false)).toBe("Ctrl+Shift+F");
    expect(formatKeys("Mod+Shift+F", true)).toBe("⇧⌘F");
    expect(formatKeys("Mod+Ctrl+Alt+K", true)).toBe("⌃⌥⌘K");
    expect(formatKeys("F2", true)).toBe("F2");
  });

  it("names shortcuts for assistive technology", () => {
    expect(ariaKeys("Mod+Shift+F", false)).toBe("Control+Shift+F");
    expect(ariaKeys("Mod+P", true)).toBe("Meta+P");
    expect(ariaKeys("Ctrl+K", true)).toBe("Control+K");
  });
});

describe("hotkeys", () => {
  it("reads the vault's choices, leaving out what is not a list of shortcuts", () => {
    expect(readHotkeys({ a: ["Mod+A"], b: [], c: "Mod+C", d: [1] })).toEqual({
      a: ["Mod+A"],
      b: [],
    });
    expect(readHotkeys(null)).toEqual({});
    expect(readHotkeys(["Mod+A"])).toEqual({});
  });

  it("takes the vault's choice over a default, and finds the command a shortcut runs", () => {
    const hotkeys = resolveHotkeys(
      { search: ["Mod+Shift+F"], palette: ["Mod+P"] },
      { search: ["Mod+K"], export: ["Mod+Shift+E"] },
    );
    expect(hotkeys).toEqual({
      search: ["Mod+K"],
      palette: ["Mod+P"],
      export: ["Mod+Shift+E"],
    });
    expect(commandFor(hotkeys, "Mod+k")).toBe("search");
    expect(commandFor(hotkeys, "Mod+Shift+F")).toBeUndefined();
  });
});

describe("canBeShortcut", () => {
  it("takes keys with Ctrl, Cmd or Alt, or a function key, and not what typing makes", () => {
    for (const keys of ["Mod+K", "Alt+K", "Ctrl+K", "Meta+K", "F2", "Shift+F12"]) {
      expect(canBeShortcut(keys)).toBe(true);
    }
    for (const keys of ["K", "Shift+K", "Enter", "Shift+/", "F"]) {
      expect(canBeShortcut(keys)).toBe(false);
    }
  });
});
