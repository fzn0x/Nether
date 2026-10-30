// Markdown to a syntax tree: CommonMark, GFM, YAML frontmatter, display math
// and Obsidian's syntax.
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import type { Extension } from "micromark-util-types";
import { obsidianFromMarkdown, obsidianSyntax } from "./syntax.ts";

// Only display math comes from micromark's math extension: inline math
// follows Obsidian's rules, in syntax.ts.
const mathFlow: Extension = { flow: math().flow ?? {} };

const syntax = [gfm({ singleTilde: false }), mathFlow, obsidianSyntax()];
const tree = [gfmFromMarkdown(), mathFromMarkdown(), obsidianFromMarkdown()];
const withFrontmatter = {
  extensions: [frontmatter(["yaml"]), ...syntax],
  mdastExtensions: [frontmatterFromMarkdown(["yaml"]), ...tree],
};
const withoutFrontmatter = { extensions: syntax, mdastExtensions: tree };

// A file that opens with `---` and closes it with another `---` line. The
// frontmatter extension is used only then: when it tries a `---` that never
// closes, it upsets what follows, so a rule and a list after it read as a
// rule and a paragraph.
const closedFrontmatter = /^---[ \t]*\r?\n(?:[^]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Whether a file opens with frontmatter: a `---` line, closed by another. */
export function hasFrontmatter(markdown: string): boolean {
  return closedFrontmatter.test(markdown);
}

/** Parses Markdown into an mdast syntax tree with positions. */
export function markdownToTree(markdown: string): Root {
  return fromMarkdown(markdown, hasFrontmatter(markdown) ? withFrontmatter : withoutFrontmatter);
}
