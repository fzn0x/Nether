// Exports notes: one, a folder's, or the whole vault's. As Markdown, the
// notes' files as they are, with the files they show and their comments as
// JSON in `.nether/comments.json` (ADR 0044); as HTML, a page for
// each note, its links leading to the pages exported with it and its files
// beside it; as a PDF, every note printed from a view of the page, each on
// a new page. The user chooses where first, and a ZIP goes to the app in
// batches as it is made. This loads when an export starts.
import type { LinkTarget } from "@nether/core";
import { diagramToSvg, highlightCode, mathToMathml, readThreads } from "@nether/editor";
import { type LinkGraph, noteSection } from "@nether/graph";
import {
  type HtmlHooks,
  type ParsedMarkdown,
  blocksToHtml,
  escapeHtml,
  headingSlug,
  noteArticle,
  noteToHtml,
  parseMarkdown,
} from "@nether/markdown";
import { type NoteEntry, type Vault, commentsDocument, isNotePath } from "@nether/storage";
import * as Y from "yjs";
import type { Exporter, VaultMedia } from "./backend.ts";
import { pageStyle, printStyle } from "./exportStyle.ts";
import type { ExportEntry, PDFPage } from "./mygo.ts";

export type ExportFormat = "markdown" | "html" | "pdf";

export interface ExportJob {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly media: VaultMedia;
  readonly exporter: Exporter;
  /** The notes to export, in the order a PDF prints them. */
  readonly notes: readonly NoteEntry[];
  /** Whether the whole vault goes, with every file it holds, not only those its notes show. */
  readonly wholeVault: boolean;
  /** The name the save dialog suggests, and an HTML export's index shows. */
  readonly name: string;
  readonly format: ExportFormat;
  /** The paper a PDF is laid out on. */
  readonly page?: PDFPage;
  /** Called as notes are done. */
  readonly onProgress?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
}

/** How many files go to the app at once. */
const batchSize = 100;
/** How many embeds deep an exported note shows other notes, as the editor does. */
const embedDepth = 2;

const webAddress = /^(https?:|mailto:|tel:)/i;

/** The address of one vault file from another's page, each segment escaped. */
export function relativePath(from: string, to: string): string {
  const fromFolders = from.split("/").slice(0, -1);
  const toParts = to.split("/");
  let common = 0;
  while (
    common < fromFolders.length &&
    common < toParts.length - 1 &&
    fromFolders[common] === toParts[common]
  ) {
    common++;
  }
  const up = Array.from({ length: fromFolders.length - common }, () => "..");
  return [...up, ...toParts.slice(common).map(encodeURIComponent)].join("/");
}

