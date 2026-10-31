// Searches a vault: the index finds notes by their words and phrases, and
// the link index filters them by tag, path and property. And the quick
// switcher's matches, by title, alias or path.
import type { LinkGraph } from "@nether/graph";
import { type Filter, type SearchQuery, foldText } from "@nether/search";
import { type NoteEntry, type Vault, matchEnd, matchStart } from "@nether/storage";
import { lowerMatchScore } from "./noteLinks.ts";

/** How many notes a search lists at most, and how many the index gives it to filter. */
const resultLimit = 100;
const textLimit = 1000;

export interface SearchResult {
  readonly note: NoteEntry;
  /** The text around a match, each match between \u0002 and \u0003; none for a search by filters alone. */
  readonly snippet?: string;
}

function propertyMatches(value: unknown, wanted: string): boolean {
  if (Array.isArray(value)) return value.some((item) => propertyMatches(item, wanted));
  if (typeof value === "string") return foldText(value).includes(wanted);
  if (typeof value === "number" || typeof value === "boolean") return String(value) === wanted;
  return false;
}

/** Whether a note passes a filter, as the link index knows it. */
export function passes(
  graph: LinkGraph,
  note: Pick<NoteEntry, "id" | "path">,
  filter: Filter,
): boolean {
  const index = graph.note(note.id)?.index;
  switch (filter.kind) {
    case "tag": {
      const tag = foldText(filter.tag);
      return (index?.tags ?? []).some((own) => {
        const folded = foldText(own);
        return folded === tag || folded.startsWith(`${tag}/`);
      });
    }
    case "path":
      return foldText(note.path).includes(foldText(filter.path));
    case "prop": {
      const key = foldText(filter.key);
      const entry = index?.properties.find((property) => foldText(property.key) === key);
      if (entry === undefined) return false;
      return filter.value === undefined || propertyMatches(entry.value, foldText(filter.value));
    }
  }
}

/** The notes a search finds, the best first: by text when it has words, else in path order. */
export async function searchVault(
  vault: Vault,
  graph: LinkGraph,
  query: SearchQuery,
): Promise<readonly SearchResult[]> {
  const byText = query.words.length > 0 || query.phrases.length > 0;
  const found: SearchResult[] = [];
  if (byText) {
    for (const hit of await vault.indexes.searchText(query, textLimit)) {
      const note = vault.note(hit.note);
      if (note !== undefined) found.push({ note, snippet: hit.snippet });
    }
  } else {
    for (const note of vault.notes()) found.push({ note });
  }
  return found
    .filter(
      ({ note }) =>
        query.filters.every((filter) => passes(graph, note, filter)) &&
        !query.excludedFilters.some((filter) => passes(graph, note, filter)),
    )
    .slice(0, resultLimit);
}

/** A note the quick switcher offers, and the alias it matched, if it matched one. */
export interface SwitcherMatch {
  readonly note: NoteEntry;
  readonly alias?: string;
}

/**
 * The notes whose title, alias or path best match what was typed, at most
 * `limit`; with nothing typed, the notes edited last.
 */
/** A note's title and path in lower case, as the switcher matches them. */
interface SwitcherEntry {
  readonly note: NoteEntry;
  readonly title: string;
  readonly path: string;
}

// Kept for each version of the vault's list of notes, which changes when a note does.
const switcherEntries = new WeakMap<readonly NoteEntry[], readonly SwitcherEntry[]>();

function entriesOf(notes: readonly NoteEntry[]): readonly SwitcherEntry[] {
  let entries = switcherEntries.get(notes);
  if (entries === undefined) {
    entries = notes.map((note) => ({
      note,
      title: note.title.toLowerCase(),
      path: note.path.replace(/\.md$/i, "").toLowerCase(),
    }));
    switcherEntries.set(notes, entries);
  }
  return entries;
}

/** Whether one match goes before another: a better score, then the note edited last. */
function before(a: { score: number; match: SwitcherMatch }, b: typeof a): boolean {
  return (
    a.score > b.score || (a.score === b.score && a.match.note.modified > b.match.note.modified)
  );
}

export function switcherMatches(
  vault: Vault,
  graph: LinkGraph,
  query: string,
  limit = 20,
): readonly SwitcherMatch[] {
  const typed = query.trim().toLowerCase();
  const byPath = typed.includes("/");
  // The best matches so far, best first: no more than `limit` are ever kept.
  const best: { match: SwitcherMatch; score: number }[] = [];
  for (const entry of entriesOf(vault.notes())) {
    let found = {
      match: { note: entry.note } as SwitcherMatch,
      score: Math.max(
        lowerMatchScore(typed, entry.title),
        byPath ? lowerMatchScore(typed, entry.path) - 1 : 0,
      ),
    };
    if (typed !== "") {
      for (const alias of graph.note(entry.note.id)?.index.aliases ?? []) {
        const score = lowerMatchScore(typed, alias.toLowerCase());
        if (score > found.score) found = { match: { note: entry.note, alias }, score };
      }
    }
    if (found.score <= 0) continue;
    const last = best[best.length - 1];
    if (best.length === limit && last !== undefined && !before(found, last)) continue;
    let at = best.length;
    while (at > 0) {
      const above = best[at - 1];
      if (above === undefined || !before(found, above)) break;
      at--;
    }
    best.splice(at, 0, found);
    if (best.length > limit) best.pop();
  }
  return best.map(({ match }) => match);
}

/** Splits a snippet into text and its marked matches, for the page to show. */
export function snippetParts(
  snippet: string,
): { readonly text: string; readonly match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  const pattern = new RegExp(`${matchStart}([^${matchEnd}]*)${matchEnd}`, "g");
  let at = 0;
  for (const found of snippet.matchAll(pattern)) {
    if (found.index > at) parts.push({ text: snippet.slice(at, found.index), match: false });
    parts.push({ text: found[1] ?? "", match: true });
    at = found.index + found[0].length;
  }
  if (at < snippet.length) parts.push({ text: snippet.slice(at), match: false });
  return parts;
}
