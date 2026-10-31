// The members of the workspace the vault syncs with: who is in it, at which
// role, and for its owners and admins, changing roles, removing members and
// inviting people by a link. Anyone may leave, after which the vault keeps
// its notes and syncs no more.
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import {
  type Invitation,
  type Member,
  invitationLink,
  invitations,
  invite,
  members,
  removeMember,
  roleName,
  setMemberRole,
  withdrawInvitation,
} from "./server.ts";
import { type VaultLink, hostOf } from "./sync.ts";
import { useModal } from "./useModal.ts";

const roles = ["owner", "admin", "member", "guest"] as const;

/** The roles one at `actor` may give someone at `target`; none when they may not change it. */
function rolesFor(actor: string, target: string): readonly string[] {
  if (actor === "owner") return roles;
  if (actor === "admin" && (target === "member" || target === "guest")) return ["member", "guest"];
  return [];
}

/** Whether one at `actor` may remove someone at `target`. */
function removes(actor: string, target: string): boolean {
  return actor === "owner" || (actor === "admin" && (target === "member" || target === "guest"));
}

const expiry = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function MembersDialog(props: {
  readonly link: VaultLink;
  /** After the account leaves the workspace: the vault stops syncing. */
  readonly onLeft: () => void;
  readonly onClose: () => void;
}) {
  const { link, onLeft, onClose } = props;
  const [me, setMe] = useState<string | undefined>();
  const [list, setList] = useState<readonly Member[] | undefined>();
  const [waiting, setWaiting] = useState<readonly Invitation[]>([]);
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [made, setMade] = useState<string | undefined>();
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const dialog = useRef<HTMLDivElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  useModal(dialog);

  const server = link.server;
  const token = useCallback(async () => {
    const found = await backend.serverToken(server);
    if (found === undefined) throw new Error(t("syncSignedOut", { server: hostOf(server) }));
    return found;
  }, [server]);

  const load = useCallback(async () => {
    const session = await token();
    const accounts = await backend.servers();
    const mine = accounts.find((account) => account.url === server)?.user.id;
    setMe(mine);
    const found = await members(backend.serverFetch, server, session, link.workspaceId);
    setList(found);
    const role = found.find((member) => member.id === mine)?.role;
    setWaiting(
      role === "owner" || role === "admin"
        ? await invitations(backend.serverFetch, server, session, link.workspaceId)
        : [],
    );
  }, [token, server, link.workspaceId]);

  useEffect(() => {
    load().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [load]);

  const act = (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    work()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const myRole = list?.find((member) => member.id === me)?.role ?? "guest";
  const manages = myRole === "owner" || myRole === "admin";

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
        aria-labelledby="members-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="members-title">{t("membersTitle", { workspace: link.workspaceName })}</h2>
        {list === undefined ? null : (
          <ul className="member-list" aria-label={t("membersList")}>
            {list.map((member) => {
              const choices = member.id === me ? [] : rolesFor(myRole, member.role);
              return (
                <li key={member.id}>
                  <span className="member-name">
                    {member.name}
                    {member.id === me ? <span className="hint">{t("membersYou")}</span> : null}
                  </span>
                  <span className="hint">{member.email}</span>
                  {choices.length === 0 ? (
                    <span className="member-role">{roleName(member.role)}</span>
                  ) : (
                    <select
                      aria-label={t("membersRoleOf", { name: member.name })}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => {
                        const role = event.target.value;
                        act(async () => {
                          await setMemberRole(
                            backend.serverFetch,
                            server,
                            await token(),
                            link.workspaceId,
                            member.id,
                            role,
                          );
                          await load();
                          setStatus(
                            t("membersRoleChanged", { name: member.name, role: roleName(role) }),
                          );
                        });
                      }}
                    >
                      {choices.map((role) => (
                        <option key={role} value={role}>
                          {roleName(role)}
                        </option>
                      ))}
                    </select>
                  )}
                  {member.id !== me && removes(myRole, member.role) ? (
                    <button
                      type="button"
                      className="quiet danger"
                      disabled={busy}
                      onClick={() => {
                        act(async () => {
                          await removeMember(
                            backend.serverFetch,
                            server,
                            await token(),
                            link.workspaceId,
                            member.id,
                          );
                          await load();
                          setStatus(t("membersRemoved", { name: member.name }));
                        });
                      }}
                    >
                      {t("membersRemove", { name: member.name })}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {manages ? (
          <form
            className="member-invite"
            onSubmit={(event) => {
              event.preventDefault();
              act(async () => {
                const created = await invite(
                  backend.serverFetch,
                  server,
                  await token(),
                  link.workspaceId,
                  inviteRole,
                  inviteEmail,
                );
                setMade(invitationLink(server, created.token));
                setInviteEmail("");
                await load();
              });
            }}
          >
            <fieldset disabled={busy}>
              <legend>{t("membersInvite")}</legend>
              <label className="field">
                {t("membersInviteRole")}
                <select
                  value={inviteRole}
                  onChange={(event) => {
                    setInviteRole(event.target.value);
                  }}
                >
                  <option value="member">{t("role_member")}</option>
                  {myRole === "owner" ? <option value="admin">{t("role_admin")}</option> : null}
                </select>
              </label>
              <label className="field">
                {t("membersInviteEmail")}
                <input
                  type="email"
                  autoComplete="off"
                  value={inviteEmail}
                  aria-describedby="invite-email-hint"
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                  }}
                />
                <span id="invite-email-hint" className="hint">
                  {t("membersInviteEmailHint")}
                </span>
              </label>
              <button type="submit">{t("membersInviteMake")}</button>
            </fieldset>
            {made === undefined ? null : (
              <div className="field">
                <label htmlFor="invite-link">{t("membersInviteLink")}</label>
                <span className="field-actions">
                  <input
                    id="invite-link"
                    ref={linkField}
                    type="text"
                    readOnly
                    value={made}
                    onFocus={(event) => {
                      event.target.select();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(made).then(
                        () => {
                          setStatus(t("membersInviteCopied"));
                        },
                        () => {
                          linkField.current?.focus();
                          setStatus(t("membersInviteCopyYourself"));
                        },
                      );
                    }}
                  >
                    {t("copy")}
                  </button>
                </span>
                <span className="hint">{t("membersInviteLinkHint")}</span>
              </div>
            )}
          </form>
        ) : null}
        {waiting.length === 0 ? null : (
          <section aria-labelledby="invitations-title">
            <h3 id="invitations-title">{t("membersWaiting")}</h3>
            <ul className="member-list">
              {waiting.map((item) => (
                <li key={item.id}>
                  <span className="member-name">{item.email ?? t("membersAnyone")}</span>
                  <span className="member-role">{roleName(item.role)}</span>
                  <span className="hint">
                    {t("membersExpires", { date: expiry.format(Date.parse(item.expiresAt)) })}
                  </span>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => {
                      act(async () => {
                        await withdrawInvitation(
                          backend.serverFetch,
                          server,
                          await token(),
                          link.workspaceId,
                          item.id,
                        );
                        await load();
                        setStatus(t("membersWithdrawn"));
                      });
                    }}
                  >
                    {t("membersWithdraw")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {status === undefined ? null : <p role="status">{status}</p>}
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          {leaving ? (
            <span
              className="trash-actions"
              role="group"
              aria-label={t("membersLeaveSure", { workspace: link.workspaceName })}
            >
              <span>{t("membersLeaveSure", { workspace: link.workspaceName })}</span>
              <button
                type="button"
                className="quiet danger"
                disabled={busy}
                onClick={() => {
                  if (me === undefined) return;
                  act(async () => {
                    await removeMember(
                      backend.serverFetch,
                      server,
                      await token(),
                      link.workspaceId,
                      me,
                    );
                    onLeft();
                  });
                }}
              >
                {t("membersLeave")}
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setLeaving(false);
                }}
              >
                {t("cancel")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="quiet"
              disabled={busy || me === undefined}
              onClick={() => {
                setLeaving(true);
              }}
            >
              {t("membersLeave")}
            </button>
          )}
          <button type="button" className="primary" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
