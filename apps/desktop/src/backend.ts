// Where the page gets its vaults: the Go services and the SQLite plugin in
// the desktop app, or a sample vault in memory when the page runs in a
// browser, as in the dev server's preview and the end-to-end tests.
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
import { type VaultInfo, Vaults } from "./mygo.ts";
import { sampleVault } from "./sample.ts";

/** Where the page loads a vault's files from, and how it hands them to the system's apps. */
export interface VaultMedia {
  /** The URL of a file of the vault, by its path. */
  url(path: string): string | undefined;
  /** Opens a media file, such as a PDF, in the system's app for it, where there is one. */
  readonly open?: (path: string) => Promise<void>;
  /** Shows a file in the system's file manager, where there is one. */
  readonly reveal?: (path: string) => Promise<void>;
}

export interface Connection {
  readonly files: VaultFiles;
  readonly store: IndexStore;
  readonly media: VaultMedia;
}

/** A path's segments escaped for a URL, its slashes kept. */
function escapePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
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
  startup(): Promise<VaultInfo | null>;
  recent(): Promise<VaultInfo[]>;
  /** Asks the user for a folder; null when they cancel. */
  choose(): Promise<VaultInfo | null>;
  open(path: string): Promise<VaultInfo>;
  forget(id: string): Promise<void>;
  connect(vault: VaultInfo): Promise<Connection>;
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

  async write(path: string, text: string, base: string) {
    try {
      return await Vaults.write(this.#id, path, text, base);
    } catch (error) {
      // The Go service's ErrChanged.
      if (isCallError(error) && error.message.includes("changed on disk")) {
        throw new ChangedOnDisk(path);
      }
      throw error;
    }
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
    return { files: new DesktopFiles(vault.id), store, media };
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

const sample: VaultInfo = {
  id: "01929f4c-7b00-7a00-8000-0000000000aa",
  name: "Sample vault",
  path: "In memory",
};

const preview: Backend = {
  kind: "preview",
  startup: () => Promise.resolve(null),
  recent: () => Promise.resolve([]),
  choose: () => Promise.resolve(sample),
  open: () => Promise.resolve(sample),
  forget: () => Promise.resolve(),
  connect() {
    const files = new MemoryFiles(sampleVault);
    // The end-to-end tests change the sample's files as another app would.
    (globalThis as { netherPreview?: { files: MemoryFiles } }).netherPreview = { files };
    return Promise.resolve({ files, store: new MemoryStore(), media: memoryMedia(files) });
  },
};

/** The backend for where the page runs. */
export const backend: Backend = isMyGo() ? desktop : preview;
