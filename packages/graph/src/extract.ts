// What the link index keeps of a note: its links, tags, aliases, headings
// and the block IDs its file writes, read from the note's parse. Small
// enough to keep for every note of a large vault, and rebuilt only when a
// note's file changes.
import type { Block, BlockId, ContentBlock, Inline, LinkTarget, PropertyEntry } from "@nether/core";

/** A link in a note, to another note, a part of one, or a part of the same note. */
export interface LinkRef {
  /** The note or file the link names as written, `Roadmap` or `Projects/Roadmap.md`; "" within the note. */
  readonly target: string;
  readonly heading?: string;
  readonly block?: string;
  /** Whether it embeds what it names, as `![[Roadmap]]` does. */
  readonly embed: boolean;
  /** The text of the block the link is in, which backlinks show. */
  readonly context: string;
}

export interface Heading {
  readonly level: number;
  readonly text: string;
}

/** What the link index keeps of a note. */
export interface NoteIndex {
  readonly links: readonly LinkRef[];
  /** Its tags without the `#`, inline ones and those its properties name, in order, once each. */
  readonly tags: readonly string[];
  /** The other names its `aliases` property gives it. */
  readonly aliases: readonly string[];
  readonly headings: readonly Heading[];
  /** The IDs of blocks its file writes as `^id`, which links can name. */
  readonly blocks: readonly string[];
  /** Its properties, for searches by property. */
  readonly properties: readonly PropertyEntry[];
}

/** The longest context kept for a link. */
const contextLength = 240;

function inlineText(inlines: readonly Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
          return inline.text;
        case "hardBreak":
          return " ";
        case "wikiLink":
          return inline.alias ?? targetText(inline.target);
        case "tag":
          return `#${inline.name}`;
        case "math":
          return inline.latex;
        case "raw":
          return inline.markdown;
      }
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** A link's text as its chip in the editor shows it: `Roadmap#Next`, `#^block`. */
function targetText(target: LinkTarget): string {
  let text = "title" in target ? target.title : "";
  if ("heading" in target) text += `#${target.heading}`;
  if ("block" in target) text += `#^${target.block}`;
  return text;
}

function linkRef(target: LinkTarget, embed: boolean, context: string): LinkRef | undefined {
  // A link by note ID names no text; the index learns of those another way.
  if ("note" in target) return undefined;
  const heading = "heading" in target ? target.heading : undefined;
  const block = "block" in target ? target.block : undefined;
  return {
    target: "title" in target ? target.title : "",
    ...(heading === undefined ? {} : { heading }),
    ...(block === undefined ? {} : { block }),
    embed,
    context: context.slice(0, contextLength),
  };
}

/** A Markdown link to a note in the vault, `[text](Projects/Roadmap.md)`, as a link. */
function markdownLink(href: string, context: string): LinkRef | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
  const [path = "", fragment] = href.split("#", 2);
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // Kept as written.
  }
  if (!/\.md$/i.test(decoded)) return undefined;
  return {
    target: decoded,
    ...(fragment === undefined || fragment === "" ? {} : { heading: fragment }),
    embed: false,
    context: context.slice(0, contextLength),
  };
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((part) => part.trim());
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/** What the link index keeps of a note, from its properties, content and the IDs its file writes. */
export function indexNote(
  note: {
    readonly properties: readonly PropertyEntry[];
    readonly content: readonly ContentBlock[];
  },
  writtenIds: ReadonlySet<BlockId>,
): NoteIndex {
  const links: LinkRef[] = [];
  const tags: string[] = [];
  const headings: Heading[] = [];
  const seenTags = new Set<string>();
  const tag = (name: string) => {
    const clean = name.replace(/^#/, "").trim();
    if (clean === "" || seenTags.has(clean.toLowerCase())) return;
    seenTags.add(clean.toLowerCase());
    tags.push(clean);
  };

  const visitInlines = (inlines: readonly Inline[], context: string) => {
    for (const inline of inlines) {
      if (inline.type === "wikiLink") {
        const ref = linkRef(inline.target, false, context);
        if (ref !== undefined) links.push(ref);
      } else if (inline.type === "tag") {
        tag(inline.name);
      }
      if ("marks" in inline) {
        for (const mark of inline.marks ?? []) {
          if (mark.type !== "link") continue;
          const ref = markdownLink(mark.href, context);
          if (ref !== undefined) links.push(ref);
        }
      }
    }
  };

  const visit = (block: Block) => {
    if ("content" in block && Array.isArray(block.content)) {
      const inlines = block.content as readonly Inline[];
      const context = inlineText(inlines);
      visitInlines(inlines, context);
      if (block.type === "heading") {
        const level = (block.attrs as { level?: number } | undefined)?.level ?? 1;
        headings.push({ level, text: context });
      }
    }
    if (block.type === "embed") {
      const { target } = block.attrs as { target: LinkTarget };
      const ref = linkRef(target, true, "");
      if (ref !== undefined) links.push(ref);
    }
    if ("children" in block && Array.isArray(block.children)) {
      for (const child of block.children as readonly Block[]) visit(child);
    }
  };
  for (const block of note.content) visit(block);

  let aliases: string[] = [];
  for (const { key, value } of note.properties) {
    const name = key.toLowerCase();
    if (name === "tags" || name === "tag") strings(value).forEach(tag);
    if (name === "aliases" || name === "alias")
      aliases = strings(value).filter((alias) => alias !== "");
  }
  return {
    links: dedupe(links),
    tags,
    aliases,
    headings,
    blocks: [...writtenIds],
    properties: note.properties,
  };
}

/** A note's text as search reads it: each block's words on lines of their own, code and math too. */
export function plainText(content: readonly ContentBlock[]): string {
  const lines: string[] = [];
  const visit = (block: Block) => {
    if ("content" in block && Array.isArray(block.content)) {
      const text = inlineText(block.content as readonly Inline[]);
      if (text !== "") lines.push(text);
    }
    if ("text" in block && typeof block.text === "string" && block.text !== "") {
      lines.push(block.text);
    }
    if ("children" in block && Array.isArray(block.children)) {
      for (const child of block.children as readonly Block[]) visit(child);
    }
  };
  for (const block of content) visit(block);
  return lines.join("\n");
}

/** One of each link: a link written twice in one block counts once; in two blocks, twice. */
function dedupe(links: readonly LinkRef[]): LinkRef[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = JSON.stringify([link.target, link.heading, link.block, link.embed, link.context]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
