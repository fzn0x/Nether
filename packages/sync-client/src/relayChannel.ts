// Syncing an encrypted workspace through the server's relay (ADR 0038). The
// server keeps each document's updates in order without reading them, so
// the client does what Hocuspocus does for the others:
//
// - it subscribes to a document after the last number it applied, decrypts
//   the updates that come, and applies them;
// - it sends only its own changes: the document's Yjs snapshot (its state
//   vector and deleted items) is kept as last sent, and a document whose
//   snapshot differs sends its diff from that state, encrypted, taken
//   before the server's updates are applied;
// - once a document's log on the server grows long, it sends a snapshot
//   that replaces it.
//
// The vault document stays subscribed while the channel is open, and
// sends each change of its own as it is made.
import * as Y from "yjs";
import type { Channel, ChannelEvents, ChannelOptions } from "./channel.ts";
import { socketUrl } from "./channel.ts";
import { type WorkspaceKey, decryptUpdate, encryptUpdate } from "./crypto.ts";

/** What the channel keeps of a document between runs. */
interface DocumentState {
  /** The number of the last update applied. */
  cursor: number;
  /** The document's Yjs snapshot as last sent, encoded, in base64. */
  sent: string;
}

/** Updates in a document's log past which a client replaces them with a snapshot. */
const compactAfter = 50;

/** The origin of updates that come from the server, which are not sent back. */
const fromServer = Symbol("relay");

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A document's snapshot, encoded, to tell whether it changed since it was sent. */
function snapshotOf(document: Y.Doc): string {
  return toBase64(Y.encodeSnapshot(Y.snapshot(document)));
}

/** The state a document was last sent at, or nothing yet. */
function sentVector(state: DocumentState | undefined): Uint8Array | undefined {
  if (state === undefined || state.sent === "") return undefined;
  return Y.encodeStateVector(Y.decodeSnapshot(fromBase64(state.sent)).sv);
}

type Message = Readonly<Record<string, unknown>>;

/** Whether a document's state, as read back from where it was kept, is whole. */
function isDocumentState(value: unknown): value is DocumentState {
  if (typeof value !== "object" || value === null) return false;
  const { cursor, sent } = value as Record<string, unknown>;
  return typeof cursor === "number" && typeof sent === "string";
}

/** A document's own changes, and the snapshot they were taken at. */
interface Changes {
  readonly own: Uint8Array | undefined;
  readonly at: string;
}

interface Subscription {
  readonly document: Y.Doc;
  /** How many updates came since subscribing. */
  received: number;
  readonly subscribed: (seq: number) => void;
  readonly failed: (error: Error) => void;
}

export interface RelayOptions extends ChannelOptions {
  /** The workspace's key to encrypt with, at its latest version. */
  readonly key: WorkspaceKey;
  /** Every version of the workspace's key this device has, to decrypt with. */
  readonly keys: ReadonlyMap<number, Uint8Array>;
}

export class RelayChannel implements Channel {
  readonly #options: RelayOptions;
  readonly #vaultDocument: Y.Doc;
  readonly #events: ChannelEvents;
  readonly #documents: Map<string, DocumentState>;
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #acks = new Map<
    string,
    { resolve: (message: Message) => void; reject: (error: Error) => void }
  >();
  #socket: WebSocket | undefined;
  #ready = false;
  #synced = false;
  #closed = false;
  #retry = 1000;
  #nextId = 0;
  /** Messages are handled in order: an update applies after the ones before it. */
  #incoming: Promise<void> = Promise.resolve();
  #vaultTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the vault document changed here before it was synced, to send once it is. */
  #changedWhileSyncing = false;

