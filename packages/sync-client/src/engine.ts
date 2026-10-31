// Syncing a vault with a workspace (ADR 0037). One WebSocket carries the
// vault document, which stays synced while the vault is open, and each
// note's document while it syncs. The engine:
//
// - brings this vault's notes and the server's list together, by the base
//   the two last agreed on: notes made, moved or removed on one side are
//   made, moved or removed on the other;
// - catches up on the notes stored on the server since it last looked, by
//   their number, and hears of each as it is stored while it is connected;
// - syncs a note's document when it changes here or there, through the
//   document the vault holds for it, which the editor shares;
// - makes a note this vault lacks from the server's document before its
//   file, so no second history of its text is made from the file.
//
// What a device knows between runs, the base, the last number seen, the
// notes changed here and not sent, and the vault document, is kept by the
// store it is given, so edits made offline are sent when it reconnects.
import * as Y from "yjs";
import { type Channel, HocuspocusChannel } from "./channel.ts";
import type { WorkspaceKey } from "./crypto.ts";
import { type Paths, reconcilePaths, removeVaultPath, setVaultPath, vaultPaths } from "./paths.ts";
import { RelayChannel } from "./relayChannel.ts";

/** A note's document, held while it syncs; let go when done. */
export interface HeldDocument {
  readonly document: Y.Doc;
  release(): void;
}

/** The vault the engine syncs, as the app gives it. */
export interface SyncVault {
  /** The vault's notes now: each note's ID and path. */
  paths(): Paths;
  /**
   * Calls `listener` with a note's ID when its text changes here, and with
   * no ID when notes are made, moved or removed; gives the way to stop.
   */
  watch(listener: (id?: string) => void): () => void;
  /** Holds a note's document: the one the editor shares while it is open. */
  hold(id: string): Promise<HeldDocument>;
  /** Makes a note the server has and this vault lacks, from its document's state. */
  create(id: string, path: string, state: Uint8Array): Promise<void>;
  /** Moves a note to the path the server has for it. */
  move(id: string, path: string): Promise<void>;
  /** Sends a note removed elsewhere to the trash. */
  remove(id: string): Promise<void>;
}

/** What a device keeps between runs. */
export interface SyncRecord {
  /** The number of the last stored document listed. */
  readonly cursor: number;
  /** The paths this vault and the server last agreed on. */
  readonly base: Readonly<Record<string, string>>;
  /** Notes changed here and not yet sent. */
  readonly pending: readonly string[];
  /** The vault document as last seen. */
  readonly vault: Uint8Array | null;
  /** What the channel keeps, as the relay its documents' numbers and what it sent. */
  readonly channel?: unknown;
}

export interface SyncStore {
  load(): Promise<SyncRecord | undefined>;
  save(record: SyncRecord): Promise<void>;
}

export interface SyncStatus {
  /** Connecting or away, catching up, or up to date. */
  readonly state: "offline" | "syncing" | "synced";
  /** Notes changed here and not yet sent. */
  readonly pending: number;
  /** The last failure, until the next success. */
  readonly error?: string;
}

export interface SyncOptions {
  /** The server, as `https://nether.example.org`. */
  readonly server: string;
  readonly token: string;
  readonly workspaceId: string;
  readonly vault: SyncVault;
  readonly store: SyncStore;
  /** fetch for the server's API; the global one by default. */
  readonly fetch?: typeof fetch;
  /** A WebSocket class, as the desktop app's through Go; the global one by default. */
  readonly WebSocket?: unknown;
  readonly onStatus?: (status: SyncStatus) => void;
  /** How many notes sync at once. */
  readonly concurrency?: number;
  /**
   * The keys of an encrypted workspace, which syncs through the relay: the
   * latest to encrypt with, and every version this device has to decrypt with.
   */
  readonly encryption?: {
    readonly key: WorkspaceKey;
    readonly keys: ReadonlyMap<number, Uint8Array>;
  };
}

