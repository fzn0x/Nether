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
import {
  type TrashItem,
  type TrashRecord,
  isKeepDays,
  numberedPath,
  readTrashRecord,
  trashFolder,
} from "./trash.ts";

/** A note in the vault. */
export interface NoteEntry {
  readonly id: NoteId;
  readonly path: string;
  readonly title: string;
  readonly size: number;
  readonly modified: number;
}

/** Where a vault keeps its notes' Yjs documents: the part of its index that holds them. */
export type NoteDocuments = Pick<
  IndexStore,
  "document" | "appendUpdates" | "compact" | "setFileHash"
>;

/** Where a vault keeps what the link index and search read of its notes. */
export type NoteIndexes = Pick<
  IndexStore,
  | "noteIndexes"
  | "putNoteIndexes"
  | "deleteNoteIndexes"
  | "putNoteTexts"
  | "deleteNoteTexts"
  | "searchText"
>;

export interface VaultOptions {
  /** Makes the ID of a note seen for the first time; a UUID version 7 by default. */
  readonly newId?: () => NoteId;
  /** The time, in milliseconds since 1970, as the trash records it; the system's by default. */
  readonly now?: () => number;
}

const dayLength = 86_400_000;

/** Where the vault records its trash, in `.nether`. */
const trashData = "trash";

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
  readonly #now: () => number;
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
    this.#now = options.now ?? Date.now;
  }

  /** Where the vault keeps its notes' documents. */
  get documents(): NoteDocuments {
    return this.#store;
  }

  /**
   * A JSON file of the vault's own, `.nether/<name>.json`, such as its
   * property types: undefined when there is none or it cannot be read.
   */
  readData(name: string): Promise<unknown> {
    return this.#readJson(`.nether/${name}.json`);
  }

  /**
   * A JSON file of Obsidian's settings for the vault, from its `.obsidian`
   * folder, such as `daily-notes`, so a vault moved from Obsidian keeps
   * them; nothing when it is missing or does not read as JSON.
   */
  readObsidianData(name: string): Promise<unknown> {
    return this.#readJson(`.obsidian/${name}.json`);
  }

  async #readJson(path: string): Promise<unknown> {
    const file = await this.#files.read(path);
    if (file.missing === true || file.binary === true) return undefined;
    try {
      return JSON.parse(file.text) as unknown;
    } catch {
      return undefined;
    }
  }

  /** Replaces a JSON file of the vault's own, in one step. */
  async writeData(name: string, value: unknown): Promise<void> {
    const path = `.nether/${name}.json`;
    const current = await this.#files.read(path);
    await this.#files.write(
      path,
      `${JSON.stringify(value, null, 2)}\n`,
      current.missing === true ? "" : current.hash,
    );
  }

  /** Where the vault keeps what the link index and search read of its notes. */
  get indexes(): NoteIndexes {
    return this.#store;
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

  /** The paths of every file the vault holds, notes and others, sorted as a file explorer sorts them. */
  files(): readonly string[] {
    return [...this.#records.keys()].sort((a, b) => collator.compare(a, b));
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
   * Reads many notes' files, calling `each` with each note's ID and file;
   * for the link index and search, which keep what they read themselves.
   */
  async readNotes(
    ids: readonly NoteId[],
    each: (id: NoteId, file: FileText) => void,
  ): Promise<void> {
    const byPath = new Map<string, NoteId>();
    for (const id of ids) {
      const path = this.#paths.get(id);
      if (path !== undefined) byPath.set(path, id);
    }
    await this.#files.readMany([...byPath.keys()], (file) => {
      const id = byPath.get(file.path);
      if (id !== undefined) each(id, file);
    });
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
    await this.#moveFile(this.#need(id), path);
    return this.note(id) ?? this.#fail(path);
  }

  /**
   * Moves a file of any kind, as an image moving with its folder, making the
   * folders it needs; a note keeps its ID. It throws if a file is there.
   */
  moveFile(from: string, to: string): Promise<void> {
    return this.#serial(() => this.#moveFile(from, to));
  }

  async #moveFile(from: string, to: string): Promise<void> {
    const info = await this.#files.rename(from, to);
    const record = this.#records.get(from);
    if (record === undefined) return;
    await this.#commit({
      remove: [from],
      upsert: [
        {
          ...moved(record, to, info),
          ...(record.hash === undefined ? {} : { hash: record.hash }),
        },
      ],
    });
  }

  /** Moves a note to the vault's trash, recording where it was, and returns where it went. */
  remove(id: NoteId): Promise<string> {
    return this.#serial(() => this.#remove(id));
  }

  async #remove(id: NoteId): Promise<string> {
    const path = this.#need(id);
    const where = await this.#files.remove(path);
    await this.#commit({ remove: [path] });
    const record = readTrashRecord(await this.readData(trashData));
    await this.writeData(trashData, {
      ...record,
      items: [
        ...record.items.filter((item) => item.path !== where),
        { path: where, from: path, deleted: this.#now(), note: id },
      ],
    });
    return where;
  }

  /**
   * The files in the vault's trash, the latest first. A file another app
   * put there is recorded as gone when the vault first finds it.
   */
  trash(): Promise<readonly TrashItem[]> {
    return this.#serial(async () =>
      [...(await this.#trashRecord()).items].sort((a, b) => b.deleted - a.deleted),
    );
  }

  /**
   * Puts a file in the trash back where it was, or beside it under a free
   * name when a file is there now, and returns where it went. A note is the
   * same note again, with its ID and its document.
   */
  restore(path: string): Promise<string> {
    return this.#serial(async () => {
      const record = await this.#trashRecord();
      const item = record.items.find((entry) => entry.path === path);
      if (item === undefined) throw new Error(`${path} is not in the trash.`);
      const target = await this.#freePath(item.from);
      const info = await this.#files.rename(path, target);
      const note = isNotePath(target)
        ? item.note !== undefined && !this.#paths.has(item.note)
          ? item.note
          : this.#newId()
        : undefined;
      await this.#commit({
        upsert: [
          {
            path: target,
            ...(note === undefined ? {} : { note }),
            size: info.size,
            modified: info.modified,
          },
        ],
      });
      await this.writeData(trashData, {
        ...record,
        items: record.items.filter((entry) => entry !== item),
      });
      return target;
    });
  }

  /** Deletes a file in the trash for good, and the document of the note it was. */
  erase(path: string): Promise<void> {
    return this.#serial(async () => {
      const record = await this.#trashRecord();
      const item = record.items.find((entry) => entry.path === path);
      if (item === undefined) throw new Error(`${path} is not in the trash.`);
      await this.#erase(record, [item]);
    });
  }

  /**
   * Deletes for good every file in the trash, or those that went there
   * before a time, in milliseconds since 1970; returns how many.
   */
  emptyTrash(before?: number): Promise<number> {
    return this.#serial(async () => {
      const record = await this.#trashRecord();
      const items = record.items.filter((item) => before === undefined || item.deleted < before);
      await this.#erase(record, items);
      return items.length;
    });
  }

  /** Deletes for good what has been in the trash longer than the vault keeps it; returns how many. */
  async purgeTrash(): Promise<number> {
    const days = await this.trashDays();
    return this.emptyTrash(this.#now() - days * dayLength);
  }

  /** How many days a file stays in the trash before it is deleted for good: 30 unless set. */
  async trashDays(): Promise<number> {
    return readTrashRecord(await this.readData(trashData)).keepDays;
  }

  /** Sets how many days a file stays in the trash, a whole number from 1. */
  setTrashDays(days: number): Promise<void> {
    if (!isKeepDays(days)) {
      return Promise.reject(
        new Error(`${String(days)} is not a number of days to keep the trash.`),
      );
    }
    return this.#serial(async () => {
      const record = readTrashRecord(await this.readData(trashData));
      await this.writeData(trashData, { ...record, keepDays: days });
    });
  }

  /** The trash's record, brought in line with the files the trash holds. */
  async #trashRecord(): Promise<TrashRecord> {
    const record = readTrashRecord(await this.readData(trashData));
    const files: FileInfo[] = [];
    await this.#files.list(trashFolder, (batch) => {
      files.push(...batch);
    });
    const known = new Map(record.items.map((item) => [item.path, item]));
    const items = files.map(
      (file): TrashItem =>
        known.get(file.path) ?? {
          path: file.path,
          from: file.path.slice(trashFolder.length + 1),
          deleted: this.#now(),
        },
    );
    const next = { ...record, items };
    if (items.length !== record.items.length || items.some((item) => !known.has(item.path))) {
      await this.writeData(trashData, next);
    }
    return next;
  }

  async #erase(record: TrashRecord, items: readonly TrashItem[]): Promise<void> {
    const gone = new Set<TrashItem>();
    try {
      for (const item of items) {
        await this.#files.erase(item.path);
        gone.add(item);
        // A note restored from another copy keeps its document.
        if (item.note !== undefined && !this.#paths.has(item.note)) {
          await this.#store.deleteDocument(item.note);
        }
      }
    } finally {
      if (gone.size > 0) {
        await this.writeData(trashData, {
          ...record,
          items: record.items.filter((item) => !gone.has(item)),
        });
      }
    }
  }

  /** The path itself when nothing is there, else the first free one like it, `name 2.md` and on. */
  async #freePath(path: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = numberedPath(path, n);
      if (this.#records.has(candidate)) continue;
      if ((await this.#files.stat([candidate])).length === 0) return candidate;
    }
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
    const before = this.#notes;
    for (const record of change.upsert ?? []) this.#remember(record);
    // A change that moves nothing, as a save, changes the notes in place,
    // which keeps their order: sorting 50,000 notes again took 80 ms.
    this.#notes = moves || before === undefined ? undefined : this.#updated(before, change);
    for (const listener of this.#listeners) listener();
  }

  /** The list of notes with the notes a change updated, each where it was. */
  #updated(notes: readonly NoteEntry[], change: IndexChange): NoteEntry[] | undefined {
    const changed = new Map<NoteId, FileRecord>();
    for (const record of change.upsert ?? []) {
      if (record.note !== undefined) changed.set(record.note, record);
    }
    let found = 0;
    const next = notes.map((note) => {
      const record = changed.get(note.id);
      if (record === undefined) return note;
      found++;
      return { ...note, size: record.size, modified: record.modified };
    });
    // A note new to the list, as a file that becomes a note, takes the list made anew.
    return found === changed.size ? next : undefined;
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
