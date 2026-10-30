// Notes as HTML pages, for export: each block as the element a browser
// shows it as, with Obsidian's links, callouts, highlights and embeds.
// What only the app can draw comes from hooks the caller gives: where links
// and files lead, math, highlighted code, diagrams and embedded notes.
// Without them, each shows as its text. `%%comments%%` are left out, as
// Obsidian's reading view leaves them out.
import type {
  Block,
  BlockId,
  BulletListItem,
  CodeBlock,
  ContentBlock,
  Inline,
  JsonValue,
  LinkTarget,
  Mark,
  NumberedListItem,
  PropertyEntry,
  TaskListItem,
} from "@nether/core";

type ListItem = BulletListItem | NumberedListItem | TaskListItem;

type Maybe<T> = T | Promise<T>;

export interface HtmlHooks {
  /** Where a link to a note leads from this page; nothing leaves it as text. */
  readonly link?: (target: LinkTarget) => Maybe<string | undefined>;
  /** Where a Markdown link's address leads from this page, such as a note's page for `Note.md`; nothing leaves it as text. */
  readonly href?: (href: string) => Maybe<string | undefined>;
  /** Where a file the note shows leads, by its link as written; nothing shows its name. */
  readonly file?: (src: string) => Maybe<string | undefined>;
  /** Math as HTML, such as MathML; its LaTeX as code when not given. */
  readonly math?: (latex: string, display: boolean) => Maybe<string>;
  /** Code's text as HTML, with its highlighting; the text escaped when not given. */
  readonly code?: (text: string, language: string) => Maybe<string>;
  /** A code block drawn as a diagram, as SVG; nothing shows its code. */
  readonly diagram?: (block: CodeBlock) => Maybe<string | undefined>;
  /** What an embed of a note, or of a part of one, shows, as HTML; nothing shows a link to it. */
  readonly embed?: (target: LinkTarget) => Maybe<string | undefined>;
}

/** A note as an HTML page shows it. */
export interface HtmlNote {
  readonly title: string;
  readonly properties: readonly PropertyEntry[];
  readonly content: readonly ContentBlock[];
  /** The blocks whose IDs the file writes as `^id`, which links to them name. */
  readonly writtenIds?: ReadonlySet<BlockId>;
}

export interface HtmlPageOptions {
  /** The page's language. */
  readonly lang?: string;
  /** CSS for the page, in its head. */
  readonly style?: string;
}

const escapes: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text as HTML shows it, in an element or an attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => escapes[char] ?? char);
}

/** A heading's anchor, as GitHub and most sites make it: lower case, words joined by `-`. */
export function headingSlug(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}

const safeScheme = /^(https?:|mailto:|tel:)/i;
const anyScheme = /^[a-z][a-z0-9+.-]*:/i;

/** Whether an address can be followed from a page: the web, mail and phones, or within the export. */
function isSafeHref(href: string): boolean {
  return safeScheme.test(href) || !anyScheme.test(href);
}

