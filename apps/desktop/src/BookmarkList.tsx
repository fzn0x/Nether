// The vault's bookmarks above its notes in the sidebar, in the order they
// were added, opened and closed by their heading, which is remembered for
// the vault. A bookmark opens its note; a right click, or the menu key,
// opens the note's menu; its × takes the bookmark away. A bookmark whose
// note is gone, as in the trash, shows its path until it comes back.
import type { NoteId } from "@nether/core";
import type { Vault } from "@nether/storage";
import { useState } from "react";
import type { Bookmark } from "./bookmarks.ts";
import { type MenuPoint, isMenuKey, pointBelow } from "./ContextMenu.tsx";
import { t } from "./messages.ts";

function readOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "closed";
  } catch {
    return true;
  }
}

function storeOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? "open" : "closed");
  } catch {
    // Not remembered: the list stays as it is until the app closes.
  }
}

export function BookmarkList(props: {
  readonly vault: Vault;
  readonly bookmarks: readonly Bookmark[];
  readonly selected: NoteId | undefined;
  readonly onOpen: (id: NoteId) => void;
  readonly onRemove: (path: string) => void;
  readonly onMenu: (id: NoteId, at: MenuPoint) => void;
  /** The note whose menu is open, which shows so. */
  readonly menuFor: NoteId | undefined;
  /** Where the list remembers whether it is open, for its vault. */
  readonly storageKey: string;
}) {
  const { vault, bookmarks, selected, onOpen, onRemove, onMenu, menuFor, storageKey } = props;
  const [open, setOpen] = useState(() => readOpen(storageKey));

  return (
    <section className="bookmarks" aria-labelledby="bookmarks-heading">
      <h2 id="bookmarks-heading" className="bookmarks-heading">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            storeOpen(storageKey, !open);
          }}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {t("bookmarks")}{" "}
          <span className="count">{bookmarks.length}</span>
        </button>
      </h2>
      {open ? (
        <ul className="bookmark-list">
          {bookmarks.map(({ path }) => {
            const note = vault.noteAt(path);
            const name = note?.title ?? path.replace(/\.md$/i, "");
            return (
              <li key={path} className={note === undefined ? "bookmark missing" : "bookmark"}>
                {note === undefined ? (
                  <span className="bookmark-open" title={t("bookmarkMissing", { path })}>
                    {name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`bookmark-open${note.id === menuFor ? " menu-open" : ""}`}
                    aria-current={note.id === selected ? "page" : undefined}
                    title={path}
                    onClick={() => {
                      onOpen(note.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onMenu(note.id, { x: event.clientX, y: event.clientY });
                    }}
                    onKeyDown={(event) => {
                      if (!isMenuKey(event)) return;
                      event.preventDefault();
                      onMenu(note.id, pointBelow(event.currentTarget));
                    }}
                  >
                    {name}
                  </button>
                )}
                <button
                  type="button"
                  className="quiet bookmark-remove"
                  aria-label={t("removeBookmark", { name })}
                  title={t("removeBookmark", { name })}
                  onClick={() => {
                    onRemove(path);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
