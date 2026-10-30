// The links of a note, for its editor: what `[[` suggests, the notes of
// the vault by title, path or alias, a note's headings after `#`, or its
// blocks after `#^`, found by their text; and what a link opens, a note
// the vault makes first when it has none by that name, as Obsidian does.
// A link to a block that has no ID writes one, `^id`, after the block in
// its note's file, as Obsidian does.
import {
  type Block,
  type BlockId,
  type ContentBlock,
  type Inline,
  type LinkTarget,
  type NoteId,
  inlineContent,
  walkBlocks,
} from "@nether/core";
import type { LinkSuggestion, NoteLinks } from "@nether/editor";
import { type LinkGraph, noteSection } from "@nether/graph";
import { type ParsedMarkdown, parseMarkdown, serializeMarkdown } from "@nether/markdown";
import { ChangedOnDisk, type NoteEntry, type Vault } from "@nether/storage";

/** How many notes `[[` suggests at most. */
const limit = 20;

/** How much of a block's text a suggestion shows. */
const blockTextLength = 80;

/** `[[Note#^text` or `[[Note^text`: the note, "" for this one, and the text to find a block by. */
export function blockQuery(
  query: string,
): { readonly title: string; readonly text: string } | undefined {
  const match = /^([^#^]*?)#?\^([^#^]*)$/.exec(query);
  return match === null ? undefined : { title: (match[1] ?? "").trim(), text: match[2] ?? "" };
}

function inlineText(inlines: readonly Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
          return inline.text;
        case "hardBreak":
          return " ";
        case "wikiLink":
          return inline.alias ?? ("title" in inline.target ? inline.target.title : "");
        case "tag":
          return `#${inline.name}`;
        case "math":
          return inline.latex;
        case "raw":
          return inline.markdown;
      }
    })
    .join("");
}

/** What a block says, to find it by: its own text, or a table's cells. */
export function blockText(block: Block): string {
  let text: string;
  switch (block.type) {
    case "code":
    case "math":
    case "raw":
      text = block.text;
      break;
    case "table":
      text = block.children
        .flatMap((row) => row.children.map((cell) => inlineText(cell.content)))
        .join(" ");
      break;
    default:
      text = inlineText(inlineContent(block));
  }
  return text.replace(/\s+/g, " ").trim();
}

/** The blocks a link can name, in order: those with text, but not a table's rows and cells. */
function linkableBlocks(content: readonly ContentBlock[]): { block: Block; text: string }[] {
  return [...walkBlocks(content)].flatMap((block) => {
    if (block.type === "tableRow" || block.type === "tableCell" || block.type === "column")
      return [];
    const text = blockText(block);
    return text === "" ? [] : [{ block, text }];
  });
}

/** The blocks with one block's ID changed, as a block read again takes the ID a link gave it. */
function withId<T extends Block>(blocks: readonly T[], from: BlockId, to: BlockId): T[] {
  return blocks.map((block) => {
    const own = block.id === from ? { ...block, id: to } : block;
    const children: readonly Block[] | undefined = "children" in own ? own.children : undefined;
    return children === undefined ? own : { ...own, children: withId(children, from, to) };
  });
}

/**
 * How well `text` matches what was typed, case aside: whole, at its start,
 * at a word's start, anywhere, or as letters in order; 0 for not at all.
 */
export function matchScore(query: string, text: string): number {
  const typed = query.trim().toLowerCase();
  const target = text.toLowerCase();
  if (typed === "") return 1;
  if (target === typed) return 100;
  if (target.startsWith(typed)) return 80;
  if (target.split(/[\s/_-]+/).some((word) => word.startsWith(typed))) return 60;
  if (target.includes(typed)) return 40;
  let at = 0;
  for (const char of typed) {
    at = target.indexOf(char, at);
    if (at === -1) return 0;
    at += 1;
  }
  return 20;
}

function titleOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

function folderOf(path: string): string | undefined {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? undefined : path.slice(0, slash);
}

