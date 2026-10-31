// The web app's backend (ADR 0053): the page served by a Nether server, its
// vaults the workspaces of the account signed in there. Each workspace is
// kept in the origin's private file system, its files with OpfsFiles and
// its index in SQLite in a worker, so it opens offline once opened, and
// syncs with the server as the desktop app's linked vaults do. The session
// is an HttpOnly cookie the page never sees: requests send it, with the
// CSRF value read from its second cookie, and a token of "" stands for it.
import { OpfsFiles, type OpfsDirectory, SqliteStore, isNotePath } from "@nether/storage";
import type { Backend, Connection, Exporter, Importer, VaultMedia } from "./backend.ts";
import { t } from "./messages.ts";
import type { ServerAccount, VaultInfo } from "./mygo.ts";
import { type LoopbackWait, ServerError, account } from "./server.ts";
import { linkVaultStore } from "./sync.ts";
import { providerChannel, providerReturn, webFetch, webServer } from "./web.ts";
import { openWebIndex } from "./webIndex.ts";
import { makeZip } from "./webZip.ts";

const accountKey = "nether.web.account";
const keyPrefix = "nether.web.key.";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage that is refused, as in a private window, keeps nothing.
  }
}

/** The account signed in, as this browser last knew it. */
function signedInAccount(): ServerAccount | undefined {
  const text = stored(accountKey);
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as Partial<ServerAccount>;
    return value.url === webServer && typeof value.user?.id === "string"
      ? (value as ServerAccount)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A workspace as a vault: its ID, its name, and the server it is on. */
function vaultOf(workspace: { readonly id: string; readonly name: string }): VaultInfo {
  return { id: workspace.id, name: workspace.name, path: new URL(webServer).host };
}

/** The account's workspaces; none when signed out, which it then forgets. */
async function workspaces() {
  if (signedInAccount() === undefined) return [];
  try {
    return (await account(webFetch, webServer, "")).workspaces;
  } catch (error) {
    if (error instanceof ServerError && error.status === 401) store(accountKey, undefined);
    throw error;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A vault's files as URLs, made of the browser's references to them, which
 * read from the disk only when loaded; each is made again when its file
 * changes, as a reference to a file written since cannot be read.
 */
async function opfsMedia(files: OpfsFiles): Promise<VaultMedia> {
  const urls = new Map<string, string>();
  const load = async (path: string) => {
    const file = await files.file(path).catch(() => undefined);
    const old = urls.get(path);
    if (old !== undefined) URL.revokeObjectURL(old);
    if (file === undefined) urls.delete(path);
    else urls.set(path, URL.createObjectURL(file as unknown as Blob));
  };
  const paths: string[] = [];
  await files.list("", (batch) => {
    for (const file of batch) if (!isNotePath(file.path)) paths.push(file.path);
  });
  await Promise.all(paths.map(load));
  void files.watch((events) => {
    for (const event of events) {
      if (event.isDir) continue;
      if (event.oldPath !== undefined) void load(event.oldPath);
      if (!isNotePath(event.path)) void load(event.path);
    }
  }, new AbortController().signal);
  return { url: (path) => urls.get(path) };
}

/** Saves a file the page made to the browser's downloads. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

/**
 * Exports as downloads: a ZIP the page makes, a CSV, or a PDF printed by
 * the browser's own print dialog from the page's print view.
 */
function webExporter(files: OpfsFiles): Exporter {
  const encoder = new TextEncoder();
  const open = new Map<
    string,
    { name: string; kind: string; entries: { path: string; data: Uint8Array }[] }
  >();
  let next = 0;
  const take = (token: string) => {
    const item = open.get(token);
    if (item === undefined) throw new Error(`No export is open as ${token}.`);
    open.delete(token);
    return item;
  };
  return {
    choose(name, kind) {
      next += 1;
      const token = String(next);
      open.set(token, { name, kind, entries: [] });
      return Promise.resolve(token);
    },
    async add(token, entries) {
      const item = open.get(token);
      if (item === undefined) throw new Error(`No export is open as ${token}.`);
      for (const entry of entries) {
        const data =
          entry.source === undefined
            ? encoder.encode(entry.text ?? "")
            : (await files.readBytes(entry.source)).bytes;
        item.entries.push({ path: entry.path, data });
      }
    },
    async finish(token) {
      const item = take(token);
      const name = `${item.name}.zip`;
      download(await makeZip(item.entries), name);
      return name;
    },
    printPdf(token) {
      const item = take(token);
      // The print view shows only #print-root; the browser saves it as a PDF.
      window.print();
      return Promise.resolve(`${item.name}.pdf`);
    },
    saveText(token, text) {
      const item = take(token);
      const name = `${item.name}.${item.kind}`;
      download(new Blob([text], { type: "text/csv;charset=utf-8" }), name);
      return Promise.resolve(name);
    },
    cancel(token) {
      open.delete(token);
      return Promise.resolve();
    },
  };
}

/** Imports come with the next part of the web app; its command is hidden until then. */
const noImports: Importer = {
  choose: () => Promise.resolve(undefined),
};

/** The folder of the origin's private file system a workspace's files are kept in. */
async function workspaceFolder(id: string): Promise<OpfsDirectory> {
  const root = await navigator.storage.getDirectory();
  const workspaces = await root.getDirectoryHandle("workspaces", { create: true });
  return workspaces.getDirectoryHandle(id, { create: true });
}

export const web: Backend = {
  kind: "web",
  startup: () => Promise.resolve(null),
  async recent() {
    return (await workspaces()).map(vaultOf);
  },
  choose: () => Promise.resolve(null),
  async open(id) {
    const found = (await workspaces()).find((workspace) => workspace.id === id);
    if (found === undefined) throw new Error(t("webNoSuchWorkspace"));
    return vaultOf(found);
  },
  async forget(id) {
    // The workspace's copy in this browser: its files, then its index.
    const root = await navigator.storage.getDirectory();
    for (const folder of ["workspaces", "indexes"]) {
      const parent = await root.getDirectoryHandle(folder, { create: true });
      await parent.removeEntry(id, { recursive: true }).catch(() => undefined);
    }
  },
  async connect(vault): Promise<Connection> {
    // Kept until the user clears it, where the browser agrees to.
    await navigator.storage.persist().catch(() => false);
    const workspace = (await workspaces()).find((item) => item.id === vault.id);
    const files = new OpfsFiles(await workspaceFolder(vault.id));
    const store = await SqliteStore.open(await openWebIndex(vault.id));
    if (workspace !== undefined) {
      if (workspace.encrypted) {
        // Its key must open here before it can sync: unlocked in the account's dialog.
        const { workspaceEncryption } = await import("./encryption.ts");
        await workspaceEncryption(webServer, "", workspace.id);
      }
      await linkVaultStore(store, {
        server: webServer,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        ...(workspace.encrypted ? { encrypted: true } : {}),
      });
    }
    return {
      files,
      store,
      media: await opfsMedia(files),
      exporter: webExporter(files),
      importer: noImports,
    };
  },
  fetchPreview: () => Promise.reject(new Error(t("previewNeedsApp"))),
  openUrl(url) {
    window.open(url, "_blank", "noopener");
    return Promise.resolve();
  },
  serverFetch: webFetch,
  servers() {
    const signedIn = signedInAccount();
    return Promise.resolve(signedIn === undefined ? [] : [signedIn]);
  },
  saveServer(signedIn) {
    if (signedIn.url === webServer) store(accountKey, JSON.stringify(signedIn));
    return Promise.resolve();
  },
  serverToken: (url) =>
    Promise.resolve(url === webServer && signedInAccount() !== undefined ? "" : undefined),
  forgetServer(url) {
    if (url === webServer) {
      const signedIn = signedInAccount();
      if (signedIn !== undefined) store(keyPrefix + signedIn.user.id, undefined);
      store(accountKey, undefined);
    }
    return Promise.resolve();
  },
  serverKey(url) {
    const signedIn = signedInAccount();
    const text =
      url === webServer && signedIn !== undefined ? stored(keyPrefix + signedIn.user.id) : null;
    return Promise.resolve(
      text === null ? undefined : Uint8Array.from(atob(text), (char) => char.charCodeAt(0)),
    );
  },
  saveServerKey(url, key) {
    const signedIn = signedInAccount();
    if (url === webServer && signedIn !== undefined)
      store(keyPrefix + signedIn.user.id, base64(key));
    return Promise.resolve();
  },
  loopback(): Promise<LoopbackWait> {
    // The provider sends the browser back to a page of the app, which hands
    // its query to this one (main.tsx) and closes.
    const channel = new BroadcastChannel(providerChannel);
    return Promise.resolve({
      redirect: `${webServer}${providerReturn}`,
      wait: () =>
        new Promise<Readonly<Record<string, string>>>((resolve) => {
          channel.onmessage = (event: MessageEvent<Record<string, string>>) => {
            resolve(event.data);
          };
        }),
      close() {
        channel.close();
        return Promise.resolve();
      },
    });
  },
  syncSocket: () => Promise.resolve(globalThis.WebSocket),
  // The web app updates with its server.
  updateSettings: () => Promise.resolve({ available: false, automatic: false }),
  setAutomaticUpdates: () => Promise.resolve(),
  checkForUpdates: () => Promise.resolve(),
  mark() {
    // Measured with the browser's own timing instead.
  },
  settle() {
    // The browser's memory is its own.
  },
};
