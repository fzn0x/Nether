// Templates and periodic notes as a vault sets them: the folder its
// templates are in, how dates are written, and where each day's, week's and
// month's note goes and what it starts from. Nether keeps them in
// `.nether/templates.json`; a vault without that file starts from
// Obsidian's settings, when it has them, else from Nether's defaults.
import { type Period, formatDate, startOfPeriod } from "@nether/core";
import type { NoteEntry } from "@nether/storage";

export interface PeriodicSettings {
  /** Whether the app offers the note: daily notes are on, weekly and monthly off, until changed. */
  readonly enabled: boolean;
  /** The folder the notes go in; the vault's top when empty. */
  readonly folder: string;
  /** A note's name as a moment.js format of its date; `/` makes folders. */
  readonly format: string;
  /** The path of the note new ones start from, without `.md`, as Obsidian writes it; none when empty. */
  readonly template: string;
}

export interface TemplateSettings {
  /** The folder whose notes the template picker lists. */
  readonly folder: string;
  /** How `{{date}}` is written. */
  readonly dateFormat: string;
  /** How `{{time}}` is written. */
  readonly timeFormat: string;
  readonly day: PeriodicSettings;
  readonly week: PeriodicSettings;
  readonly month: PeriodicSettings;
}

export const periods: readonly Period[] = ["day", "week", "month"];

export const defaultSettings: TemplateSettings = {
  folder: "Templates",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "HH:mm",
  day: { enabled: true, folder: "", format: "YYYY-MM-DD", template: "" },
  week: { enabled: false, folder: "", format: "GGGG-[W]WW", template: "" },
  month: { enabled: false, folder: "", format: "YYYY-MM", template: "" },
};

type Fields = Readonly<Record<string, unknown>>;

function fields(value: unknown): Fields | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** A folder as the vault names it: no slashes at either end. */
export function cleanFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

/** A note's path without `.md`, as settings name templates. */
export function cleanTemplate(path: string): string {
  return cleanFolder(path).replace(/\.md$/i, "");
}

function periodic(value: unknown, fallback: PeriodicSettings): PeriodicSettings {
  const read = fields(value);
  if (read === undefined) return fallback;
  return {
    enabled: typeof read.enabled === "boolean" ? read.enabled : fallback.enabled,
    folder: cleanFolder(text(read.folder, fallback.folder)),
    format: text(read.format, fallback.format) || fallback.format,
    template: cleanTemplate(text(read.template, fallback.template)),
  };
}

/** What Obsidian keeps of templates and periodic notes, from its `.obsidian` folder. */
export interface ObsidianSettings {
  /** `templates.json`, of the Templates plugin. */
  readonly templates?: unknown;
  /** `daily-notes.json`, of the Daily notes plugin. */
  readonly dailyNotes?: unknown;
  /** `plugins/periodic-notes/data.json`, of the community Periodic Notes plugin. */
  readonly periodicNotes?: unknown;
}

/**
 * The vault's settings: Nether's own when it has them, else Obsidian's,
 * each field over the defaults.
 */
export function readSettings(own: unknown, obsidian: ObsidianSettings = {}): TemplateSettings {
  const mine = fields(own);
  if (mine !== undefined) {
    return {
      folder: cleanFolder(text(mine.folder, defaultSettings.folder)),
      dateFormat: text(mine.dateFormat, "") || defaultSettings.dateFormat,
      timeFormat: text(mine.timeFormat, "") || defaultSettings.timeFormat,
      day: periodic(mine.day, defaultSettings.day),
      week: periodic(mine.week, defaultSettings.week),
      month: periodic(mine.month, defaultSettings.month),
    };
  }
  const templates = fields(obsidian.templates) ?? {};
  const plugin = fields(obsidian.periodicNotes) ?? {};
  // The Periodic Notes plugin's settings, when it has them, come before the Daily notes plugin's.
  const daily = periodic(obsidian.dailyNotes, defaultSettings.day);
  return {
    folder: cleanFolder(text(templates.folder, defaultSettings.folder)),
    dateFormat: text(templates.dateFormat, "") || defaultSettings.dateFormat,
    timeFormat: text(templates.timeFormat, "") || defaultSettings.timeFormat,
    day: periodic(plugin.daily, daily),
    week: periodic(plugin.weekly, defaultSettings.week),
    month: periodic(plugin.monthly, defaultSettings.month),
  };
}

