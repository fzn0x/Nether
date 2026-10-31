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
//   file, so no second history of its text is made from the file;
// - brings attachments together by path and hash in the same way (ADR 0040),
//   sending a file's bytes the server lacks, encrypted for an encrypted
//   workspace, and fetching those this vault lacks.
//
// A workspace's notes are divided into sync units (ADR 0042), each with its
// own vault document; the engine syncs those of the units the account
// opens, and puts each note and file in the unit whose area holds its path,
// asking the server first to move a note from one unit to another.
//
// What a device knows between runs, the base, the last number seen, the
// notes changed here and not sent, the units and their vault documents, is
// kept by the store it is given, so edits made offline are sent when it
// reconnects.
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type Channel, HocuspocusChannel, type LiveDocument } from "./channel.ts";
import { type WorkspaceKey, decryptFile, encryptFile } from "./crypto.ts";
import {
  type FileHashes,
  type VaultFile,
  besidePath,
  isSyncedFile,
  reconcileFiles,
  removeVaultFile,
  setVaultFile,
  sha256,
  vaultFiles,
} from "./files.ts";
import {
  type Paths,
  reconcilePaths,
  removeVaultPath,
  setVaultPath,
  vaultPath,
  vaultPaths,
} from "./paths.ts";
import { RelayChannel } from "./relayChannel.ts";
import {
  type Level,
  type SyncUnit,
  general,
  generalOnly,
  readUnits,
  unitForPath,
  writes,
} from "./units.ts";

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
   * Calls `listener` with a document's name when it changes here, a note's
   * ID for its text or `<id>.comments` for its comments, and with no name
   * when notes are made, moved or removed, or other files are made, changed,
   * moved or removed; gives the way to stop.
   */
  watch(listener: (id?: string) => void): () => void;
  /** Holds a note's document: the one the editor shares while it is open. */
  hold(id: string): Promise<HeldDocument>;
  /** Holds a note's comments' document (ADR 0044), which the editor shares while the note is open. */
  holdComments(id: string): Promise<HeldDocument>;
  /** Makes a note the server has and this vault lacks, from its document's state. */
  create(id: string, path: string, state: Uint8Array): Promise<void>;
  /** Moves a note to the path the server has for it. */
  move(id: string, path: string): Promise<void>;
  /** Sends a note removed elsewhere to the trash. */
  remove(id: string): Promise<void>;
  /** The vault's files that are not notes, such as images: each one's path, and the SHA-256 hash of its bytes. */
  files(): Promise<FileHashes>;
  /** Reads a file's bytes, and their hash. */
  readFile(path: string): Promise<{ readonly bytes: Uint8Array; readonly hash: string }>;
  /**
   * Writes a file fetched from the server. `base` is the hash of the file
   * there, or "" for none; if the file is no longer that, it throws and
   * writes nothing.
   */
  writeFile(path: string, data: Uint8Array, base: string): Promise<void>;
  /** Moves a file, as a file changed here and elsewhere moves aside. */
  moveFile(from: string, to: string): Promise<void>;
  /** Sends a file removed elsewhere to the trash. */
  removeFile(path: string): Promise<void>;
}

/** Who is editing, as others see them beside their caret. */
export interface Editor {
  readonly name: string;
  readonly color: string;
}

/** A note syncing live while its editor is open (ADR 0043). */
export interface LiveNote {
  /** Where each person is in it: the editor shows the others' carets. */
  readonly awareness: Awareness;
  /** Who this person is to the others. */
  readonly editor: Editor;
  /** Stops syncing it live; it syncs in rounds again. */
  stop(): void;
}

