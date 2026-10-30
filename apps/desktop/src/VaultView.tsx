// An open vault: its notes on the left, the selected note in the editor on
// the right.
import type { NoteId } from "@nether/core";
import { Suspense, lazy, useEffect, useState } from "react";
import { NoteList } from "./NoteList.tsx";
import { t } from "./messages.ts";
import type { VaultInfo } from "./mygo.ts";
import { useNotes, useVault } from "./useVault.ts";

// The editor and the Markdown parser load on their own, so the vault's notes
// show while they do.
const loadNoteView = () => import("./NoteView.tsx");
const NoteView = lazy(loadNoteView);

const numbers = new Intl.NumberFormat();

export function VaultView(props: { readonly info: VaultInfo; readonly onClose: () => void }) {
  const { info, onClose } = props;
  const state = useVault(info);
  const vault = state.status === "open" ? state.vault : undefined;
  const notes = useNotes(vault);
  const [selected, setSelected] = useState<NoteId | undefined>();

  useEffect(() => {
    // Start loading the editor as the vault opens, before a note is picked.
    void loadNoteView();
  }, []);

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
          <Suspense fallback={null}>
            <NoteView vault={vault} id={selected} />
          </Suspense>
        ) : (
          <p className="placeholder">{t("selectNote")}</p>
        )}
      </main>
    </div>
  );
}
