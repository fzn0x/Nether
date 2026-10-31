// What a client's platform gives Nether to work with a vault's files: the
// desktop's Go services, an in-memory folder in the browser preview and in
// tests, and later the mobile apps' file system.

/** A file in a vault. */
export interface FileInfo {
  /** Relative to the vault, separated by slashes. */
  readonly path: string;
  /** In bytes. */
  readonly size: number;
  /** The modification time, in milliseconds since 1970. */
  readonly modified: number;
}

/** A file, and the SHA-256 hash of its bytes in hexadecimal. */
export interface FileHash extends FileInfo {
  readonly hash: string;
}

/** A file's bytes, as sync sends attachments, and their hash. */
export interface FileBytes extends FileHash {
  readonly bytes: Uint8Array;
}

/** A file's text, and the SHA-256 hash of its bytes in hexadecimal. */
export interface FileText extends FileHash {
  readonly text: string;
  /** The file was not there. */
  readonly missing?: boolean;
  /** The file is not UTF-8 text: its text is empty, and writing it would change its bytes. */
  readonly binary?: boolean;
}

/** What happened to a file. `rescan` asks for the folder at `path` to be listed again. */
export type FileOp = "create" | "write" | "remove" | "rename" | "rescan";

/** A change to a vault's files, as the watch reports it. */
export interface FileEvent {
  readonly op: FileOp;
  /** Relative to the vault; "" is the vault itself. */
  readonly path: string;
  /** Where a rename moved the file or folder from. */
  readonly oldPath?: string;
  readonly isDir: boolean;
}

/** A vault's files, as the platform reads and writes them. */
export interface VaultFiles {
  /**
   * Lists every file, or those in one folder, leaving out hidden ones below
   * it, such as `.nether`; `.trash` lists the trash. Calls `each` per batch.
   */
  list(folder: string, each: (files: readonly FileInfo[]) => void): Promise<void>;
  /** The size and modification time of each file that is there, in order. */
  stat(paths: readonly string[]): Promise<readonly FileInfo[]>;
  read(path: string): Promise<FileText>;
  /** Reads many files, calling `each` with each in order; one that is gone comes with `missing`. */
  readMany(paths: readonly string[], each: (file: FileText) => void): Promise<void>;
  /**
   * Replaces a file's text in one step. `base` is the hash of the text last
   * read, or "" for a file that must not exist yet; if the file is no longer
   * that, it throws a `ChangedOnDisk` and writes nothing.
   */
  write(path: string, text: string, base: string): Promise<FileText>;
  /** Reads a file's bytes, text or not; it throws if the file is not there. */
  readBytes(path: string): Promise<FileBytes>;
  /** Replaces a file's bytes in one step, checked against `base` as `write` is. */
  writeBytes(path: string, data: Uint8Array, base: string): Promise<FileHash>;
  /** Moves a file, making the folders it needs; it throws if a file is there. */
  rename(from: string, to: string): Promise<FileInfo>;
  /**
   * Adds a file of bytes, such as an image pasted into a note, making the
   * folders it needs. It never replaces a file: when the path is taken it
   * uses the first free name of `name 1.png`, `name 2.png` and so on, and
   * returns where the file went.
   */
  attach(path: string, data: Uint8Array): Promise<FileInfo>;
  /** Moves a file to the vault's trash and returns where it went. */
  remove(path: string): Promise<string>;
  /** Deletes a file in the vault's trash for good; it deletes nothing outside it. */
  erase(path: string): Promise<void>;
  /**
   * Every folder, or those below one folder, empty ones too, leaving out
   * hidden ones and what is in them.
   */
  folders(folder: string): Promise<readonly string[]>;
  /** Makes a folder and those it is in; it throws for a hidden name, or where a file or folder is. */
  makeFolder(path: string): Promise<void>;
  /** Deletes an empty folder; it throws for one with anything in it. */
  removeFolder(path: string): Promise<void>;
  /** Calls `each` with batches of changes until `signal` aborts. */
  watch(each: (events: readonly FileEvent[]) => void, signal: AbortSignal): Promise<void>;
}

/** The file changed on disk since it was read: merge, then write again. */
export class ChangedOnDisk extends Error {
  override readonly name = "ChangedOnDisk";
  readonly path: string;

  constructor(path: string) {
    super(`${path} changed on disk since it was read.`);
    this.path = path;
  }
}

/** Whether a file is a note: a Markdown file. */
export function isNotePath(path: string): boolean {
  return /\.md$/i.test(path);
}

/** A note's title: its file's name without the folder and the `.md`. */
export function noteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

/** The folder a path is in, "" for the vault itself. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Whether `path` is `folder` or inside it. */
export function isInside(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}