/** What a device keeps between runs. */
export interface SyncRecord {
  /** The number of the last stored document listed. */
  readonly cursor: number;
  /** The paths this vault and the server last agreed on. */
  readonly base: Readonly<Record<string, string>>;
  /** Notes changed here and not yet sent. */
  readonly pending: readonly string[];
  /** The other files this vault and the server last agreed on: each one's path, and its hash. */
  readonly files?: Readonly<Record<string, string>>;
  /** The vault document as last seen. */
  readonly vault: Uint8Array | null;
  /** The units the account opened, as the server last said (ADR 0042). */
  readonly units?: readonly SyncUnit[];
  /** The vault documents of the units besides General, as last seen. */
  readonly vaults?: Readonly<Record<string, Uint8Array>>;
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
  /** Files the server would not take, larger than it allows or sent by a guest; sent again once changed. */
  readonly refused?: readonly string[];
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
  /** General's vault document. */
  readonly #vaultDocument = new Y.Doc();
  /** The other units' vault documents, by their IDs. */
  readonly #documents = new Map<string, Y.Doc>();
  /** The units the account opens, as the server last said; General alone before it says. */
  #units: readonly SyncUnit[] = generalOnly;
  /** Asks for the units again, while there are none to hear from. */
  #unitsTimer: ReturnType<typeof setTimeout> | undefined;
  #channel: Channel | undefined;
  #cursor = 0;
  /** What this vault and the server last agreed on: each note's path. */
  #base = new Map<string, string>();
  /** And each other file's hash, by its path. */
  #fileBase = new Map<string, string>();
  /** Files the server refused: each one's path, and the hash it refused. */
  readonly #refused = new Map<string, string>();
  readonly #pending = new Set<string>();
  /** Notes' comments the server has stored: fetched even where this device has none. */
  readonly #storedComments = new Set<string>();
  /** Notes syncing now, which do not start again until done. */
  readonly #syncing = new Set<string>();
  /** Notes open in an editor, each live once listed: they skip rounds meanwhile. */
  readonly #editing = new Map<
    string,
    { readonly document: Y.Doc; readonly awareness: Awareness; open: LiveDocument | undefined }
  >();
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

