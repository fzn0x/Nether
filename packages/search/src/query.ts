// A search as people type it: words, "quoted phrases", -excluded words
// and phrases, and filters by tag, path and property, as Obsidian's search
// reads `tag:`, `path:` and `[property:value]`. The index runs the words
// and phrases; the app applies the filters, which it knows from the link
// index.

/** A filter on a note: by tag, by path, or by property and maybe value. */
export type Filter =
  | { readonly kind: "tag"; readonly tag: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "prop"; readonly key: string; readonly value?: string };

export interface SearchQuery {
  /** Words a note must have, each, in its title or text. */
  readonly words: readonly string[];
  /** Phrases a note must have, each word in order. */
  readonly phrases: readonly string[];
  /** Words and phrases a note must not have. */
  readonly excluded: readonly string[];
  readonly filters: readonly Filter[];
  readonly excludedFilters: readonly Filter[];
}

/** Whether a query asks for anything. */
export function isEmptyQuery(query: SearchQuery): boolean {
  return (
    query.words.length === 0 &&
    query.phrases.length === 0 &&
    query.filters.length === 0 &&
    query.excludedFilters.length === 0
  );
}

/**
 * The parts of a query, each maybe after `-`: quoted phrases, Obsidian's
 * `[property:value]`, filters with a quoted value as `path:"Daily notes"`,
 * and words, filters among them.
 */
const token = /(-?)(?:"([^"]*)"?|\[([^\]]*)\]?|([^\s":[]+:"[^"]*"?)|(\S+))/g;

function filterOf(text: string): Filter | undefined {
  const colon = text.indexOf(":");
  if (colon <= 0) return undefined;
  const key = text.slice(0, colon).toLowerCase();
  const value = text
    .slice(colon + 1)
    .replace(/^"|"$/g, "")
    .trim();
  if (key === "tag" && value !== "") return { kind: "tag", tag: value.replace(/^#/, "") };
  if (key === "path" && value !== "") return { kind: "path", path: value };
  if (key === "prop" && value !== "") {
    const equals = value.search(/[=:]/);
    return equals === -1
      ? { kind: "prop", key: value }
      : { kind: "prop", key: value.slice(0, equals).trim(), value: value.slice(equals + 1).trim() };
  }
  return undefined;
}

/** Reads a search as typed. A `#tag` alone is a tag filter, as in Obsidian. */
export function parseQuery(text: string): SearchQuery {
  const words: string[] = [];
  const phrases: string[] = [];
  const excluded: string[] = [];
  const filters: Filter[] = [];
  const excludedFilters: Filter[] = [];
  for (const match of text.matchAll(token)) {
    const not = match[1] === "-";
    const [, , quoted, bracketed, keyed, word] = match;
    const bare = keyed ?? word;
    if (bracketed !== undefined) {
      // Obsidian's [property:value], or [property] for notes that have it.
      const filter = filterOf(`prop:${bracketed}`);
      if (filter !== undefined) (not ? excludedFilters : filters).push(filter);
      continue;
    }
    if (quoted !== undefined) {
      const phrase = quoted.trim();
      if (phrase !== "") (not ? excluded : phrases).push(phrase);
      continue;
    }
    if (bare === undefined) continue;
    const filter =
      bare.startsWith("#") && bare.length > 1 ? filterOf(`tag:${bare}`) : filterOf(bare);
    if (filter !== undefined) {
      (not ? excludedFilters : filters).push(filter);
    } else if (not && bare !== "") {
      excluded.push(bare);
    } else if (bare !== "-") {
      words.push(bare);
    }
  }
  return { words, phrases, excluded, filters, excludedFilters };
}

/** A word or phrase as FTS5 reads it: in double quotes, its own quotes doubled. */
function ftsString(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A query's words and phrases as an FTS5 MATCH expression, every one
 * required, the last word matching as a prefix while it is typed, and
 * excluded ones left out; undefined when there are none to match.
 */
export function ftsMatch(query: SearchQuery, prefix = true): string | undefined {
  const parts = [
    ...query.words.map((word, index) =>
      prefix && index === query.words.length - 1 ? `${ftsString(word)}*` : ftsString(word),
    ),
    ...query.phrases.map(ftsString),
  ];
  if (parts.length === 0) return undefined;
  const required = parts.join(" AND ");
  if (query.excluded.length === 0) return required;
  return `${required} NOT (${query.excluded.map(ftsString).join(" OR ")})`;
}

/** Folds text as the index does, for search to compare: case and accents aside. */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}
