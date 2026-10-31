// The folder a note moves to, from its menu: the vault's folders, found by
// typing, the note's own left out. The note's pages go with it, and links
// to it follow, as dragging it in the tree does.
import type { NoteEntry } from "@nether/storage";
import { folderOf } from "@nether/storage";
import { type KeyboardEvent, type SyntheticEvent, useMemo, useRef, useState } from "react";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

/** A folder as the list shows it, the vault's top by name. */
function shown(folder: string): string {
  return folder === "" ? t("vaultTop") : folder;
}

export function MoveNoteDialog(props: {
  readonly note: NoteEntry;
  /** Every folder of the vault, the top as "". */
  readonly folders: readonly string[];
  /** Moves the note into a folder; a rejection shows in the dialog, which stays open. */
  readonly onMove: (folder: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { note, folders, onMove, onClose } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  const own = folderOf(note.path);
  const choices = useMemo(() => {
    const typed = query.trim().toLocaleLowerCase();
    return folders.filter(
      (folder) =>
        folder !== own && (typed === "" || shown(folder).toLocaleLowerCase().includes(typed)),
    );
  }, [folders, own, query]);
  const current = Math.min(active, choices.length - 1);

  const move = (folder: string | undefined) => {
    if (busy || folder === undefined) return;
    setBusy(true);
    onMove(folder).then(onClose, (reason: unknown) => {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowDown") setActive(Math.min(choices.length - 1, current + 1));
    else if (event.key === "ArrowUp") setActive(Math.max(0, current - 1));
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        // A click outside the dialog closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="switcher dialog move-note-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-note-title"
        onSubmit={(event: SyntheticEvent) => {
          event.preventDefault();
          move(choices[current]);
        }}
        onKeyDown={onKeyDown}
      >
        <h2 id="move-note-title">{t("moveNoteTitle", { name: note.title })}</h2>
        <input
          className="switcher-input"
          role="combobox"
          aria-label={t("findFolder")}
          aria-controls="move-note-folders"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={
            choices.length === 0 ? undefined : `move-folder-${String(current)}`
          }
          placeholder={t("findFolder")}
          value={query}
          spellCheck={false}
          // The dialog opens to be typed in.
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setError(undefined);
          }}
        />
        <ul
          id="move-note-folders"
          className="switcher-list"
          role="listbox"
          aria-label={t("folders")}
        >
          {choices.length === 0 ? (
            <li className="slash-empty">{t("noFolders")}</li>
          ) : (
            choices.map((folder, index) => (
              <li
                key={folder}
                id={`move-folder-${String(index)}`}
                role="option"
                aria-selected={index === current}
                className="slash-item"
                onMouseDown={(event) => {
                  // The search keeps the focus.
                  event.preventDefault();
                }}
                onMouseMove={() => {
                  if (index !== current) setActive(index);
                }}
                onClick={() => {
                  move(folder);
                }}
              >
                {shown(folder)}
              </li>
            ))
          )}
        </ul>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary" disabled={busy || choices.length === 0}>
            {t("moveDo")}
          </button>
        </div>
      </form>
    </div>
  );
}
