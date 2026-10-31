// A note's new name, from its menu: the name in its folder, links to it
// following, as renaming its title does.
import type { NoteEntry } from "@nether/storage";
import { type SyntheticEvent, useRef, useState } from "react";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

export function RenameNoteDialog(props: {
  readonly note: NoteEntry;
  /** Renames the note; a rejection shows in the dialog, which stays open. */
  readonly onRename: (name: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { note, onRename, onClose } = props;
  const [name, setName] = useState(note.title);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === note.title) {
      onClose();
      return;
    }
    setBusy(true);
    onRename(name.trim()).then(onClose, (reason: unknown) => {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
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
        className="switcher dialog rename-note-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-note-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="rename-note-title">{t("renameNoteTitle", { name: note.title })}</h2>
        <label className="field">
          {t("noteName")}
          <input
            value={name}
            spellCheck={false}
            // The dialog opens to be typed in, the name chosen to type over.
            autoFocus
            onFocus={(event) => {
              event.target.select();
            }}
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
          />
        </label>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {t("renameDo")}
          </button>
        </div>
      </form>
    </div>
  );
}
