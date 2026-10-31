// A vault folder in the browser's origin private file system (OPFS), as the
// web app keeps each workspace (ADR 0053). It behaves as the desktop's Go
// service and MemoryFiles do: writes checked against a base hash and made in
// one step, a trash folder, hidden files left out of lists, and batches of
// change events. Nothing else writes to the folder, so the watch reports
// this folder's own changes; the web app opens a workspace in one tab.
import {
  ChangedOnDisk,
  type FileBytes,
  type FileEvent,
  type FileHash,
  type FileInfo,
  type FileText,
  type VaultFiles,
} from "./files.ts";
import { sha256 } from "./memory.ts";

/** What the store uses of a file in OPFS, a `FileSystemFileHandle`. */
export interface OpfsFile {
  readonly kind: "file";
  getFile(): Promise<{
    readonly size: number;
    readonly lastModified: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  /** Writes to a copy, which replaces the file when closed, so a write is whole or not at all. */
  createWritable(): Promise<{
    write(data: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

/** What the store uses of a folder in OPFS, a `FileSystemDirectoryHandle`. */
export interface OpfsDirectory {
  readonly kind: "directory";
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFile>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, OpfsDirectory | OpfsFile]>;
}

/** How many files `list` hands over at a time. */
const batch = 500;

// Fails on bytes that are not UTF-8, and keeps a byte order mark, so text
// read back is the same bytes.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function checkPath(path: string): readonly string[] {
  const parts = path.split("/");
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`"${path}" is not a path in the vault.`);
  }
  return parts;
}

function hiddenPath(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "NotFoundError" || error.name === "TypeMismatchError")
  );
}

/** `name 1.png`, `name 2.png` and so on, for a path that is taken. */
function numbered(path: string, n: number): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  return `${stem} ${String(n)}${ext}`;
}

export class OpfsFiles implements VaultFiles {
  readonly #root: OpfsDirectory;
  readonly #listeners = new Set<(events: readonly FileEvent[]) => void>();
  /** Changes run one at a time, so a write's check and its write see the same file. */
  #queue: Promise<unknown> = Promise.resolve();

  /** The vault in `root`, a folder of the origin's private file system. */
  constructor(root: OpfsDirectory) {
    this.#root = root;
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #emit(events: readonly FileEvent[]): void {
    for (const listener of this.#listeners) listener(events);
  }

  /** The folder at `parts`; undefined when it is not there, unless `create`. */
  async #folder(parts: readonly string[], create = false): Promise<OpfsDirectory | undefined> {
    let folder = this.#root;
    for (const part of parts) {
      try {
        folder = await folder.getDirectoryHandle(part, { create });
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    }
    return folder;
  }

  /** The file at `path`; undefined when it is not there. */
  async #file(path: string): Promise<OpfsFile | undefined> {
    const parts = checkPath(path);
    const folder = await this.#folder(parts.slice(0, -1));
    if (folder === undefined) return undefined;
    try {
      return await folder.getFileHandle(parts.at(-1) ?? "");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async #bytes(path: string): Promise<{ info: FileInfo; bytes: Uint8Array } | undefined> {
    const handle = await this.#file(path);
    if (handle === undefined) return undefined;
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { info: { path, size: file.size, modified: file.lastModified }, bytes };
  }

  /** Writes a file's bytes in one step, making its folders; gives the file as it is then. */
  async #put(path: string, data: Uint8Array): Promise<FileInfo> {
    const parts = checkPath(path);
    const folder = await this.#folder(parts.slice(0, -1), true);
    if (folder === undefined) throw new Error(`${path}: its folder could not be made.`);
    const handle = await folder.getFileHandle(parts.at(-1) ?? "", { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data.slice());
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    const file = await handle.getFile();
    return { path, size: file.size, modified: file.lastModified };
  }

  async #delete(path: string): Promise<void> {
    const parts = checkPath(path);
    const folder = await this.#folder(parts.slice(0, -1));
    if (folder === undefined) throw new Error(`${path} is not there.`);
    await folder.removeEntry(parts.at(-1) ?? "");
  }

