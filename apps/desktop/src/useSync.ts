// The open vault's sync with its workspace, while the vault is open: the
// engine starts once the vault's link and its server's token are known,
// stops when the vault closes or is unlinked, and tells how it is going.
import type { CommentAuthor } from "@nether/editor";
import type { Vault } from "@nether/storage";
import type { Level, SyncStatus, VaultSync } from "@nether/sync-client";
import { colorFor } from "./presence.ts";
import type { GoLive } from "./useLive.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import { type VaultLink, setVaultLink, settingsStore, vaultLink } from "./sync.ts";

export interface VaultSyncState {
  /** The workspace the vault syncs with; undefined when none, or while it is read. */
  readonly link: VaultLink | undefined;
  /** How sync is going, while it runs. */
  readonly status: SyncStatus | undefined;
  /** Whether the app has no session for the link's server, and must sign in again. */
  readonly signedOut: boolean;
  /** Why sync cannot start, as an encrypted workspace locked on this device; tried again meanwhile. */
  readonly problem: string | undefined;
  /** Links the vault to a workspace, and starts syncing it. */
  linkTo(link: VaultLink): Promise<void>;
  /** Stops syncing the vault, forgetting what sync knew. */
  unlink(): Promise<void>;
  /** Syncs an open note live, with the others' carets (ADR 0043), while sync runs. */
  readonly live: GoLive | undefined;
  /** Who this person is in the workspace, as their comments name them; undefined when not linked. */
  readonly me: CommentAuthor | undefined;
  /** The access this account has to a note, while sync runs and knows it. */
  readonly levelOf: ((id: string) => Level | undefined) | undefined;
}

export function useSync(vault: Vault | undefined): VaultSyncState {
  const [link, setLink] = useState<VaultLink | undefined>();
  const [status, setStatus] = useState<SyncStatus | undefined>();
  const [signedOut, setSignedOut] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [live, setLive] = useState<GoLive | undefined>();
  const [me, setMe] = useState<CommentAuthor | undefined>();
  const [levelOf, setLevelOf] = useState<((id: string) => Level | undefined) | undefined>();
  // Bumped to start again, as after signing in.
  const [round, setRound] = useState(0);
  const running = useRef<VaultSync | undefined>(undefined);

  useEffect(() => {
    setLink(undefined);
    if (vault === undefined) return;
    let current = true;
    void vaultLink(vault).then((found) => {
      if (current) setLink(found);
    });
    return () => {
      current = false;
    };
  }, [vault]);

  // The account the vault syncs as, known offline too, from the servers signed in to.
  useEffect(() => {
    setMe(undefined);
    if (link === undefined) return;
    let current = true;
    void backend.servers().then((servers) => {
      const user = servers.find((account) => account.url === link.server)?.user;
      if (current && user !== undefined) setMe({ id: user.id, name: user.name });
    });
    return () => {
      current = false;
    };
  }, [link, round]);

  useEffect(() => {
    setStatus(undefined);
    setSignedOut(false);
    setProblem(undefined);
    if (vault === undefined || link === undefined) return;
    let engine: VaultSync | undefined;
    let current = true;
    const stopped = () => !current;
    void (async () => {
      const token = await backend.serverToken(link.server);
      if (stopped()) return;
      if (token === undefined) {
        setSignedOut(true);
        return;
      }
      // The engine, and the editor's code it needs, load for a linked vault only.
      const [{ VaultSync }, { DesktopSyncVault }, { noteDocuments }, { noteComments }, socket] =
        await Promise.all([
          import("@nether/sync-client"),
          import("./syncVault.ts"),
          import("./noteDocuments.ts"),
          import("./noteComments.ts"),
          backend.syncSocket(),
        ]);
      if (stopped()) return;
      // An encrypted workspace's key, opened with this device's private key;
      // members waiting for it get it from whoever has it and is here.
      let encryption:
        Awaited<ReturnType<typeof import("./encryption.ts").workspaceEncryption>> | undefined;
      if (link.encrypted === true) {
        const { shareWorkspaceKey, workspaceEncryption } = await import("./encryption.ts");
        try {
          encryption = await workspaceEncryption(link.server, token, link.workspaceId);
        } catch (error) {
          if (!stopped()) setProblem(error instanceof Error ? error.message : String(error));
          return;
        }
        void shareWorkspaceKey(link.server, token, link.workspaceId, encryption).catch(
          () => undefined,
        );
      }
      if (stopped()) return;
      const started = await VaultSync.start({
        server: link.server,
        token,
        workspaceId: link.workspaceId,
        vault: new DesktopSyncVault(vault, noteDocuments(vault), noteComments(vault)),
        store: settingsStore(vault),
        fetch: backend.serverFetch,
        WebSocket: socket,
        ...(encryption === undefined ? {} : { encryption }),
        onStatus: (next) => {
          if (!stopped()) setStatus(next);
        },
      });
      if (stopped()) {
        await started.stop();
        return;
      }
      engine = started;
      running.current = started;
      // Who this person is to the others editing a note with them.
      const me = (await backend.servers()).find((account) => account.url === link.server)?.user;
      const editor = { name: me?.name ?? "", color: colorFor(me?.id ?? link.server) };
      if (!stopped()) {
        setLive(
          () => (id: string, document: Parameters<GoLive>[1]) => started.live(id, document, editor),
        );
        setLevelOf(() => (id: string) => started.level(id));
      }
    })();
    return () => {
      current = false;
      setLive(undefined);
      setLevelOf(undefined);
      if (running.current === engine) running.current = undefined;
      void engine?.stop();
    };
  }, [vault, link, round]);

  // Signing in to the link's server, in the servers dialog, starts sync again.
  useEffect(() => {
    if (!signedOut) return;
    const timer = setInterval(() => {
      if (link === undefined) return;
      void backend.serverToken(link.server).then((token) => {
        if (token !== undefined) setRound((count) => count + 1);
      });
    }, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [signedOut, link]);

  // A workspace locked here, or whose key no member has shared yet, is tried
  // again now and then: unlocking it, or a member sharing it, starts sync.
  useEffect(() => {
    if (problem === undefined) return;
    const timer = setInterval(() => {
      setRound((count) => count + 1);
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [problem]);

  const linkTo = useCallback(
    async (next: VaultLink) => {
      if (vault === undefined) return;
      await setVaultLink(vault, next);
      setLink(next);
    },
    [vault],
  );

  const unlink = useCallback(async () => {
    if (vault === undefined) return;
    // Stopped first, so its last save does not bring back what is forgotten.
    await running.current?.stop();
    await setVaultLink(vault, undefined);
    setLink(undefined);
  }, [vault]);

  return { link, status, signedOut, problem, linkTo, unlink, live, me, levelOf };
}
