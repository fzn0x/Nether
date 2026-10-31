// A Notion export, as Markdown and CSV (ADR 0028). Notion names every page
// and folder with its 32-character ID, writes a page's subpages in a
// folder beside it, as Nether keeps them (ADR 0013), and a database as a
// CSV table beside a folder of its rows, each row's page starting with its
// properties as `Key: Value` lines. Here each name loses its ID, each page
// its title line, which its file's name holds, and each row its property
// lines, which become its frontmatter; links between pages become wiki
// links, and everything else in a page stays as Notion wrote it.
import type { JsonValue, PropertyEntry } from "@nether/core";
import type { Nodes, Root } from "mdast";
import { writeFrontmatter } from "../frontmatter.ts";
import { serializeMarkdown } from "../serialize.ts";
import { markdownToTree } from "../tree.ts";
import { parseCsv } from "./csv.ts";
import {
  type ImportPlan,
  type ImportSource,
  type PlannedFile,
  type PlannedNote,
  freeNames,
  safeName,
  within,
} from "./plan.ts";

const idAtEnd = /\s+[0-9a-f]{32}$/i;

/** A name without its extension, and the extension, `.md`; a folder's name has none. */
function splitName(name: string, folder: boolean): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return folder || dot <= 0
    ? { stem: name, ext: "" }
    : { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/** A name without Notion's ID, nor its extension unless it is a folder's: `Plan 0123…cdef.md` is `Plan`. */
export function notionStem(name: string, folder = false): string {
  return splitName(name, folder).stem.replace(/_all$/, "").replace(idAtEnd, "");
}

/**
 * Where each of an export's files goes: every folder and file named
 * without its ID, two of the same name in a folder apart, and a page and
 * its folder of subpages, or a database's table and its folder of rows,
 * under the same name.
 */
function placesOf(paths: readonly string[], into: string): (path: string) => string {
  const files = new Set(paths);
  const folders = new Map<string, (name: string) => string>();
  const named = new Map<string, string>();
  const place = (path: string): string => {
    const slash = path.lastIndexOf("/");
    const parent = slash === -1 ? "" : path.slice(0, slash);
    const name = path.slice(slash + 1);
    const parentPlace = parent === "" ? into : place(parent);
    const isFolder = !files.has(path);
    const { stem, ext } = splitName(name, isFolder);
    // A page, its folder and a database's tables share a key: the name with its ID, without `_all`.
    const key = `${parentPlace}/${stem.replace(/_all$/, "").toLowerCase()}`;
    let given = named.get(key);
    if (given === undefined) {
      let free = folders.get(parentPlace);
      if (free === undefined) {
        free = freeNames();
        folders.set(parentPlace, free);
      }
      given = free(safeName(notionStem(name, isFolder)));
      named.set(key, given);
    }
    // A database's table is its note.
    const extension = /\.csv$/i.test(ext) ? ".md" : ext;
    return within(parentPlace, `${given}${extension}`);
  };
  return place;
}

const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const notionDate = /^([A-Za-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) ?(AM|PM))?$/;

/** A date as Notion writes it, `October 30, 2026` or `October 30, 2026 3:45 PM`, as rows write dates. */
export function readNotionDate(text: string): string | undefined {
  const match = notionDate.exec(text.trim());
  if (match === null) return undefined;
  const [, monthName = "", day = "", year = "", hour, minute, half] = match;
  const month = months.indexOf(monthName.toLowerCase()) + 1;
  if (month === 0 || Number(day) < 1 || Number(day) > 31) return undefined;
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${year}-${pad(month)}-${pad(Number(day))}`;
  if (hour === undefined || minute === undefined) return date;
  const hours = (Number(hour) % 12) + (half?.toUpperCase() === "PM" ? 12 : 0);
  return `${date}T${pad(hours)}:${minute}`;
}

type ColumnType = "number" | "date" | "checkbox" | "url" | "text";

function columnType(values: readonly string[]): ColumnType {
  const written = values.map((value) => value.trim()).filter((value) => value !== "");
  if (written.length === 0) return "text";
  if (written.every((value) => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value))) return "number";
  if (written.every((value) => /^(yes|no)$/i.test(value))) return "checkbox";
  if (
    written.every(
      (value) => readNotionDate(value) !== undefined || /^\d{4}-\d{2}-\d{2}$/.test(value),
    )
  ) {
    return "date";
  }
  if (written.every((value) => /^https?:\/\/\S+$/i.test(value))) return "url";
  return "text";
}

function valueOf(text: string, type: ColumnType): JsonValue {
  const value = text.trim();
  switch (type) {
    case "number":
      return Number(value);
    case "checkbox":
      return /^yes$/i.test(value);
    case "date":
      return readNotionDate(value) ?? value;
    case "url":
      return value;
    case "text":
      return text;
  }
}

/** A database, as its table tells it. */
interface NotionDatabase {
  readonly keys: readonly string[];
  readonly types: readonly ColumnType[];
  readonly lines: readonly (readonly string[])[];
}

function readDatabase(text: string): NotionDatabase {
  const [header = [], ...lines] = parseCsv(text).filter((line) =>
    line.some((cell) => cell.trim() !== ""),
  );
  const keyName = freeNames();
  const keys = header.map((key, column) =>
    keyName(key.trim() === "" ? `Column ${String(column + 1)}` : key.trim()),
  );
  const types = keys.map((_, column) => columnType(lines.map((line) => line[column] ?? "")));
  return { keys, types, lines };
}

/** The text of a link's label, without its marks. */
function plainText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as readonly Nodes[]).map(plainText).join("");
  return "";
}

/** Whether a link's address is a path in the export rather than a web address or an anchor. */
function isLocal(url: string): boolean {
  return (
    url !== "" && !url.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//")
  );
}

/** A path from a folder, `..` and `.` taken, as a path in the export. */
function resolve(folder: string, relative: string): string {
  const parts = folder === "" ? [] : folder.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** A wiki link's alias as it can be written: no brackets, and a bar escaped in a table. */
function alias(text: string, inTable: boolean): string {
  const clean = text.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim();
  return inTable ? clean.replaceAll("|", "\\|") : clean.replaceAll("|", " ");
}

/**
 * A page's Markdown with its links to pages, databases and files of the
 * export written as wiki links to where they go; the rest as it was.
 */
function relink(
  markdown: string,
  folder: string,
  target: (path: string) => string | undefined,
  missed: (url: string) => void,
): string {
  const tree: Root = markdownToTree(markdown);
  const edits: { start: number; end: number; text: string }[] = [];
  const walk = (node: Nodes, inTable: boolean) => {
    if (node.type === "code" || node.type === "inlineCode" || node.type === "html") return;
    if ((node.type === "link" || node.type === "image") && isLocal(node.url)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      let decoded: string;
      try {
        decoded = decodeURIComponent(node.url);
      } catch {
        decoded = node.url;
      }
      const [path = "", heading] = decoded.split("#");
      const goes = target(resolve(folder, path));
      if (goes === undefined) {
        missed(decoded);
      } else if (start !== undefined && end !== undefined) {
        const name = goes.replace(/\.md$/i, "");
        const label =
          node.type === "image" ? alias(node.alt ?? "", inTable) : alias(plainText(node), inTable);
        const bar = inTable ? "\\|" : "|";
        const part = heading === undefined || heading === "" ? "" : `#${heading}`;
        const shown =
          label === "" || label === name.slice(name.lastIndexOf("/") + 1) ? "" : `${bar}${label}`;
        edits.push({
          start,
          end,
          text: `${node.type === "image" ? "!" : ""}[[${name}${part}${shown}]]`,
        });
      }
      return;
    }
    if ("children" in node) {
      for (const child of node.children as readonly Nodes[]) {
        walk(child, inTable || node.type === "tableCell");
      }
    }
  };
  walk(tree, false);
  let out = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** A note's text: its properties as frontmatter, then its body as it is. */
