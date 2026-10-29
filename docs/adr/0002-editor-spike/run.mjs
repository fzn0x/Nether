// Markdown round-trip spike for ADR 0002: every file in corpus/ goes
// Markdown -> editor document -> Markdown through each library's own,
// official Markdown support, and the output is compared with the input.
//
//   node run.mjs            prints the summary and writes results/
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import MarkdownIt from "markdown-it";

const corpusDir = new URL("./corpus/", import.meta.url);
const resultsDir = new URL("./results/", import.meta.url);

// Adapters: each returns an async function from Markdown to Markdown.
const adapters = {
  async TipTap() {
    const { MarkdownManager } = await import("@tiptap/markdown");
    const { default: StarterKit } = await import("@tiptap/starter-kit");
    const { TaskList, TaskItem } = await import("@tiptap/extension-list");
    const { TableKit } = await import("@tiptap/extension-table");
    const { default: Image } = await import("@tiptap/extension-image");
    const { default: Highlight } = await import("@tiptap/extension-highlight");
    const { Mathematics } = await import("@tiptap/extension-mathematics");
    const manager = new MarkdownManager({
      extensions: [StarterKit, TaskList, TaskItem, TableKit, Image, Highlight, Mathematics],
    });
    return async (markdown) => manager.serialize(manager.parse(markdown));
  },

  async BlockNote() {
    const { ServerBlockNoteEditor } = await import("@blocknote/server-util");
    const editor = ServerBlockNoteEditor.create();
    return async (markdown) =>
      editor.blocksToMarkdownLossy(await editor.tryParseMarkdownToBlocks(markdown));
  },

  async Lexical() {
    const { createHeadlessEditor } = await import("@lexical/headless");
    const md = await import("@lexical/markdown");
    const { HeadingNode, QuoteNode } = await import("@lexical/rich-text");
    const { ListNode, ListItemNode } = await import("@lexical/list");
    const { CodeNode, CodeHighlightNode } = await import("@lexical/code");
    const { LinkNode, AutoLinkNode } = await import("@lexical/link");
    const { HorizontalRuleNode } = await import("@lexical/extension");
    const transformers = [md.CHECK_LIST, ...md.TRANSFORMERS];
    return async (markdown) => {
      const editor = createHeadlessEditor({
        nodes: [
          HeadingNode,
          QuoteNode,
          ListNode,
          ListItemNode,
          CodeNode,
          CodeHighlightNode,
          LinkNode,
          AutoLinkNode,
          HorizontalRuleNode,
        ],
        onError: (error) => {
          throw error;
        },
      });
      editor.update(() => md.$convertFromMarkdownString(markdown, transformers), {
        discrete: true,
      });
      return editor.getEditorState().read(() => md.$convertToMarkdownString(transformers));
    };
  },

  // Not an editor: the Markdown syntax tree that packages/markdown could
  // convert from and to, as a baseline for what a dedicated converter keeps.
  async remark() {
    const { unified } = await import("unified");
    const { default: remarkParse } = await import("remark-parse");
    const { default: remarkFrontmatter } = await import("remark-frontmatter");
    const { default: remarkGfm } = await import("remark-gfm");
    const { default: remarkMath } = await import("remark-math");
    const { default: remarkStringify } = await import("remark-stringify");
    const processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml"])
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkStringify, { bullet: "-", emphasis: "*", rule: "-", listItemIndent: "one" });
    return async (markdown) => String(await processor.process(markdown));
  },
};

// Checks. Each returns null when the output passes, or a short reason.
const commonMark = new MarkdownIt({ html: true });

function splitFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match ? [match[0], text.slice(match[0].length)] : ["", text];
}

