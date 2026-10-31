// A note's comments (ADR 0044): threads in a document of their own beside
// the note's, each on a range of the note's text, holding its comments in
// the order they were made. Whoever may comment starts threads, replies,
// and resolves and reopens them; each person edits and deletes their own,
// which the app sees to, as the server cannot read inside a document.
import { uuidV7 } from "@nether/core";
import * as Y from "yjs";

/** Who wrote a comment or resolved a thread: an account's ID, and its name at the time. */
export interface CommentAuthor {
  readonly id: string;
  readonly name: string;
}

/** Where a thread is in its note. */
export interface CommentAnchor {
  /** The range's ends: Yjs relative positions in the note's document, encoded. */
  readonly start: Uint8Array;
  readonly end: Uint8Array;
  /** The block the range began in, for when the range is gone. */
  readonly block: string | undefined;
  /** The text commented on, as it was then. */
  readonly quote: string;
}

export interface NoteComment {
  readonly id: string;
  readonly author: CommentAuthor;
  /** What was written, as plain text. */
  readonly body: string;
  readonly created: number;
  /** When it was last edited, if it was. */
  readonly edited: number | undefined;
}

export interface CommentThread {
  readonly id: string;
  readonly anchor: CommentAnchor;
  readonly created: number;
  /** Its comments, the first one opening it. */
  readonly comments: readonly NoteComment[];
  /** Who resolved it and when, while it is resolved. */
  readonly resolved: { readonly by: CommentAuthor; readonly at: number } | undefined;
}

/** The map of threads, by ID, in a note's comments' document. */
const threadsField = "threads";

function threadsOf(document: Y.Doc): Y.Map<Y.Map<unknown>> {
  return document.getMap(threadsField);
}

function readAuthor(value: unknown): CommentAuthor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, name } = value as Record<string, unknown>;
  return typeof id === "string" && typeof name === "string" ? { id, name } : undefined;
}

function readComment(value: unknown): NoteComment | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  const map = value as Y.Map<unknown>;
  const id = map.get("id");
  const author = readAuthor(map.get("author"));
  const body = map.get("body");
  const created = map.get("created");
  const edited = map.get("edited");
  if (typeof id !== "string" || author === undefined) return undefined;
  if (typeof body !== "string" || typeof created !== "number") return undefined;
  return { id, author, body, created, edited: typeof edited === "number" ? edited : undefined };
}

function readThread(id: string, map: Y.Map<unknown>): CommentThread | undefined {
  const start = map.get("start");
  const end = map.get("end");
  const block = map.get("block");
  const quote = map.get("quote");
  const created = map.get("created");
  const list = map.get("comments");
  if (!(start instanceof Uint8Array) || !(end instanceof Uint8Array)) return undefined;
  if (typeof quote !== "string" || typeof created !== "number") return undefined;
  if (!(list instanceof Y.Array)) return undefined;
  const comments = (list as Y.Array<unknown>)
    .toArray()
    .map(readComment)
    .filter((comment) => comment !== undefined);
  if (comments.length === 0) return undefined;
  const resolvedBy = readAuthor(map.get("resolvedBy"));
  const resolvedAt = map.get("resolvedAt");
  return {
    id,
    anchor: { start, end, block: typeof block === "string" ? block : undefined, quote },
    created,
    comments,
    resolved:
      resolvedBy !== undefined && typeof resolvedAt === "number"
        ? { by: resolvedBy, at: resolvedAt }
        : undefined,
  };
}

/** A note's threads, the oldest first; any it cannot read are left out. */
export function readThreads(document: Y.Doc): CommentThread[] {
  const threads: CommentThread[] = [];
  for (const [id, map] of threadsOf(document)) {
    const thread = map instanceof Y.Map ? readThread(id, map) : undefined;
    if (thread !== undefined) threads.push(thread);
  }
  return threads.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
}

