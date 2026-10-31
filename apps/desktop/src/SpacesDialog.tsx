// The spaces of the workspace the vault syncs with (ADR 0042): General,
// which every member opens; teamspaces, each a top-level folder its members
// open; and a private space, the `Private` folder its member alone opens.
// Naming a teamspace as a folder here makes that folder the teamspace's,
// and its notes leave General. Those with full access to a teamspace choose
// who opens it, rename it, or delete it once it is empty.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import {
  type ServerUnit,
  deleteTeamspace,
  levelName,
  makePrivateSpace,
  makeTeamspace,
  renameTeamspace,
  units,
} from "./server.ts";
import type { VaultLink } from "./sync.ts";
import { UnitPeople } from "./UnitPeople.tsx";
import { useModal } from "./useModal.ts";

export function SpacesDialog(props: {
  readonly link: VaultLink;
  /** The vault's top-level folders, which a new teamspace may take. */
  readonly folders: readonly string[];
  readonly onClose: () => void;
}) {
  const { link, folders, onClose } = props;
  const [list, setList] = useState<readonly ServerUnit[] | undefined>();
  const [name, setName] = useState("");
  const [managing, setManaging] = useState<string | undefined>();
  const [rename, setRename] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog);
  const { server, workspaceId } = link;

  const token = useCallback(async () => {
    const found = await backend.serverToken(server);
    if (found === undefined) throw new Error(t("syncSignedOut", { server }));
    return found;
  }, [server]);

  const load = useCallback(async () => {
    setList(await units(backend.serverFetch, server, await token(), workspaceId));
  }, [token, server, workspaceId]);

  const report = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
  }, []);

  useEffect(() => {
    load().catch(report);
  }, [load, report]);

  const act = (work: (session: string) => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    token()
      .then(async (session) => {
        const said = await work(session);
        await load();
        setStatus(said);
      })
      .catch(report)
      .finally(() => {
        setBusy(false);
      });
  };

  const spaces = (list ?? []).filter((unit) => unit.kind !== "page");
  const teamspaces = spaces.filter((unit) => unit.kind === "team");
  const hasPrivate = spaces.some((unit) => unit.kind === "private");
  const managed = teamspaces.find((unit) => unit.id === managing);

  const describe = (unit: ServerUnit): ReactNode =>
    unit.kind === "general"
      ? t("spaceGeneral")
      : unit.kind === "private"
        ? t("spacePrivate")
        : t("spaceTeam", { level: levelName(unit.level) });

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="switcher dialog members-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spaces-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="spaces-title">{t("spacesTitle", { workspace: link.workspaceName })}</h2>
        <ul className="member-list" aria-label={t("spacesList")}>
          {spaces.map((unit) => (
            <li key={unit.id}>
              <span className="member-name">
                {unit.kind === "general"
                  ? t("spaceGeneralName")
                  : unit.kind === "private"
                    ? t("spacePrivateName")
                    : unit.name}
              </span>
              <span className="hint">{describe(unit)}</span>
              {unit.kind === "team" && unit.level === "full" ? (
                <button
                  type="button"
                  className="quiet"
                  aria-expanded={managing === unit.id}
                  onClick={() => {
                    setManaging(managing === unit.id ? undefined : unit.id);
                    setRename(unit.name ?? "");
                  }}
                >
                  {t("spaceManage", { name: unit.name ?? "" })}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {managed === undefined ? null : (
          <section aria-labelledby="managed-title">
            <h3 id="managed-title">{managed.name}</h3>
            <UnitPeople
              link={link}
              unit={managed.id}
              kind="team"
              onStatus={setStatus}
              onError={setError}
            />
            <form
              className="unit-add"
              onSubmit={(event) => {
                event.preventDefault();
                act(async (session) => {
                  await renameTeamspace(
                    backend.serverFetch,
                    server,
                    session,
                    workspaceId,
                    managed.id,
                    rename.trim(),
                  );
                  return t("spaceRenamed", { name: rename.trim() });
                });
              }}
            >
              <label className="field">
                {t("spaceRename")}
                <input
                  type="text"
                  required
                  value={rename}
                  onChange={(event) => {
                    setRename(event.target.value);
                  }}
                />
              </label>
              <button type="submit" disabled={busy}>
                {t("spaceRenameDo")}
              </button>
            </form>
            <button
              type="button"
              className="quiet danger"
              disabled={busy}
              onClick={() => {
                act(async (session) => {
                  await deleteTeamspace(
                    backend.serverFetch,
                    server,
                    session,
                    workspaceId,
                    managed.id,
                  );
                  setManaging(undefined);
                  return t("spaceDeleted", { name: managed.name ?? "" });
                });
              }}
            >
              {t("spaceDelete", { name: managed.name ?? "" })}
            </button>
          </section>
        )}
        <form
          className="unit-add"
          onSubmit={(event) => {
            event.preventDefault();
            const chosen = name.trim();
            act(async (session) => {
              await makeTeamspace(backend.serverFetch, server, session, workspaceId, chosen);
              setName("");
              return t("spaceMade", { name: chosen });
            });
          }}
        >
          <label className="field">
            {t("spaceNew")}
            <input
              type="text"
              required
              list="space-folders"
              value={name}
              aria-describedby="space-new-hint"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <datalist id="space-folders">
              {folders.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
            <span id="space-new-hint" className="hint">
              {t("spaceNewHint")}
            </span>
          </label>
          <button type="submit" disabled={busy}>
            {t("spaceMake")}
          </button>
        </form>
        {hasPrivate || list === undefined ? null : (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => {
              act(async (session) => {
                await makePrivateSpace(backend.serverFetch, server, session, workspaceId);
                return t("spacePrivateMade");
              });
            }}
          >
            {t("spacePrivateMake")}
          </button>
        )}
        {status === undefined ? null : <p role="status">{status}</p>}
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
