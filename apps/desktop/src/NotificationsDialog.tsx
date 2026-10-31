// The account's notifications on the vault's server (ADR 0045): who
// mentioned them, on which note, and when, the unread marked. Opening one
// goes to its note and thread when this vault has the note, and marks it
// read. Whether to be emailed too is chosen here.
import { useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import { type ServerNotification, mentionEmails, setMentionEmails } from "./server.ts";
import type { VaultLink } from "./sync.ts";
import { useModal } from "./useModal.ts";
import type { Notifications } from "./useNotifications.ts";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** What a notification says happened. */
function whatHappened(notification: ServerNotification): string {
  const name = notification.actor?.name ?? t("someone");
  return notification.title === undefined
    ? t("mentionedYouIn", { name })
    : t("mentionedYouOn", { name, title: notification.title });
}

export function NotificationsDialog(props: {
  readonly link: VaultLink;
  readonly notifications: Notifications;
  /** Whether this vault has a note, to open it. */
  readonly hasNote: (id: string) => boolean;
  readonly onOpen: (note: string, thread: string | undefined) => void;
  readonly onClose: () => void;
}) {
  const { link, notifications, hasNote, onOpen, onClose } = props;
  const { list, unread, refresh, markRead } = notifications;
  const [email, setEmail] = useState<boolean | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog);

  const failed = (error: unknown) => {
    setMessage(error instanceof Error ? error.message : String(error));
  };

  // Asked for anew as the dialog opens, with whether emails come too.
  useEffect(() => {
    refresh();
    let current = true;
    const stopped = () => !current;
    void (async () => {
      const token = await backend.serverToken(link.server);
      if (token === undefined) return;
      const on = await mentionEmails(backend.serverFetch, link.server, token);
      if (!stopped()) setEmail(on);
    })().catch(failed);
    return () => {
      current = false;
    };
  }, [link, refresh]);

  const open = (notification: ServerNotification) => {
    if (!notification.read) markRead([notification.id]).catch(failed);
    if (notification.workspace.id === link.workspaceId && hasNote(notification.note)) {
      onOpen(notification.note, notification.thread);
      return;
    }
    setMessage(t("notificationNoteNotHere"));
  };

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        // A click outside the dialog closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="switcher dialog notifications-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="notifications-title">{t("notifications")}</h2>
        <div className="dialog-body">
          {list.length === 0 ? (
            <p className="placeholder">{t("noNotifications")}</p>
          ) : (
            <ul className="notification-list" aria-label={t("notifications")}>
              {list.map((notification) => (
                <li
                  key={notification.id}
                  className={notification.read ? "notification" : "notification unread"}
                >
                  <button
                    type="button"
                    className="notification-open"
                    onClick={() => {
                      open(notification);
                    }}
                  >
                    <span className="notification-what">
                      {notification.read ? null : (
                        <span className="visually-hidden">{t("unreadNotification")} </span>
                      )}
                      {whatHappened(notification)}
                    </span>
                    {notification.excerpt === undefined ? null : (
                      <span className="notification-excerpt">{notification.excerpt}</span>
                    )}
                    <span className="notification-when">
                      <time dateTime={new Date(notification.created).toISOString()}>
                        {when.format(notification.created)}
                      </time>
                      {` · ${notification.workspace.name}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="dialog-option">
            <input
              type="checkbox"
              checked={email === true}
              disabled={email === undefined}
              onChange={(event) => {
                const on = event.target.checked;
                setEmail(on);
                void (async () => {
                  const token = await backend.serverToken(link.server);
                  if (token === undefined) return;
                  await setMentionEmails(backend.serverFetch, link.server, token, on);
                })().catch((error: unknown) => {
                  setEmail(!on);
                  failed(error);
                });
              }}
            />
            {t("emailMentions")}
          </label>
        </div>
        {message === undefined ? null : <p role="status">{message}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="quiet"
            disabled={unread === 0}
            onClick={() => {
              markRead("all").catch(failed);
            }}
          >
            {t("markAllRead")}
          </button>
          <button type="button" className="primary" onClick={onClose}>
            {t("done")}
          </button>
        </div>
      </div>
    </div>
  );
}