  /**
   * The access this account has to a note: that of the unit listing it, or
   * of the unit its path would place it in; undefined where it is in none,
   * as a guest's note outside their pages.
   */
  level(id: string): Level | undefined {
    for (const unit of this.#units) {
      if (vaultPath(this.#documentOf(unit.id), id) !== undefined) return unit.level;
    }
    const path = this.#options.vault.paths().get(id);
    return path === undefined ? undefined : this.#placer(new Map())(path)?.level;
  }

  /**
   * Syncs a note's document live while its editor is open, with who is
   * editing for the others' carets. It goes live once a vault document
   * lists it, as a note just made once a round has placed it; in an
   * encrypted workspace it stays in rounds, its awareness alone.
   */
  live(id: string, document: Y.Doc, editor: Editor): LiveNote {
    const awareness = new Awareness(document);
    awareness.setLocalStateField("user", editor);
    const entry = { document, awareness, open: undefined as LiveDocument | undefined };
    this.#editing.get(id)?.open?.stop();
    this.#editing.set(id, entry);
    this.#openLive();
    return {
      awareness,
      editor,
      stop: () => {
        entry.open?.stop();
        awareness.destroy();
        if (this.#editing.get(id) !== entry) return;
        this.#editing.delete(id);
        // The next round, not one at once beside the live sync's close, takes
        // what it may not have sent.
        this.#pending.add(id);
        this.#saveSoon();
      },
    };
  }

  /** Opens the live syncs wanted for notes now listed, and not syncing in a round. */
  #openLive(): void {
    const channel = this.#channel;
    if (channel === undefined || this.#stopped || this.#editing.size === 0) return;
    const listed = this.#listed().units;
    for (const [id, entry] of this.#editing) {
      if (entry.open !== undefined || !listed.has(id) || this.#syncing.has(id)) continue;
      entry.open = channel.live(id, entry.document, entry.awareness);
    }
  }

  async #halt(): Promise<void> {
    this.#stopped = true;
    for (const entry of this.#editing.values()) entry.open?.stop();
    clearTimeout(this.#unitsTimer);
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
      this.#fileBase = new Map(Object.entries(record.files ?? {}));
      for (const id of record.pending) this.#pending.add(id);
      if (record.vault !== null) Y.applyUpdate(this.#vaultDocument, record.vault);
      if (record.units !== undefined) this.#units = readUnits({ units: record.units });
      for (const [id, state] of Object.entries(record.vaults ?? {})) {
        if (this.#units.some((unit) => unit.id === id)) Y.applyUpdate(this.#documentOf(id), state);
      }
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
        if (!options.vault.paths().has(noteOf(document))) return;
        if (document !== noteOf(document)) this.#storedComments.add(document);
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
        ? new HocuspocusChannel(where, events)
        : new RelayChannel(
            { ...where, ...options.encryption },
            this.#vaultDocument,
            events,
            record?.channel,
          );
    this.#openUnits();
    // The first round asks for the units: a guest, refused General, hears nothing until then.
    this.#schedule();
  }

  /** A unit's vault document: General's is the vault document of old. */
  #documentOf(unit: string): Y.Doc {
    if (unit === general) return this.#vaultDocument;
    let document = this.#documents.get(unit);
    if (document === undefined) {
      document = new Y.Doc();
      document.on("update", () => {
        this.#saveSoon();
        this.#schedule();
      });
      this.#documents.set(unit, document);
    }
    return document;
  }

  /** Has the channel sync the vault documents of the units the account opens. */
  #openUnits(): void {
    this.#channel?.vaults(
      new Map(this.#units.map((unit) => [unit.document, this.#documentOf(unit.id)])),
    );
  }

  /**
   * Asks the server for the account's units; true when they changed. They
   * stay as they were while the server cannot say, and an encrypted
   * workspace has General alone.
   */
  async #refreshUnits(): Promise<boolean> {
    if (this.#options.encryption !== undefined) return false;
    let units: SyncUnit[];
    try {
      const response = await this.#request("/units", { headers: { accept: "application/json" } });
      if (!response.ok) return false;
      units = readUnits(await response.json());
    } catch {
      return false;
    }
    clearTimeout(this.#unitsTimer);
    // With none, nothing is heard from the server: it is asked again in a minute.
    if (units.length === 0 && !this.#stopped) {
      this.#unitsTimer = setTimeout(() => {
        this.#schedule();
      }, 60_000);
    }
    const key = (list: readonly SyncUnit[]) =>
      JSON.stringify(list.map((unit) => [unit.id, unit.level, unit.name, unit.rootNote]));
    if (key(units) === key(this.#units)) return false;
    this.#units = units;
    // A unit no longer opened is let go: its notes leave this vault as removed elsewhere.
    for (const [id, document] of [...this.#documents]) {
      if (units.some((unit) => unit.id === id)) continue;
      document.destroy();
      this.#documents.delete(id);
    }
    this.#openUnits();
    this.#saveSoon();
    return true;
  }

  /** The notes the units' vault documents list: each one's path, and the unit listing it. */
  #listed(): { readonly paths: Map<string, string>; readonly units: Map<string, string> } {
    const paths = new Map<string, string>();
    const units = new Map<string, string>();
    for (const unit of this.#units) {
      for (const [id, path] of vaultPaths(this.#documentOf(unit.id))) {
        if (paths.has(id)) continue;
        paths.set(id, path);
        units.set(id, unit.id);
      }
    }
    return { paths, units };
  }

  /** Where each path belongs: the unit whose area holds it, with the shared pages where they are. */
  #placer(listed: ReadonlyMap<string, string>): (path: string) => SyncUnit | undefined {
    const local = this.#options.vault.paths();
    const pages = new Map<string, string>();
    for (const unit of this.#units) {
      if (unit.rootNote === undefined) continue;
      const path = local.get(unit.rootNote) ?? listed.get(unit.rootNote);
      if (path !== undefined) pages.set(unit.rootNote, path);
    }
    return (path) => unitForPath(path, this.#units, pages);
  }

  #unit(id: string | undefined): SyncUnit | undefined {
    return this.#units.find((unit) => unit.id === id);
  }

  /** Asks the server to put a note in a unit; false when it refuses, as without edit access. */
  async #place(id: string, unit: string): Promise<boolean> {
    const response = await this.#request(`/notes/${id}/unit`, { method: "PUT", json: { unit } });
    if (response.ok) return true;
    if (response.status === 403 || response.status === 404) return false;
    throw new Error(`The server answered ${String(response.status)} moving a note.`);
  }

  /** Tells of the state, and of a failure until the next success. */
  #report(next: Partial<SyncStatus>): void {
    this.#status = {
      state: next.state ?? this.#status.state,
      pending: this.#pending.size,
      ...(next.error === undefined ? {} : { error: next.error }),
      ...(this.#refused.size === 0 ? {} : { refused: [...this.#refused.keys()] }),
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
      if (this.#stopped) return;
      // A unit opened or let go waits for its vault document before the round.
      await this.#refreshUnits();
      if (!this.#live()) return;
      this.#report({ state: "syncing" });
      try {
        await this.#reconcile();
        await this.#catchUp();
        await this.#flush();
        await this.#reconcileFiles();
        this.#openLive();
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
    const listed = this.#listed();
    const plan = reconcilePaths(this.#base, vault.paths(), listed.paths);
    const placer = this.#placer(listed.paths);
    // Each change is agreed on as it is made, so a note moved here while
    // others are fetched is still taken for moved here, not there.
    try {
      for (const id of plan.upload) {
        const path = vault.paths().get(id);
        const unit = path === undefined ? undefined : placer(path);
        // A note in no unit this account may change, as a guest's outside its pages, stays here.
        if (path === undefined || unit === undefined || !writes(unit)) continue;
        if (unit.id !== general && !(await this.#place(id, unit.id))) continue;
        setVaultPath(this.#documentOf(unit.id), id, path);
        this.#base.set(id, path);
        // And its comments, as those made before the vault synced.
        this.#pending.add(id);
        this.#pending.add(`${id}.comments`);
      }
      for (const { id, path } of plan.moveRemote) {
        if (!(await this.#move(id, path, this.#unit(listed.units.get(id)), placer(path)))) continue;
        this.#base.set(id, path);
      }
      for (const id of plan.removeRemote) {
        const from = this.#unit(listed.units.get(id));
        if (from === undefined || !writes(from)) continue;
        removeVaultPath(this.#documentOf(from.id), id);
        this.#base.delete(id);
      }
      // A note listed in a unit its path is no longer in, as one under a page
      // just shared on its own, goes to its path's unit.
      const local = vault.paths();
      for (const [id, path] of listed.paths) {
        if (local.get(id) !== path) continue;
        const from = this.#unit(listed.units.get(id));
        const to = placer(path);
        if (!narrows(from, to) || from === undefined) continue;
        await this.#move(id, path, from, to);
      }
      for (const { id, path } of plan.moveLocal) {
        await vault.move(id, path);
        this.#base.set(id, path);
      }
      for (const id of plan.removeLocal) {
        await vault.remove(id);
        this.#base.delete(id);
      }
      await this.#each(plan.download, async ({ id, path }) => {
        const document = new Y.Doc();
        try {
          await this.#sync(id, document);
          await vault.create(id, path, Y.encodeStateAsUpdate(document));
          this.#base.set(id, path);
          // And its comments, which may have been stored before this device
          // could see them, as in a teamspace just opened to it.
          this.#storedComments.add(`${id}.comments`);
          this.#pending.add(`${id}.comments`);
        } finally {
          document.destroy();
        }
      });
    } finally {
      agree(this.#base, vault.paths(), this.#listed().paths);
      this.#saveSoon();
    }
  }

  /**
   * Lists a note at a path, in the unit that path belongs to: from one unit
   * to another only once the server agrees. False when it is not moved, as
   * where the account may not change notes.
   */
  async #move(
    id: string,
    path: string,
    from: SyncUnit | undefined,
    to: SyncUnit | undefined,
  ): Promise<boolean> {
    if (from === undefined || to === undefined || !writes(to)) return false;
    if (from.id !== to.id) {
      if (!writes(from) || !(await this.#place(id, to.id))) return false;
      removeVaultPath(this.#documentOf(from.id), id);
    }
    setVaultPath(this.#documentOf(to.id), id, path);
    return true;
  }

  /** Lists the notes stored on the server since the last number seen, to sync them. */
  async #catchUp(): Promise<void> {
    const local = this.#options.vault.paths();
    for (;;) {
      const response = await this.#request(`/documents?since=${String(this.#cursor)}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`The server answered ${String(response.status)}.`);
      const answer = (await response.json()) as {
        documents?: { name?: unknown; seq?: unknown }[];
        more?: unknown;
      };
      for (const item of answer.documents ?? []) {
        if (typeof item.seq === "number") this.#cursor = Math.max(this.#cursor, item.seq);
        if (typeof item.name === "string" && local.has(noteOf(item.name))) {
          if (item.name !== noteOf(item.name)) this.#storedComments.add(item.name);
          this.#pending.add(item.name);
        }
      }
      if (answer.more !== true) break;
    }
    this.#saveSoon();
  }

  /** Syncs the notes changed on either side. */
  async #flush(): Promise<void> {
    const vault = this.#options.vault;
    await this.#each([...this.#pending], async (id) => {
      // A note open in an editor syncs live, once listed: a round's sync of it
      // beside the live one would clash on the socket. In an encrypted
      // workspace, which has no live sync, it goes on in rounds. Its
      // comments, beside it, sync in rounds.
      const editing = this.#editing.get(id);
      const live =
        editing !== undefined &&
        (editing.open !== undefined || this.#options.encryption === undefined);
      if (!vault.paths().has(noteOf(id)) || live) {
        this.#pending.delete(id);
        return;
      }
      if (this.#syncing.has(id)) return;
      this.#syncing.add(id);
      // Taken now: a change made while it syncs marks it again.
      this.#pending.delete(id);
      try {
        const comments = id !== noteOf(id);
        const held = comments ? await vault.holdComments(noteOf(id)) : await vault.hold(id);
        try {
          // A note with no comments, here or on the server, has nothing to sync.
          const none =
            comments && !this.#storedComments.has(id) && held.document.store.clients.size === 0;
          if (!none) await this.#sync(id, held.document);
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

  /**
   * Brings this vault's other files and the server's list together: files
   * changed on both sides first move aside here, then files are removed,
   * sent and fetched.
   */
  async #reconcileFiles(): Promise<void> {
    const vault = this.#options.vault;
    let local = await this.#localFiles();
    for (const [path, hash] of this.#refused) {
      if (local.get(path) !== hash) this.#refused.delete(path);
    }
    let listed = this.#listedFiles();
    let plan = reconcileFiles(this.#fileBase, local, hashes(listed.files));
    if (plan.conflict.length > 0) {
      const taken = new Set([...local.keys(), ...listed.files.keys()]);
      for (const path of plan.conflict) {
        const aside = besidePath(path, (candidate) => taken.has(candidate));
        taken.add(aside);
        await vault.moveFile(path, aside);
      }
      local = await this.#localFiles();
      listed = this.#listedFiles();
      plan = reconcileFiles(this.#fileBase, local, hashes(listed.files));
    }
    const remote = listed.files;
    const placer = this.#placer(this.#listed().paths);
    // Agreed on as each change is made, as notes are.
    const base = this.#fileBase;
    try {
      for (const path of plan.removeRemote) {
        const from = this.#unit(listed.units.get(path));
        if (from === undefined || !writes(from)) continue;
        removeVaultFile(this.#documentOf(from.id), path);
        base.delete(path);
      }
      // A file listed in a unit its path is no longer in goes to its path's unit.
      for (const [path, file] of remote) {
        const from = this.#unit(listed.units.get(path));
        const to = placer(path);
        if (!narrows(from, to) || from === undefined || to === undefined) continue;
        if (local.get(path) !== file.hash || !writes(from) || !writes(to)) continue;
        removeVaultFile(this.#documentOf(from.id), path);
        setVaultFile(this.#documentOf(to.id), path, file);
      }
      for (const path of plan.removeLocal) {
        await vault.removeFile(path);
        base.delete(path);
      }
      // Blobs by the hash of their bytes: a file listed once is not sent again.
      const blobs = new Map([...remote.values()].map((file) => [file.hash, file.blob]));
      await this.#each(plan.upload, async (path) => {
        if (this.#refused.get(path) === local.get(path)) return;
        const unit = placer(path);
        if (unit === undefined || !writes(unit)) return;
        const file = await vault.readFile(path);
        const blob = blobs.get(file.hash) ?? (await this.#send(path, file.bytes));
        if (blob === undefined) {
          this.#refused.set(path, file.hash);
          return;
        }
        blobs.set(file.hash, blob);
        // Listed where it belongs, and nowhere else.
        const from = this.#unit(listed.units.get(path));
        if (from !== undefined && from.id !== unit.id && writes(from)) {
          removeVaultFile(this.#documentOf(from.id), path);
        }
        setVaultFile(this.#documentOf(unit.id), path, { hash: file.hash, blob });
        base.set(path, file.hash);
      });
      // Files here by their hash, to copy rather than fetch.
      const copies = new Map([...local].map(([path, hash]) => [hash, path]));
      await this.#each(plan.download, async (path) => {
        const file = remote.get(path);
        if (file === undefined) return;
        const bytes = await this.#fetchFile(path, file, copies.get(file.hash));
        await vault.writeFile(path, bytes, local.get(path) ?? "");
        base.set(path, file.hash);
      });
    } finally {
      agree(base, await this.#localFiles(), hashes(this.#listedFiles().files));
      this.#saveSoon();
    }
  }

  /** The files the units' vault documents list: each one, and the unit listing it. */
  #listedFiles(): { readonly files: Map<string, VaultFile>; readonly units: Map<string, string> } {
    const files = new Map<string, VaultFile>();
    const units = new Map<string, string>();
    for (const unit of this.#units) {
      for (const [path, file] of vaultFiles(this.#documentOf(unit.id))) {
        if (files.has(path)) continue;
        files.set(path, file);
        units.set(path, unit.id);
      }
    }
    return { files, units };
  }

  /** This vault's files that sync, by path, with their hashes. */
  async #localFiles(): Promise<Map<string, string>> {
    const files = await this.#options.vault.files();
    return new Map([...files].filter(([path]) => isSyncedFile(path)));
  }

  /**
   * Sends a file's bytes, encrypted for an encrypted workspace, unless the
   * server has them; gives their blob, or none when the server refuses them.
   */
  async #send(path: string, bytes: Uint8Array): Promise<string | undefined> {
    const encryption = this.#options.encryption;
    const data = encryption === undefined ? bytes : await encryptFile(bytes, encryption.key);
    const blob = await sha256(data);
    const asked = await this.#request(`/attachments/${blob}`, { method: "HEAD" });
    if (asked.ok) return blob;
    if (asked.status !== 404) {
      throw new Error(`The server answered ${String(asked.status)} for ${path}.`);
    }
    const sent = await this.#request(`/attachments/${blob}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: data.slice(),
    });
    // Larger than the server takes, or from a guest, who only reads.
    if (sent.status === 413 || sent.status === 403) return undefined;
    if (!sent.ok) throw new Error(`The server answered ${String(sent.status)} for ${path}.`);
    return blob;
  }

  /** A listed file's bytes: copied from the file here that has them, or fetched, and checked. */
  async #fetchFile(path: string, file: VaultFile, copy: string | undefined): Promise<Uint8Array> {
    if (copy !== undefined) {
      const found = await this.#options.vault.readFile(copy);
      if (found.hash === file.hash) return found.bytes;
    }
    const response = await this.#request(`/attachments/${file.blob}`);
    if (!response.ok) {
      throw new Error(`The server answered ${String(response.status)} for ${path}.`);
    }
    let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
    const encryption = this.#options.encryption;
    if (encryption !== undefined) bytes = await decryptFile(bytes, encryption.keys);
    if ((await sha256(bytes)) !== file.hash) {
      throw new Error(`${path} came from the server other than it was sent.`);
    }
    return bytes;
  }

  /** A request to the workspace's API, with the session's token. */
  #request(
    path: string,
    init: {
      readonly method?: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly body?: Uint8Array<ArrayBuffer>;
      /** A body to send as JSON. */
      readonly json?: unknown;
    } = {},
  ): Promise<Response> {
    const fetcher = this.#options.fetch ?? fetch;
    const { json, ...rest } = init;
    return fetcher(`${this.#options.server}/api/workspaces/${this.#options.workspaceId}${path}`, {
      ...rest,
      headers: {
        authorization: `Bearer ${this.#options.token}`,
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
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

  /**
   * Syncs a document with the server's: both get what the other lacks. A
   * round that reaches a note after sync stopped, as one whose note took
   * long to load, syncs nothing, so stopping does not wait on it.
   */
  #sync(id: string, document: Y.Doc): Promise<void> {
    if (this.#channel === undefined) return Promise.reject(new Error("Sync has not started."));
    if (this.#stopped) return Promise.reject(new Error("Sync stopped."));
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
      files: Object.fromEntries(this.#fileBase),
      vault: Y.encodeStateAsUpdate(this.#vaultDocument),
      units: this.#units,
      vaults: Object.fromEntries(
        [...this.#documents].map(([id, document]) => [id, Y.encodeStateAsUpdate(document)]),
      ),
      channel: this.#channel?.state(),
    });
  }
}

/**
 * Whether a note or file listed in one unit is moved, unasked, to the unit
 * its path is in: only into somewhere narrower, out of General or into a
 * shared page. A teamspace's note never goes to General so, as when this
 * app learns of the teamspace's new name before its notes' new paths.
 */
function narrows(from: SyncUnit | undefined, to: SyncUnit | undefined): boolean {
  if (from === undefined || to === undefined || from.id === to.id) return false;
  return from.id === general || to.kind === "page";
}

/** The note a document belongs to: its own, or the one whose comments it holds. */
function noteOf(document: string): string {
  return document.endsWith(".comments") ? document.slice(0, -".comments".length) : document;
}

/** Files by path: each one's hash. */
function hashes(files: ReadonlyMap<string, VaultFile>): Map<string, string> {
  return new Map([...files].map(([path, file]) => [path, file.hash]));
}

/**
 * Brings what a device and the server agree on up to date: a note or file
 * the same on both sides now is agreed on so, and one on neither is
 * forgotten. One they differ on keeps what they last agreed on, as a note
 * moved here while others were fetched, or a file whose sending failed, so
 * the next round takes it for changed on the side that changed it.
 */
function agree(
  base: Map<string, string>,
  local: ReadonlyMap<string, string>,
  remote: ReadonlyMap<string, string>,
): void {
  for (const key of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
    const here = local.get(key);
    if (here !== remote.get(key)) continue;
    if (here === undefined) base.delete(key);
    else base.set(key, here);
  }
}
