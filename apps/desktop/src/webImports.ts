// Imports in the web app (ADR 0053): what the user picks with the browser's
// own file picker, read as the desktop app's Go service reads it
// (imports.go): a folder's files by their paths in it, a ZIP file's, with
// the ZIP files it holds opened in turn as Notion splits a large export, or
// the files chosen, by their names; hidden files, and paths that would
// climb out, left out.
import type { ImportKind, Importer, OpenedImport } from "./backend.ts";
import { readZip } from "./webZip.ts";

/** As many files as one import takes, as the desktop app's. */
export const maxImportFiles = 200_000;
/** The largest text one file of an import can be. */
const maxImportText = 64 << 20;
/** The largest file an import copies into the vault. */
const maxAttachment = 256 << 20;

/** What the file pickers take, by the kind of import. */
const accepts: Readonly<Record<ImportKind, { accept: string; multiple: boolean }>> = {
  folder: { accept: "", multiple: true },
  zip: { accept: ".zip,application/zip", multiple: false },
  markdown: { accept: ".md,.markdown,text/markdown", multiple: true },
  html: { accept: ".html,.htm,text/html", multiple: true },
  csv: { accept: ".csv,text/csv", multiple: false },
};

/** A file an import reads: a picked file, or one in a ZIP file. */
interface SourceFile {
  readonly size: number;
  bytes(): Promise<Uint8Array>;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function hiddenPath(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

/** A path inside the import, its slashes forward, or undefined for one that would climb out. */
function cleanPath(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length === 0 || path.startsWith("/") ? undefined : parts.join("/");
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** What was picked, open for reading and for copying its files into the vault with `attach`. */
function opened(
  name: string,
  files: ReadonlyMap<string, SourceFile>,
  attach: (dest: string, data: Uint8Array) => Promise<string>,
): OpenedImport {
  const take = (path: string) => {
    const file = files.get(path);
    if (file === undefined) throw new Error(`${path} is not in the import.`);
    return file;
  };
  return {
    name,
    files: [...files].map(([path, file]) => ({ path, size: file.size })),
    async readText(path) {
      const file = take(path);
      if (file.size > maxImportText) {
        throw new Error(`${path} is larger than ${String(maxImportText >> 20)} MB`);
      }
      try {
        return decoder.decode(await file.bytes());
      } catch (error) {
        throw new Error(`${path} is not UTF-8 text`, { cause: error });
      }
    },
    async copyInto(path, dest) {
      const file = take(path);
      if (file.size > maxAttachment) {
        throw new Error(`${path} is larger than ${String(maxAttachment >> 20)} MB`);
      }
      return attach(dest, await file.bytes());
    },
    close: () => Promise.resolve(),
  };
}

function picked(file: File): SourceFile {
  return { size: file.size, bytes: async () => new Uint8Array(await file.arrayBuffer()) };
}

function tooMany(what: string): Error {
  return new Error(`${what} has more than ${String(maxImportFiles)} files`);
}

/** A folder's files, by their paths in it: the browser gives each with the folder's name first. */
export function folderImport(
  files: readonly File[],
  attach: (dest: string, data: Uint8Array) => Promise<string>,
): OpenedImport {
  const found = new Map<string, SourceFile>();
  let name = "";
  for (const file of files) {
    const relative = file.webkitRelativePath === "" ? file.name : file.webkitRelativePath;
    const slash = relative.indexOf("/");
    if (name === "" && slash > 0) name = relative.slice(0, slash);
    const path = cleanPath(slash > 0 ? relative.slice(slash + 1) : relative);
    if (path === undefined || hiddenPath(path)) continue;
    if (found.size >= maxImportFiles) throw tooMany("The folder");
    found.set(path, picked(file));
  }
  return opened(name, found, attach);
}

/** A ZIP file's files, those of the ZIP files in it too, by their paths in it. */
export async function zipImport(
  zip: File,
  attach: (dest: string, data: Uint8Array) => Promise<string>,
): Promise<OpenedImport> {
  const found = new Map<string, SourceFile>();
  const add = async (bytes: Uint8Array, outer: boolean) => {
    for (const entry of readZip(bytes)) {
      const path = cleanPath(entry.path);
      if (path === undefined || hiddenPath(path)) continue;
      if (outer && /\.zip$/i.test(path)) {
        await add(await entry.bytes(), false);
        continue;
      }
      if (found.size >= maxImportFiles) throw tooMany("The ZIP file");
      found.set(path, entry);
    }
  };
  await add(new Uint8Array(await zip.arrayBuffer()), true);
  return opened(stem(zip.name), found, attach);
}

/** The files chosen, by their names. */
export function filesImport(
  files: readonly File[],
  attach: (dest: string, data: Uint8Array) => Promise<string>,
): OpenedImport {
  const found = new Map<string, SourceFile>();
  for (const file of files) found.set(file.name, picked(file));
  return opened(stem(files[0]?.name ?? ""), found, attach);
}

/** Asks the browser for files or a folder; none when the user cancels. */
function pick(kind: ImportKind): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    const { accept, multiple } = accepts[kind];
    if (accept !== "") input.accept = accept;
    input.multiple = multiple;
    if (kind === "folder") input.webkitdirectory = true;
    input.addEventListener("change", () => {
      resolve([...(input.files ?? [])]);
    });
    input.addEventListener("cancel", () => {
      resolve([]);
    });
    input.click();
  });
}

/** Imports from what the user picks, copied into the vault with `attach`. */
export function webImporter(attach: (dest: string, data: Uint8Array) => Promise<string>): Importer {
  return {
    async choose(kind) {
      const files = await pick(kind);
      const [first] = files;
      if (first === undefined) return undefined;
      if (kind === "folder") return folderImport(files, attach);
      if (kind === "zip") return zipImport(first, attach);
      return filesImport(files, attach);
    },
  };
}
