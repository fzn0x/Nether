// A new note, Ctrl or Cmd and N: its name, folders written with `/`, and
// the note it starts from, blank or a template. The templates folder's
// notes are listed; typing finds any other, since any note can be one.
import type { NoteEntry } from "@nether/storage";
import { type SyntheticEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { t } from "./messages.ts";
import { type TemplateSettings, notePathFor, templateChoices, untitledName } from "./templates.ts";

export function NewNoteDialog(props: {
  readonly notes: readonly NoteEntry[];
  readonly settings: TemplateSettings;
  /** Makes the note; a rejection shows in the dialog, which stays open. */
  readonly onCreate: (path: string, template: NoteEntry | undefined) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { notes, settings, onCreate, onClose } = props;
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<NoteEntry | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const choices = useMemo(
    () => templateChoices(notes, settings.folder, query),
    [notes, settings.folder, query],
  );
  const untitled = useMemo(() => untitledName(notes), [notes]);

  // Focus goes back where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (busy) return;
    const target = notePathFor(name.trim() === "" ? untitled : name, notes);
    if ("error" in target) {
      setError(
        target.error === "taken"
          ? t("noteTaken", { path: target.path ?? "" })
          : target.error === "unsafe"
            ? t("noteNameUnsafe")
            : t("noteNameEmpty"),
      );
      return;
    }
    setBusy(true);
    onCreate(target.path, chosen).then(onClose, (reason: unknown) => {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const option = (note: NoteEntry | undefined) => {
    const key = note?.id ?? "blank";
    return (
      <li key={key}>
        <label className="template-option">
          <input
            type="radio"
            name="template"
            checked={chosen?.id === note?.id}
            onChange={() => {
              setChosen(note);
            }}
          />
          {note === undefined ? (
            t("blankNote")
          ) : (
            <>
              {note.title}
              <span className="slash-detail">{note.path.replace(/\.md$/i, "")}</span>
            </>
          )}
        </label>
      </li>
    );
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
        className="switcher dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-note-title"
        onSubmit={submit}
        onKeyDown={onKeyDown}
      >
        <h2 id="new-note-title">{t("newNote")}</h2>
        <label className="field">
          {t("noteName")}
          <input
            value={name}
            placeholder={untitled}
            spellCheck={false}
            // The dialog opens to be typed in.
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
          />
        </label>
        <fieldset className="template-choices">
          <legend>{t("startFrom")}</legend>
          <input
            type="search"
            aria-label={t("findTemplate")}
            placeholder={t("findTemplate")}
            value={query}
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter here makes the note, as in the name field.
              if (event.key === "Enter") submit(event);
            }}
          />
          <ul className="template-list">
            {option(undefined)}
            {choices.map((note) => option(note))}
          </ul>
          {choices.length === 0 ? (
            <p className="hint">
              {query.trim() !== ""
                ? t("noResults")
                : settings.folder === ""
                  ? t("noTemplatesFolder")
                  : t("noTemplates", { folder: settings.folder })}
            </p>
          ) : null}
        </fieldset>
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
