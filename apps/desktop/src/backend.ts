// Where the page gets its vaults: the Go services and the SQLite plugin in
// the desktop app, or a sample vault in memory when the page runs in a
// browser, as in the dev server's preview and the end-to-end tests.
import { fetch as goFetch } from "@mygo-plugins/fetch";
import { open } from "@mygo-plugins/sqlite";
import {
  ChangedOnDisk,
  type FileEvent,
  type FileInfo,
  type FileText,
  type IndexStore,
  MemoryFiles,
  MemoryStore,
  SqliteStore,
  type VaultFiles,
} from "@nether/storage";
import { Channel, isCallError, isMyGo } from "mygo-runtime";
import {
  Desktop,
  type ExportEntry,
  Exports,
  Imports,
  type LinkPreview,
  type PDFPage,
  Previews,
  type ServerAccount,
  Servers,
  type UpdateSettings,
  Updates,
  type Startup,
  type VaultInfo,
  Vaults,
} from "./mygo.ts";
import type { ImportSource } from "@nether/markdown";
import { t } from "./messages.ts";
import { sampleVault } from "./sample.ts";
import type { LoopbackWait } from "./server.ts";

/** Where the page loads a vault's files from, and how it hands them to the system's apps. */
export interface VaultMedia {
  /** The URL of a file of the vault, by its path. */
  url(path: string): string | undefined;
  /** Opens a media file, such as a PDF, in the system's app for it, where there is one. */
  readonly open?: (path: string) => Promise<void>;
  /** Shows a file in the system's file manager, where there is one. */
  readonly reveal?: (path: string) => Promise<void>;
}

/**
 * Where exports go: a file the user chooses, in the desktop app, or a
 * record the end-to-end tests read, in the preview.
 */
export interface Exporter {
  /** Asks where to save an export of the vault; undefined when the user cancels. */
  choose(name: string, kind: "zip" | "pdf" | "csv"): Promise<string | undefined>;
  /** Adds files to a ZIP: text the page made, or a file of the vault by its path. */
  add(token: string, entries: readonly ExportEntry[]): Promise<void>;
  /** Completes a ZIP and returns where it was saved. */
  finish(token: string): Promise<string>;
  /** Prints the page, as its print styles lay it out, as the PDF, and returns where it was saved. */
  printPdf(token: string, page: PDFPage): Promise<string>;
  /** Saves a text the page made as the file, as a database's CSV, and returns where it was saved. */
  saveText(token: string, text: string): Promise<string>;
  cancel(token: string): Promise<void>;
  /** Shows a saved export in the system's file manager, where there is one. */
  readonly reveal?: (path: string) => Promise<void>;
}

/** What can be imported: a folder, a ZIP file, or Markdown, web page or CSV files. */
export type ImportKind = "folder" | "zip" | "markdown" | "html" | "csv";