/** Calls `listener` whenever a note's threads change; gives the way to stop. */
export function observeThreads(document: Y.Doc, listener: () => void): () => void {
  const threads = threadsOf(document);
  const observer = () => {
    listener();
  };
  threads.observeDeep(observer);
  return () => {
    threads.unobserveDeep(observer);
  };
}

function newComment(author: CommentAuthor, body: string, now: number): Y.Map<unknown> {
  const comment = new Y.Map<unknown>();
  comment.set("id", uuidV7(now));
  comment.set("author", { id: author.id, name: author.name });
  comment.set("body", body);
  comment.set("created", now);
  return comment;
}

/** Starts a thread on a range of the note with its first comment; gives its ID. */
export function startThread(
  document: Y.Doc,
  anchor: CommentAnchor,
  author: CommentAuthor,
  body: string,
  now: number = Date.now(),
): string {
  const id = uuidV7(now);
  document.transact(() => {
    const thread = new Y.Map<unknown>();
    thread.set("start", anchor.start);
    thread.set("end", anchor.end);
    if (anchor.block !== undefined) thread.set("block", anchor.block);
    thread.set("quote", anchor.quote);
    thread.set("created", now);
    const comments = new Y.Array<Y.Map<unknown>>();
    comments.push([newComment(author, body, now)]);
    thread.set("comments", comments);
    threadsOf(document).set(id, thread);
  });
  return id;
}

function commentsOf(document: Y.Doc, thread: string): Y.Array<Y.Map<unknown>> | undefined {
  const list = threadsOf(document).get(thread)?.get("comments");
  return list instanceof Y.Array ? (list as Y.Array<Y.Map<unknown>>) : undefined;
}

/** Adds a reply to a thread; gives its ID, or undefined when the thread is gone. */
export function reply(
  document: Y.Doc,
  thread: string,
  author: CommentAuthor,
  body: string,
  now: number = Date.now(),
): string | undefined {
  const comments = commentsOf(document, thread);
  if (comments === undefined) return undefined;
  const comment = newComment(author, body, now);
  comments.push([comment]);
  return comment.get("id") as string;
}

/** Marks a thread resolved: it stays, out of the way, until reopened. */
export function resolveThread(
  document: Y.Doc,
  thread: string,
  by: CommentAuthor,
  now: number = Date.now(),
): void {
  const map = threadsOf(document).get(thread);
  if (map === undefined) return;
  document.transact(() => {
    map.set("resolvedBy", { id: by.id, name: by.name });
    map.set("resolvedAt", now);
  });
}

/** Opens a resolved thread again. */
export function reopenThread(document: Y.Doc, thread: string): void {
  const map = threadsOf(document).get(thread);
  if (map === undefined) return;
  document.transact(() => {
    map.delete("resolvedBy");
    map.delete("resolvedAt");
  });
}

function findComment(
  comments: Y.Array<Y.Map<unknown>>,
  id: string,
): { index: number; map: Y.Map<unknown> } | undefined {
  const index = comments.toArray().findIndex((map) => map.get("id") === id);
  const map = comments.get(index) as Y.Map<unknown> | undefined;
  return index < 0 || map === undefined ? undefined : { index, map };
}

/** Changes what a comment says. */
export function editComment(
  document: Y.Doc,
  thread: string,
  comment: string,
  body: string,
  now: number = Date.now(),
): void {
  const comments = commentsOf(document, thread);
  const found = comments === undefined ? undefined : findComment(comments, comment);
  if (found === undefined) return;
  document.transact(() => {
    found.map.set("body", body);
    found.map.set("edited", now);
  });
}

/** Deletes a comment; a thread left with none goes with it. */
export function deleteComment(document: Y.Doc, thread: string, comment: string): void {
  const comments = commentsOf(document, thread);
  const found = comments === undefined ? undefined : findComment(comments, comment);
  if (comments === undefined || found === undefined) return;
  document.transact(() => {
    comments.delete(found.index, 1);
    if (comments.length === 0) threadsOf(document).delete(thread);
  });
}
