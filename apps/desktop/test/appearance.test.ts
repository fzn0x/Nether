// A vault's appearance: as its file holds it, the themes and snippets the
// vault has, and whether the page shows light or dark.
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it } from "vitest";
import {
  availableStyles,
  defaultAppearance,
  loadAppearance,
  readAppearance,
  saveAppearance,
  shownMode,
} from "../src/appearance.ts";

describe("readAppearance", () => {
  it("reads a mode, a theme and snippets, and leaves out what it cannot read", () => {
    expect(readAppearance({ mode: "dark", theme: "Ocean", snippets: ["wide", "wide", 3] })).toEqual(
      { mode: "dark", theme: "Ocean", snippets: ["wide"] },
    );
    expect(readAppearance({ mode: "sepia", theme: "", snippets: "wide" })).toEqual(
      defaultAppearance,
    );
    expect(readAppearance(undefined)).toEqual(defaultAppearance);
    expect(readAppearance([])).toEqual(defaultAppearance);
  });
});

describe("shownMode", () => {
  it("is the mode chosen, or the system's", () => {
    expect(shownMode("light", true)).toBe("light");
    expect(shownMode("dark", false)).toBe("dark");
    expect(shownMode("system", true)).toBe("dark");
    expect(shownMode("system", false)).toBe("light");
  });
});

describe("a vault's styles", () => {
  it("lists the CSS files of its themes and snippets folders, by name", async () => {
    const vault = new Vault(
      new MemoryFiles({
        "a.md": "A",
        ".nether/themes/Ocean.css": ":root {}",
        ".nether/themes/Night.CSS": ":root {}",
        ".nether/themes/notes.txt": "not a theme",
        ".nether/themes/old/Deep.css": "a folder below is not a theme",
        ".nether/snippets/wide.css": ".pane {}",
      }),
      new MemoryStore(),
    );
    await vault.open();
    expect(await availableStyles(vault)).toEqual({
      themes: ["Night", "Ocean"],
      snippets: ["wide"],
    });
  });

  it("keeps its appearance in .nether/appearance.json", async () => {
    const files = new MemoryFiles({ "a.md": "A" });
    const vault = new Vault(files, new MemoryStore());
    await vault.open();
    expect(await loadAppearance(vault)).toEqual(defaultAppearance);
    await saveAppearance(vault, { mode: "light", theme: "Ocean", snippets: ["wide"] });
    expect(await loadAppearance(vault)).toEqual({
      mode: "light",
      theme: "Ocean",
      snippets: ["wide"],
    });
    expect(JSON.parse((await files.read(".nether/appearance.json")).text)).toEqual({
      mode: "light",
      theme: "Ocean",
      snippets: ["wide"],
    });
  });
});
