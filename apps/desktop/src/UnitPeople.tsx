// Who opens a teamspace or a shared page by a grant of their own (ADR 0042),
// at which level, for someone with full access to it: changing a level,
// taking access back, giving it to another member, and for a page,
// inviting a guest by a link.
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import {
  type Member,
  type UnitAccess,
  invitationLink,
  inviteGuest,
  levelName,
  members,
  removeGrant,
  setGrant,
  unitAccess,
} from "./server.ts";
import type { VaultLink } from "./sync.ts";

const levels = ["full", "edit", "comment", "view"] as const;

export function UnitPeople(props: {
  readonly link: VaultLink;
  readonly unit: string;
  readonly kind: "team" | "page";
  /** Says what changed, or what went wrong. */
  readonly onStatus: (status: string) => void;
  readonly onError: (error: string) => void;
  /** Tells of each change, as one that adds or takes access. */
  readonly onChanged?: () => void;
}) {
  const { link, unit, kind, onStatus, onError, onChanged } = props;
  const [access, setAccess] = useState<UnitAccess | undefined>();
  const [everyone, setEveryone] = useState<readonly Member[]>([]);
  const [adding, setAdding] = useState("");
  const [addLevel, setAddLevel] = useState("edit");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestLevel, setGuestLevel] = useState("view");
  const [made, setMade] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);
  const { server, workspaceId } = link;

  const token = useCallback(async () => {
    const found = await backend.serverToken(server);
    if (found === undefined) throw new Error(t("syncSignedOut", { server }));
    return found;
  }, [server]);

  const load = useCallback(async () => {
    const session = await token();
    setAccess(await unitAccess(backend.serverFetch, server, session, workspaceId, unit));
    setEveryone(await members(backend.serverFetch, server, session, workspaceId));
  }, [token, server, workspaceId, unit]);

  useEffect(() => {
    load().catch((reason: unknown) => {
      onError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [load, onError]);

  const act = (work: (session: string) => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    token()
      .then(async (session) => {
        const said = await work(session);
        await load();
        onChanged?.();
        onStatus(said);
      })
      .catch((reason: unknown) => {
        onError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (access === undefined) return null;
  const granted = new Set(access.grants.map((grant) => grant.user));
  // Guests come by invitation to pages, not to teamspaces.
  const others = everyone.filter(
    (member) => !granted.has(member.id) && (kind === "page" || member.role !== "guest"),
  );

  return (
    <div className="unit-people">
      <ul className="member-list" aria-label={t("unitPeople")}>
        {access.grants.map((grant) => (
          <li key={grant.user}>
            <span className="member-name">{grant.name}</span>
            <span className="hint">{grant.email}</span>
            <select
              aria-label={t("levelOf", { name: grant.name })}
              value={grant.level}
              disabled={busy}
              onChange={(event) => {
                const level = event.target.value;
                act(async (session) => {
                  await setGrant(
                    backend.serverFetch,
                    server,
                    session,
                    workspaceId,
                    unit,
                    grant.user,
                    level,
                  );
                  return t("levelChanged", { name: grant.name, level: levelName(level) });
                });
              }}
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  {levelName(level)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="quiet danger"
              disabled={busy}
              onClick={() => {
                act(async (session) => {
                  await removeGrant(
                    backend.serverFetch,
                    server,
                    session,
                    workspaceId,
                    unit,
                    grant.user,
                  );
                  return t("accessRemoved", { name: grant.name });
                });
              }}
            >
              {t("accessRemove", { name: grant.name })}
            </button>
          </li>
        ))}
      </ul>
      {others.length === 0 ? null : (
        <form
          className="unit-add"
          onSubmit={(event) => {
            event.preventDefault();
            const member = others.find((item) => item.id === adding) ?? others[0];
            if (member === undefined) return;
            act(async (session) => {
              await setGrant(
                backend.serverFetch,
                server,
                session,
                workspaceId,
                unit,
                member.id,
                addLevel,
              );
              return t("accessGiven", { name: member.name, level: levelName(addLevel) });
            });
          }}
        >
          <label className="field">
            {t("accessAddWho")}
            <select
              value={adding === "" ? (others[0]?.id ?? "") : adding}
              onChange={(event) => {
                setAdding(event.target.value);
              }}
            >
              {others.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("accessLevel")}
            <select
              value={addLevel}
              onChange={(event) => {
                setAddLevel(event.target.value);
              }}
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  {levelName(level)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {t("accessAdd")}
          </button>
        </form>
      )}
      {kind === "page" ? (
        <form
          className="unit-add"
          onSubmit={(event) => {
            event.preventDefault();
            act(async (session) => {
              const invited = await inviteGuest(
                backend.serverFetch,
                server,
                session,
                workspaceId,
                unit,
                guestLevel,
                guestEmail,
              );
              setMade(invitationLink(server, invited));
              setGuestEmail("");
              return t("guestInvited");
            });
          }}
        >
          <label className="field">
            {t("guestEmail")}
            <input
              type="email"
              autoComplete="off"
              value={guestEmail}
              onChange={(event) => {
                setGuestEmail(event.target.value);
              }}
            />
          </label>
          <label className="field">
            {t("accessLevel")}
            <select
              value={guestLevel}
              onChange={(event) => {
                setGuestLevel(event.target.value);
              }}
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  {levelName(level)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {t("guestInvite")}
          </button>
          {made === undefined ? null : (
            <label className="field">
              {t("membersInviteLink")}
              <input
                ref={linkField}
                type="text"
                readOnly
                value={made}
                onFocus={(event) => {
                  event.target.select();
                }}
              />
            </label>
          )}
          {access.invitations.length === 0 ? null : (
            <p className="hint">{t("guestWaiting", { count: access.invitations.length })}</p>
          )}
        </form>
      ) : null}
    </div>
  );
}
