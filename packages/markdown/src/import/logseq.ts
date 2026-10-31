// A Logseq graph (ADR 0029): its folders as they are, `pages`, `journals`
// and `assets`, so links between them still find what they named; its
// page properties, `key:: value` lines at a page's top, as frontmatter;
// a block's ID, `id:: …` below it, as `^id` after it; references to blocks,
// `((id))`, and embeds, `{{embed …}}`, as wiki links and embeds; TODO and
// DONE as tasks; journals named by their dates as rows write dates, with
// the titles Logseq gave them as aliases, and links to them by those
// titles made links to them; and namespaces, `a___b`, as folders. Every
// other line stays as Logseq wrote it, its other block properties among
// them, which Obsidian's Dataview reads as fields.
import { type JsonValue, type PropertyEntry, formatDate } from "@nether/core";
import type { Nodes, Root } from "mdast";
import { writeFrontmatter } from "../frontmatter.ts";
import { markdownToTree } from "../tree.ts";
import {
  type ImportPlan,
  type ImportSource,
  type PlannedFile,
  type PlannedNote,
  isMarkdown,
  notePath,
  safeName,
  within,
} from "./plan.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Logseq's format for a journal's title, as date-fns writes it, in the tokens dates are formatted with here. */
export function journalFormat(dateFns: string): string {
  return dateFns
    .replace(/EEEE/g, "dddd")
    .replace(/EEE/g, "ddd")
    .replace(/yyyy/g, "YYYY")
    .replace(/\byy\b/g, "YY")
    .replace(/do/g, "Do")
    .replace(/\bdd\b/g, "DD")
    .replace(/\bd\b/g, "D");
}

/** A page's file name as Logseq writes it, `area___project` or `area%2Fproject`, as a path of folders. */
function pageName(file: string): string {
  let name = file.replace(/\.(md|markdown)$/i, "").replace(/___/g, "/");
  try {
    name = decodeURIComponent(name);
  } catch {
    // A name with a % of its own stays as it is.
  }
  return name
    .split("/")
    .map((part) => safeName(part))
    .join("/");
}

function relativeTo(fromFolder: string, to: string): string {
  const from = fromFolder === "" ? [] : fromFolder.split("/");
  const parts = to.split("/");
  let same = 0;
  while (same < from.length && same < parts.length - 1 && from[same] === parts[same]) same++;
  return [...from.slice(same).map(() => ".."), ...parts.slice(same)].join("/");
}

