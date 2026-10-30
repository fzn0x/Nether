// An open vault: its notes on the left, the selected note on the right. The
// note shows as its Markdown until the editor arrives.
import type { NoteId } from "@nether/core";
import type { FileText, Vault } from "@nether/storage";
import { useEffect, useState } from "react";
import { NoteList } from "./NoteList.tsx";
import { t } from "./messages.ts";
import type { VaultInfo } from "./mygo.ts";
import { useNotes, useVault } from "./useVault.ts";

function NoteView(props: { readonly vault: Vault; readonly id: NoteId }) {
  const { vault, id } = props;
  const [text, setText] = useState<FileText | Error | undefined>();
  const note = vault.note(id);
  const modified = note?.modified;

  useEffect(() => {
    let current = true;
    setText(undefined);
    vault.read(id).then(
      (read) => {
        if (current) setText(read);
      },
      (error: unknown) => {
        if (current) setText(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => {
      current = false;
    };
    // Read again when another app changes the file.
  }, [vault, id, modified]);

  if (note === undefined) return <p className="placeholder">{t("missingNote")}</p>;
  return (
    <article className="note" aria-labelledby="note-title">
      <h1 id="note-title">{note.title}</h1>
      {text instanceof Error ? (
        <p role="alert">{text.message}</p>
      ) : text?.binary === true ? (
        <p className="placeholder">{t("binaryNote")}</p>
      ) : text?.missing === true ? (
        <p className="placeholder">{t("missingNote")}</p>
      ) : (
        <pre className="markdown">{text?.text}</pre>
      )}
    </article>
  );
}

const numbers = new Intl.NumberFormat();

export function VaultView(props: { readonly info: VaultInfo; readonly onClose: () => void }) {
  const { info, onClose } = props;
  const state = useVault(info);
  const vault = state.status === "open" ? state.vault : undefined;
  const notes = useNotes(vault);
  const [selected, setSelected] = useState<NoteId | undefined>();

  return (
    <div className="vault">
      <aside className="sidebar" aria-label={info.name}>
        <header className="sidebar-header">
          <h2 title={info.path}>{info.name}</h2>
          <button type="button" className="quiet" onClick={onClose}>
            {t("closeVault")}
          </button>
        </header>
        {state.status === "opening" ? (
          <p className="placeholder" role="status">
            {t("indexing")}
          </p>
        ) : state.status === "failed" ? (
          <p role="alert">{state.error.message}</p>
        ) : notes.length === 0 ? (
          <p className="placeholder">{t("noNotes")}</p>
        ) : (
          <>
            <NoteList notes={notes} selected={selected} onSelect={setSelected} label={t("notes")} />
            <p className="count" role="status">
              {notes.length === 1
                ? t("oneNote")
                : t("noteCount", { count: numbers.format(notes.length) })}
            </p>
          </>
        )}
      </aside>
      <main className="pane">
        {vault !== undefined && selected !== undefined ? (
          <NoteView vault={vault} id={selected} />
        ) : (
          <p className="placeholder">{t("selectNote")}</p>
        )}
      </main>
    </div>
  );
}