const fileExtension = /\.([a-z0-9]+)$/i;
const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"]);
const audioExtensions = new Set(["mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "3gp"]);
const videoExtensions = new Set(["webm", "mp4", "m4v", "mov", "mkv", "ogv"]);

type FileKind = "image" | "audio" | "video" | "pdf" | "other";

function fileKind(path: string): FileKind {
  const extension = fileExtension.exec(path.split(/[?#]/)[0] ?? "")?.[1]?.toLowerCase() ?? "";
  if (imageExtensions.has(extension)) return "image";
  if (audioExtensions.has(extension)) return "audio";
  if (videoExtensions.has(extension)) return "video";
  return extension === "pdf" ? "pdf" : "other";
}

/** Whether an embed's link names a note, by having no extension or `.md`, rather than a file. */
function isNoteLink(title: string): boolean {
  const extension = fileExtension.exec(title)?.[1]?.toLowerCase();
  return extension === undefined || extension === "md";
}

function targetText(target: LinkTarget): string {
  const title = "title" in target ? target.title : "";
  const heading = "heading" in target ? target.heading : undefined;
  const block = "block" in target ? target.block : undefined;
  const part = heading ?? (block === undefined ? undefined : `^${block}`);
  if (part === undefined) return title;
  return title === "" ? part : `${title} > ${part}`;
}

function attributes(
  values: Readonly<Record<string, string | number | boolean | undefined>>,
): string {
  return Object.entries(values)
    .flatMap(([name, value]) => {
      if (value === undefined || value === false) return [];
      return value === true ? [` ${name}`] : [` ${name}="${escapeHtml(String(value))}"`];
    })
    .join("");
}

const markTags: Readonly<Record<Exclude<Mark["type"], "link" | "comment">, string>> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  strike: "s",
  code: "code",
  highlight: "mark",
};

class Renderer {
  readonly #hooks: HtmlHooks;
  readonly #ids: ReadonlySet<BlockId>;
  readonly #slugs = new Map<string, number>();

  constructor(hooks: HtmlHooks, ids: ReadonlySet<BlockId>) {
    this.#hooks = hooks;
    this.#ids = ids;
  }

  /** A heading's anchor on this page, numbered after the first of the same text. */
  #slug(text: string): string {
    const slug = headingSlug(text);
    const count = this.#slugs.get(slug) ?? 0;
    this.#slugs.set(slug, count + 1);
    return count === 0 ? slug : `${slug}-${String(count)}`;
  }

  #id(block: Block): string | undefined {
    return this.#ids.has(block.id) ? `^${block.id}` : undefined;
  }

  async #marked(html: string, marks: readonly Mark[] | undefined): Promise<string> {
    let out = html;
    for (const mark of marks ?? []) {
      if (mark.type === "comment") return "";
      if (mark.type === "link") {
        const href = await this.#href(mark.href);
        out = href === undefined ? out : `<a${attributes({ href, title: mark.title })}>${out}</a>`;
      } else {
        const tag = markTags[mark.type];
        out = `<${tag}>${out}</${tag}>`;
      }
    }
    return out;
  }

  async #href(href: string): Promise<string | undefined> {
    const hook = this.#hooks.href;
    if (hook !== undefined) return hook(href);
    return isSafeHref(href) ? href : undefined;
  }

  async #inline(inline: Inline): Promise<string> {
    switch (inline.type) {
      case "text":
        return this.#marked(escapeHtml(inline.text), inline.marks);
      case "hardBreak":
        return "<br>";
      case "wikiLink": {
        const text = escapeHtml(inline.alias ?? targetText(inline.target));
        const href = await this.#hooks.link?.(inline.target);
        return this.#marked(
          href === undefined
            ? `<span class="internal-link unresolved">${text}</span>`
            : `<a class="internal-link"${attributes({ href })}>${text}</a>`,
          inline.marks,
        );
      }
      case "tag":
        return this.#marked(`<span class="tag">#${escapeHtml(inline.name)}</span>`, inline.marks);
      case "math": {
        const math = this.#hooks.math;
        return this.#marked(
          math === undefined
            ? `<code class="math">${escapeHtml(inline.latex)}</code>`
            : `<span class="math">${await math(inline.latex, false)}</span>`,
          inline.marks,
        );
      }
      case "raw":
        return this.#marked(escapeHtml(inline.markdown), inline.marks);
    }
  }

  async inlines(inlines: readonly Inline[]): Promise<string> {
    const parts: string[] = [];
    for (const inline of inlines) parts.push(await this.#inline(inline));
    return parts.join("");
  }

  async #fileHtml(src: string, name: string, width?: number, alt?: string): Promise<string> {
    const url = await (this.#hooks.file?.(src) ?? (safeScheme.test(src) ? src : undefined));
    if (url === undefined) return `<p class="file missing">${escapeHtml(name)}</p>`;
    switch (fileKind(src)) {
      case "image":
        return `<p class="image"><img${attributes({ src: url, alt: alt ?? "", width })}></p>`;
      case "audio":
        return `<p class="file"><audio controls${attributes({ src: url })}></audio></p>`;
      case "video":
        return `<p class="file"><video controls${attributes({ src: url, width })}></video></p>`;
      default:
        return `<p class="file"><a${attributes({ href: url })}>${escapeHtml(name)}</a></p>`;
    }
  }

  async #listItem(block: ListItem): Promise<string> {
    const children = block.children ?? [];
    const inner = await this.inlines(block.content);
    const nested = children.length === 0 ? "" : await this.blocks(children);
    if (block.type === "taskListItem") {
      const box = `<input type="checkbox" disabled${block.attrs.checked ? " checked" : ""}>`;
      return `<li class="task"${attributes({ id: this.#id(block) })}>${box} ${inner}${nested}</li>`;
    }
    return `<li${attributes({ id: this.#id(block) })}>${inner}${nested}</li>`;
  }

  async #block(block: ContentBlock): Promise<string> {
    const id = this.#id(block);
    switch (block.type) {
      case "paragraph":
        return `<p${attributes({ id })}>${await this.inlines(block.content)}</p>`;
      case "heading": {
        const tag = `h${String(block.attrs.level)}`;
        const text = block.content
          .map((inline) => (inline.type === "text" ? inline.text : ""))
          .join("");
        return `<${tag}${attributes({ id: id ?? this.#slug(text) })}>${await this.inlines(block.content)}</${tag}>`;
      }
      case "bulletListItem":
      case "numberedListItem":
      case "taskListItem":
        return this.#listItem(block);
      case "quote":
        return `<blockquote${attributes({ id })}>${await this.blocks(block.children)}</blockquote>`;
      case "callout": {
        const kind = block.attrs.kind.toLowerCase();
        const title =
          block.content.length === 0
            ? escapeHtml(kind.charAt(0).toUpperCase() + kind.slice(1))
            : await this.inlines(block.content);
        const body = await this.blocks(block.children ?? []);
        const fold = block.attrs.fold;
        return fold === undefined
          ? `<aside class="callout"${attributes({ id, "data-callout": kind })}><p class="callout-title">${title}</p>${body}</aside>`
          : `<details class="callout"${attributes({ id, "data-callout": kind, open: fold === "open" })}><summary class="callout-title">${title}</summary>${body}</details>`;
      }
      case "toggle":
        return `<details${attributes({ id })}><summary>${await this.inlines(block.content)}</summary>${await this.blocks(block.children ?? [])}</details>`;
      case "code": {
        const language = block.attrs.language.trim().split(/\s/)[0] ?? "";
        if (language.toLowerCase() === "mermaid") {
          const svg = await this.#hooks.diagram?.(block);
          if (svg !== undefined)
            return `<figure class="diagram"${attributes({ id })}>${svg}</figure>`;
        }
        const code = this.#hooks.code;
        const html = code === undefined ? escapeHtml(block.text) : await code(block.text, language);
        return `<pre${attributes({ id })}><code${attributes({ class: language === "" ? undefined : `language-${language}` })}>${html}</code></pre>`;
      }
      case "math": {
        const math = this.#hooks.math;
        return math === undefined
          ? `<pre class="math"${attributes({ id })}>${escapeHtml(block.text)}</pre>`
          : `<div class="math"${attributes({ id })}>${await math(block.text, true)}</div>`;
      }
      case "divider":
        return "<hr>";
      case "table": {
        const align = block.attrs.align;
        const rows: string[] = [];
        for (const [index, row] of block.children.entries()) {
          const header = index === 0 && block.attrs.header;
          const cells: string[] = [];
          for (const [column, cell] of row.children.entries()) {
            const tag = header ? "th" : "td";
            const side = align[column] ?? null;
            cells.push(
              `<${tag}${attributes({ style: side === null ? undefined : `text-align: ${side}` })}>${await this.inlines(cell.content)}</${tag}>`,
            );
          }
          rows.push(`<tr>${cells.join("")}</tr>`);
        }
        const [head, ...body] = rows;
        return block.attrs.header && head !== undefined
          ? `<table${attributes({ id })}><thead>${head}</thead><tbody>${body.join("")}</tbody></table>`
          : `<table${attributes({ id })}><tbody>${rows.join("")}</tbody></table>`;
      }
      case "columns": {
        const columns: string[] = [];
        for (const column of block.children) {
          const width = column.attrs?.width;
          columns.push(
            `<div class="column"${attributes({ style: width === undefined ? undefined : `flex: ${String(width)}` })}>${await this.blocks(column.children)}</div>`,
          );
        }
        return `<div class="columns"${attributes({ id })}>${columns.join("")}</div>`;
      }
      case "image":
        return this.#fileHtml(
          block.attrs.src,
          block.attrs.alt ?? block.attrs.src,
          block.attrs.width,
          block.attrs.alt,
        );
      case "file":
        return this.#fileHtml(block.attrs.src, block.attrs.name ?? block.attrs.src);
      case "bookmark": {
        const href = safeScheme.test(block.attrs.url) ? block.attrs.url : undefined;
        return href === undefined
          ? `<p class="bookmark">${escapeHtml(block.attrs.url)}</p>`
          : `<p class="bookmark"><a${attributes({ href })}>${escapeHtml(block.attrs.url)}</a></p>`;
      }
      case "embed": {
        const { target, alias } = block.attrs;
        const title = "title" in target ? target.title : "";
        if (title !== "" && !isNoteLink(title)) {
          const size = /^(\d+)(?:x\d+)?$/.exec(alias ?? "");
          const width = size?.[1] === undefined ? undefined : Number(size[1]);
          const name = alias !== undefined && width === undefined ? alias : title;
          return this.#fileHtml(
            title,
            name,
            width,
            alias !== undefined && width === undefined ? alias : "",
          );
        }
        const embedded = await this.#hooks.embed?.(target);
        if (embedded !== undefined)
          return `<div class="embed"${attributes({ id })}>${embedded}</div>`;
        const href = await this.#hooks.link?.(target);
        const text = escapeHtml(alias ?? targetText(target));
        return href === undefined
          ? `<p class="embed unresolved">${text}</p>`
          : `<p class="embed"><a class="internal-link"${attributes({ href })}>${text}</a></p>`;
      }
      case "database":
        return `<p class="database"${attributes({ id })}></p>`;
      case "raw":
        return `<pre class="raw"${attributes({ id })}>${escapeHtml(block.text)}</pre>`;
      default: {
        // A plugin's block: its text and what it holds, if anything.
        const plugin = block as {
          readonly content?: readonly Inline[];
          readonly children?: readonly ContentBlock[];
        };
        const text =
          plugin.content === undefined ? "" : `<p>${await this.inlines(plugin.content)}</p>`;
        return `<div class="plugin-block">${text}${await this.blocks(plugin.children ?? [])}</div>`;
      }
    }
  }

  /** Blocks as HTML, list items that follow each other gathered into lists. */
  async blocks(blocks: readonly ContentBlock[]): Promise<string> {
    const out: string[] = [];
    let list: { kind: ListItem["type"]; open: string; close: string; items: string[] } | undefined;
    const close = () => {
      if (list !== undefined) out.push(`${list.open}${list.items.join("")}${list.close}`);
      list = undefined;
    };
    for (const block of blocks) {
      if (
        block.type === "bulletListItem" ||
        block.type === "numberedListItem" ||
        block.type === "taskListItem"
      ) {
        // A number to start from begins a new list, as in Markdown.
        const start = block.type === "numberedListItem" ? block.attrs?.start : undefined;
        if (list?.kind !== block.type || start !== undefined) {
          close();
          list =
            block.type === "numberedListItem"
              ? {
                  kind: block.type,
                  open: `<ol${attributes({ start: start === 1 ? undefined : start })}>`,
                  close: "</ol>",
                  items: [],
                }
              : {
                  kind: block.type,
                  open: block.type === "taskListItem" ? '<ul class="tasks">' : "<ul>",
                  close: "</ul>",
                  items: [],
                };
        }
        list.items.push(await this.#listItem(block));
        continue;
      }
      close();
      out.push(await this.#block(block));
    }
    close();
    return out.join("\n");
  }
}

function propertyText(value: JsonValue): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map(propertyText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A note's blocks as HTML, without the page around them. */
export function blocksToHtml(
  blocks: readonly ContentBlock[],
  hooks: HtmlHooks = {},
  writtenIds: ReadonlySet<BlockId> = new Set(),
): Promise<string> {
  return new Renderer(hooks, writtenIds).blocks(blocks);
}

/** A note's properties as a list of names and values. */
export function propertiesToHtml(properties: readonly PropertyEntry[]): string {
  if (properties.length === 0) return "";
  const rows = properties.map(
    (entry) => `<dt>${escapeHtml(entry.key)}</dt><dd>${escapeHtml(propertyText(entry.value))}</dd>`,
  );
  return `<dl class="properties">${rows.join("")}</dl>`;
}

/**
 * A note's page without the page around it: its title, as a heading unless
 * the note starts with one of its own, its properties, and its blocks.
 */
export async function noteArticle(note: HtmlNote, hooks: HtmlHooks = {}): Promise<string> {
  const [first] = note.content;
  const heading =
    first?.type === "heading" && first.attrs.level === 1
      ? ""
      : `<h1 class="title">${escapeHtml(note.title)}</h1>\n`;
  const body = await blocksToHtml(note.content, hooks, note.writtenIds);
  return `${heading}${propertiesToHtml(note.properties)}${body}`;
}

/** A note as an HTML page, its article in a document with its title and style. */
export async function noteToHtml(
  note: HtmlNote,
  hooks: HtmlHooks = {},
  options: HtmlPageOptions = {},
): Promise<string> {
  const article = await noteArticle(note, hooks);
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(options.lang ?? "en")}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(note.title)}</title>`,
    options.style === undefined ? "" : `<style>${options.style}</style>`,
    "</head>",
    "<body>",
    "<article>",
    article,
    "</article>",
    "</body>",
    "</html>",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .concat("\n");
}
