// The vault's links, held in memory: which note each link names, as
// Obsidian finds it or by an alias, the notes that link to a note, and the
// vault's tags. A change to a note changes only what the graph keeps of
// that note; nothing is worked out again for the whole vault, so a save, a
// move and the first reading of a large vault each cost what they change.
import type { NoteId } from "@nether/core";
import { LinkIndex } from "@nether/storage";
import type { LinkRef, NoteIndex } from "./extract.ts";

/** A note as the graph holds it. */
export interface GraphNote {
  readonly id: NoteId;
  readonly path: string;
  readonly title: string;
  readonly index: NoteIndex;
}

/** What the graph is told of a note: where it is and what its index read. */
export interface GraphEntry {
  readonly id: NoteId;
  readonly path: string;
  readonly index: NoteIndex;
}

/** A note that links to another, with each link and the text around it. */
export interface Backlink {
  readonly source: NoteId;
  readonly links: readonly LinkRef[];
}

/** A tag, as first written, and how many notes have it or a tag under it. */
export interface TagCount {
  readonly tag: string;
  readonly count: number;
}

function titleOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/** The file a link names: a note's, without `.md` as links write it. */
function fileOf(target: string): string {
  return /\.md$/i.test(target) ? target : `${target}.md`;
}

/**
 * The name a link's target writes, case aside and without `.md`: the last
 * part of the file it names, lowercased with `.md` on as the link index
 * lowercases it, final sigma as any other. A link finds a note only when
 * it writes the note's name or one of its aliases, so a note's backlinks
 * are among the notes that write one of those.
 */
function nameOf(target: string): string {
  const file = fileOf(target.trim());
  return file
    .slice(file.lastIndexOf("/") + 1)
    .toLowerCase()
    .slice(0, -3)
    .replaceAll("ς", "σ");
}

/** The names a note's links write, its links within itself aside. */
function namesOf(links: readonly LinkRef[]): Set<string> {
  const names = new Set<string>();
  for (const link of links) if (link.target !== "") names.add(nameOf(link.target));
  return names;
}

/**
 * The notes that write a name: the note alone while it is the only one,
 * as a list for each took megabytes in a large vault.
 */
type Sources = NoteId | NoteId[];

function sourceList(sources: Sources | undefined): readonly NoteId[] {
  return sources === undefined ? [] : typeof sources === "string" ? [sources] : sources;
}

const noLinks: readonly LinkRef[] = [];

export class LinkGraph {
  readonly #notes = new Map<NoteId, GraphNote>();
  /** The notes' paths, made when a link is first resolved and kept as notes come, move and go. */
  #paths: LinkIndex | undefined;
  #byPath: Map<string, NoteId> | undefined;
  /** Each alias, lowercase, to the first note with it; made again when an alias changes. */
  #aliases: Map<string, NoteId> | undefined;
  /** For each name links write, the notes that write it. */
  readonly #writers = new Map<string, Sources>();
  readonly #listeners = new Set<() => void>();

  /** Sets what the graph holds of a note, at the path it has now. */
  set(id: NoteId, path: string, index: NoteIndex): void {
    this.setMany([{ id, path, index }]);
  }

  /**
   * Sets what the graph holds of several notes as one change, as a vault's
   * index loads, telling whoever listens once.
   */
  setMany(entries: Iterable<GraphEntry>): void {
    let any = false;
    for (const { id, path, index } of entries) {
      any = true;
      const before = this.#notes.get(id);
      const note = { id, path, title: titleOf(path), index };
      this.#notes.set(id, note);
      if (before?.path !== path) {
        if (before !== undefined) this.#forgetPath(before);
        this.#paths?.add(path);
        this.#byPath?.set(path, id);
      }
      if (before === undefined) {
        // A note new to the graph is the last in its order: its aliases
        // name it where no note before it has them.
        for (const alias of index.aliases) {
          const key = alias.toLowerCase();
          if (this.#aliases !== undefined && !this.#aliases.has(key)) this.#aliases.set(key, id);
        }
      } else if (before.index.aliases.join("|") !== index.aliases.join("|")) {
        this.#aliases = undefined;
      }
      this.#rewrite(id, before?.index.links ?? noLinks, index.links);
    }
    if (any) this.#changed();
  }

  /** Forgets a note that left the vault. */
  remove(id: NoteId): void {
    const note = this.#notes.get(id);
    if (note === undefined) return;
    this.#notes.delete(id);
    this.#forgetPath(note);
    if (note.index.aliases.length > 0) this.#aliases = undefined;
    this.#rewrite(id, note.index.links, noLinks);
    this.#changed();
  }

  #forgetPath(note: GraphNote): void {
    this.#paths?.remove(note.path);
    if (this.#byPath?.get(note.path) === note.id) this.#byPath.delete(note.path);
  }

  /** Moves a note among the writers of the names its links wrote and now write. */
  #rewrite(id: NoteId, was: readonly LinkRef[], now: readonly LinkRef[]): void {
    if (was === now) return;
    const before = namesOf(was);
    const after = namesOf(now);
    for (const name of before) {
      if (after.has(name)) continue;
      const sources = this.#writers.get(name);
      if (sources === undefined || typeof sources === "string") {
        if (sources === id) this.#writers.delete(name);
        continue;
      }
      const at = sources.indexOf(id);
      if (at !== -1) sources.splice(at, 1);
      const [only] = sources;
      if (sources.length === 1 && only !== undefined) this.#writers.set(name, only);
    }
    for (const name of after) {
      if (before.has(name)) continue;
      const sources = this.#writers.get(name);
      if (sources === undefined) this.#writers.set(name, id);
      else if (typeof sources === "string") this.#writers.set(name, [sources, id]);
      else sources.push(id);
    }
  }

