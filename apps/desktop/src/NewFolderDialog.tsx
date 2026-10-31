// A new folder: its name, in the folder it was asked for or at the vault's
// top, folders in it written with `/`. A name the vault has, or a hidden
// one, is refused before it is tried.
import { type SyntheticEvent, useRef, useState } from "react";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

/** Why a folder's path cannot be made, if it cannot: empty, hidden, or a folder or note already. */
export function folderProblem(path: string, taken: (path: string) => boolean): string | undefined {
  const parts = path.split("/");
  if (path === "" || parts.some((part) => part.trim() === "")) return t("folderNameEmpty");
  if (parts.some((part) => part.startsWith(".") || part === "..")) return t("folderNameHidden");
  if (/[\\:*?"<>|]/.test(path)) return t("folderNameCharacters");
  if (taken(path)) return t("folderNameTaken", { name: path });
  return undefined;
}

export function NewFolderDialog(props: {
  /** The folder it goes in; "" is the vault's top. */
  readonly folder: string;
  /** Whether a path is a folder or file the vault has, ignoring case as Windows and macOS do. */
  readonly taken: (path: string) => boolean;
  /** Makes the folder; a rejection shows in the dialog, which stays open. */
  readonly onCreate: (path: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { folder, taken, onCreate, onClose } = props;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  const path = [folder, name.trim().replace(/^\/+|\/+$/g, "")]
    .filter((part) => part !== "")
    .join("/");

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = folderProblem(name.trim() === "" ? "" : path, taken);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    setBusy(true);
    onCreate(path).then(onClose, (reason: unknown) => {
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
        className="switcher dialog new-folder-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-folder-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="new-folder-title">{t("newFolderTitle")}</h2>
        <label className="field">
          {folder === "" ? t("folderName") : t("folderNameIn", { folder })}
          <input
            value={name}
            spellCheck={false}
            autoFocus
            aria-invalid={error === undefined ? undefined : true}
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
            {t("createNote")}
          </button>
        </div>
      </form>
    </div>
  );
}
