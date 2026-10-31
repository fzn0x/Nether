// Syncing the open vault with a workspace (ADR 0037): on a server the app is
// signed in to, a workspace of the account's, linked only while it has no
// notes or the vault has none, so no note's text is made twice; and how
// sync is going, with the way to stop it.
import type { Vault } from "@nether/storage";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import type { ServerAccount } from "./mygo.ts";
import { type Workspace, account, request } from "./server.ts";
import { type VaultLink, hostOf, syncSummary } from "./sync.ts";
import { useModal } from "./useModal.ts";
import type { VaultSyncState } from "./useSync.ts";

export function SyncDialog(props: {
  readonly vault: Vault;
  readonly sync: VaultSyncState;
  readonly onServers: () => void;
  readonly onClose: () => void;
}) {
  const { vault, sync, onServers, onClose } = props;
  const [servers, setServers] = useState<readonly ServerAccount[] | undefined>();
  const [server, setServer] = useState<string | undefined>();
  const [workspaces, setWorkspaces] = useState<readonly Workspace[] | undefined>();
  const [workspace, setWorkspace] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  useEffect(() => {
    let current = true;
    void backend.servers().then((list) => {
      if (!current) return;
      setServers(list);
      setServer(list[0]?.url);
    });
    return () => {
      current = false;
    };
  }, []);

  // The workspaces of the account on the server chosen.
  useEffect(() => {
    setWorkspaces(undefined);
    setWorkspace(undefined);
    if (server === undefined) return;
    let current = true;
    // Read through a function: the effect's cleanup changes it during the waits.
    const live = () => current;
    void (async () => {
      try {
        const token = await backend.serverToken(server);
        if (token === undefined) throw new Error(t("syncSignedOut", { server: hostOf(server) }));
        const found = await account(backend.serverFetch, server, token);
        if (!live()) return;
        setWorkspaces(found.workspaces);
        setWorkspace(found.workspaces[0]?.id);
      } catch (reason) {
        if (live()) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      current = false;
    };
  }, [server]);

  const start = async () => {
    const chosen = workspaces?.find((item) => item.id === workspace);
    if (server === undefined || chosen === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const token = await backend.serverToken(server);
      if (token === undefined) throw new Error(t("syncSignedOut", { server: hostOf(server) }));
      // One side starts empty: the workspace, which this vault fills, or this
      // vault, which the workspace fills.
      const listed = (await request(
        backend.serverFetch,
        server,
        `/api/workspaces/${chosen.id}/documents`,
        { token },
      )) as { documents?: unknown[] } | undefined;
      const hasNotes = (listed?.documents ?? []).length > 0;
      if (hasNotes && vault.notes().length > 0) {
        throw new Error(t("syncBothHaveNotes", { workspace: chosen.name }));
      }
      const link: VaultLink = { server, workspaceId: chosen.id, workspaceName: chosen.name };
      await sync.linkTo(link);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await sync.unlink();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const linked = sync.link;
  let body;
  if (linked !== undefined) {
    body = (
      <>
        <p>{t("syncLinked", { workspace: linked.workspaceName, server: hostOf(linked.server) })}</p>
        <p role="status">{syncSummary(linked, sync.status, sync.signedOut)}</p>
        {sync.signedOut ? (
          <button type="button" className="quiet" onClick={onServers}>
            {t("command_servers")}
          </button>
        ) : null}
      </>
    );
  } else if (servers === undefined) {
    body = null;
  } else if (servers.length === 0) {
    body = (
      <>
        <p className="hint">{t("syncSignInFirst")}</p>
        <button type="button" className="quiet" data-autofocus onClick={onServers}>
          {t("command_servers")}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p className="hint">{t("syncHint")}</p>
        <label className="field">
          {t("syncServer")}
          <select
            value={server ?? ""}
            onChange={(event) => {
              setError(undefined);
              setServer(event.target.value);
            }}
          >
            {servers.map((item) => (
              <option key={item.url} value={item.url}>
                {t("syncServerAccount", { server: hostOf(item.url), name: item.user.name })}
              </option>
            ))}
          </select>
        </label>
        {workspaces === undefined ? null : workspaces.length === 0 ? (
          <p className="hint">
            {t("syncNoWorkspaces", { server: hostOf(server ?? "http://unknown") })}
          </p>
        ) : (
          <label className="field">
            {t("syncWorkspace")}
            <select
              value={workspace ?? ""}
              onChange={(event) => {
                setError(undefined);
                setWorkspace(event.target.value);
              }}
            >
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    );
  }

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="switcher dialog settings-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (linked === undefined && workspace !== undefined) void start();
          else onClose();
        }}
        onKeyDown={onKeyDown}
      >
        <h2 id="sync-title">{t("syncTitle")}</h2>
        <div className="dialog-body">{body}</div>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          {linked === undefined ? null : (
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                void stop();
              }}
            >
              {t("syncStop")}
            </button>
          )}
          {linked === undefined && workspace !== undefined ? (
            <button type="submit" className="primary" disabled={busy}>
              {t("syncStart")}
            </button>
          ) : (
            <button type="submit" className="primary">
              {t("done")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
