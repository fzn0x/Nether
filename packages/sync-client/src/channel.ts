// How the engine syncs documents with the server (ADRs 0037 and 0038):
// through Hocuspocus for a workspace the server can read, or through the
// relay, encrypted, for one it cannot. Either keeps the vault documents of
// the account's units (ADR 0042) synced while open, syncs a note's document
// when asked, and says when the server stored a note elsewhere.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/** What a channel tells the engine. */
export interface ChannelEvents {
  /** The vault document has the server's state, as after each connection. */
  onSynced(): void;
  /** A note's document was stored on the server by another device. */
  onStored(document: string): void;
  /** The connection is gone, or was refused. */
  onOffline(error?: string): void;
}

/** A note's document syncing live, while its editor is open (ADR 0043). */
export interface LiveDocument {
  stop(): void;
}

export interface Channel {
  /** Whether the vault documents are synced with the server's now. */
  readonly synced: boolean;
  /**
   * Keeps these vault documents synced, by their names after the
   * workspace's ID, and no others: the units' as the account opens them.
   */
  vaults(documents: ReadonlyMap<string, Y.Doc>): void;
  /** Syncs a note's document: both sides get what the other lacks. */
  sync(id: string, document: Y.Doc): Promise<void>;
  /**
   * Keeps a note's document synced as it changes on either side, with the
   * awareness that tells where each person is in it, until stopped; none
   * where the channel cannot.
   */
  live(id: string, document: Y.Doc, awareness: Awareness): LiveDocument | undefined;
  /** What the channel keeps between runs, as the sync record's `channel`. */
  state(): unknown;
  close(): void;
}

/** Where a channel connects, and as whom. */
export interface ChannelOptions {
  readonly server: string;
  readonly token: string;
  readonly workspaceId: string;
  readonly WebSocket?: unknown;
}

/** The sync WebSocket's address for a server's. */
export function socketUrl(server: string, path: string): string {
  return `${server.replace(/^http/, "ws")}${path}`;
}

/** What the vault document's clients hear when a note is stored. */
interface Stored {
  readonly type: "stored";
  readonly document: string;
}

function isStored(value: unknown): value is Stored {
  const stored = value as Partial<Stored> | null;
  return (
    typeof stored === "object" &&
    stored !== null &&
    stored.type === "stored" &&
    typeof stored.document === "string"
  );
}

/** Syncing through Hocuspocus, which merges and stores each document itself. */
export class HocuspocusChannel implements Channel {
  readonly #options: ChannelOptions;
  readonly #events: ChannelEvents;
  readonly #socket: HocuspocusProviderWebsocket;
  /** Each vault document syncing, by its name. */
  readonly #vaults = new Map<string, { document: Y.Doc; provider: HocuspocusProvider }>();
  /** How to give up on each document syncing now, when the channel closes. */
  readonly #inflight = new Set<(error: Error) => void>();
  #closed = false;

  constructor(options: ChannelOptions, events: ChannelEvents) {
    this.#options = options;
    this.#events = events;
    this.#socket = new HocuspocusProviderWebsocket({
      url: socketUrl(options.server, "/api/sync"),
      ...(options.WebSocket === undefined ? {} : { WebSocketPolyfill: options.WebSocket }),
    });
  }

  get synced(): boolean {
    if (this.#vaults.size === 0) return false;
    for (const { provider } of this.#vaults.values()) if (!provider.isSynced) return false;
    return true;
  }

  vaults(documents: ReadonlyMap<string, Y.Doc>): void {
    if (this.#closed) return;
    for (const [name, vault] of [...this.#vaults]) {
      if (documents.get(name) === vault.document) continue;
      vault.provider.destroy();
      this.#vaults.delete(name);
    }
    const events = this.#events;
    for (const [name, document] of documents) {
      if (this.#vaults.has(name)) continue;
      const provider = new HocuspocusProvider({
        websocketProvider: this.#socket,
        name: `${this.#options.workspaceId}/${name}`,
        document,
        token: this.#options.token,
        onSynced: () => {
          events.onSynced();
        },
        onStateless: ({ payload }) => {
          let stored: unknown;
          try {
            stored = JSON.parse(payload);
          } catch {
            return;
          }
          if (isStored(stored)) events.onStored(stored.document);
        },
        onAuthenticationFailed: ({ reason }) => {
          events.onOffline(reason);
        },
        onDisconnect: () => {
          events.onOffline();
        },
      });
      this.#vaults.set(name, { document, provider });
      provider.attach();
    }
  }

  sync(id: string, document: Y.Doc): Promise<void> {
    // The socket is gone: no answer would ever come.
    if (this.#closed) return Promise.reject(new Error("Sync stopped."));
    return new Promise((resolve, reject) => {
      const provider = new HocuspocusProvider({
        websocketProvider: this.#socket,
        name: `${this.#options.workspaceId}/${id}`,
        document,
        token: this.#options.token,
        // A note syncing is not a person there: no cursor to show.
        awareness: null,
      });
      const done = (error?: Error) => {
        this.#inflight.delete(done);
        provider.off("synced", check);
        provider.off("unsyncedChanges", check);
        provider.destroy();
        if (error === undefined) resolve();
        else reject(error);
      };
      this.#inflight.add(done);
      // Synced once the server has this side's changes too, or, for a
      // guest, whose changes it refuses, once it has sent its own.
      function check() {
        if (!provider.isSynced) return;
        if (!provider.hasUnsyncedChanges || provider.authorizedScope === "readonly") done();
      }
      provider.on("synced", check);
      provider.on("unsyncedChanges", check);
      provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
        done(new Error(reason));
      });
      provider.attach();
    });
  }

  live(id: string, document: Y.Doc, awareness: Awareness): LiveDocument | undefined {
    if (this.#closed) return undefined;
    const provider = new HocuspocusProvider({
      websocketProvider: this.#socket,
      name: `${this.#options.workspaceId}/${id}`,
      document,
      token: this.#options.token,
      awareness,
    });
    provider.attach();
    return {
      stop: () => {
        // The awareness is the caller's, which outlives the provider.
        provider.detach();
        provider.destroy();
      },
    };
  }

  state(): undefined {
    return undefined;
  }

  close(): void {
    this.#closed = true;
    // A document syncing now gets no answer once the socket is gone.
    for (const giveUp of this.#inflight) giveUp(new Error("Sync stopped."));
    for (const { provider } of this.#vaults.values()) provider.destroy();
    this.#vaults.clear();
    this.#socket.destroy();
  }
}