export class VaultSync {
  readonly #options: SyncOptions;
  readonly #vaultDocument = new Y.Doc();
  #channel: Channel | undefined;
  #cursor = 0;
  #base = new Map<string, string>();
  readonly #pending = new Set<string>();
  /** Notes syncing now, which do not start again until done. */
  readonly #syncing = new Set<string>();
  #queue: Promise<void> = Promise.resolve();
  #queued = false;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #unwatch: (() => void) | undefined;
  #stopped = false;
  #stopping: Promise<void> | undefined;
  #status: SyncStatus = { state: "offline", pending: 0 };

  private constructor(options: SyncOptions) {
    this.#options = options;
  }

  /** Starts syncing a vault with a workspace, from what this device kept. */
  static async start(options: SyncOptions): Promise<VaultSync> {
    const sync = new VaultSync(options);
    await sync.#begin();
    return sync;
  }

  get status(): SyncStatus {
    return this.#status;
  }

  /** Waits for the work under way, and any it leads to, to be done. */
  async settled(): Promise<void> {
    let queue: Promise<void>;
    do {
      queue = this.#queue;
      await queue;
    } while (queue !== this.#queue);
  }

  /** Stops syncing, keeping what this device knows for the next start; once, however often called. */
  stop(): Promise<void> {
    this.#stopping ??= this.#halt();
    return this.#stopping;
  }

  async #halt(): Promise<void> {
    this.#stopped = true;
    this.#unwatch?.();
    this.#channel?.close();
    await this.#queue.catch(() => undefined);
    clearTimeout(this.#saveTimer);
    await this.#save();
  }

  async #begin(): Promise<void> {
    const record = await this.#options.store.load();
    if (record !== undefined) {
      this.#cursor = record.cursor;
      this.#base = new Map(Object.entries(record.base));
      for (const id of record.pending) this.#pending.add(id);
      if (record.vault !== null) Y.applyUpdate(this.#vaultDocument, record.vault);
    }
    this.#vaultDocument.on("update", () => {
      this.#saveSoon();
      this.#schedule();
    });
    this.#unwatch = this.#options.vault.watch((id) => {
      if (id !== undefined) this.#pending.add(id);
      this.#saveSoon();
      this.#schedule();
    });
    const options = this.#options;
    const events = {
      // Connected, or connected again: all of it, from the list on.
      onSynced: () => {
        this.#schedule();
      },
      onStored: (document: string) => {
        if (!options.vault.paths().has(document)) return;
        this.#pending.add(document);
        this.#schedule();
      },
      onOffline: (error?: string) => {
        this.#report({ state: "offline", ...(error === undefined ? {} : { error }) });
      },
    };
    const where = {
      server: options.server,
      token: options.token,
      workspaceId: options.workspaceId,
      ...(options.WebSocket === undefined ? {} : { WebSocket: options.WebSocket }),
    };
    this.#channel =
      options.encryption === undefined
        ? new HocuspocusChannel(where, this.#vaultDocument, events)
        : new RelayChannel(
            { ...where, ...options.encryption },
            this.#vaultDocument,
            events,
            record?.channel,
          );
  }

  /** Tells of the state, and of a failure until the next success. */
  #report(next: Partial<SyncStatus>): void {
    this.#status = {
      state: next.state ?? this.#status.state,
      pending: this.#pending.size,
      ...(next.error === undefined ? {} : { error: next.error }),
    };
    this.#options.onStatus?.(this.#status);
  }

  /** Whether the engine runs and the vault document is synced; read anew after each wait. */
  #live(): boolean {
    return !this.#stopped && this.#channel?.synced === true;
  }

  /** Runs a round of sync after the one under way, once however often it is asked for. */
  #schedule(): void {
    if (this.#queued || this.#stopped) return;
    this.#queued = true;
    this.#queue = this.#queue.then(async () => {
      this.#queued = false;
      if (!this.#live()) return;
      this.#report({ state: "syncing" });
      try {
        await this.#reconcile();
        await this.#catchUp();
        await this.#flush();
        if (this.#live()) this.#report({ state: "synced" });
      } catch (error) {
        this.#report({
          state: "offline",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /** Brings this vault's notes and the server's list together. */
  async #reconcile(): Promise<void> {
    const vault = this.#options.vault;
    const plan = reconcilePaths(this.#base, vault.paths(), vaultPaths(this.#vaultDocument));
    this.#vaultDocument.transact(() => {
      for (const id of plan.upload) {
        const path = vault.paths().get(id);
        if (path !== undefined) setVaultPath(this.#vaultDocument, id, path);
      }
      for (const { id, path } of plan.moveRemote) setVaultPath(this.#vaultDocument, id, path);
      for (const id of plan.removeRemote) removeVaultPath(this.#vaultDocument, id);
    });
    for (const id of plan.upload) this.#pending.add(id);
    for (const { id, path } of plan.moveLocal) await vault.move(id, path);
    for (const id of plan.removeLocal) await vault.remove(id);
    await this.#each(plan.download, async ({ id, path }) => {
      const document = new Y.Doc();
      try {
        await this.#sync(id, document);
        await vault.create(id, path, Y.encodeStateAsUpdate(document));
      } finally {
        document.destroy();
      }
    });
    // Agreed: what the server lists at the path this vault has it.
    const local = vault.paths();
    this.#base = new Map(
      [...vaultPaths(this.#vaultDocument)].filter(([id, path]) => local.get(id) === path),
    );
    this.#saveSoon();
  }

  /** Lists the notes stored on the server since the last number seen, to sync them. */
  async #catchUp(): Promise<void> {
    const fetcher = this.#options.fetch ?? fetch;
    const local = this.#options.vault.paths();
    for (;;) {
      const response = await fetcher(
        `${this.#options.server}/api/workspaces/${this.#options.workspaceId}/documents?since=${String(this.#cursor)}`,
        { headers: { authorization: `Bearer ${this.#options.token}`, accept: "application/json" } },
      );
      if (!response.ok) throw new Error(`The server answered ${String(response.status)}.`);
      const answer = (await response.json()) as {
        documents?: { name?: unknown; seq?: unknown }[];
        more?: unknown;
      };
      for (const item of answer.documents ?? []) {
        if (typeof item.seq === "number") this.#cursor = Math.max(this.#cursor, item.seq);
        if (typeof item.name === "string" && local.has(item.name)) this.#pending.add(item.name);
      }
      if (answer.more !== true) break;
    }
    this.#saveSoon();
  }

  /** Syncs the notes changed on either side. */
  async #flush(): Promise<void> {
    const vault = this.#options.vault;
    await this.#each([...this.#pending], async (id) => {
      if (!vault.paths().has(id)) {
        this.#pending.delete(id);
        return;
      }
      if (this.#syncing.has(id)) return;
      this.#syncing.add(id);
      // Taken now: a change made while it syncs marks it again.
      this.#pending.delete(id);
      try {
        const held = await vault.hold(id);
        try {
          await this.#sync(id, held.document);
        } finally {
          held.release();
        }
      } catch (error) {
        this.#pending.add(id);
        throw error;
      } finally {
        this.#syncing.delete(id);
        this.#report({});
      }
    });
    this.#saveSoon();
  }

  /** Runs work on items, a few at a time. */
  async #each<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const failures: unknown[] = [];
    const worker = async () => {
      for (let item = queue.shift(); item !== undefined && !this.#stopped; item = queue.shift()) {
        await work(item).catch((error: unknown) => failures.push(error));
      }
    };
    await Promise.all(Array.from({ length: this.#options.concurrency ?? 4 }, worker));
    if (failures.length > 0) throw failures[0];
  }

  /** Syncs a document with the server's: both get what the other lacks. */
  #sync(id: string, document: Y.Doc): Promise<void> {
    if (this.#channel === undefined) return Promise.reject(new Error("Sync has not started."));
    return this.#channel.sync(id, document);
  }

  #saveSoon(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => void this.#save(), 200);
  }

  async #save(): Promise<void> {
    await this.#options.store.save({
      cursor: this.#cursor,
      base: Object.fromEntries(this.#base),
      pending: [...this.#pending],
      vault: Y.encodeStateAsUpdate(this.#vaultDocument),
      channel: this.#channel?.state(),
    });
  }
}
