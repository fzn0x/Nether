// The vault's links, held in memory: which note each link names, as
// Obsidian finds it or by an alias, the notes that link to a note, and the
// vault's tags. Changes to one note change only its entry; what depends on
// every note, backlinks and tags, is worked out again when next asked for.
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

export class LinkGraph {
  readonly #notes = new Map<NoteId, GraphNote>();
  #paths: LinkIndex | undefined;
  #byPath: Map<string, NoteId> | undefined;
  #aliases: Map<string, NoteId> | undefined;
  #backlinks: Map<NoteId, Backlink[]> | undefined;
  readonly #listeners = new Set<() => void>();

  /** Sets what the graph holds of a note, at the path it has now. */
  set(id: NoteId, path: string, index: NoteIndex): void {
    const before = this.#notes.get(id);
    this.#notes.set(id, { id, path, title: titleOf(path), index });
    if (before?.path !== path) {
      this.#paths = undefined;
      this.#byPath = undefined;
    }
    if (before?.index.aliases.join("|") !== index.aliases.join("|")) {
      this.#aliases = undefined;
    }
    this.#backlinks = undefined;
    this.#changed();
  }

  /** Forgets a note that left the vault. */
  remove(id: NoteId): void {
    if (!this.#notes.delete(id)) return;
    this.#paths = undefined;
    this.#byPath = undefined;
    this.#aliases = undefined;
    this.#backlinks = undefined;
    this.#changed();
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
    this.#paths ??= new LinkIndex([...this.#notes.values()].map((note) => note.path));
    this.#byPath ??= new Map([...this.#notes.values()].map((note) => [note.path, note.id]));
    const file = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
    const path = this.#paths.resolve(file, from);
    if (path !== undefined) return this.#byPath.get(path);
    this.#aliases ??= this.#aliasMap();
    return this.#aliases.get(trimmed.toLowerCase());
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
    if (this.#backlinks === undefined) {
      const incoming = new Map<NoteId, Map<NoteId, LinkRef[]>>();
      for (const source of this.#notes.values()) {
        for (const link of source.index.links) {
          const target = link.target === "" ? source.id : this.resolve(link.target, source.path);
          if (target === undefined || target === source.id) continue;
          let sources = incoming.get(target);
          if (sources === undefined) {
            sources = new Map();
            incoming.set(target, sources);
          }
          const list = sources.get(source.id);
          if (list === undefined) sources.set(source.id, [link]);
          else list.push(link);
        }
      }
      const pathOf = (note: NoteId) => this.#notes.get(note)?.path ?? "";
      this.#backlinks = new Map(
        [...incoming].map(([target, sources]) => [
          target,
          [...sources]
            .map(([source, links]) => ({ source, links }))
            .sort((a, b) => pathOf(a.source).localeCompare(pathOf(b.source))),
        ]),
      );
    }
    return this.#backlinks.get(id) ?? [];
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