/** The path a new note gets from a link's text: its folders kept, and characters file systems cannot hold left out. */
export function newNotePath(title: string): string {
  const parts = title
    .split("/")
    .map((part) =>
      part
        .replace(/[\\:*?"<>|#^[\]]/g, "")
        .trim()
        .replace(/[.\s]+$/, ""),
    )
    .filter((part) => part !== "" && part !== "." && part !== "..");
  return parts.length === 0 ? "Untitled.md" : `${parts.join("/")}.md`;
}

/** A heading or block in a note that a link goes to, or a place in a block's text. */
export interface NotePart {
  readonly heading?: string;
  readonly block?: string;
  /** Characters into the block's text, each inline that is not text counting one. */
  readonly offset?: number;
}

export function noteLinks(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
  open: (note: NoteId, part?: NotePart) => void,
  report: (error: unknown) => void,
  openTag?: (name: string) => void,
): NoteLinks {
  const from = () => vault.note(id)?.path ?? "";
  /** The shortest text that links to a note from this one: its title, or its path when another note has the title. */
  const linkText = (note: NoteId, path: string) => {
    const title = titleOf(path);
    return graph.resolve(title, from()) === note ? title : path.replace(/\.md$/i, "");
  };
  const resolve = (title: string) =>
    graph.resolve(title, from()) ?? vault.noteAt(/\.md$/i.test(title) ? title : `${title}.md`)?.id;

  /** Writes a block's ID after it in its note's file, so links to it find it. */
  const writeBlockId = async (
    note: NoteId,
    parsed: ParsedMarkdown,
    hash: string,
    block: BlockId,
  ) => {
    const write = (read: ParsedMarkdown, base: string) =>
      vault.write(
        note,
        serializeMarkdown(read, {
          source: read.source,
          writeIds: new Set([...read.writtenIds, block]),
        }).text,
        base,
      );
    try {
      await write(parsed, hash);
    } catch (error) {
      if (!(error instanceof ChangedOnDisk)) throw error;
      // Changed since it was read: the block with the same text takes the ID.
      const wanted = linkableBlocks(parsed.content).find((entry) => entry.block.id === block);
      const file = await vault.read(note);
      if (wanted === undefined || file.missing === true || file.binary === true) return;
      const again = parseMarkdown(file.text);
      const found = linkableBlocks(again.content).find(
        (entry) => entry.block.type === wanted.block.type && entry.text === wanted.text,
      );
      if (found === undefined) return;
      await write({ ...again, content: withId(again.content, found.block.id, block) }, file.hash);
    }
  };

  return {
    suggest(query) {
      const hash = query.indexOf("#");
      if (hash !== -1) {
        const title = query.slice(0, hash).trim();
        const note = title === "" ? id : resolve(title);
        const headings = note === undefined ? [] : (graph.note(note)?.index.headings ?? []);
        const typed = query.slice(hash + 1);
        return headings
          .map((heading, index) => ({ heading, index, score: matchScore(typed, heading.text) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, limit)
          .map(({ heading, index }): LinkSuggestion => ({
            key: `h${String(index)}`,
            title: heading.text,
            ...(title === "" ? {} : { detail: title }),
            target: title === "" ? { heading: heading.text } : { title, heading: heading.text },
          }));
      }
      // Scored by title, or by path when a folder is typed, and by alias;
      // the link text, which takes resolving, only for the notes shown.
      const found: { note: NoteEntry; score: number; alias?: string }[] = [];
      const byPath = query.includes("/");
      for (const note of vault.notes()) {
        if (note.id === id) continue;
        const score = Math.max(
          matchScore(query, note.title),
          byPath ? matchScore(query, note.path.replace(/\.md$/i, "")) - 1 : 0,
        );
        if (score > 0) found.push({ note, score });
        if (query.trim() === "") continue;
        for (const alias of graph.note(note.id)?.index.aliases ?? []) {
          const byAlias = matchScore(query, alias);
          if (byAlias > score) found.push({ note, score: byAlias, alias });
        }
      }
      // The best matches first; with nothing typed, the notes edited last.
      return found
        .sort((a, b) => b.score - a.score || b.note.modified - a.note.modified)
        .slice(0, limit)
        .map(({ note, alias }): LinkSuggestion => {
          const target = { title: linkText(note.id, note.path) };
          if (alias !== undefined) {
            return { key: `${note.id}|${alias}`, title: alias, detail: note.title, target, alias };
          }
          const folder = folderOf(note.path);
          return {
            key: note.id,
            title: note.title,
            ...(folder === undefined ? {} : { detail: folder }),
            target,
          };
        });
    },

    open(target: LinkTarget) {
      const part: NotePart = {
        ...("heading" in target ? { heading: target.heading } : {}),
        ...("block" in target ? { block: target.block } : {}),
      };
      if (!("title" in target)) {
        // A heading or block of this note.
        open(id, part);
        return;
      }
      const note = resolve(target.title);
      if (note !== undefined) {
        open(note, part);
        return;
      }
      vault.create(newNotePath(target.title), "").then((created) => {
        open(created.id);
      }, report);
    },

    ...(openTag === undefined ? {} : { openTag }),

    suggestBlocks(query) {
      const asked = blockQuery(query);
      if (asked === undefined) return undefined;
      return (async () => {
        const note = asked.title === "" ? id : resolve(asked.title);
        if (note === undefined) return [];
        const file = await vault.read(note);
        if (file.missing === true || file.binary === true) return [];
        const parsed = parseMarkdown(file.text);
        const path = vault.note(note)?.path ?? "";
        return linkableBlocks(parsed.content)
          .map((entry, index) => ({ ...entry, index, score: matchScore(asked.text, entry.text) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, limit)
          .map(({ block, text }): LinkSuggestion => {
            const written = parsed.writtenIds.has(block.id);
            return {
              key: `b${block.id}`,
              title: text.length > blockTextLength ? `${text.slice(0, blockTextLength)}…` : text,
              ...(asked.title === "" ? {} : { detail: titleOf(path) }),
              target:
                asked.title === ""
                  ? { block: block.id }
                  : { title: linkText(note, path), block: block.id },
              ...(written
                ? {}
                : {
                    onChoose: () => {
                      writeBlockId(note, parsed, file.hash, block.id).catch(report);
                    },
                  }),
            };
          });
      })();
    },

    async embed(target: LinkTarget) {
      const note = "title" in target ? resolve(target.title) : id;
      if (note === undefined) return undefined;
      const file = await vault.read(note);
      if (file.missing === true || file.binary === true) return undefined;
      const blocks = noteSection(parseMarkdown(file.text).content, {
        ...("heading" in target ? { heading: target.heading } : {}),
        ...("block" in target ? { block: target.block } : {}),
      });
      const title = vault.note(note)?.title ?? "";
      return blocks === undefined ? undefined : { title, blocks };
    },
  };
}
