// The open vault's sync with its workspace, while the vault is open: the
// engine starts once the vault's link and its server's token are known,
// stops when the vault closes or is unlinked, and tells how it is going.
import type { Vault } from "@nether/storage";
import type { SyncStatus, VaultSync } from "@nether/sync-client";
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
  /** Links the vault to a workspace, and starts syncing it. */
  linkTo(link: VaultLink): Promise<void>;
  /** Stops syncing the vault, forgetting what sync knew. */
  unlink(): Promise<void>;
}

export function useSync(vault: Vault | undefined): VaultSyncState {
  const [link, setLink] = useState<VaultLink | undefined>();
  const [status, setStatus] = useState<SyncStatus | undefined>();
  const [signedOut, setSignedOut] = useState(false);
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

  useEffect(() => {
    setStatus(undefined);
    setSignedOut(false);
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
      const [{ VaultSync }, { DesktopSyncVault }, { noteDocuments }, socket] = await Promise.all([
        import("@nether/sync-client"),
        import("./syncVault.ts"),
        import("./noteDocuments.ts"),
        backend.syncSocket(),
      ]);
      if (stopped()) return;
      const started = await VaultSync.start({
        server: link.server,
        token,
        workspaceId: link.workspaceId,
        vault: new DesktopSyncVault(vault, noteDocuments(vault)),
        store: settingsStore(vault),
        fetch: backend.serverFetch,
        WebSocket: socket,
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
    })();
    return () => {
      current = false;
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

  return { link, status, signedOut, linkTo, unlink };
}