function noteText(properties: readonly PropertyEntry[], body: string): string {
  const yaml = properties.length === 0 ? undefined : writeFrontmatter(undefined, [], properties);
  return yaml === undefined ? body : `---\n${yaml.replace(/\n$/, "")}\n---\n${body}`;
}

/** Plans a Notion export's import into the vault's folder `into`. */
export async function planNotion(source: ImportSource, into: string): Promise<ImportPlan> {
  const paths = source.files.map((file) => file.path);
  const has = new Set(paths);
  const place = placesOf(paths, into);
  const warnings: string[] = [];
  let missedLinks = 0;

  // Each database by the folder of its rows: its table, the one with every property when Notion wrote both.
  const databases = new Map<string, { path: string; database: NotionDatabase }>();
  for (const path of paths) {
    if (!/\.csv$/i.test(path)) continue;
    const folder = path.replace(/(_all)?\.csv$/i, "");
    const all = `${folder}_all.csv`;
    if (path !== all && has.has(all)) continue;
    databases.set(folder, { path, database: readDatabase(await source.readText(path)) });
  }

  // Where a link to a path in the export goes, if it is one: a page, a database or a file.
  const target = (path: string): string | undefined => {
    if (has.has(path)) return place(path);
    if (databases.has(path.replace(/(_all)?\.csv$/i, ""))) return place(path);
    return undefined;
  };

  const notes: PlannedNote[] = [];
  const files: PlannedFile[] = [];
  const rowTitles = new Map<string, Set<string>>();
  for (const path of paths) {
    if (/\.csv$/i.test(path)) continue;
    if (!/\.md$/i.test(path)) {
      files.push({ from: path, to: place(path) });
      continue;
    }
    const slash = path.lastIndexOf("/");
    const folder = slash === -1 ? "" : path.slice(0, slash);
    let body = await source.readText(path);
    const properties: PropertyEntry[] = [];
    // The title line, which the note's name holds.
    const heading = /^(?:\uFEFF)?#[ \t]+([^\n]*?)[ \t]*\r?\n(?:[ \t]*\r?\n)?/.exec(body);
    const title = heading?.[1] ?? notionStem(path.slice(slash + 1));
    if (heading !== null) body = body.slice(heading[0].length);
    const goes = place(path);
    // A title its file's name cannot hold, kept as an alias.
    if (title.trim() !== "" && safeName(title) !== title.trim()) {
      properties.push({ key: "aliases", value: [title.trim()] });
    }
    // A row's properties, the lines at its top that name its database's columns.
    const database = databases.get(folder)?.database;
    if (database !== undefined) {
      const columns = new Map(database.keys.map((key, column) => [key, column]));
      for (;;) {
        const line = /^([^:\r\n]+): ?([^\r\n]*)(?:\r?\n|$)/.exec(body);
        const column = line === null ? undefined : columns.get(line[1] ?? "");
        if (line === null || column === undefined || column === 0) break;
        body = body.slice(line[0].length);
        const value = line[2] ?? "";
        if (value.trim() !== "") {
          properties.push({
            key: database.keys[column] ?? "",
            value: valueOf(value, database.types[column] ?? "text"),
          });
        }
      }
      body = body.replace(/^[ \t]*\r?\n/, "");
      let titles = rowTitles.get(folder);
      if (titles === undefined) {
        titles = new Set();
        rowTitles.set(folder, titles);
      }
      titles.add(title.trim().toLowerCase());
    }
    body = relink(body, folder, target, () => {
      missedLinks++;
    });
    notes.push({ path: goes, text: noteText(properties, body) });
  }

  // Each database's note, and a row for each line of its table that has no page.
  for (const [folder, { path, database }] of databases) {
    const keys = database.keys.slice(1);
    const schema: JsonValue = {
      properties: keys.map((key, column) => ({ key, type: database.types[column + 1] ?? "text" })),
      views: [{ name: "Table", layout: "table", visible: keys }],
    };
    notes.push({
      path: place(path),
      text: serializeMarkdown({ properties: [{ key: "database", value: schema }], content: [] })
        .text,
    });
    const titles = rowTitles.get(folder) ?? new Set();
    const rows = place(path).replace(/\.md$/, "");
    const rowName = freeNames();
    for (const existing of notes) {
      if (
        existing.path.startsWith(`${rows}/`) &&
        !existing.path.slice(rows.length + 1).includes("/")
      ) {
        rowName(existing.path.slice(rows.length + 1, -3));
      }
    }
    for (const line of database.lines) {
      const written = (line[0] ?? "").trim();
      if (titles.has(written.toLowerCase())) continue;
      const entries: PropertyEntry[] = [];
      if (written !== "" && safeName(written) !== written) {
        entries.push({ key: "aliases", value: [written] });
      }
      keys.forEach((key, column) => {
        const cell = line[column + 1] ?? "";
        if (cell.trim() !== "") {
          entries.push({ key, value: valueOf(cell, database.types[column + 1] ?? "text") });
        }
      });
      notes.push({
        path: `${rows}/${rowName(safeName(written))}.md`,
        text: serializeMarkdown({ properties: entries, content: [] }).text,
      });
    }
  }
  if (missedLinks > 0) {
    warnings.push(
      `${String(missedLinks)} links name pages or files the export does not have; they are as Notion wrote them.`,
    );
  }
  return { notes, files, warnings };
}