/** The path of a note's page in an HTML export. */
export function pagePath(notePath: string): string {
  return notePath.replace(/\.md$/i, ".html");
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The folder a path is in, or "" at the vault's top. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** A path relative to a folder, `..` and `.` taken out; undefined when it leaves the vault. */
function joinPath(folder: string, relative: string): string | undefined {
  const parts = folder === "" ? [] : folder.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

class Export {
  readonly #job: ExportJob;
  readonly #parsed = new Map<string, Promise<ParsedMarkdown | undefined>>();
  readonly #diagrams = new Map<string, Promise<string | undefined>>();
  readonly #exported: ReadonlyMap<string, number>;
  /** The vault's files the export takes with its notes. */
  readonly files = new Set<string>();

  constructor(job: ExportJob) {
    this.#job = job;
    this.#exported = new Map(job.notes.map((note, index) => [note.id, index]));
  }

  /** A note's text read as blocks, read once however often it is asked for. */
  parsed(note: NoteEntry): Promise<ParsedMarkdown | undefined> {
    let parsed = this.#parsed.get(note.id);
    if (parsed === undefined) {
      parsed = this.#job.vault
        .read(note.id)
        .then((file) =>
          file.missing === true || file.binary === true ? undefined : parseMarkdown(file.text),
        );
      this.#parsed.set(note.id, parsed);
    }
    return parsed;
  }

  /** The note a link names from another, and the part of it. */
  #linked(target: LinkTarget, from: NoteEntry) {
    const { vault, graph } = this.#job;
    const heading = "heading" in target ? target.heading : undefined;
    const block = "block" in target ? target.block : undefined;
    let note: NoteEntry | undefined;
    if ("note" in target) note = vault.note(target.note);
    else if ("title" in target) {
      const id =
        graph.resolve(target.title, from.path) ??
        vault.noteAt(/\.md$/i.test(target.title) ? target.title : `${target.title}.md`)?.id;
      note = id === undefined ? undefined : vault.note(id);
    } else note = from;
    return note === undefined ? undefined : { note, heading, block };
  }

  /** A vault file a note shows or links to, by the link as written, taken into the export. */
  #file(src: string, from: NoteEntry): string | undefined {
    const { vault } = this.#job;
    const path = vault.resolveFile(src, from.path) ?? vault.resolveFile(decode(src), from.path);
    if (path === undefined || isNotePath(path)) return undefined;
    this.files.add(path);
    return path;
  }

  /** Where a link leads from a page: another exported note's page, or a PDF's section. */
  #noteHref(
    page: string | undefined,
    note: NoteEntry,
    heading?: string,
    block?: string,
  ): string | undefined {
    const index = this.#exported.get(note.id);
    if (index === undefined) return undefined;
    // In a PDF, a link leads to the note's start.
    if (page === undefined) return `#note-${String(index)}`;
    const anchor =
      heading !== undefined ? `#${headingSlug(heading)}` : block !== undefined ? `#^${block}` : "";
    const target = pagePath(note.path);
    return target === page ? anchor || "#" : `${relativePath(page, target)}${anchor}`;
  }

  /**
   * The hooks for a note shown in a page: links resolve from `source`, the
   * note whose blocks they are, and lead from `page`, the HTML page's path,
   * or within the PDF when there is none. Without `draw`, only links and
   * files, as when a note is read only for the files it takes along.
   */
  hooks(page: string | undefined, source: NoteEntry, depth = 0, draw = true): HtmlHooks {
    const { media } = this.#job;
    const fileHref = (path: string) =>
      page === undefined ? media.url(path) : relativePath(page, path);
    const links: HtmlHooks = {
      link: (target) => {
        const linked = this.#linked(target, source);
        return linked === undefined
          ? undefined
          : this.#noteHref(page, linked.note, linked.heading, linked.block);
      },
      href: (href) => {
        if (webAddress.test(href)) return href;
        if (href.startsWith("#")) return page === undefined ? undefined : href;
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
        const [address = "", anchor] = href.split("#", 2);
        const path = joinPath(folderOf(source.path), decode(address));
        const note = path === undefined ? undefined : this.#job.vault.noteAt(path);
        if (note !== undefined) {
          return this.#noteHref(page, note, anchor === undefined ? undefined : decode(anchor));
        }
        const file = this.#file(address, source);
        return file === undefined ? undefined : fileHref(file);
      },
      file: (src) => {
        if (webAddress.test(src)) return src;
        const path = this.#file(src, source);
        return path === undefined ? undefined : fileHref(path);
      },
    };
    if (!draw) return links;
    return {
      ...links,
      math: mathToMathml,
      code: highlightCode,
      diagram: (block) => {
        let svg = this.#diagrams.get(block.text);
        if (svg === undefined) {
          svg = diagramToSvg(block.text);
          this.#diagrams.set(block.text, svg);
        }
        return svg;
      },
      embed: async (target) => {
        if (depth >= embedDepth) return undefined;
        const linked = this.#linked(target, source);
        if (linked === undefined) return undefined;
        const parsed = await this.parsed(linked.note);
        if (parsed === undefined) return undefined;
        const blocks = noteSection(parsed.content, {
          ...(linked.heading === undefined ? {} : { heading: linked.heading }),
          ...(linked.block === undefined ? {} : { block: linked.block }),
        });
        return blocks === undefined
          ? undefined
          : blocksToHtml(blocks, this.hooks(page, linked.note, depth + 1), parsed.writtenIds);
      },
    };
  }
}

