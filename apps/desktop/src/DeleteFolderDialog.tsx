// Asks before a folder with notes or files in it goes: what is in it moves
// to the trash, where each can be restored, and the folder is deleted. The
// focus starts on Cancel, so Enter alone deletes nothing.
import { useRef, useState } from "react";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

export function DeleteFolderDialog(props: {
  readonly path: string;
  /** How many notes, and other files, are in it, folders in it included. */
  readonly notes: number;
  readonly files: number;
  /** Deletes it; a rejection shows in the dialog, which stays open. */
  readonly onDelete: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const { path, notes, files, onDelete, onClose } = props;
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog);
  const name = path.slice(path.lastIndexOf("/") + 1);

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        // A click outside the dialog closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="switcher dialog delete-folder-dialog"
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-folder-title"
        aria-describedby="delete-folder-body"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="delete-folder-title">{t("deleteFolderTitle", { name })}</h2>
        <p id="delete-folder-body">
          {t("deleteFolderBody", {
            notes: t(notes === 1 ? "countNote" : "countNotes", { count: String(notes) }),
            files: t(files === 1 ? "countFile" : "countFiles", { count: String(files) }),
          })}
        </p>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" autoFocus onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onDelete().then(onClose, (reason: unknown) => {
                setBusy(false);
                setError(reason instanceof Error ? reason.message : String(reason));
              });
            }}
          >
            {t("deleteFolderDo")}
          </button>
        </div>
      </div>
    </div>
  );
}
