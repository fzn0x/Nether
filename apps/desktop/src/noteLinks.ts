// The links of a note, for its editor: what `[[` suggests, the notes of
// the vault by title, path or alias, or a note's headings after `#`, and
// what a link opens, a note the vault makes first when it has none by that
// name, as Obsidian does.
import type { LinkTarget, NoteId } from "@nether/core";
import type { LinkSuggestion, NoteLinks } from "@nether/editor";
import type { LinkGraph } from "@nether/graph";
import type { NoteEntry, Vault } from "@nether/storage";

/** How many notes `[[` suggests at most. */
const limit = 20;

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

export function noteLinks(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
  open: (note: NoteId) => void,
  report: (error: unknown) => void,
): NoteLinks {
  const from = () => vault.note(id)?.path ?? "";
  /** The shortest text that links to a note from this one: its title, or its path when another note has the title. */
  const linkText = (note: NoteId, path: string) => {
    const title = titleOf(path);
    return graph.resolve(title, from()) === note ? title : path.replace(/\.md$/i, "");
  };
  const resolve = (title: string) =>
    graph.resolve(title, from()) ?? vault.noteAt(/\.md$/i.test(title) ? title : `${title}.md`)?.id;

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
      if (!("title" in target)) return;
      const note = resolve(target.title);
      if (note !== undefined) {
        open(note);
        return;
      }
      vault.create(newNotePath(target.title), "").then((created) => {
        open(created.id);
      }, report);
    },
  };
}
