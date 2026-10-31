// The vault's bookmarks, read when it opens: Nether's own, or Obsidian's
// when the vault has only those; saving writes Nether's own, one write at a
// time, and never Obsidian's. A bookmarked note renamed or moved, here or
// by another app, keeps its bookmark at its new path.
import type { NoteId } from "@nether/core";
import type { Vault } from "@nether/storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Bookmark,
  bookmarksData,
  movedBookmarks,
  readBookmarks,
  toggleBookmark,
} from "./bookmarks.ts";

const bookmarksName = "bookmarks";

export interface Bookmarks {
  readonly list: readonly Bookmark[];
  readonly has: (path: string) => boolean;
  /** Bookmarks a note, or takes its bookmark away. */
  readonly toggle: (path: string) => Promise<void>;
}

export function useBookmarks(vault: Vault | undefined): Bookmarks {
  const [list, setList] = useState<readonly Bookmark[]>([]);
  // The list as last set, and the write before, which the next waits for.
  const latest = useRef<readonly Bookmark[]>([]);
  const writing = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    latest.current = [];
    setList([]);
    if (vault === undefined) return;
    let current = true;
    void Promise.all([vault.readData(bookmarksName), vault.readObsidianData(bookmarksName)]).then(
      ([own, obsidian]) => {
        if (!current) return;
        latest.current = readBookmarks(own ?? obsidian);
        setList(latest.current);
      },
    );
    return () => {
      current = false;
    };
  }, [vault]);

  const save = useCallback(
    (next: readonly Bookmark[]): Promise<void> => {
      if (vault === undefined) return Promise.resolve();
      latest.current = next;
      setList(next);
      const write = writing.current.then(() => vault.writeData(bookmarksName, bookmarksData(next)));
      writing.current = write.catch(() => undefined);
      return write;
    },
    [vault],
  );

  // Each bookmarked note by its ID, so its bookmark follows it when its path changes.
  useEffect(() => {
    if (vault === undefined) return;
    const tracked = new Map<string, NoteId>();
    for (const { path } of list) {
      const note = vault.noteAt(path);
      if (note !== undefined) tracked.set(path, note.id);
    }
    if (tracked.size === 0) return;
    return vault.subscribe(() => {
      const moved = new Map<string, string>();
      for (const [path, id] of tracked) {
        const now = vault.note(id)?.path;
        if (now !== undefined && now !== path) moved.set(path, now);
      }
      const next = movedBookmarks(latest.current, moved);
      if (next !== latest.current) void save(next).catch(() => undefined);
    });
  }, [vault, list, save]);

  const has = useCallback(
    (path: string) => list.some((bookmark) => bookmark.path === path),
    [list],
  );
  const toggle = useCallback(
    (path: string) => save(toggleBookmark(latest.current, path, Date.now())),
    [save],
  );

  return { list, has, toggle };
}
