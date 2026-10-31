// The note to merge a note into, from its menu: the vault's notes, found by
// typing a word of their name or path, the note itself left out. What a
// merge does is said before it is done.
import type { NoteEntry } from "@nether/storage";
import { folderOf } from "@nether/storage";
import { type KeyboardEvent, type SyntheticEvent, useMemo, useRef, useState } from "react";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

/** How many notes the list shows at most, so typing stays quick in a large vault. */
const shownAtMost = 50;

export function MergeNoteDialog(props: {
  readonly note: NoteEntry;
  readonly notes: readonly NoteEntry[];
  /** Merges the note into another; a rejection shows in the dialog, which stays open. */
  readonly onMerge: (into: NoteEntry) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { note, notes, onMerge, onClose } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  const choices = useMemo(() => {
    const typed = query.trim().toLocaleLowerCase();
    const found: NoteEntry[] = [];
    for (const other of notes) {
      if (other.id === note.id) continue;
      if (typed !== "" && !other.path.toLocaleLowerCase().includes(typed)) continue;
      found.push(other);
      if (found.length === shownAtMost) break;
    }
    return found;
  }, [notes, note.id, query]);
  const current = Math.min(active, choices.length - 1);
  const chosen = choices[current];

  const merge = () => {
    if (busy || chosen === undefined) return;
    setBusy(true);
    onMerge(chosen).then(onClose, (reason: unknown) => {
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
        aria-labelledby="merge-note-title"
        aria-describedby="merge-note-what"
        onSubmit={(event: SyntheticEvent) => {
          event.preventDefault();
          merge();
        }}
        onKeyDown={onKeyDown}
      >
        <h2 id="merge-note-title">{t("mergeNoteTitle", { name: note.title })}</h2>
        <p id="merge-note-what" className="hint">
          {t("mergeNoteWhat", { name: note.title })}
        </p>
        <input
          className="switcher-input"
          role="combobox"
          aria-label={t("findNote")}
          aria-controls="merge-note-choices"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={chosen === undefined ? undefined : `merge-note-${String(current)}`}
          placeholder={t("findNote")}
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
          id="merge-note-choices"
          className="switcher-list"
          role="listbox"
          aria-label={t("notes")}
        >
          {choices.length === 0 ? (
            <li className="slash-empty">{t("noResults")}</li>
          ) : (
            choices.map((other, index) => {
              const folder = folderOf(other.path);
              return (
                <li
                  key={other.id}
                  id={`merge-note-${String(index)}`}
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
                    setActive(index);
                  }}
                >
                  {other.title}
                  {folder === "" ? null : <span className="slash-detail">{folder}</span>}
                </li>
              );
            })
          )}
        </ul>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary" disabled={busy || chosen === undefined}>
            {chosen === undefined ? t("mergeDo") : t("mergeInto", { name: chosen.title })}
          </button>
        </div>
      </form>
    </div>
  );
}
