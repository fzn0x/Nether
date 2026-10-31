// Unlinked mentions: where a note's Markdown writes a name as plain text,
// a whole word, not in a link, a tag, code, math, a comment or HTML, as
// Obsidian lists a note's unlinked mentions. Making one a link replaces only
// the name where it is written, keeping every other byte of the file.
import type { Nodes, Root } from "mdast";
import { markdownToTree } from "./tree.ts";

/** A name written as text in a note's Markdown. */
export interface Mention {
  /** Where the name is written: replacing the range with a link links it. */
  readonly start: number;
  readonly end: number;
  /** The name as written there, as `roadmap` for `Roadmap`. */
  readonly text: string;
  /** The line it is on, as written, and where on it the name starts. */
  readonly line: string;
  readonly column: number;
  /** Whether it is in a table's cell, where a link's `|` must be escaped. */
  readonly inTable: boolean;
}

/** Text that names nothing: what other syntax holds, and Obsidian's own. */
const skipped = new Set([
  "yaml",
  "code",
  "inlineCode",
  "math",
  "inlineMath",
  "html",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
  "wikiLink",
  "tag",
  "obsidianComment",
  "commentBlock",
  "rawInline",
]);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walk(
  node: Nodes,
  inTable: boolean,
  visit: (start: number, end: number, inTable: boolean) => void,
): void {
  if (skipped.has(node.type)) return;
  if (node.type === "text") {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) visit(start, end, inTable);
    return;
  }
  if ("children" in node) {
    const table = inTable || node.type === "tableCell";
    for (const child of node.children as readonly Nodes[]) walk(child, table, visit);
  }
}

/**
 * Where a note's Markdown mentions any of the names as text, in the order
 * they are written: whole words, case aside, the longest name first where
 * names overlap.
 */
export function findMentions(markdown: string, names: readonly string[]): Mention[] {
  const wanted = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ""))].sort(
    (a, b) => b.length - a.length,
  );
  if (wanted.length === 0) return [];
  // Not inside a word, nor a tag, a block's ID or a path.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_#^/\\\\])(?:${wanted.map(escape).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const tree: Root = markdownToTree(markdown);
  const mentions: Mention[] = [];
  walk(tree, false, (start, end, inTable) => {
    const written = markdown.slice(start, end);
    for (const match of written.matchAll(pattern)) {
      const at = start + match.index;
      const lineStart = markdown.lastIndexOf("\n", at - 1) + 1;
      const lineEnd = markdown.indexOf("\n", at);
      const line = markdown
        .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
        .replace(/\r$/, "");
      mentions.push({
        start: at,
        end: at + match[0].length,
        text: match[0],
        line,
        column: at - lineStart,
        inTable,
      });
    }
  });
  return mentions.sort((a, b) => a.start - b.start);
}

/**
 * The Markdown with a mention made a link to the note `target` names, as
 * `[[Roadmap]]`, or `[[Roadmap|roadmap]]` where the mention is written
 * otherwise, so the text reads as before; every other byte as it was.
 */
export function linkMention(markdown: string, mention: Mention, target: string): string {
  const bar = mention.inTable ? "\\|" : "|";
  const link = mention.text === target ? `[[${target}]]` : `[[${target}${bar}${mention.text}]]`;
  return markdown.slice(0, mention.start) + link + markdown.slice(mention.end);
}
