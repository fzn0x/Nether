import type { NoteId } from "@nether/core";
import type { NoteEntry } from "@nether/storage";
import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  findTemplate,
  nameOf,
  notePathFor,
  periodicNote,
  readSettings,
  templateChoices,
  untitledName,
} from "../src/templates.ts";

function notes(...paths: string[]): NoteEntry[] {
  return paths.map((path, index) => ({
    id: `n${String(index)}` as NoteId,
    path,
    title: nameOf(path),
    size: 0,
    modified: index,
  }));
}

describe("readSettings", () => {
  it("starts from Nether's defaults", () => {
    expect(readSettings(undefined)).toEqual(defaultSettings);
    expect(readSettings("not settings")).toEqual(defaultSettings);
  });

  it("reads Nether's own settings over the defaults, field by field", () => {
    const settings = readSettings({
      folder: "/Meta/Templates/",
      dateFormat: " DD.MM.YYYY ",
      timeFormat: 7,
      day: { folder: "Journal/", template: "Meta/Templates/Day.md" },
      week: { enabled: true, format: "" },
    });
    expect(settings).toEqual({
      ...defaultSettings,
      folder: "Meta/Templates",
      dateFormat: "DD.MM.YYYY",
      day: { ...defaultSettings.day, folder: "Journal", template: "Meta/Templates/Day" },
      week: { ...defaultSettings.week, enabled: true },
    });
  });

  it("reads Obsidian's when the vault has none of Nether's", () => {
    const obsidian = {
      templates: { folder: "Meta", dateFormat: "D MMM", timeFormat: "h:mm A" },
      dailyNotes: { folder: "Journal", format: "YYYY/MM-DD", template: "Meta/Day" },
    };
    expect(readSettings(undefined, obsidian)).toEqual({
      ...defaultSettings,
      folder: "Meta",
      dateFormat: "D MMM",
      timeFormat: "h:mm A",
      day: { enabled: true, folder: "Journal", format: "YYYY/MM-DD", template: "Meta/Day" },
    });
    // Nether's own, once saved, are the ones read.
    expect(readSettings({}, obsidian)).toEqual(defaultSettings);
  });

  it("takes the Periodic Notes plugin's settings before the Daily notes plugin's", () => {
    const settings = readSettings(undefined, {
      dailyNotes: { folder: "Daily" },
      periodicNotes: {
        daily: { enabled: true, folder: "Days", format: "", template: "" },
        weekly: { enabled: true, folder: "Weeks", format: "gggg-[W]ww", template: "T/Week" },
      },
    });
    expect(settings.day).toEqual({ ...defaultSettings.day, folder: "Days" });
    expect(settings.week).toEqual({
      enabled: true,
      folder: "Weeks",
      format: "gggg-[W]ww",
      template: "T/Week",
    });
    expect(settings.month).toEqual(defaultSettings.month);
  });
});

describe("periodicNote", () => {
  const settings = {
    ...defaultSettings,
    day: { ...defaultSettings.day, folder: "Daily", format: "YYYY/MM/YYYY-MM-DD" },
  };
  const now = new Date(2026, 10, 6, 15, 30);

  it("names each period's note by its start, in its folder", () => {
    expect(periodicNote(settings, "day", now)).toEqual({
      path: "Daily/2026/11/2026-11-06.md",
      date: new Date(2026, 10, 6),
    });
    expect(periodicNote(settings, "week", now)).toEqual({
      path: "2026-W45.md",
      date: new Date(2026, 10, 2),
    });
    expect(periodicNote(settings, "month", now)).toEqual({
      path: "2026-11.md",
      date: new Date(2026, 10, 1),
    });
  });
});

describe("findTemplate", () => {
  const vault = notes("Templates/Daily.md", "Other/Week.md", "Week.md");

  it("finds a template by its path, case aside, or by its name in the templates folder", () => {
    expect(findTemplate(vault, defaultSettings, "templates/daily")?.path).toBe(
      "Templates/Daily.md",
    );
    expect(findTemplate(vault, defaultSettings, "Daily.md")?.path).toBe("Templates/Daily.md");
    expect(findTemplate(vault, defaultSettings, "Other/Week")?.path).toBe("Other/Week.md");
    expect(findTemplate(vault, defaultSettings, "Week")?.path).toBe("Week.md");
    expect(findTemplate(vault, defaultSettings, "Missing")).toBeUndefined();
    expect(findTemplate(vault, defaultSettings, " ")).toBeUndefined();
  });
});

describe("templateChoices", () => {
  const vault = notes(
    "Welcome.md",
    "Templates/Meeting.md",
    "Templates/Daily.md",
    "Projects/Meeting notes.md",
    "Templatesque.md",
  );

  it("lists the templates folder's notes when nothing is typed", () => {
    expect(templateChoices(vault, "Templates", "").map((note) => note.path)).toEqual([
      "Templates/Daily.md",
      "Templates/Meeting.md",
    ]);
    expect(templateChoices(vault, "", "")).toEqual([]);
  });

  it("finds any note by the words typed, the templates folder's first", () => {
    expect(templateChoices(vault, "Templates", "meet").map((note) => note.path)).toEqual([
      "Templates/Meeting.md",
      "Projects/Meeting notes.md",
    ]);
    expect(templateChoices(vault, "Templates", "proj meet", 1).map((note) => note.path)).toEqual([
      "Projects/Meeting notes.md",
    ]);
  });
});

describe("notePathFor", () => {
  const vault = notes("Welcome.md", "Projects/Plan.md");

  it("gives a name's path, its folders written with /", () => {
    expect(notePathFor(" Kickoff ", vault)).toEqual({ path: "Kickoff.md" });
    expect(notePathFor("Projects / Next.md", vault)).toEqual({ path: "Projects/Next.md" });
  });

  it("says why a name cannot be a note's", () => {
    expect(notePathFor("  ", vault)).toEqual({ error: "empty" });
    expect(notePathFor("a:b", vault)).toEqual({ error: "unsafe" });
    expect(notePathFor("[[x]]", vault)).toEqual({ error: "unsafe" });
    expect(notePathFor("a//b", vault)).toEqual({ error: "unsafe" });
    expect(notePathFor(".hidden", vault)).toEqual({ error: "unsafe" });
    expect(notePathFor("projects/plan", vault)).toEqual({
      error: "taken",
      path: "projects/plan.md",
    });
  });
});

describe("untitledName", () => {
  it("numbers Untitled past the notes there", () => {
    expect(untitledName(notes("Welcome.md"))).toBe("Untitled");
    expect(untitledName(notes("Untitled.md", "untitled 2.md"))).toBe("Untitled 3");
  });

  it("numbers it past the notes in the folder it goes in", () => {
    const vault = notes("Untitled.md", "Plan/Untitled.md");
    expect(untitledName(vault, "Plan")).toBe("Untitled 2");
    expect(untitledName(vault, "Other")).toBe("Untitled");
  });
});
