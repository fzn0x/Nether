// A note in the editor, with its title and what happened to its last save.
import type { NoteId } from "@nether/core";
import { NoteEditor } from "@nether/editor";
import "@nether/editor/math.css";
import type { Vault } from "@nether/storage";
import { t } from "./messages.ts";
import { useNote } from "./useNote.ts";

export default function NoteView(props: { readonly vault: Vault; readonly id: NoteId }) {
  const { vault, id } = props;
  const note = vault.note(id);
  const { state, conflict, saveError, edit } = useNote(vault, id);

  if (note === undefined || state.status === "missing") {
    return <p className="placeholder">{t("missingNote")}</p>;
  }
  return (
    <article className="note" aria-labelledby="note-title">
      <h1 id="note-title">{note.title}</h1>
      {conflict === undefined ? null : (
        <p className="notice" role="status">
          {t("conflict", { path: conflict })}
        </p>
      )}
      {saveError === undefined ? null : <p role="alert">{t("saveFailed", { error: saveError })}</p>}
      {state.status === "failed" ? (
        <p role="alert">{state.error.message}</p>
      ) : state.status === "binary" ? (
        <p className="placeholder">{t("binaryNote")}</p>
      ) : state.status === "loading" ? null : (
        <NoteEditor
          // A note read again from disk starts a new editor.
          key={state.version}
          blocks={state.blocks}
          onChange={edit}
          label={t("noteBody", { title: note.title })}
          placeholder={t("emptyNote")}
        />
      )}
    </article>
  );
}