  /** Each file below `folder`, its path from the vault, hidden ones below it left out. */
  async *#walk(folder: OpfsDirectory, prefix: string): AsyncGenerator<[string, OpfsFile]> {
    for await (const [name, entry] of folder.entries()) {
      if (name.startsWith(".")) continue;
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (entry.kind === "directory") yield* this.#walk(entry, path);
      else yield [path, entry];
    }
  }

  async list(folder: string, each: (files: readonly FileInfo[]) => void): Promise<void> {
    const start = await this.#folder(folder === "" ? [] : checkPath(folder));
    if (start === undefined) return;
    let files: FileInfo[] = [];
    for await (const [path, handle] of this.#walk(start, folder)) {
      const file = await handle.getFile();
      files.push({ path, size: file.size, modified: file.lastModified });
      if (files.length === batch) {
        each(files);
        files = [];
      }
    }
    if (files.length > 0) each(files);
  }

  async stat(paths: readonly string[]): Promise<readonly FileInfo[]> {
    const found: FileInfo[] = [];
    for (const path of paths) {
      const handle = await this.#file(path);
      if (handle === undefined) continue;
      const file = await handle.getFile();
      found.push({ path, size: file.size, modified: file.lastModified });
    }
    return found;
  }

  async read(path: string): Promise<FileText> {
    const found = await this.#bytes(path);
    if (found === undefined)
      return { path, size: 0, modified: 0, text: "", hash: "", missing: true };
    const hash = await sha256(found.bytes);
    try {
      return { ...found.info, text: decoder.decode(found.bytes), hash };
    } catch {
      return { ...found.info, text: "", hash, binary: true };
    }
  }

  /**
   * A file as the browser keeps it, a `File` there, which reads from the
   * disk only when read, as a URL made of it does; undefined when it is not
   * there. A later write leaves it unreadable: ask again after one.
   */
  async file(path: string): Promise<Awaited<ReturnType<OpfsFile["getFile"]>> | undefined> {
    return (await this.#file(path))?.getFile();
  }

  async readMany(paths: readonly string[], each: (file: FileText) => void): Promise<void> {
    for (const path of paths) each(await this.read(path));
  }

  async #checkBase(path: string, base: string): Promise<boolean> {
    const current = await this.#bytes(path);
    if (base === "" && current !== undefined) throw new Error(`${path}: a file is already there.`);
    if (base !== "" && (current === undefined || (await sha256(current.bytes)) !== base)) {
      throw new ChangedOnDisk(path);
    }
    return current === undefined;
  }

  write(path: string, text: string, base: string): Promise<FileText> {
    return this.#serial(async () => {
      const created = await this.#checkBase(path, base);
      const data = encoder.encode(text);
      const info = await this.#put(path, data);
      this.#emit([{ op: created ? "create" : "write", path, isDir: false }]);
      return { ...info, text, hash: await sha256(data) };
    });
  }

  async readBytes(path: string): Promise<FileBytes> {
    const found = await this.#bytes(path);
    if (found === undefined) throw new Error(`${path} is not there.`);
    return { ...found.info, bytes: found.bytes, hash: await sha256(found.bytes) };
  }

  writeBytes(path: string, data: Uint8Array, base: string): Promise<FileHash> {
    return this.#serial(async () => {
      const created = await this.#checkBase(path, base);
      const info = await this.#put(path, data);
      this.#emit([{ op: created ? "create" : "write", path, isDir: false }]);
      return { ...info, hash: await sha256(data) };
    });
  }

  rename(from: string, to: string): Promise<FileInfo> {
    checkPath(from);
    checkPath(to);
    return this.#serial(async () => {
      const found = await this.#bytes(from);
      if (found === undefined) throw new Error(`${from} is not there.`);
      if (from === to) return found.info;
      // Only the case of a name changing is a move onto itself, which OPFS,
      // telling cases apart, makes as any other.
      if ((await this.#file(to)) !== undefined) throw new Error(`${to}: a file is already there.`);
      const info = await this.#put(to, found.bytes);
      await this.#delete(from);
      this.#emit([{ op: "rename", path: to, oldPath: from, isDir: false }]);
      return info;
    });
  }

  attach(path: string, data: Uint8Array): Promise<FileInfo> {
    checkPath(path);
    return this.#serial(async () => {
      let target = path;
      for (let n = 1; (await this.#file(target)) !== undefined; n++) {
        target = numbered(path, n);
      }
      const info = await this.#put(target, data);
      this.#emit([{ op: "create", path: target, isDir: false }]);
      return info;
    });
  }

  remove(path: string): Promise<string> {
    checkPath(path);
    return this.#serial(async () => {
      const found = await this.#bytes(path);
      if (found === undefined) throw new Error(`${path} is not there.`);
      const name = path.slice(path.lastIndexOf("/") + 1);
      let target = `.trash/${name}`;
      for (let n = 2; (await this.#file(target)) !== undefined; n++) {
        target = `.trash/${numbered(name, n)}`;
      }
      await this.#put(target, found.bytes);
      await this.#delete(path);
      this.#emit([{ op: "remove", path, isDir: false }]);
      return target;
    });
  }

  erase(path: string): Promise<void> {
    checkPath(path);
    if (!path.startsWith(".trash/"))
      return Promise.reject(new Error(`${path} is not in the trash.`));
    return this.#serial(async () => {
      if ((await this.#file(path)) === undefined) throw new Error(`${path} is not there.`);
      await this.#delete(path);
    });
  }

  async #folderPaths(folder: OpfsDirectory, prefix: string, into: string[]): Promise<void> {
    for await (const [name, entry] of folder.entries()) {
      if (name.startsWith(".") || entry.kind !== "directory") continue;
      const path = prefix === "" ? name : `${prefix}/${name}`;
      into.push(path);
      await this.#folderPaths(entry, path, into);
    }
  }

  async folders(folder: string): Promise<readonly string[]> {
    const start = await this.#folder(folder === "" ? [] : checkPath(folder));
    const found: string[] = [];
    if (start !== undefined) await this.#folderPaths(start, folder, found);
    return found;
  }

  makeFolder(path: string): Promise<void> {
    const parts = checkPath(path);
    if (hiddenPath(path)) return Promise.reject(new Error(`"${path}" has a hidden name.`));
    return this.#serial(async () => {
      const parent = await this.#folder(parts.slice(0, -1));
      const name = parts.at(-1) ?? "";
      if (parent !== undefined) {
        for await (const [taken] of parent.entries()) {
          if (taken === name) throw new Error(`${path}: a file is already there.`);
        }
      }
      await this.#folder(parts, true);
    });
  }

  removeFolder(path: string): Promise<void> {
    const parts = checkPath(path);
    return this.#serial(async () => {
      const folder = await this.#folder(parts);
      if (folder === undefined) throw new Error(`${path} is not a folder.`);
      // Hidden files count too: they would go with the folder.
      const first = await folder.entries()[Symbol.asyncIterator]().next();
      if (first.done !== true) throw new Error(`"${path}" is not empty.`);
      const parent = await this.#folder(parts.slice(0, -1));
      await parent?.removeEntry(parts.at(-1) ?? "");
    });
  }

  watch(each: (events: readonly FileEvent[]) => void, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    this.#listeners.add(each);
    return new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        this.#listeners.delete(each);
        resolve();
      });
    });
  }
}
