// Web pages (ADR 0030): each page a note, named by its title, its text as
// Markdown, read by the syntax-tree project's HTML tools as Nether reads
// Markdown: headings, paragraphs, lists, quotes, tables, links, images,
// code and emphasis. Scripts, styles and the page's head are not text a
// reader sees, and stay behind. Its own entry, as it brings an HTML parser
// the app loads only to import.
import type { Element, Nodes as HastNodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { writeFrontmatter } from "../frontmatter.ts";
import {
  type ImportPlan,
  type ImportSource,
  type PlannedNote,
  freeNames,
  safeName,
  within,
} from "./plan.ts";

/** The text of an element, its descendants' text joined. */
function textOf(node: HastNodes): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return (node.children as readonly HastNodes[]).map(textOf).join("");
  return "";
}

/** The first element of a name in a tree, depth first. */
function find(node: HastNodes, name: string): Element | undefined {
  if (node.type === "element" && node.tagName === name) return node;
  if (!("children" in node)) return undefined;
  for (const child of node.children as readonly HastNodes[]) {
    const found = find(child, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** A web page as Markdown, and its title: its `<title>`, else its first heading. */
export function htmlToMarkdown(html: string): {
  readonly title?: string;
  readonly markdown: string;
} {
  const tree = fromHtml(html);
  const title = [find(tree, "title"), find(tree, "h1")]
    .map((element) => (element === undefined ? "" : textOf(element).replace(/\s+/g, " ").trim()))
    .find((text) => text !== "");
  const markdown = toMarkdown(toMdast(tree), {
    extensions: [gfmToMarkdown()],
    bullet: "-",
    emphasis: "*",
    fences: true,
    rule: "-",
  });
  return { ...(title === undefined ? {} : { title }), markdown };
}

/** Plans the import of web pages, each a note, into the vault's folder `into`. */
export async function planHtml(source: ImportSource, into: string): Promise<ImportPlan> {
  const notes: PlannedNote[] = [];
  const names = freeNames();
  for (const file of source.files) {
    if (!/\.html?$/i.test(file.path)) continue;
    const { title, markdown } = htmlToMarkdown(await source.readText(file.path));
    const fileName = file.path.slice(file.path.lastIndexOf("/") + 1).replace(/\.html?$/i, "");
    const shown = title ?? fileName;
    const name = names(safeName(shown));
    // A title a file's name cannot hold, kept where links and search find it.
    const yaml =
      safeName(shown) === shown.trim()
        ? undefined
        : writeFrontmatter(undefined, [], [{ key: "aliases", value: [shown.trim()] }]);
    notes.push({
      path: within(into, `${name}.md`),
      text: yaml === undefined ? markdown : `---\n${yaml.replace(/\n$/, "")}\n---\n${markdown}`,
    });
  }
  return { notes, files: [], warnings: [] };
}
