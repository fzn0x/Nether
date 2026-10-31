// A note's tags, from its menu: those in its frontmatter as chips, more
// added by typing, the vault's tags offered. Saved to the frontmatter's
// `tags`, through the note's document; tags written in the text stay there.
import type { NoteId } from "@nether/core";
import type { Vault } from "@nether/storage";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { t } from "./messages.ts";
import { cleanTag, noteTags, setNoteTags } from "./noteActions.ts";
import { ListEditor } from "./PropertiesPanel.tsx";
import { useModal } from "./useModal.ts";

export function NoteTagsDialog(props: {
  readonly vault: Vault;
  readonly note: { readonly id: NoteId; readonly title: string };
  /** The vault's tags, to offer. */
  readonly known: readonly string[];
  readonly onClose: () => void;
}) {
  const { vault, note, known, onClose } = props;
  const [tags, setTags] = useState<readonly string[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  // Once the tags are read, the dialog is ready to type one.
  const ready = tags !== undefined;
  useEffect(() => {
    if (ready) dialog.current?.querySelector<HTMLElement>(".property-list input")?.focus();
  }, [ready]);

  useEffect(() => {
    let current = true;
    noteTags(vault, note.id).then(
      (read) => {
        if (current) setTags(read);
      },
      (reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [vault, note.id]);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (busy || tags === undefined) return;
    setBusy(true);
    setNoteTags(vault, note.id, tags).then(onClose, (reason: unknown) => {
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
        className="switcher dialog note-tags-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-tags-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="note-tags-title">{t("noteTagsTitle", { name: note.title })}</h2>
        {tags === undefined ? null : (
          <div className="field">
            <ListEditor
              label={t("addTag")}
              values={tags}
              suggestions={known.filter((tag) => !tags.includes(tag))}
              show={(tag) => `#${tag}`}
              toValue={cleanTag}
              onChange={(next) => {
                setTags(
                  next
                    .map(cleanTag)
                    .filter((tag, index, all) => tag !== "" && all.indexOf(tag) === index),
                );
              }}
            />
            <p className="hint">{t("noteTagsHint")}</p>
          </div>
        )}
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary" disabled={busy || tags === undefined}>
            {t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
