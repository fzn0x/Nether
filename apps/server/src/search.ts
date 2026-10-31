// Workspace search (ADR 0050): what the server can read of each note, kept
// in note_search as notes and vault documents are stored, and searched for
// an account across its workspaces, in the units it may open. A note's text
// is read from its Yjs state without the editor: the text of each block, a
// line each, its properties, and its tags, as Obsidian reads them.
import { type Filter, type SearchQuery, isEmptyQuery, parseQuery } from "@nether/search";
import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { type Database, type Queryable, type Row, readBytes, readText } from "./db.ts";
import { fail, limitBy } from "./http.ts";
import { accountOf, signedIn } from "./sessions.ts";
import { accessible, general } from "./units.ts";

/** The most results one search gives. */
const maxResults = 50;

/** What a note's state holds that search reads. */
export interface NoteContent {
  readonly body: string;
  readonly tags: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

/** The text of an inline run, its embeds left out. */
function textOf(text: Y.XmlText): string {
  return (text.toDelta() as { insert?: unknown }[])
    .map((part) => (typeof part.insert === "string" ? part.insert : ""))
    .join("");
}

/** A block's text: an element with text in it is a line, others hold lines. */
function linesOf(node: Y.XmlElement | Y.XmlFragment, lines: string[]): void {
  const children = node.toArray();
  if (children.some((child) => child instanceof Y.XmlText)) {
    const line = children
      .map((child) => (child instanceof Y.XmlText ? textOf(child) : inlineText(child)))
      .join("");
    if (line.trim() !== "") lines.push(line);
    return;
  }
  for (const child of children) {
    if (child instanceof Y.XmlElement) linesOf(child, lines);
  }
}

/** The text of something inline, as a mention or a hard break: its own text, if any. */
function inlineText(node: Y.XmlElement | Y.XmlHook): string {
  if (!(node instanceof Y.XmlElement)) return "";
  return node
    .toArray()
    .map((child) => (child instanceof Y.XmlText ? textOf(child) : inlineText(child)))
    .join("");
}

/** `#tags` in text, as Obsidian has them: after a space or the start, not numbers alone. */
const inlineTag = /(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

function tagsOf(body: string, properties: Readonly<Record<string, unknown>>): string[] {
  const tags = new Map<string, string>();
  const add = (tag: string) => {
    const clean = tag.trim().replace(/^#/, "");
    if (clean !== "" && !tags.has(clean.toLowerCase())) tags.set(clean.toLowerCase(), clean);
  };
  const property = properties.tags ?? properties.tag;
  if (typeof property === "string") property.split(/[\s,]+/).forEach(add);
  if (Array.isArray(property)) {
    for (const tag of property) if (typeof tag === "string") add(tag);
  }
  for (const match of body.matchAll(inlineTag)) if (match[1] !== undefined) add(match[1]);
  return [...tags.values()];
}

/** What search reads of a note's Yjs state. */
export function noteContent(state: Uint8Array): NoteContent {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  const lines: string[] = [];
  linesOf(document.getXmlFragment("content"), lines);
  const body = lines.join("\n");
  const properties = document.getMap<unknown>("properties").toJSON() as Record<string, unknown>;
  return { body, tags: tagsOf(body, properties), properties };
}

/** A vault document's notes: each note's ID, and its path. */
function pathsOf(state: Uint8Array | undefined): Map<string, string> {
  if (state === undefined) return new Map();
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return new Map(document.getMap<string>("notes").entries());
}

function titleOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/** Keeps what search reads of a note, as it is stored. */
export async function indexNote(
  db: Queryable,
  workspaceId: string,
  note: string,
  state: Uint8Array,
): Promise<void> {
  const content = noteContent(state);
  await db.query(
    `INSERT INTO note_search (workspace_id, note, body, tags, properties)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, note)
       DO UPDATE SET body = excluded.body, tags = excluded.tags, properties = excluded.properties`,
    [workspaceId, note, content.body, content.tags, JSON.stringify(content.properties)],
  );
}

/**
 * Keeps the paths a unit's vault document gives its notes, as it is stored:
 * those added or moved since the state it replaces, and, for those it no
 * longer lists that are still in its unit, no path, which search leaves out.
 */
export async function indexPaths(
  db: Queryable,
  workspaceId: string,
  unit: string,
  state: Uint8Array,
  before: Uint8Array | undefined,
): Promise<void> {
  const now = pathsOf(state);
  const was = pathsOf(before);
  for (const [id, path] of now) {
    if (was.get(id) === path) continue;
    await db.query(
      `INSERT INTO note_search (workspace_id, note, path, title)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, note) DO UPDATE SET path = excluded.path, title = excluded.title`,
      [workspaceId, id.toLowerCase(), path, titleOf(path)],
    );
  }
  const gone = [...was.keys()].filter((id) => !now.has(id)).map((id) => id.toLowerCase());
  if (gone.length === 0) return;
  // A note that moved to another unit has its path from that unit's document.
  await db.query(
    `UPDATE note_search s SET path = '', title = ''
     WHERE s.workspace_id = $1 AND s.note = ANY($2)
       AND COALESCE(
         (SELECT u.unit_id::text FROM note_units u
           WHERE u.workspace_id = s.workspace_id AND u.note = s.note),
         $3) = $4`,
    [workspaceId, gone, general, unit],
  );
}

/** Indexes what was stored before search was: once, as the server starts after the migration. */
export async function backfillSearch(db: Database): Promise<number> {
  return db.transaction(async (tx) => {
    const { rows: pending } = await tx.query(
      "DELETE FROM search_backfill WHERE pending RETURNING pending",
    );
    if (pending.length === 0) return 0;
    const { rows } = await tx.query(
      `SELECT d.workspace_id, d.name, d.state FROM documents d
       JOIN workspaces w ON w.id = d.workspace_id
       WHERE w.encryption = 'none' AND d.name NOT LIKE '%.comments'`,
    );
    for (const row of rows) {
      const workspace = readText(row, "workspace_id");
      const name = readText(row, "name");
      const state = readBytes(row, "state");
      if (name === "vault") await indexPaths(tx, workspace, general, state, undefined);
      else if (name.startsWith("vault.")) {
        await indexPaths(tx, workspace, name.slice("vault.".length), state, undefined);
      } else await indexNote(tx, workspace, name, state);
    }
    return rows.length;
  });
}

/** A query's words and phrases as SQL building a tsquery, its values added to `values`. */
function tsQuery(query: SearchQuery, values: unknown[]): string | undefined {
  const add = (value: unknown) => `$${String(values.push(value))}`;
  /** A word as a lexeme: letters and digits alone, which nothing in a tsquery can be read into. */
  const lexeme = (word: string) =>
    word
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const parts: string[] = [];
  query.words.forEach((word, index) => {
    const clean = lexeme(word).toLowerCase();
    if (clean === "") return;
    // The last word, as it is typed, matches as a prefix.
    if (index === query.words.length - 1 && !clean.includes(" ")) {
      parts.push(`to_tsquery('simple', ${add(`${clean}:*`)})`);
    } else parts.push(`phraseto_tsquery('simple', ${add(clean)})`);
  });
  for (const phrase of query.phrases) parts.push(`phraseto_tsquery('simple', ${add(phrase)})`);
  if (parts.length === 0) return undefined;
  const excluded = query.excluded.map((text) => `!!phraseto_tsquery('simple', ${add(text)})`);
  return `(${[...parts, ...excluded].join(" && ")})`;
}

/** A filter as an SQL condition on note_search s, its values added to `values`. */
function filterSql(filter: Filter, values: unknown[]): string {
  const add = (value: unknown) => `$${String(values.push(value))}`;
  if (filter.kind === "tag") {
    // A tag finds the tags nested under it too, as #area finds #area/project.
    const tag = add(filter.tag.toLowerCase());
    return `EXISTS (SELECT 1 FROM unnest(s.tags) t WHERE lower(t) = ${tag} OR lower(t) LIKE ${tag} || '/%')`;
  }
  if (filter.kind === "path") {
    const escaped = filter.path.replace(/[\\%_]/g, (character) => `\\${character}`);
    return `s.path ILIKE ${add(`%${escaped}%`)}`;
  }
  const key = add(filter.key.toLowerCase());
  if (filter.value === undefined) {
    return `EXISTS (SELECT 1 FROM jsonb_object_keys(s.properties) k WHERE lower(k) = ${key})`;
  }
  const value = add(filter.value.toLowerCase());
  return `EXISTS (SELECT 1 FROM jsonb_each(s.properties) e WHERE lower(e.key) = ${key} AND (
    lower(e.value #>> '{}') = ${value} OR (jsonb_typeof(e.value) = 'array' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(e.value) x WHERE lower(x) = ${value}))))`;
}

/** Where a snippet's matches are, as ts_headline marks them, and the snippet without the marks. */
const markStart = "\u{E000}";
const markEnd = "\u{E001}";

export function readSnippet(marked: string): {
  readonly text: string;
  readonly matches: readonly (readonly [number, number])[];
} {
  let text = "";
  const matches: [number, number][] = [];
  let start = -1;
  for (const character of marked) {
    if (character === markStart) start = text.length;
    else if (character === markEnd) {
      if (start !== -1) matches.push([start, text.length]);
      start = -1;
    } else text += character;
  }
  return { text, matches };
}

export interface SearchResult {
  readonly workspace: string;
  readonly workspaceName: string;
  readonly note: string;
  readonly title: string;
  readonly path: string;
  readonly snippet: string;
  /** Where in the snippet the query matched, as [start, end) offsets. */
  readonly matches: readonly (readonly [number, number])[];
}

/**
 * Searches the notes an account may open, in every workspace it is a member
 * of that the server can read; names the encrypted ones it could not.
 */
export async function search(
  db: Queryable,
  userId: string,
  text: string,
  limit = maxResults,
): Promise<{ readonly results: SearchResult[]; readonly encrypted: string[] }> {
  const { rows: workspaces } = await db.query(
    `SELECT w.id, w.name, w.encryption FROM memberships m
     JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1`,
    [userId],
  );
  const encrypted: string[] = [];
  const pairs: { workspace: string; unit: string }[] = [];
  const names = new Map<string, string>();
  for (const row of workspaces) {
    const id = readText(row, "id");
    names.set(id, readText(row, "name"));
    if (row.encryption !== "none") {
      encrypted.push(readText(row, "name"));
      continue;
    }
    for (const unit of (await accessible(db, userId, id)).levels.keys()) {
      pairs.push({ workspace: id, unit });
    }
  }
  const query = parseQuery(text);
  if (pairs.length === 0 || isEmptyQuery(query)) return { results: [], encrypted };

  const values: unknown[] = [pairs.map((pair) => pair.workspace), pairs.map((pair) => pair.unit)];
  values.push(general);
  const conditions = [
    "s.path <> ''",
    `(s.workspace_id, COALESCE(u.unit_id::text, $3)) IN (SELECT * FROM unnest($1::uuid[], $2::text[]))`,
  ];
  const matching = tsQuery(query, values);
  if (matching !== undefined) conditions.push(`s.search @@ ${matching}`);
  for (const filter of query.filters) conditions.push(filterSql(filter, values));
  for (const filter of query.excludedFilters) conditions.push(`NOT ${filterSql(filter, values)}`);
  const words = matching ?? "to_tsquery('simple', '')";
  values.push(Math.min(limit, maxResults));
  const { rows } = await db.query(
    `SELECT s.workspace_id, s.note, s.title, s.path,
       ts_headline('simple', s.body, ${words},
         'StartSel=${markStart}, StopSel=${markEnd}, MaxWords=30, MinWords=12, MaxFragments=1') AS snippet,
       ts_rank(s.search, ${words}) AS rank
     FROM note_search s
     LEFT JOIN note_units u ON u.workspace_id = s.workspace_id AND u.note = s.note
     WHERE ${conditions.join(" AND ")}
     ORDER BY rank DESC, s.title
     LIMIT $${String(values.length)}`,
    values,
  );
  const results = rows.map((row: Row): SearchResult => {
    const workspace = readText(row, "workspace_id");
    const snippet = readSnippet(readText(row, "snippet"));
    return {
      workspace,
      workspaceName: names.get(workspace) ?? "",
      note: readText(row, "note"),
      title: readText(row, "title"),
      path: readText(row, "path"),
      snippet: snippet.text,
      matches: snippet.matches,
    };
  });
  return { results, encrypted };
}

export function registerSearch(app: FastifyInstance, db: Database): void {
  const account = signedIn(db);
  app.get<{ Querystring: { q: string; limit?: number } }>(
    "/api/search",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 500 },
            limit: { type: "integer", minimum: 1, maximum: maxResults },
          },
        },
      },
      preHandler: [account, limitBy(app, 120, "1 minute", (request) => accountOf(request).id)],
    },
    async (request, reply) => {
      if (request.query.q.trim() === "") return fail(reply, 400, "Type something to search for.");
      return search(db, accountOf(request).id, request.query.q, request.query.limit);
    },
  );
}