function resolve(folder: string, relative: string): string {
  const parts = folder === "" ? [] : folder.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** A page property's value: a list of what is between commas for tags and aliases, else its text. */
function propertyValue(key: string, value: string): JsonValue {
  if (key === "tags" || key === "alias" || key === "aliases") {
    return value
      .split(",")
      .map((item) =>
        item
          .trim()
          .replace(/^\[\[(.*)\]\]$/, "$1")
          .replace(/^#/, ""),
      )
      .filter((item) => item !== "");
  }
  return value.trim();
}

/** The Markdown links and images of a text whose paths are relative, with where in it each is. */
function relativeLinks(markdown: string): { start: number; end: number; url: string }[] {
  const tree: Root = markdownToTree(markdown);
  const found: { start: number; end: number; url: string }[] = [];
  const walk = (node: Nodes) => {
    if (node.type === "code" || node.type === "inlineCode" || node.type === "html") return;
    if (
      (node.type === "link" || node.type === "image") &&
      node.url !== "" &&
      !/^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(node.url)
    ) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        // The address as written, inside the link's parentheses.
        const written = markdown.slice(start, end);
        const at = written.lastIndexOf("](");
        if (at !== -1) {
          const url =
            written
              .slice(at + 2, -1)
              .trim()
              .replace(/^<|>$/g, "")
              .split(/\s+"/)[0] ?? "";
          const urlStart = start + at + 2 + written.slice(at + 2).indexOf(url);
          found.push({ start: urlStart, end: urlStart + url.length, url });
        }
      }
    }
    if ("children" in node) for (const child of node.children as readonly Nodes[]) walk(child);
  };
  walk(tree);
  return found;
}

/** Plans a Logseq graph's import into the vault's folder `into`. */
export async function planLogseq(source: ImportSource, into: string): Promise<ImportPlan> {
  const warnings: string[] = [];
  const config = source.files.some((file) => file.path === "logseq/config.edn")
    ? await source.readText("logseq/config.edn")
    : "";
  const titleFormat = journalFormat(
    /:journal\/page-title-format\s+"([^"]+)"/.exec(config)?.[1] ?? "MMM do, yyyy",
  );

  // Where each file goes: Logseq's own settings stay behind.
  const places = new Map<string, string>();
  const journalTitles = new Map<string, string>();
  for (const { path } of source.files) {
    if (path.startsWith("logseq/")) continue;
    const slash = path.lastIndexOf("/");
    const folder = slash === -1 ? "" : path.slice(0, slash);
    const file = path.slice(slash + 1);
    const journal = /^(\d{4})_(\d{2})_(\d{2})\.md$/.exec(file);
    if (folder === "journals" && journal !== null) {
      const [, year = "", month = "", day = ""] = journal;
      const name = `${year}-${month}-${day}`;
      places.set(path, within(into, `journals/${name}.md`));
      journalTitles.set(
        path,
        formatDate(new Date(Number(year), Number(month) - 1, Number(day)), titleFormat),
      );
    } else if (folder === "pages" && isMarkdown(file)) {
      places.set(path, within(into, `pages/${pageName(file)}.md`));
    } else {
      places.set(path, within(into, isMarkdown(path) ? notePath(path) : path));
    }
  }

  // The page each block's ID is in, for references to it.
  const texts = new Map<string, string>();
  const blockPages = new Map<string, string>();
  for (const [path, goes] of places) {
    if (!isMarkdown(path)) continue;
    const text = await source.readText(path);
    texts.set(path, text);
    for (const match of text.matchAll(new RegExp(`^\\s*id:: (${uuid})\\s*$`, "gim"))) {
      blockPages.set((match[1] ?? "").toLowerCase(), goes.replace(/\.md$/i, ""));
    }
  }

  // Each journal by the title Logseq gave it, for the links that name it so.
  const journals = new Map<string, string>();
  for (const [path, title] of journalTitles) {
    journals.set(title.toLowerCase(), (places.get(path) ?? "").replace(/\.md$/i, ""));
  }

  const notes: PlannedNote[] = [];
  const files: PlannedFile[] = [];
  let missed = 0;
  const reference = (id: string, embed: boolean): string | undefined => {
    const page = blockPages.get(id.toLowerCase());
    if (page === undefined) {
      missed++;
      return undefined;
    }
    return `${embed ? "!" : ""}[[${page}#^${id}]]`;
  };

  for (const [path, goes] of places) {
    const text = texts.get(path);
    if (text === undefined) {
      files.push({ from: path, to: goes });
      continue;
    }
    const lines = text.split("\n");
    const properties: PropertyEntry[] = [];
    // Page properties: the lines at the top, alone or as the first block.
    let first = 0;
    while (first < lines.length) {
      const property = /^(?:- )?([A-Za-z0-9_-]+):: (.*?)\r?$/.exec(lines[first] ?? "");
      if (property === null) break;
      const key = property[1] === "alias" ? "aliases" : (property[1] ?? "");
      properties.push({ key, value: propertyValue(key, property[2] ?? "") });
      first++;
    }
    const title = journalTitles.get(path);
    if (title !== undefined) {
      const aliases = properties.find((entry) => entry.key === "aliases");
      if (aliases === undefined) properties.push({ key: "aliases", value: [title] });
      else if (Array.isArray(aliases.value)) aliases.value.push(title);
    }

    const out: string[] = [];
    let fenced = false;
    let lastBlock = -1;
    for (const raw of lines.slice(first)) {
      if (/^\s*(- )?```/.test(raw)) fenced = !fenced;
      if (fenced && !/^\s*(- )?```/.test(raw)) {
        out.push(raw);
        continue;
      }
      // A block's ID goes after the block, as Obsidian writes block IDs.
      const blockId = new RegExp(`^\\s*id:: (${uuid})\\s*\\r?$`, "i").exec(raw);
      if (blockId !== null && lastBlock !== -1) {
        const line = out[lastBlock] ?? "";
        const cr = line.endsWith("\r") ? "\r" : "";
        out[lastBlock] = `${line.slice(0, line.length - cr.length)} ^${blockId[1] ?? ""}${cr}`;
        continue;
      }
      const line = raw
        .replace(/^(\s*- )(TODO|LATER) /, "$1[ ] ")
        .replace(/^(\s*- )DONE /, "$1[x] ")
        .replace(
          /\{\{embed \(\(([0-9a-f-]{36})\)\)\}\}/gi,
          (whole, id: string) => reference(id, true) ?? whole,
        )
        .replace(/\{\{embed \[\[([^\]]+)\]\]\}\}/g, "![[$1]]")
        .replace(/\(\(([0-9a-f-]{36})\)\)/gi, (whole, id: string) => reference(id, false) ?? whole)
        // A tag of several words is a page, as Logseq reads it.
        .replace(/#\[\[([^\]]+)\]\]/g, "[[$1]]")
        .replace(/\[\[([^\]|#]+)\]\]/g, (whole, name: string) => {
          const journal = journals.get(name.trim().toLowerCase());
          return journal === undefined ? whole : `[[${journal}|${name}]]`;
        });
      if (/^\s*- /.test(line)) lastBlock = out.length;
      out.push(line);
    }
    let body = out.join("\n");
    // Relative links from a page whose folder changed, as a namespace's, find their files again.
    const from = goes.slice(0, goes.lastIndexOf("/"));
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    for (const link of relativeLinks(body).sort((a, b) => b.start - a.start)) {
      let decoded: string;
      try {
        decoded = decodeURI(link.url);
      } catch {
        decoded = link.url;
      }
      const target = places.get(resolve(folder, decoded));
      if (target === undefined) continue;
      const moved = encodeURI(relativeTo(from, target));
      if (moved !== link.url) body = body.slice(0, link.start) + moved + body.slice(link.end);
    }
    const yaml = properties.length === 0 ? undefined : writeFrontmatter(undefined, [], properties);
    notes.push({
      path: goes,
      text: yaml === undefined ? body : `---\n${yaml.replace(/\n$/, "")}\n---\n${body}`,
    });
  }
  if (missed > 0) {
    warnings.push(
      `${String(missed)} block references name blocks the graph does not have; they are as Logseq wrote them.`,
    );
  }
  return { notes, files, warnings };
}