  constructor(options: RelayOptions, vaultDocument: Y.Doc, events: ChannelEvents, saved: unknown) {
    this.#options = options;
    this.#vaultDocument = vaultDocument;
    this.#events = events;
    this.#documents = new Map(
      Object.entries((saved ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, DocumentState] => isDocumentState(entry[1]),
      ),
    );
    vaultDocument.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin === fromServer) return;
      if (!this.#synced) {
        this.#changedWhileSyncing = true;
        return;
      }
      clearTimeout(this.#vaultTimer);
      this.#vaultTimer = setTimeout(() => {
        void this.#sendVault().catch((error: unknown) => {
          this.#events.onOffline(error instanceof Error ? error.message : String(error));
        });
      }, 100);
    });
    this.#connect();
  }

  get synced(): boolean {
    return this.#synced;
  }

  #name(id: string): string {
    return `${this.#options.workspaceId}/${id}`;
  }

  #connect(): void {
    if (this.#closed) return;
    const Socket = (this.#options.WebSocket ?? WebSocket) as typeof WebSocket;
    const socket = new Socket(socketUrl(this.#options.server, "/api/relay"));
    this.#socket = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token: this.#options.token }));
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      const text = String(event.data);
      this.#incoming = this.#incoming
        .then(() => this.#receive(JSON.parse(text) as Message))
        .catch((error: unknown) => {
          this.#events.onOffline(error instanceof Error ? error.message : String(error));
        });
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#ready = false;
      this.#synced = false;
      const gone = new Error("The connection to the server closed.");
      for (const subscription of this.#subscriptions.values()) subscription.failed(gone);
      this.#subscriptions.clear();
      for (const ack of this.#acks.values()) ack.reject(gone);
      this.#acks.clear();
      if (this.#closed) return;
      this.#events.onOffline(event.code === 4401 ? "Sign in again." : undefined);
      // Back after a while, waiting longer each time it fails.
      setTimeout(() => {
        this.#connect();
      }, this.#retry);
      this.#retry = Math.min(this.#retry * 2, 30_000);
    });
  }

  #send(message: object): void {
    // Open is 1 in every WebSocket class, the desktop app's through Go included.
    if (this.#socket?.readyState !== 1) throw new Error("Not connected to the server.");
    this.#socket.send(JSON.stringify(message));
  }

  /** Sends a message that is answered by its ID, and waits for the answer. */
  #ask(message: Record<string, unknown>): Promise<Message> {
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      this.#acks.set(id, { resolve, reject });
      try {
        this.#send({ ...message, id });
      } catch (error) {
        this.#acks.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async #receive(message: Message): Promise<void> {
    if (message.type === "ready") {
      this.#ready = true;
      this.#retry = 1000;
      // Not waited for here: its answers come through this same queue.
      void this.#syncVault().catch((error: unknown) => {
        this.#events.onOffline(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    if (typeof message.id === "string" && this.#acks.has(message.id)) {
      const ack = this.#acks.get(message.id);
      this.#acks.delete(message.id);
      if (message.type === "error") ack?.reject(new Error(String(message.message)));
      else ack?.resolve(message);
      return;
    }
    if (message.type === "stored" && typeof message.document === "string") {
      this.#events.onStored(message.document);
      return;
    }
    const name = typeof message.name === "string" ? message.name : undefined;
    const subscription = name === undefined ? undefined : this.#subscriptions.get(name);
    if (message.type === "updates" && name !== undefined && subscription !== undefined) {
      try {
        for (const update of (message.updates ?? []) as { seq: number; data: string }[]) {
          const plain = await decryptUpdate(fromBase64(update.data), this.#options.keys, name);
          Y.applyUpdate(subscription.document, plain, fromServer);
          const state = this.#documents.get(name) ?? { cursor: 0, sent: "" };
          state.cursor = Math.max(state.cursor, update.seq);
          this.#documents.set(name, state);
          subscription.received += 1;
        }
      } catch (error) {
        // An update that cannot be read fails the document's sync, which
        // then sends nothing and never replaces the log it could not read.
        const failure = error instanceof Error ? error : new Error(String(error));
        subscription.failed(failure);
        if (this.#ready) this.#send({ type: "unsubscribe", name });
        if (name === this.#name("vault")) this.#events.onOffline(failure.message);
      }
    } else if (message.type === "subscribed" && name !== undefined && subscription !== undefined) {
      subscription.subscribed(typeof message.seq === "number" ? message.seq : 0);
    } else if (message.type === "error" && subscription !== undefined && name !== undefined) {
      subscription.failed(new Error(String(message.message)));
    } else if (message.type === "error") {
      this.#events.onOffline(String(message.message));
    }
  }

  /** Subscribes to a document, and waits for the updates stored before it to apply. */
  #subscribe(name: string, document: Y.Doc): Promise<Subscription> {
    return new Promise((resolve, reject) => {
      const subscription: Subscription = {
        document,
        received: 0,
        subscribed: () => {
          resolve(subscription);
        },
        failed: (error) => {
          this.#subscriptions.delete(name);
          reject(error);
        },
      };
      this.#subscriptions.set(name, subscription);
      try {
        this.#send({ type: "subscribe", name, after: this.#documents.get(name)?.cursor ?? 0 });
      } catch (error) {
        subscription.failed(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Sends a document's own changes since it was last sent, then keeps as
   * sent the snapshot they were taken at; replaces a long log with a snapshot.
   */
  async #exchange(name: string, document: Y.Doc, changes: Changes, received: number) {
    const state = this.#documents.get(name) ?? { cursor: 0, sent: "" };
    const { own } = changes;
    if (own !== undefined) {
      const data = await encryptUpdate(own, this.#options.key, name);
      const pushed = await this.#ask({ type: "push", name, data: toBase64(data) });
      if (typeof pushed.seq === "number") state.cursor = Math.max(state.cursor, pushed.seq);
    }
    if (received > compactAfter && state.cursor > 0) {
      const data = await encryptUpdate(Y.encodeStateAsUpdate(document), this.#options.key, name);
      await this.#ask({ type: "compact", name, through: state.cursor, data: toBase64(data) });
    }
    // Sent: the document as it was when its changes were taken. An edit made
    // since, while this went on, is not, and goes the next time; what came
    // from the server since may go back once, which Yjs ignores.
    state.sent = changes.at;
    this.#documents.set(name, state);
  }

  /** This side's changes to a document since it was last sent, and the snapshot they are taken at. */
  #ownChanges(name: string, document: Y.Doc): Changes {
    const at = snapshotOf(document);
    const state = this.#documents.get(name);
    if (state?.sent === at) return { own: undefined, at };
    const vector = sentVector(state);
    const own =
      vector === undefined
        ? Y.encodeStateAsUpdate(document)
        : Y.encodeStateAsUpdate(document, vector);
    // An update with nothing in it, as a new document's, is not worth sending.
    const empty = own.length === 2 && own[0] === 0 && own[1] === 0;
    return { own: empty ? undefined : own, at };
  }

  /** Subscribes to the vault document, sends what it has of its own, and tells the engine. */
  async #syncVault(): Promise<void> {
    const name = this.#name("vault");
    const own = this.#ownChanges(name, this.#vaultDocument);
    this.#changedWhileSyncing = false;
    const subscription = await this.#subscribe(name, this.#vaultDocument);
    await this.#exchange(name, this.#vaultDocument, own, subscription.received);
    this.#synced = true;
    this.#events.onSynced();
    // What changed here meanwhile, which waited for the vault to be synced.
    if (this.#hadChanges()) await this.#sendVault();
  }

  /** Whether the vault document changed here while it was syncing; read anew after each wait. */
  #hadChanges(): boolean {
    return this.#changedWhileSyncing;
  }

  /** Sends the vault document's own changes as they are made. */
  async #sendVault(): Promise<void> {
    if (!this.#synced) return;
    const name = this.#name("vault");
    await this.#exchange(name, this.#vaultDocument, this.#ownChanges(name, this.#vaultDocument), 0);
  }

  async sync(id: string, document: Y.Doc): Promise<void> {
    if (!this.#ready) throw new Error("Not connected to the server.");
    const name = this.#name(id);
    // Taken before the server's updates apply: only this side's changes are sent.
    const own = this.#ownChanges(name, document);
    const subscription = await this.#subscribe(name, document);
    try {
      await this.#exchange(name, document, own, subscription.received);
    } finally {
      this.#subscriptions.delete(name);
      if (this.#isReady()) this.#send({ type: "unsubscribe", name });
    }
  }

  /** Whether the socket is signed in; read anew after each wait. */
  #isReady(): boolean {
    return this.#ready;
  }

  state(): Record<string, DocumentState> {
    return Object.fromEntries(this.#documents);
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#vaultTimer);
    const socket = this.#socket;
    this.#socket = undefined;
    const gone = new Error("Sync stopped.");
    for (const subscription of this.#subscriptions.values()) subscription.failed(gone);
    this.#subscriptions.clear();
    for (const ack of this.#acks.values()) ack.reject(gone);
    this.#acks.clear();
    socket?.close();
  }
}