  /** A note the graph holds. */
  note(id: NoteId): GraphNote | undefined {
    return this.#notes.get(id);
  }

  /** Every note the graph holds. */
  notes(): IterableIterator<GraphNote> {
    return this.#notes.values();
  }

  /** Calls `listener` after every change; returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }

  /**
   * The note a link's target names, from the note at `from`: the note at
   * that path, as Obsidian finds files, or else the note with that alias.
   */
  resolve(target: string, from: string): NoteId | undefined {
    const trimmed = target.trim();
    if (trimmed === "") return undefined;
    const path = this.#linkIndex().resolve(fileOf(trimmed), from);
    if (path !== undefined) return this.#byPath?.get(path);
    this.#aliases ??= this.#aliasMap();
    return this.#aliases.get(trimmed.toLowerCase());
  }

  #linkIndex(): LinkIndex {
    if (this.#paths === undefined || this.#byPath === undefined) {
      const notes = [...this.#notes.values()];
      this.#paths = new LinkIndex(notes.map((note) => note.path));
      this.#byPath = new Map(notes.map((note) => [note.path, note.id]));
    }
    return this.#paths;
  }

  #aliasMap(): Map<string, NoteId> {
    const map = new Map<string, NoteId>();
    for (const note of this.#notes.values()) {
      for (const alias of note.index.aliases) {
        const key = alias.toLowerCase();
        if (!map.has(key)) map.set(key, note.id);
      }
    }
    return map;
  }

  /** The notes that link to a note or embed it, in path order, with each of their links to it. */
  backlinks(id: NoteId): readonly Backlink[] {
    const note = this.#notes.get(id);
    if (note === undefined) return [];
    // Only the notes that write its name or an alias can link to it.
    const sources = new Set<NoteId>();
    for (const name of new Set([nameOf(note.path), ...note.index.aliases.map(nameOf)])) {
      for (const source of sourceList(this.#writers.get(name))) sources.add(source);
    }
    sources.delete(id);
    const found: { path: string; backlink: Backlink }[] = [];
    for (const source of sources) {
      const from = this.#notes.get(source);
      if (from === undefined) continue;
      const links = from.index.links.filter(
        (link) => link.target !== "" && this.resolve(link.target, from.path) === id,
      );
      if (links.length > 0) found.push({ path: from.path, backlink: { source, links } });
    }
    return found.sort((a, b) => a.path.localeCompare(b.path)).map(({ backlink }) => backlink);
  }

  /** The vault's tags, each with how many notes have it or one under it, as `area` counts `area/project`. */
  tags(): readonly TagCount[] {
    const counts = new Map<string, { tag: string; notes: Set<NoteId> }>();
    for (const note of this.#notes.values()) {
      for (const tag of note.index.tags) {
        const parts = tag.split("/");
        for (let depth = 1; depth <= parts.length; depth++) {
          const name = parts.slice(0, depth).join("/");
          const key = name.toLowerCase();
          let entry = counts.get(key);
          if (entry === undefined) {
            entry = { tag: name, notes: new Set() };
            counts.set(key, entry);
          }
          entry.notes.add(note.id);
        }
      }
    }
    return [...counts.values()]
      .map(({ tag, notes }) => ({ tag, count: notes.size }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  /** The notes with a tag, or a tag under it, in path order. */
  notesWithTag(tag: string): readonly NoteId[] {
    const key = tag.replace(/^#/, "").toLowerCase();
    return [...this.#notes.values()]
      .filter((note) =>
        note.index.tags.some((own) => {
          const lower = own.toLowerCase();
          return lower === key || lower.startsWith(`${key}/`);
        }),
      )
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((note) => note.id);
  }
}
