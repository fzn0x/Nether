// A vault folder kept in memory: the browser preview shows one, and tests use
// it to stand in for the disk. It behaves as the desktop's Go service does:
// atomic writes checked against a base hash, a trash folder, hidden files
// left out of lists, and batches of change events.
import {
  ChangedOnDisk,
  type FileEvent,
  type FileInfo,
  type FileText,
  type VaultFiles,
  isInside,
} from "./files.ts";

interface Entry {
  text: string;
  /** The bytes of a file that is not text, such as an image. */
  bytes?: Uint8Array;
  modified: number;
}

const encoder = new TextEncoder();

/** The SHA-256 hash of a text's UTF-8 bytes, in hexadecimal. */
export async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hiddenPath(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

function checkPath(path: string): void {
  const parts = path.split("/");
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`"${path}" is not a path in the vault.`);
  }
}

export class MemoryFiles implements VaultFiles {
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<(events: readonly FileEvent[]) => void>();
  #clock: number;

  /** A folder holding the given files, with modification times from `now`. */
  constructor(files: Readonly<Record<string, string>> = {}, now = Date.now()) {
    this.#clock = now;
    for (const [path, text] of Object.entries(files)) {
      checkPath(path);
      this.#entries.set(path, { text, modified: this.#clock });
    }
  }

  #tick(): number {
    this.#clock += 1;
    return this.#clock;
  }

  #info(path: string, entry: Entry): FileInfo {
    const size = entry.bytes?.length ?? encoder.encode(entry.text).length;
    return { path, size, modified: entry.modified };
  }

  #emit(events: readonly FileEvent[]): void {
    for (const listener of this.#listeners) listener(events);
  }

  list(folder: string, each: (files: readonly FileInfo[]) => void): Promise<void> {
    const files = [...this.#entries]
      .filter(([path]) => !hiddenPath(path) && isInside(path, folder) && path !== folder)
      .map(([path, entry]) => this.#info(path, entry));
    if (files.length > 0) each(files);
    return Promise.resolve();
  }

  stat(paths: readonly string[]): Promise<readonly FileInfo[]> {
    return Promise.resolve(
      paths.flatMap((path) => {
        checkPath(path);
        const entry = this.#entries.get(path);
        return entry === undefined ? [] : [this.#info(path, entry)];
      }),
    );
  }

  async read(path: string): Promise<FileText> {
    checkPath(path);
    const entry = this.#entries.get(path);
    if (entry === undefined)
      return { path, size: 0, modified: 0, text: "", hash: "", missing: true };
    if (entry.bytes !== undefined) {
      return { ...this.#info(path, entry), text: "", hash: "", binary: true };
    }
    return { ...this.#info(path, entry), text: entry.text, hash: await sha256(entry.text) };
  }

  async readMany(paths: readonly string[], each: (file: FileText) => void): Promise<void> {
    for (const path of paths) each(await this.read(path));
  }

  async write(path: string, text: string, base: string): Promise<FileText> {
    checkPath(path);
    const current = await this.read(path);
    if (base === "" && current.missing !== true)
      throw new Error(`${path}: a file is already there.`);
    if (base !== "" && (current.missing === true || current.hash !== base)) {
      throw new ChangedOnDisk(path);
    }
    this.#entries.set(path, { text, modified: this.#tick() });
    this.#emit([{ op: current.missing === true ? "create" : "write", path, isDir: false }]);
    return this.read(path);
  }

  rename(from: string, to: string): Promise<FileInfo> {
    checkPath(from);
    checkPath(to);
    const entry = this.#entries.get(from);
    if (entry === undefined) return Promise.reject(new Error(`${from} is not there.`));
    if (this.#entries.has(to) && from.toLowerCase() !== to.toLowerCase()) {
      return Promise.reject(new Error(`${to}: a file is already there.`));
    }
    this.#entries.delete(from);
    this.#entries.set(to, entry);
    this.#emit([{ op: "rename", path: to, oldPath: from, isDir: false }]);
    return Promise.resolve(this.#info(to, entry));
  }

  attach(path: string, data: Uint8Array): Promise<FileInfo> {
    checkPath(path);
    const slash = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    const [stem, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
    let target = path;
    for (let n = 1; this.#entries.has(target); n++) target = `${stem} ${String(n)}${ext}`;
    const entry = { text: "", bytes: data.slice(), modified: this.#tick() };
    this.#entries.set(target, entry);
    this.#emit([{ op: "create", path: target, isDir: false }]);
    return Promise.resolve(this.#info(target, entry));
  }

  /** A file's bytes, text or not, as the page loads them: the browser preview shows images so. */
  bytes(path: string): Uint8Array<ArrayBuffer> | undefined {
    const entry = this.#entries.get(path);
    if (entry === undefined) return undefined;
    return entry.bytes?.slice() ?? encoder.encode(entry.text);
  }

  remove(path: string): Promise<string> {
    checkPath(path);
    const entry = this.#entries.get(path);
    if (entry === undefined) return Promise.reject(new Error(`${path} is not there.`));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let target = `.trash/${name}`;
    for (let n = 2; this.#entries.has(target); n++) target = `.trash/${stem} ${String(n)}${ext}`;
    this.#entries.delete(path);
    this.#entries.set(target, entry);
    this.#emit([{ op: "remove", path, isDir: false }]);
    return Promise.resolve(target);
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

  /** Changes a file as another app would, and reports it as the watch does. */
  edit(path: string, text: string | undefined): void {
    checkPath(path);
    const existed = this.#entries.has(path);
    if (text === undefined) {
      this.#entries.delete(path);
      if (existed) this.#emit([{ op: "remove", path, isDir: false }]);
      return;
    }
    this.#entries.set(path, { text, modified: this.#tick() });
    if (!hiddenPath(path)) this.#emit([{ op: existed ? "write" : "create", path, isDir: false }]);
  }

  /** Moves a file as another app would, and reports it with `events`, as a system that saw it may. */
  move(from: string, to: string, events: readonly FileEvent[]): void {
    const entry = this.#entries.get(from);
    if (entry === undefined) throw new Error(`${from} is not there.`);
    this.#entries.delete(from);
    this.#entries.set(to, entry);
    this.#emit(events);
  }
}
