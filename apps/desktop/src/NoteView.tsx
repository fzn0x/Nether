// A note in the editor, with its title and what happened to its last save.
// It shows as blocks, or as its Markdown source, which Ctrl or Cmd and /
// switches between.
import type { NoteId } from "@nether/core";
import { NoteEditor, SourceEditor } from "@nether/editor";
import "@nether/editor/math.css";
import type { Vault } from "@nether/storage";
import { type KeyboardEvent, useMemo, useState } from "react";
import type { VaultMedia } from "./backend.ts";
import { t } from "./messages.ts";
import { noteFiles } from "./noteFiles.ts";
import { useNote } from "./useNote.ts";

export type NoteMode = "blocks" | "source";

const vimKey = "nether.vim";

/** Whether the user turned Vim keys on, remembered in this browser; storage may be closed to the page. */
function storedVim(): boolean {
  try {
    return localStorage.getItem(vimKey) === "on";
  } catch {
    return false;
  }
}

function storeVim(on: boolean): void {
  try {
    localStorage.setItem(vimKey, on ? "on" : "off");
  } catch {
    // Not remembered: the setting holds until the app closes.
  }
}

export default function NoteView(props: {
  readonly vault: Vault;
  readonly media: VaultMedia;
  readonly id: NoteId;
  readonly mode: NoteMode;
  readonly onMode: (mode: NoteMode) => void;
}) {
  const { vault, media, id, mode, onMode } = props;
  const note = vault.note(id);
  const { state, conflict, saveError, edit, editText, refresh } = useNote(vault, id);
  const [fileError, setFileError] = useState<string | undefined>();
  const [vim, setVim] = useState(storedVim);
  // The editor takes focus when the user switches modes, not when a note opens.
  const [switched, setSwitched] = useState(false);
  const files = useMemo(
    () =>
      noteFiles(vault, media, id, (error) => {
        setFileError(error instanceof Error ? error.message : String(error));
      }),
    [vault, media, id],
  );

  const toggle = async () => {
    // Save what either editor has, so the other starts from it.
    await refresh();
    setSwitched(true);
    onMode(mode === "blocks" ? "source" : "blocks");
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === "/") {
      // Before the editors, which have their own uses for the keys.
      event.preventDefault();
      event.stopPropagation();
      void toggle();
    }
  };

  if (note === undefined || state.status === "missing") {
    return <p className="placeholder">{t("missingNote")}</p>;
  }
  return (
    <article className="note" aria-labelledby="note-title" onKeyDownCapture={onKeyDownCapture}>
      <header className="note-header">
        <h1 id="note-title">{note.title}</h1>
        {state.status === "ready" ? (
          <div className="note-tools">
            {mode === "source" ? (
              <label className="note-option">
                <input
                  type="checkbox"
                  checked={vim}
                  onChange={(event) => {
                    setVim(event.target.checked);
                    storeVim(event.target.checked);
                  }}
                />
                {t("vimKeys")}
              </label>
            ) : null}
            <button
              type="button"
              className="quiet"
              aria-pressed={mode === "source"}
              aria-keyshortcuts="Control+/ Meta+/"
              title={t("sourceModeHint")}
              onClick={() => void toggle()}
            >
              {t("sourceMode")}
            </button>
          </div>
        ) : null}
      </header>
      {conflict === undefined ? null : (
        <p className="notice" role="status">
          {t("conflict", { path: conflict })}
        </p>
      )}
      {saveError === undefined ? null : <p role="alert">{t("saveFailed", { error: saveError })}</p>}
      {fileError === undefined ? null : <p role="alert">{t("fileFailed", { error: fileError })}</p>}
      {state.status === "failed" ? (
        <p role="alert">{state.error.message}</p>
      ) : state.status === "binary" ? (
        <p className="placeholder">{t("binaryNote")}</p>
      ) : state.status === "loading" ? null : mode === "source" ? (
        <SourceEditor
          // A note read again, or the other editor's changes, start a new editor.
          key={state.version}
          text={state.text}
          onChange={editText}
          label={t("noteSource", { title: note.title })}
          placeholder={t("emptySource")}
          vim={vim}
          autofocus={switched}
        />
      ) : (
        <NoteEditor
          key={state.version}
          blocks={state.blocks}
          onChange={edit}
          label={t("noteBody", { title: note.title })}
          placeholder={t("emptyNote")}
          files={files}
          autofocus={switched}
        />
      )}
    </article>
  );
}
