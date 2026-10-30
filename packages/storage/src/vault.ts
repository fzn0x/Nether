// A vault as a client sees it: its files, the index that remembers them,
// and the changes other apps make. Opening a vault loads the index, then
// lists the folder and brings the index up to date by size and modification
// time, reading no file (ADR 0003). The watch keeps it so while it is open.
import { type NoteId, newNoteId } from "@nether/core";
import {
  type FileEvent,
  type FileInfo,
  type FileText,
  type VaultFiles,
  isInside,
  isNotePath,
  noteTitle,
} from "./files.ts";
import { LinkIndex } from "./links.ts";
import type { FileRecord, IndexChange, IndexStore } from "./store.ts";

/** A note in the vault. */
export interface NoteEntry {
  readonly id: NoteId;
  readonly path: string;
  readonly title: string;
  readonly size: number;
  readonly modified: number;
}

export interface VaultOptions {
  /** Makes the ID of a note seen for the first time; a UUID version 7 by default. */
  readonly newId?: () => NoteId;
}

/** Sorts as a file explorer does: case aside, and numbers by their value. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function hidden(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function moved(record: FileRecord, path: string, info?: FileInfo): FileRecord {
  return {
    path,
    ...(record.note === undefined ? {} : { note: record.note }),
    size: info?.size ?? record.size,
    modified: info?.modified ?? record.modified,
    ...(record.hash === undefined || info !== undefined ? {} : { hash: record.hash }),
  };
}

export class Vault {
  readonly #files: VaultFiles;
  readonly #store: IndexStore;
  readonly #newId: () => NoteId;
  readonly #records = new Map<string, FileRecord>();
  readonly #paths = new Map<NoteId, string>();
  readonly #listeners = new Set<() => void>();
  #notes: NoteEntry[] | undefined;
  #links: LinkIndex | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(files: VaultFiles, store: IndexStore, options: VaultOptions = {}) {
    this.#files = files;
    this.#store = store;
    this.#newId = options.newId ?? newNoteId;
  }

  /** Loads the index, then brings it up to date with the folder. */
  async open(): Promise<void> {
    for (const record of await this.#store.files()) this.#remember(record);
    await this.reconcile("");
  }

  /** The vault's notes, sorted by path as a file explorer sorts them. */
  notes(): readonly NoteEntry[] {
    this.#notes ??= [...this.#records.values()]
      .flatMap((record) =>
        record.note === undefined
          ? []
          : [
              {
                id: record.note,
                path: record.path,
                title: noteTitle(record.path),
                size: record.size,
                modified: record.modified,
              },
            ],
      )
      .sort((a, b) => collator.compare(a.path, b.path) || (a.path < b.path ? -1 : 1));
    return this.#notes;
  }

  /** The note with an ID, if the vault has it. */
  note(id: NoteId): NoteEntry | undefined {
    const path = this.#paths.get(id);
    const record = path === undefined ? undefined : this.#records.get(path);
    if (record?.note === undefined) return undefined;
    return {
      id: record.note,
      path: record.path,
      title: noteTitle(record.path),
      size: record.size,
      modified: record.modified,
    };
  }

  /** The note at a path, if there is one. */
  noteAt(path: string): NoteEntry | undefined {
    const note = this.#records.get(path)?.note;
    return note === undefined ? undefined : this.note(note);
  }

  /**
   * The path of the file a link names from the note at `from`, as Obsidian
   * finds it: an embed's `![[photo.png]]` or an image's `![](photo.png)`.
   */
  resolveFile(link: string, from: string): string | undefined {
    return this.#linkIndex().resolve(link, from);
  }

  /** The shortest link to the file at `path` from the note at `from`. */
  linkTo(path: string, from: string): string {
    return this.#linkIndex().linkTo(path, from);
  }

  #linkIndex(): LinkIndex {
    this.#links ??= new LinkIndex(this.#records.keys());
    return this.#links;
  }

  /** Calls `listener` after every change to the vault's notes; returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Runs one of the vault's own changes after the changes the watch reported
   * before it, and before those it reports meanwhile: the watch sees the
   * vault's own writes too, and must find them already in the index.
   */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Reads a note's text, remembering its hash for the next write. */
  read(id: NoteId): Promise<FileText> {
    return this.#serial(() => this.#read(id));
  }

  async #read(id: NoteId): Promise<FileText> {
    const path = this.#need(id);
    const text = await this.#files.read(path);
    const record = this.#records.get(path);
    if (
      record !== undefined &&
      text.missing !== true &&
      (record.hash !== text.hash || record.size !== text.size || record.modified !== text.modified)
    ) {
      await this.#commit({ upsert: [{ ...moved(record, path, text), hash: text.hash }] });
    }
    return text;
  }

  /**
   * Writes a note's text. `base` is the hash of the text the caller last
   * read or wrote; if the file changed since, it throws `ChangedOnDisk`.
   */
  write(id: NoteId, text: string, base: string): Promise<FileText> {
    return this.#serial(() => this.#write(id, text, base));
  }

  async #write(id: NoteId, text: string, base: string): Promise<FileText> {
    const path = this.#need(id);
    const written = await this.#files.write(path, text, base);
    const record = this.#records.get(path);
    if (record !== undefined) {
      await this.#commit({ upsert: [{ ...moved(record, path, written), hash: written.hash }] });
    }
    return written;
  }

  /** Creates a note with its text at a path where no file is. */
  create(path: string, text: string): Promise<NoteEntry> {
    return this.#serial(() => this.#create(path, text));
  }

  async #create(path: string, text: string): Promise<NoteEntry> {
    if (!isNotePath(path)) throw new Error(`${path} is not a Markdown file.`);
    const written = await this.#files.write(path, text, "");
    const id = this.#records.get(path)?.note ?? this.#newId();
    await this.#commit({
      upsert: [
        { path, note: id, size: written.size, modified: written.modified, hash: written.hash },
      ],
    });
    return this.note(id) ?? this.#fail(path);
  }

  /**
   * Adds a file that is not a note, such as an image pasted into one, at
   * `path` or the first free name like it, and returns where it went.
   */
  attach(path: string, data: Uint8Array): Promise<string> {
    return this.#serial(async () => {
      if (isNotePath(path)) throw new Error(`${path} is a Markdown file, not an attachment.`);
      const added = await this.#files.attach(path, data);
      await this.#commit({
        upsert: [{ path: added.path, size: added.size, modified: added.modified }],
      });
      return added.path;
    });
  }

  /** Moves a note to a new path; it keeps its ID. */
  rename(id: NoteId, path: string): Promise<NoteEntry> {
    return this.#serial(() => this.#rename(id, path));
  }

  async #rename(id: NoteId, path: string): Promise<NoteEntry> {
    const from = this.#need(id);
    const info = await this.#files.rename(from, path);
    const record = this.#records.get(from);
    if (record !== undefined) {
      await this.#commit({
        remove: [from],
        upsert: [
          {
            ...moved(record, path, info),
            ...(record.hash === undefined ? {} : { hash: record.hash }),
          },
        ],
      });
    }
    return this.note(id) ?? this.#fail(path);
  }

  /** Moves a note to the vault's trash and returns where it went. */
  remove(id: NoteId): Promise<string> {
    return this.#serial(() => this.#remove(id));
  }

  async #remove(id: NoteId): Promise<string> {
    const path = this.#need(id);
    const where = await this.#files.remove(path);
    await this.#commit({ remove: [path] });
    return where;
  }

  /** Brings the index in line with the folder, or one folder in it. */
  async reconcile(folder: string): Promise<void> {
    const listed = new Map<string, FileInfo>();
    await this.#files.list(folder, (batch) => {
      for (const file of batch) listed.set(file.path, file);
    });
    const gone: FileRecord[] = [];
    for (const record of this.#records.values()) {
      if (isInside(record.path, folder) && !listed.has(record.path)) gone.push(record);
    }
    const upsert: FileRecord[] = [];
    const added: FileInfo[] = [];
    for (const file of listed.values()) {
      const record = this.#records.get(file.path);
      if (record === undefined) added.push(file);
      else if (record.size !== file.size || record.modified !== file.modified) {
        upsert.push(moved(record, file.path, file));
      }
    }
    const matches = matchMoves(gone, added);
    for (const file of added) {
      const from = matches.get(file.path);
      upsert.push(from === undefined ? this.#fresh(file) : moved(from, file.path, file));
    }
    await this.#commit({ remove: gone.map((record) => record.path), upsert });
  }

  /** Follows the folder's changes until `signal` aborts. */
  watch(signal: AbortSignal): Promise<void> {
    return this.#files.watch((events) => {
      // A batch that fails, as when a file goes away while it is read, is
      // caught up by the next reconcile; the watch goes on.
      this.#serial(() => this.apply(events)).catch(() => undefined);
    }, signal);
  }

  /** Waits for the changes the watch has reported so far to be applied. */
  settled(): Promise<void> {
    return this.#queue;
  }

  /** Applies a batch of changes the watch reported. */
  async apply(events: readonly FileEvent[]): Promise<void> {
    const changed = new Set<string>();
    for (const event of events) {
      if (hidden(event.path)) {
        // A move into a hidden folder, as the trash, is the removal of what moved.
        if (event.op === "rename" && event.oldPath !== undefined) changed.add(event.oldPath);
        continue;
      }
      if (event.op === "rename" && event.oldPath !== undefined && hidden(event.oldPath)) {
        // A move out of one, as a restore from the trash, is a new file.
        if (event.isDir) await this.reconcile(event.path);
        else changed.add(event.path);
        continue;
      }
      if (
        event.op === "rescan" ||
        (event.isDir && event.op !== "remove" && event.op !== "rename")
      ) {
        await this.reconcile(event.path);
        continue;
      }
      if (event.isDir && event.op === "remove") {
        await this.#commit({ remove: this.#inside(event.path).map((record) => record.path) });
        continue;
      }
      if (event.op === "rename" && event.oldPath !== undefined) {
        if (!(await this.#move(event.oldPath, event.path, event.isDir))) changed.add(event.path);
        continue;
      }
      changed.add(event.path);
    }
    if (changed.size === 0) return;
    const paths = [...changed];
    const found = new Map((await this.#files.stat(paths)).map((file) => [file.path, file]));
    const upsert: FileRecord[] = [];
    const remove: string[] = [];
    for (const path of paths) {
      const file = found.get(path);
      const record = this.#records.get(path);
      if (file === undefined) {
        if (record !== undefined) remove.push(path);
      } else if (record === undefined) {
        upsert.push(this.#fresh(file));
      } else if (record.size !== file.size || record.modified !== file.modified) {
        upsert.push(moved(record, path, file));
      }
    }
    // A note that went away as another appeared with the same size and time moved.
    const gone = remove.flatMap((path) => this.#records.get(path) ?? []);
    const added = upsert.filter((record) => !this.#records.has(record.path));
    const matches = matchMoves(gone, added);
    const upserts = upsert.map((record) => {
      const from = matches.get(record.path);
      return from === undefined ? record : moved(from, record.path, record);
    });
    await this.#commit({ remove, upsert: upserts });
  }

  /** Moves the records of a file or folder; returns false for a file the index did not know. */
  async #move(from: string, to: string, isDir: boolean): Promise<boolean> {
    const record = this.#records.get(from);
    const list = isDir ? this.#inside(from) : record === undefined ? [] : [record];
    if (list.length === 0) {
      // Moved from somewhere the index did not know: as if it appeared.
      if (!isDir) return false;
      await this.reconcile(to);
      return true;
    }
    await this.#commit({
      remove: list.map((item) => item.path),
      upsert: list.map((item) => moved(item, to + item.path.slice(from.length))),
    });
    return true;
  }

  #inside(folder: string): FileRecord[] {
    return [...this.#records.values()].filter(
      (record) => record.path === folder || record.path.startsWith(`${folder}/`),
    );
  }

  #fresh(file: FileInfo): FileRecord {
    return {
      path: file.path,
      ...(isNotePath(file.path) ? { note: this.#newId() } : {}),
      size: file.size,
      modified: file.modified,
    };
  }

  #need(id: NoteId): string {
    const path = this.#paths.get(id);
    if (path === undefined) throw new Error(`The vault has no note ${id}.`);
    return path;
  }

  #fail(path: string): never {
    throw new Error(`${path} is not in the index.`);
  }

  #remember(record: FileRecord): void {
    this.#records.set(record.path, record);
    if (record.note !== undefined) this.#paths.set(record.note, record.path);
  }

  async #commit(change: IndexChange): Promise<void> {
    if ((change.remove?.length ?? 0) === 0 && (change.upsert?.length ?? 0) === 0) return;
    await this.#store.apply(change);
    // Links find files by path: an edit that keeps every path keeps the index.
    const moves =
      (change.remove?.length ?? 0) > 0 ||
      (change.upsert ?? []).some((record) => !this.#records.has(record.path));
    if (moves) this.#links = undefined;
    for (const path of change.remove ?? []) {
      const record = this.#records.get(path);
      this.#records.delete(path);
      if (record?.note !== undefined && this.#paths.get(record.note) === path) {
        this.#paths.delete(record.note);
      }
    }
    for (const record of change.upsert ?? []) this.#remember(record);
    this.#notes = undefined;
    for (const listener of this.#listeners) listener();
  }
}

/**
 * Pairs files that went away with files that appeared as the same file
 * moved: same size, same modification time and same kind, preferring the
 * same name. Returns, for each new path, the record it moved from.
 */
export function matchMoves(
  gone: readonly FileRecord[],
  added: readonly FileInfo[],
): Map<string, FileRecord> {
  const key = (file: FileInfo): string =>
    `${String(file.size)}:${String(file.modified)}:${extension(file.path)}`;
  const free = new Map<string, FileInfo[]>();
  for (const file of added) {
    const list = free.get(key(file));
    if (list === undefined) free.set(key(file), [file]);
    else list.push(file);
  }
  const matches = new Map<string, FileRecord>();
  for (const record of gone) {
    const candidates = free.get(key(record));
    if (candidates === undefined || candidates.length === 0) continue;
    const same = candidates.findIndex((file) => baseName(file.path) === baseName(record.path));
    const [pick] = candidates.splice(same === -1 ? 0 : same, 1);
    if (pick !== undefined) matches.set(pick.path, record);
  }
  return matches;
}