/** What the user chose to import, open for reading, and for copying its files into the vault. */
export interface OpenedImport extends ImportSource {
  /** Copies a file of it into the vault at `dest`, or the first free name beside it; gives the path written. */
  copyInto(path: string, dest: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Where imports come from: what the user chooses, in the desktop app, or
 * what the end-to-end tests give, in the preview.
 */
export interface Importer {
  /** Asks what to import, of a kind; undefined when the user cancels. */
  choose(kind: ImportKind): Promise<OpenedImport | undefined>;
}

export interface Connection {
  readonly files: VaultFiles;
  readonly store: IndexStore;
  readonly media: VaultMedia;
  readonly exporter: Exporter;
  readonly importer: Importer;
}

/** A path's segments escaped for a URL, its slashes kept. */
function escapePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Base64 as bytes, as the Go services give them. */
function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Bytes as base64, which is how the Go services take them. */
function base64(data: Uint8Array): string {
  let binary = "";
  // In pieces: String.fromCharCode takes only so many arguments.
  for (let start = 0; start < data.length; start += 0x8000) {
    binary += String.fromCharCode(...data.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export interface Backend {
  /** The desktop app, or a browser showing the sample vault. */
  readonly kind: "desktop" | "preview";
  /** The vault the app was started with, as `nether ~/Notes`; null when none. */
  startup(): Promise<Startup | null>;
  recent(): Promise<VaultInfo[]>;
  /** Asks the user for a folder; null when they cancel. */
  choose(): Promise<VaultInfo | null>;
  open(path: string): Promise<VaultInfo>;
  forget(id: string): Promise<void>;
  connect(vault: VaultInfo): Promise<Connection>;
  /** Fetches what a web page says of itself, when the user asks for a link's preview. */
  fetchPreview(url: string): Promise<LinkPreview>;
  /** Opens a web address in the system's browser. */
  openUrl(url: string): Promise<void>;
  /**
   * fetch for a Nether server's API: Go makes the request in the desktop
   * app, outside the page's CORS, and the browser does in the preview.
   */
  readonly serverFetch: typeof fetch;
  /** The servers signed in to, the latest first. */
  servers(): Promise<ServerAccount[]>;
  /** Records a server signed in to, its session's token kept in the system's keychain. */
  saveServer(account: ServerAccount, token: string): Promise<void>;
  /** A server's session token; undefined when signed out of it. */
  serverToken(url: string): Promise<string | undefined>;
  /** Signs out of a server on this device, forgetting its token and private key. */
  forgetServer(url: string): Promise<void>;
  /** The account's private key for a server's encrypted workspaces, if this device has it. */
  serverKey(url: string): Promise<Uint8Array | undefined>;
  /** Keeps the account's private key for a server in the system's keychain. */
  saveServerKey(url: string, key: Uint8Array): Promise<void>;
  /** Waits on a loopback address for the browser to come back from a provider. */
  loopback(): Promise<LoopbackWait>;
  /**
   * The WebSocket class sync opens its connection with: Go's in the desktop
   * app, outside the page's mixed-content rules, and the browser's in the
   * preview. It loads when a vault first syncs.
   */
  syncSocket(): Promise<unknown>;
  /** Whether the app updates itself, and checks on its own. */
  updateSettings(): Promise<UpdateSettings>;
  /** Turns the automatic update checks on or off. */
  setAutomaticUpdates(on: boolean): Promise<void>;
  /** Looks for a newer version now. */
  checkForUpdates(): Promise<void>;
  /** Records a point the page reached, such as its vault open, for performance measurements. */
  mark(name: string): void;
  /** Hands back to the system the memory the app no longer uses, after a burst of work. */
  settle(): void;
}

/** A write's result, with the Go service's ErrChanged as a `ChangedOnDisk`. */
async function changedOnDisk<T>(path: string, write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (isCallError(error) && error.message.includes("changed on disk")) {
      throw new ChangedOnDisk(path);
    }
    throw error;
  }
}

/** A vault's files through the Go service. */
class DesktopFiles implements VaultFiles {
  readonly #id: string;

  constructor(id: string) {
    this.#id = id;
  }

  async list(folder: string, each: (files: readonly FileInfo[]) => void): Promise<void> {
    await Vaults.list(this.#id, folder, new Channel<FileInfo[]>(each));
  }

  stat(paths: readonly string[]) {
    return Vaults.stat(this.#id, [...paths]);
  }

  read(path: string) {
    return Vaults.readFile(this.#id, path);
  }

  async readMany(paths: readonly string[], each: (file: FileText) => void): Promise<void> {
    if (paths.length === 0) return;
    await Vaults.read(this.#id, [...paths], new Channel<FileText>(each));
  }

  write(path: string, text: string, base: string) {
    return changedOnDisk(path, Vaults.write(this.#id, path, text, base));
  }

  async readBytes(path: string) {
    const { data, ...file } = await Vaults.readBytes(this.#id, path);
    return { ...file, bytes: fromBase64(data) };
  }

  writeBytes(path: string, data: Uint8Array, base: string) {
    return changedOnDisk(path, Vaults.writeBytes(this.#id, path, base64(data), base));
  }

  rename(from: string, to: string) {
    return Vaults.rename(this.#id, from, to);
  }

  attach(path: string, data: Uint8Array) {
    return Vaults.attach(this.#id, path, base64(data));
  }

  remove(path: string) {
    return Vaults.remove(this.#id, path);
  }

  erase(path: string) {
    return Vaults.erase(this.#id, path);
  }

  async watch(each: (events: readonly FileEvent[]) => void, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const channel = new Channel<FileEvent[]>(each);
    signal.addEventListener("abort", () => {
      channel.close();
    });
    await Vaults.watch(this.#id, channel);
  }
}

const desktop: Backend = {
  kind: "desktop",
  fetchPreview: (url) => Previews.fetch(url),
  openUrl: (url) => Previews.open(url),
  serverFetch: goFetch,
  async syncSocket() {
    return (await import("@mygo-plugins/websocket")).WebSocket;
  },
  servers: () => Servers.list(),
  saveServer: (account, token) => Servers.save(account, token),
  async serverToken(url) {
    const token = await Servers.token(url);
    return token === "" ? undefined : token;
  },
  forgetServer: (url) => Servers.forget(url),
  async serverKey(url) {
    const key = await Servers.key(url);
    return key === "" ? undefined : fromBase64(key);
  },
  saveServerKey: (url, key) => Servers.saveKey(url, base64(key)),
  async loopback() {
    const { id, redirect } = await Servers.listen();
    return { redirect, wait: () => Servers.wait(id), close: () => Servers.close(id) };
  },
  updateSettings: () => Updates.settings(),
  mark(name) {
    void Desktop.mark(name);
  },
  settle() {
    void Desktop.settle();
  },
  setAutomaticUpdates: (on) => Updates.setAutomatic(on),
  checkForUpdates: () => Updates.check(),
  startup: () => Vaults.startup(),
  recent: () => Vaults.recent(),
  choose: () => Vaults.choose(),
  open: (path) => Vaults.open(path),
  forget: (id) => Vaults.forget(id),
  async connect(vault) {
    // The index of each vault is its own database, named by the vault's ID.
    const store = await SqliteStore.open(await open(`${vault.id}.db`));
    // Images, PDFs, audio and video load from the app's server on the loopback interface.
    const base = await Vaults.mediaURL(vault.id);
    const media: VaultMedia = {
      url: (path) => base + escapePath(path),
      open: (path) => Vaults.openFile(vault.id, path),
      reveal: (path) => Vaults.showFile(vault.id, path),
    };
    const exporter: Exporter = {
      async choose(name, kind) {
        const token = await Exports.choose(vault.id, name, kind);
        return token === "" ? undefined : token;
      },
      add: (token, entries) => Exports.add(token, [...entries]),
      finish: (token) => Exports.finish(token),
      printPdf: (token, page) => Exports.printPDF(token, page),
      saveText: (token, text) => Exports.saveText(token, text),
      cancel: (token) => Exports.cancel(token),
      reveal: (path) => Exports.reveal(path),
    };
    const importer: Importer = {
      async choose(kind) {
        const opened = await Imports.choose(kind);
        const { token } = opened;
        if (token === "") return undefined;
        return {
          name: opened.name,
          files: opened.files,
          readText: (path) => Imports.readText(token, path),
          copyInto: async (path, dest) =>
            (await Imports.copyInto(token, path, vault.id, dest)).path,
          close: () => Imports.close(token),
        };
      },
    };
    return { files: new DesktopFiles(vault.id), store, media, exporter, importer };
  },
};

const previewTypes: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** The files of a vault in memory, as blob URLs, for the browser preview. */
function memoryMedia(files: MemoryFiles): VaultMedia {
  const urls = new Map<string, string>();
  return {
    url(path) {
      const bytes = files.bytes(path);
      if (bytes === undefined) return undefined;
      let url = urls.get(path);
      if (url === undefined) {
        const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
        url = URL.createObjectURL(new Blob([bytes], { type: previewTypes[extension] ?? "" }));
        urls.set(path, url);
      }
      return url;
    },
  };
}

/** An export as the preview keeps it, for the end-to-end tests to read. */
export interface PreviewExport {
  readonly name: string;
  readonly kind: "zip" | "pdf" | "csv";
  /** A ZIP's files, or a CSV's text as its one file. */
  readonly entries: ExportEntry[];
  /** For a PDF, the page's print view when it was printed. */
  html?: string;
  page?: PDFPage;
  saved?: string;
}

/** Exports kept in memory, in the order they were made. */
function memoryExporter(exports: PreviewExport[]): Exporter {
  const open = new Map<string, PreviewExport>();
  const take = (token: string) => {
    const item = open.get(token);
    if (item === undefined) throw new Error(`No export is open as ${token}.`);
    return item;
  };
  return {
    choose(name, kind) {
      const token = String(exports.length + open.size + 1);
      open.set(token, { name, kind, entries: [] });
      return Promise.resolve(token);
    },
    add(token, entries) {
      take(token).entries.push(...entries);
      return Promise.resolve();
    },
    finish(token) {
      const item = take(token);
      open.delete(token);
      item.saved = `${item.name}.zip`;
      exports.push(item);
      return Promise.resolve(item.saved);
    },
    printPdf(token, page) {
      const item = take(token);
      open.delete(token);
      item.html = document.getElementById("print-root")?.innerHTML ?? "";
      item.page = page;
      item.saved = `${item.name}.pdf`;
      exports.push(item);
      return Promise.resolve(item.saved);
    },
    saveText(token, text) {
      const item = take(token);
      open.delete(token);
      item.saved = `${item.name}.${item.kind}`;
      item.entries.push({ path: item.saved, text });
      exports.push(item);
      return Promise.resolve(item.saved);
    },
    cancel(token) {
      open.delete(token);
      return Promise.resolve();
    },
  };
}

/** What the end-to-end tests give the preview to import, in the order it is asked for. */
export interface PreviewImport {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}

/** Imports from what the end-to-end tests give, copied into the vault's files in memory. */
function memoryImporter(files: MemoryFiles, imports: PreviewImport[]): Importer {
  const encoder = new TextEncoder();
  return {
    choose() {
      const next = imports.shift();
      if (next === undefined) return Promise.resolve(undefined);
      const read = (path: string) => {
        const text = next.files[path];
        if (text === undefined) throw new Error(`${path} is not in the import.`);
        return text;
      };
      return Promise.resolve({
        name: next.name,
        files: Object.entries(next.files).map(([path, text]) => ({ path, size: text.length })),
        readText: (path) => Promise.resolve(read(path)),
        copyInto: async (path, dest) => (await files.attach(dest, encoder.encode(read(path)))).path,
        close: () => Promise.resolve(),
      });
    },
  };
}

const sample: VaultInfo = {
  id: "01929f4c-7b00-7a00-8000-0000000000aa",
  name: "Sample vault",
  path: "In memory",
};

/** What the end-to-end tests give the preview: a fetcher of link previews in place of the app's. */
interface PreviewHooks {
  fetchPreview?: (url: string) => Promise<LinkPreview>;
  /** Stands in for the browser coming back from a provider, in the end-to-end tests. */
  loopback?: () => LoopbackWait;
}

/** The servers signed in to in the preview, which forgets them when the page closes. */
const previewServers = new Map<string, { account: ServerAccount; token: string }>();
/** The private keys of the preview's accounts, as the keychain keeps them in the app. */
const previewKeys = new Map<string, Uint8Array>();

const preview: Backend = {
  kind: "preview",
  fetchPreview(url) {
    const hooks = (globalThis as { netherPreview?: PreviewHooks }).netherPreview;
    return (
      hooks?.fetchPreview?.(url) ??
      Promise.reject(new Error("Link previews are fetched by the desktop app."))
    );
  },
  openUrl(url) {
    window.open(url, "_blank", "noopener");
    return Promise.resolve();
  },
  serverFetch: (input, init) => fetch(input, init),
  syncSocket: () => Promise.resolve(globalThis.WebSocket),
  servers: () =>
    Promise.resolve([...previewServers.values()].map((item) => item.account).reverse()),
  saveServer(account, token) {
    previewServers.delete(account.url);
    previewServers.set(account.url, { account, token });
    return Promise.resolve();
  },
  serverToken: (url) => Promise.resolve(previewServers.get(url)?.token),
  forgetServer(url) {
    previewServers.delete(url);
    previewKeys.delete(url);
    return Promise.resolve();
  },
  serverKey: (url) => Promise.resolve(previewKeys.get(url)),
  saveServerKey(url, key) {
    previewKeys.set(url, key);
    return Promise.resolve();
  },
  loopback() {
    const hooks = (globalThis as { netherPreview?: PreviewHooks }).netherPreview;
    const loopback = hooks?.loopback?.();
    return loopback === undefined
      ? Promise.reject(new Error(t("providerNeedsApp")))
      : Promise.resolve(loopback);
  },
  // A page in a browser updates with its server.
  updateSettings: () => Promise.resolve({ available: false, automatic: false }),
  setAutomaticUpdates: () => Promise.resolve(),
  checkForUpdates: () => Promise.resolve(),
  mark() {
    // Measured with the browser's own timing instead.
  },
  settle() {
    // The browser's memory is its own.
  },
  // `?note=Projects/Ideas.md` starts with the sample vault open at that note,
  // as the app starts with a vault and a note its command line names.
  startup() {
    const note = new URLSearchParams(location.search).get("note");
    return Promise.resolve(note === null ? null : { vault: sample, note });
  },
  recent: () => Promise.resolve([]),
  choose: () => Promise.resolve(sample),
  open: () => Promise.resolve(sample),
  forget: () => Promise.resolve(),
  async connect() {
    // `?reference=50000` opens the reference vault of that many notes, for the
    // performance tests; it loads only then.
    const reference = Number(new URLSearchParams(location.search).get("reference") ?? "");
    let vault: Readonly<Record<string, string>> = sampleVault;
    if (Number.isInteger(reference) && reference > 0) {
      const { generateVault } = await import("@nether/vault-generator");
      const generated: Record<string, string> = {};
      for (const file of generateVault({ notes: reference, seed: 1 })) {
        generated[file.path] = file.content;
      }
      vault = generated;
    }
    const files = new MemoryFiles(vault);
    const exports: PreviewExport[] = [];
    const imports: PreviewImport[] = [];
    // The end-to-end tests change the sample's files as another app would,
    // read its exports, and give it what to import.
    (
      globalThis as {
        netherPreview?: { files: MemoryFiles; exports: PreviewExport[]; imports: PreviewImport[] };
      }
    ).netherPreview = { files, exports, imports };
    return {
      files,
      store: new MemoryStore(),
      media: memoryMedia(files),
      exporter: memoryExporter(exports),
      importer: memoryImporter(files, imports),
    };
  },
};

/** The backend for where the page runs. */
export const backend: Backend = isMyGo() ? desktop : preview;
