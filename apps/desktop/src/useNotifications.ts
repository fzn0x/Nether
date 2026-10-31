// What the vault's workspace adds to comments (ADR 0045): its people, to
// mention, and the account's notifications on its server, asked for when
// the vault is linked and each minute after. Each time, the mentions this
// device made and could not send yet go first.
import type { CommentAuthor } from "@nether/editor";
import type { Vault } from "@nether/storage";
import { useCallback, useEffect, useState } from "react";
import { backend } from "./backend.ts";
import { sendMentions } from "./notify.ts";
import {
  type ServerNotification,
  markNotificationsRead,
  members,
  serverNotifications,
  tellMentioned,
} from "./server.ts";
import type { VaultLink } from "./sync.ts";

/** How often notifications are asked for while the vault is open. */
const every = 60_000;

/** The workspace's members, to mention; none for a guest, who may not list them. */
export function usePeople(link: VaultLink | undefined): readonly CommentAuthor[] {
  const [people, setPeople] = useState<readonly CommentAuthor[]>([]);
  useEffect(() => {
    setPeople([]);
    if (link === undefined) return;
    let current = true;
    const stopped = () => !current;
    void (async () => {
      const token = await backend.serverToken(link.server);
      if (token === undefined) return;
      const found = await members(backend.serverFetch, link.server, token, link.workspaceId);
      if (!stopped()) setPeople(found.map((member) => ({ id: member.id, name: member.name })));
    })().catch(() => {
      // Offline, or a guest: no one is offered, and mentions typed stay text.
    });
    return () => {
      current = false;
    };
  }, [link]);
  return people;
}

export interface Notifications {
  readonly list: readonly ServerNotification[];
  readonly unread: number;
  /** Sends the mentions waiting, and asks for the notifications anew. */
  readonly refresh: () => void;
  readonly markRead: (ids: readonly string[] | "all") => Promise<void>;
}

export function useNotifications(
  vault: Vault | undefined,
  link: VaultLink | undefined,
): Notifications {
  const [list, setList] = useState<readonly ServerNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (vault === undefined || link === undefined) {
      setList([]);
      setUnread(0);
      return;
    }
    let current = true;
    const stopped = () => !current;
    const tick = async () => {
      const token = await backend.serverToken(link.server);
      if (token === undefined) return;
      await sendMentions(vault.settings, async (mention) => {
        // One for a workspace the vault no longer syncs with cannot go: it is dropped.
        if (mention.server !== link.server || mention.workspaceId !== link.workspaceId) return;
        await tellMentioned(backend.serverFetch, link.server, token, link.workspaceId, mention);
      });
      const found = await serverNotifications(backend.serverFetch, link.server, token);
      if (stopped()) return;
      setList(found.notifications);
      setUnread(found.unread);
    };
    const run = () => {
      tick().catch(() => {
        // Offline: what was shown stays, and the next tick tries again.
      });
    };
    run();
    const timer = setInterval(run, every);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [vault, link, round]);

  const refresh = useCallback(() => {
    setRound((count) => count + 1);
  }, []);

  const markRead = useCallback(
    async (ids: readonly string[] | "all") => {
      if (link === undefined) return;
      const token = await backend.serverToken(link.server);
      if (token === undefined) return;
      await markNotificationsRead(backend.serverFetch, link.server, token, ids);
      refresh();
    },
    [link, refresh],
  );

  return { list, unread, refresh, markRead };
}