function join(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** The path of the note a period's date is for. */
export function periodicPath(settings: PeriodicSettings, date: Date): string {
  return join(cleanFolder(settings.folder), `${formatDate(date, settings.format)}.md`);
}

/** The note for the day, week or month `now` is in: its path and the date it is for. */
export function periodicNote(
  settings: TemplateSettings,
  period: Period,
  now: Date,
): { readonly path: string; readonly date: Date } {
  const date = startOfPeriod(now, period);
  return { path: periodicPath(settings[period], date), date };
}

/** The note a template path names: the note at that path, or of that name in the templates folder. */
export function findTemplate(
  notes: readonly NoteEntry[],
  settings: TemplateSettings,
  template: string,
): NoteEntry | undefined {
  const path = cleanTemplate(template).toLowerCase();
  if (path === "") return undefined;
  const inFolder = join(settings.folder, path).toLowerCase();
  return (
    notes.find((note) => note.path.toLowerCase() === `${path}.md`) ??
    notes.find((note) => note.path.toLowerCase() === `${inFolder}.md`)
  );
}

function inFolder(path: string, folder: string): boolean {
  return folder === "" ? false : path.toLowerCase().startsWith(`${folder.toLowerCase()}/`);
}

/**
 * The notes a new note can start from: with nothing typed, those in the
 * templates folder; else any note whose path has the words typed, those in
 * the folder first. Any note can be a template.
 */
export function templateChoices(
  notes: readonly NoteEntry[],
  folder: string,
  query: string,
  limit = 50,
): NoteEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const byPath = (a: NoteEntry, b: NoteEntry) => a.path.localeCompare(b.path);
  if (words.length === 0) {
    return notes
      .filter((note) => inFolder(note.path, folder))
      .sort(byPath)
      .slice(0, limit);
  }
  const matching = notes.filter((note) => {
    const path = note.path.toLowerCase();
    return words.every((word) => path.includes(word));
  });
  return [
    ...matching.filter((note) => inFolder(note.path, folder)).sort(byPath),
    ...matching.filter((note) => !inFolder(note.path, folder)).sort(byPath),
  ].slice(0, limit);
}

/** Characters a note's name cannot have, for a file's sake on any system, or a link's. */
const unsafe = /[\\:*?"<>|#^[\]]/;

/**
 * The path a new note's name gives, folders written with `/`, or why it
 * cannot be one: `empty`, `unsafe` for a character a file or link cannot
 * have, or `taken` when a note is there.
 */
export function notePathFor(
  name: string,
  notes: readonly NoteEntry[],
):
  | { readonly path: string }
  | { readonly error: "empty" | "unsafe" | "taken"; readonly path?: string } {
  const parts = name
    .trim()
    .replace(/\.md$/i, "")
    .split("/")
    .map((part) => part.trim());
  if (parts.every((part) => part === "")) return { error: "empty" };
  if (parts.some((part) => part === "" || part.startsWith(".") || unsafe.test(part))) {
    return { error: "unsafe" };
  }
  const path = `${parts.join("/")}.md`;
  const lower = path.toLowerCase();
  if (notes.some((note) => note.path.toLowerCase() === lower)) return { error: "taken", path };
  return { path };
}

/** A name for a new note nobody named: `Untitled`, then `Untitled 2` and so on. */
export function untitledName(notes: readonly NoteEntry[], base = "Untitled"): string {
  const taken = new Set(notes.map((note) => note.path.toLowerCase()));
  if (!taken.has(`${base.toLowerCase()}.md`)) return base;
  let n = 2;
  while (taken.has(`${base.toLowerCase()} ${String(n)}.md`)) n++;
  return `${base} ${String(n)}`;
}

/** A note's name from its path: its file name without `.md`. */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}