/** The index page of an HTML export: every note's page, by its path. */
function indexPage(name: string, notes: readonly NoteEntry[]): string {
  const items = notes
    .map((note) => {
      const folder = folderOf(note.path);
      const detail = folder === "" ? "" : ` <small>${escapeHtml(folder)}</small>`;
      return `<li><a href="${relativePath("index.html", pagePath(note.path))}">${escapeHtml(note.title)}</a>${detail}</li>`;
    })
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(name)}</title>`,
    `<style>${pageStyle}</style>`,
    "</head>",
    "<body>",
    "<article>",
    `<h1>${escapeHtml(name)}</h1>`,
    `<nav class="index"><ul>\n${items}\n</ul></nav>`,
    "</article>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Where a Markdown export keeps its notes' comments. */
export const commentsPath = ".nether/comments.json";

/** A time, as JSON writes it. */
function isoTime(time: number): string {
  return new Date(time).toISOString();
}

/**
 * The comments of the notes exported, so they leave Nether in an open form
 * as the notes do: each note's threads, with what each comment says, who
 * wrote it and when. Undefined when none of the notes has comments.
 */
export async function exportedComments(
  vault: Vault,
  notes: readonly NoteEntry[],
): Promise<string | undefined> {
  const exported = [];
  for (const note of notes) {
    const stored = await vault.documents.document(commentsDocument(note.id));
    if (stored.updates.length === 0) continue;
    const document = new Y.Doc();
    for (const update of stored.updates) Y.applyUpdate(document, update.data);
    const threads = readThreads(document);
    document.destroy();
    if (threads.length === 0) continue;
    exported.push({
      note: note.id,
      path: note.path,
      threads: threads.map((thread) => ({
        id: thread.id,
        quote: thread.anchor.quote,
        ...(thread.anchor.block === undefined ? {} : { block: thread.anchor.block }),
        created: isoTime(thread.created),
        ...(thread.resolved === undefined
          ? {}
          : { resolved: { by: thread.resolved.by, at: isoTime(thread.resolved.at) } }),
        comments: thread.comments.map((comment) => ({
          id: comment.id,
          author: comment.author,
          body: comment.body,
          created: isoTime(comment.created),
          ...(comment.edited === undefined ? {} : { edited: isoTime(comment.edited) }),
        })),
      })),
    });
  }
  return exported.length === 0 ? undefined : `${JSON.stringify({ notes: exported }, null, 2)}\n`;
}

async function sendInBatches(
  exporter: Exporter,
  token: string,
  entries: readonly ExportEntry[],
): Promise<void> {
  for (let start = 0; start < entries.length; start += batchSize) {
    await exporter.add(token, entries.slice(start, start + batchSize));
  }
}

async function exportZip(job: ExportJob, token: string): Promise<string> {
  const { vault, exporter, notes, signal } = job;
  const work = new Export(job);
  const pending: ExportEntry[] = [];
  const flush = async () => {
    await exporter.add(token, pending.splice(0));
  };
  for (const [index, note] of notes.entries()) {
    signal?.throwIfAborted();
    const parsed = await work.parsed(note);
    if (job.format === "markdown") {
      pending.push({ path: note.path, source: note.path });
      // Rendered only to find the files the note shows and links to.
      if (parsed !== undefined && !job.wholeVault) {
        await blocksToHtml(parsed.content, work.hooks(pagePath(note.path), note, 0, false));
      }
    } else if (parsed !== undefined) {
      const page = pagePath(note.path);
      pending.push({
        path: page,
        text: await noteToHtml({ title: note.title, ...parsed }, work.hooks(page, note), {
          style: pageStyle,
        }),
      });
    }
    if (pending.length >= batchSize) await flush();
    job.onProgress?.(index + 1, notes.length);
  }
  await flush();
  const files = job.wholeVault
    ? vault.files().filter((path) => !isNotePath(path))
    : [...work.files].sort();
  await sendInBatches(
    exporter,
    token,
    files.map((path) => ({ path, source: path })),
  );
  if (job.format === "html" && notes.length > 1) {
    await exporter.add(token, [{ path: "index.html", text: indexPage(job.name, notes) }]);
  }
  const comments = job.format === "markdown" ? await exportedComments(vault, notes) : undefined;
  if (comments !== undefined) await exporter.add(token, [{ path: commentsPath, text: comments }]);
  return exporter.finish(token);
}

/** Waits for the images in a view to load, so they print. */
async function imagesLoaded(root: HTMLElement): Promise<void> {
  await Promise.all(
    [...root.querySelectorAll("img")].map((image) => image.decode().catch(() => undefined)),
  );
}

async function exportPdf(job: ExportJob, token: string): Promise<string> {
  const { exporter, notes, signal } = job;
  const work = new Export(job);
  const articles: string[] = [];
  for (const [index, note] of notes.entries()) {
    signal?.throwIfAborted();
    const parsed = await work.parsed(note);
    if (parsed !== undefined) {
      const article = await noteArticle(
        { title: note.title, ...parsed },
        work.hooks(undefined, note),
      );
      articles.push(`<article id="note-${String(index)}">${article}</article>`);
    }
    job.onProgress?.(index + 1, notes.length);
  }
  signal?.throwIfAborted();
  const root = document.createElement("div");
  root.id = "print-root";
  root.innerHTML = `<style>${printStyle}</style>${articles.join("\n")}`;
  document.body.append(root);
  try {
    await imagesLoaded(root);
    return await exporter.printPdf(token, job.page ?? { size: "a4", landscape: false });
  } finally {
    root.remove();
  }
}

/** Exports notes as the job says; returns where the export was saved, or undefined when the user cancelled. */
export async function exportNotes(job: ExportJob): Promise<string | undefined> {
  const { exporter, format, name } = job;
  const token = await exporter.choose(name, format === "pdf" ? "pdf" : "zip");
  if (token === undefined) return undefined;
  try {
    return format === "pdf" ? await exportPdf(job, token) : await exportZip(job, token);
  } catch (error) {
    await exporter.cancel(token).catch(() => undefined);
    throw error;
  }
}
