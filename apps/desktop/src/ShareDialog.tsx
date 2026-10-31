// Sharing the open page (ADR 0042). A page goes with the space it is in,
// until it is shared on its own: it and its subpages then become a unit,
// which keeps the people of where it sits unless it is restricted to its
// own. Those with full access to it give members a level, invite guests by
// a link, and stop sharing it on its own, when it goes back where it sits.
import type { NoteEntry } from "@nether/storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import {
  type ServerUnit,
  levelName,
  restrictPage,
  sharePage,
  stopSharingPage,
  units,
} from "./server.ts";
import type { VaultLink } from "./sync.ts";
import { UnitPeople } from "./UnitPeople.tsx";
import { useModal } from "./useModal.ts";

export function ShareDialog(props: {
  readonly link: VaultLink;
  readonly note: NoteEntry;
  readonly onClose: () => void;
}) {
  const { link, note, onClose } = props;
  const [page, setPage] = useState<ServerUnit | null | undefined>();
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
    const found = await units(backend.serverFetch, server, await token(), workspaceId);
    setPage(found.find((unit) => unit.kind === "page" && unit.rootNote === note.id) ?? null);
  }, [token, server, workspaceId, note.id]);

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
        aria-labelledby="share-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="share-title">{t("shareTitle", { title: note.title })}</h2>
        {page === undefined ? null : page === null ? (
          <>
            <p>{t("shareWithSpace")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                act(async (session) => {
                  await sharePage(backend.serverFetch, server, session, workspaceId, note.id);
                  return t("shareShared", { title: note.title });
                });
              }}
            >
              {t("shareOnItsOwn")}
            </button>
          </>
        ) : (
          <>
            <p>
              {t("shareYourLevel", { level: levelName(page.level) })}{" "}
              {page.restricted ? t("shareRestricted") : t("shareInherits")}
            </p>
            {page.level === "full" ? (
              <>
                <label className="field-check">
                  <input
                    type="checkbox"
                    checked={page.restricted}
                    disabled={busy}
                    onChange={(event) => {
                      const restricted = event.target.checked;
                      act(async (session) => {
                        await restrictPage(
                          backend.serverFetch,
                          server,
                          session,
                          workspaceId,
                          page.id,
                          restricted,
                        );
                        return restricted ? t("shareNowRestricted") : t("shareNowInherits");
                      });
                    }}
                  />
                  {t("shareRestrict")}
                </label>
                <UnitPeople
                  link={link}
                  unit={page.id}
                  kind="page"
                  onStatus={setStatus}
                  onError={setError}
                />
                <button
                  type="button"
                  className="quiet danger"
                  disabled={busy}
                  onClick={() => {
                    act(async (session) => {
                      await stopSharingPage(
                        backend.serverFetch,
                        server,
                        session,
                        workspaceId,
                        page.id,
                      );
                      return t("shareStopped", { title: note.title });
                    });
                  }}
                >
                  {t("shareStop")}
                </button>
              </>
            ) : null}
          </>
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
