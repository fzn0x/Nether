// The links a note's Markdown writes, where they are written, so they can be
// rewritten when what they name moves: `[[wiki links]]` and their embeds,
// in the text and in the frontmatter, and Markdown links and images whose
// address is a path. Links in code are text, not links, and stay as they
// are. A rewrite changes only what a link names, keeping its heading or
// block, its alias, and the rest of the file byte for byte.
import type { Nodes, Root } from "mdast";
import type { WikiLinkNode } from "./mdast.ts";
import { markdownToTree } from "./tree.ts";

/** A link as a note's Markdown writes it. */
export interface WrittenLink {
  /** `wiki` for `[[target]]`, `markdown` for `[text](address)` and images. */
  readonly kind: "wiki" | "markdown";
  /** What the link names as written: `Roadmap`, `Projects/Roadmap.md`, `../Roadmap.md`. */
  readonly target: string;
  /** Whether it shows what it names in place, as `![[Note]]` and `![](photo.png)` do. */
  readonly embed: boolean;
  /** Where the target is written: replacing that range relinks it. */
  readonly start: number;
  readonly end: number;
}

/** The part of a wiki link's text that names the note, before its heading, block or alias, read as `parseWikiLink` reads it. */
function wikiTarget(value: string): string {
  const pipe = /\\?\|/.exec(value);
  const path = pipe === null ? value : value.slice(0, pipe.index);
  const hash = path.indexOf("#");
  if (hash !== -1) return path.slice(0, hash);
  const caret = /\^([A-Za-z0-9-]+)$/.exec(path);
  return caret !== null && caret.index > 0 ? path.slice(0, caret.index) : path;
}

function wikiLinks(text: string, offset: number, embed: boolean | undefined): WrittenLink[] {
  const links: WrittenLink[] = [];
  for (const match of text.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
    const value = match[2] ?? "";
    const target = wikiTarget(value);
    if (target.trim() === "") continue;
    const start = offset + match.index + (match[1] ?? "").length + 2;
    links.push({
      kind: "wiki",
      target,
      embed: embed ?? match[1] === "!",
      start,
      end: start + target.length,
    });
  }
  return links;
}

/** Whether an address is a path in the vault rather than a web address or an anchor. */
function isPath(url: string): boolean {
  return (
    url !== "" && !url.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//")
  );
}

/** Where a Markdown link's address is written in its source, as `[text](address "title")`. */
function addressRange(
  markdown: string,
  start: number,
  end: number,
  url: string,
): { start: number; end: number; target: string } | undefined {
  const source = markdown.slice(start, end);
  const open = source.lastIndexOf("](");
  if (open === -1) return undefined;
  let at = open + 2;
  while (source[at] === " " || source[at] === "\t") at++;
  const angled = source[at] === "<";
  if (angled) at++;
  const written = angled
    ? source.slice(at, source.indexOf(">", at))
    : (/^[^\s)]+(?:\([^\s)]*\)[^\s)]*)*/.exec(source.slice(at))?.[0] ?? "");
  // The address as the tree read it, its escapes and character references undone.
  if (written === "" || (written !== url && decodeEntities(written) !== url)) return undefined;
  return { start: start + at, end: start + at + written.length, target: written };
}

function decodeEntities(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1").replace(/&amp;/g, "&");
}

function walk(node: Nodes, markdown: string, links: WrittenLink[]): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  switch (node.type) {
    case "code":
    case "inlineCode":
    case "math":
    case "inlineMath":
    case "html":
      return;
    case "yaml":
      if (start !== undefined && end !== undefined) {
        // The frontmatter's text starts after its opening `---` line.
        const body = markdown.indexOf(node.value, start);
        if (body !== -1) links.push(...wikiLinks(node.value, body, false));
      }
      return;
    case "link":
    case "image":
      if (start !== undefined && end !== undefined && isPath(node.url)) {
        const range = addressRange(markdown, start, end, node.url);
        if (range !== undefined) {
          links.push({ kind: "markdown", embed: node.type === "image", ...range });
        }
      }
      break;
    default:
      break;
  }
  if ((node as { type: string }).type === "wikiLink" && start !== undefined) {
    const link = node as unknown as WikiLinkNode;
    const target = wikiTarget(link.value);
    if (target.trim() !== "") {
      const at = start + (link.embed ? 3 : 2);
      links.push({ kind: "wiki", target, embed: link.embed, start: at, end: at + target.length });
    }
    return;
  }
  if ("children" in node) {
    for (const child of node.children) walk(child, markdown, links);
  }
}

/** The links a note's Markdown writes, in the order they are written. */
export function findLinks(markdown: string): WrittenLink[] {
  const bom = markdown.startsWith("﻿") ? 1 : 0;
  const text = bom === 1 ? markdown.slice(1) : markdown;
  const tree: Root = markdownToTree(text);
  const links: WrittenLink[] = [];
  walk(tree, text, links);
  return links
    .map((link) => (bom === 0 ? link : { ...link, start: link.start + 1, end: link.end + 1 }))
    .sort((a, b) => a.start - b.start);
}

/**
 * The Markdown with each link `relink` names a new target for rewritten
 * to it, and every other byte as it was. `relink` gives the target as it
 * should be written, a note's name or path for a wiki link, an address for
 * a Markdown link, or undefined to leave the link as it is.
 */
export function relinkMarkdown(
  markdown: string,
  relink: (link: WrittenLink) => string | undefined,
): string {
  let out = "";
  let at = 0;
  for (const link of findLinks(markdown)) {
    const target = relink(link);
    if (target === undefined || target === link.target) continue;
    out += markdown.slice(at, link.start) + target;
    at = link.end;
  }
  return at === 0 ? markdown : out + markdown.slice(at);
}