function render(text) {
  return commonMark
    .render(splitFrontmatter(text)[1])
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

// The words a reader sees: the rendered text, plus the frontmatter.
function words(text) {
  const [frontmatter, body] = splitFrontmatter(text);
  const visible = commonMark
    .render(body)
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  const counts = new Map();
  for (const word of `${frontmatter} ${visible}`.match(/[\p{L}\p{N}]+/gu) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

// Obsidian syntax that a CommonMark renderer reads as plain text, so the
// rendering check cannot see it break (for example `\[\[link\]\]`).
const obsidianSyntax = [
  ["wiki link", /(?<![\\!])\[\[[^\]\n]+\]\]/g],
  ["embed", /!\[\[[^\]\n]+\]\]/g],
  ["tag", /(?<=^|\s)#[\p{L}\p{N}_/-]+/gmu],
  ["block id", /\s\^[A-Za-z0-9-]+$/gm],
  ["highlight", /(?<!\\)==[^=\n]+==/g],
  ["comment", /%%[^%\n]+%%/g],
  ["callout", /^> \[![a-z]+\]/gm],
  ["math", /(?<![\\$])\$[^$\n]+\$(?!\d)|^\$\$$/gm],
  ["footnote", /\[\^[^\]\n]+\]/g],
];

// Each check returns undefined when the input has nothing for it to check,
// null when the output passes, or a short reason when it fails.
const checks = {
  exact: (input, output) => (input.trimEnd() === output.trimEnd() ? null : "differs"),
  rendering: (input, output) =>
    render(input) === render(output) ? null : "renders differently as CommonMark",
  text: (input, output) => {
    const before = words(input);
    const after = words(output);
    const lost = [...before].filter(([word, n]) => (after.get(word) ?? 0) < n).map(([w]) => w);
    return lost.length === 0 ? null : `lost words: ${lost.slice(0, 8).join(", ")}`;
  },
  links: (input, output) => {
    const targets = (text) =>
      [...text.matchAll(/\]\(([^)\s]+)|<(https?:[^>]+)>/g)].map((m) => m[1] ?? m[2]).sort();
    const before = targets(input);
    if (before.length === 0) return undefined;
    return before.join("\n") === targets(output).join("\n") ? null : "link targets changed";
  },
  frontmatter: (input, output) => {
    const [before] = splitFrontmatter(input);
    if (before === "") return undefined;
    return splitFrontmatter(output)[0] === before ? null : "frontmatter changed";
  },
  obsidian: (input, output) => {
    const present = obsidianSyntax.filter(([, pattern]) => input.match(pattern) !== null);
    if (present.length === 0) return undefined;
    const broken = present
      .filter(([, pattern]) => (input.match(pattern) ?? []).join() !== (output.match(pattern) ?? []).join())
      .map(([name]) => name);
    return broken.length === 0 ? null : `broke: ${broken.join(", ")}`;
  },
};

const files = readdirSync(corpusDir)
  .filter((name) => name.endsWith(".md"))
  .sort();
rmSync(resultsDir, { recursive: true, force: true });
const summary = {};

for (const [name, load] of Object.entries(adapters)) {
  const roundTrip = await load();
  const dir = new URL(`${name}/`, resultsDir);
  mkdirSync(dir, { recursive: true });
  summary[name] = {};
  for (const file of files) {
    const input = readFileSync(new URL(file, corpusDir), "utf8");
    let output;
    try {
      output = await roundTrip(input);
    } catch (error) {
      output = `<<threw: ${error.message}>>`;
    }
    writeFileSync(new URL(file, dir), output);
    summary[name][file] = Object.fromEntries(
      Object.entries(checks).map(([check, run]) => {
        const result = run(input, output);
        return [check, result === undefined ? "n/a" : result];
      }),
    );
  }
}

const checkNames = Object.keys(checks);
const lines = [
  `| Library | ${checkNames.join(" | ")} |`,
  `| --- |${" --- |".repeat(checkNames.length)}`,
];
for (const [name, byFile] of Object.entries(summary)) {
  const cells = checkNames.map((check) => {
    const applicable = files.filter((file) => byFile[file][check] !== "n/a");
    const passed = applicable.filter((file) => byFile[file][check] === null);
    return `${passed.length}/${applicable.length}`;
  });
  lines.push(`| ${name} | ${cells.join(" | ")} |`);
}
lines.push("");
for (const [name, byFile] of Object.entries(summary)) {
  for (const file of files) {
    const failures = Object.entries(byFile[file]).filter(
      ([check, reason]) => reason !== null && reason !== "n/a" && check !== "exact",
    );
    if (failures.length > 0) {
      const text = failures.map(([check, reason]) => `${check} (${reason})`).join("; ");
      lines.push(`- ${name}, ${file}: ${text}`);
    }
  }
}
writeFileSync(new URL("summary.json", resultsDir), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(new URL("summary.md", resultsDir), lines.join("\n") + "\n");
console.log(lines.join("\n"));
