// A note in the editor, with its title and what happened to its last save.
// It shows as blocks, or as its Markdown source, which Ctrl or Cmd and /
// switches between.
import type { NoteId } from "@nether/core";
import { NoteEditor } from "@nether/editor";
import "@nether/editor/math.css";
import type { LinkGraph } from "@nether/graph";
import type { Vault } from "@nether/storage";
import { type KeyboardEvent, Suspense, lazy, useMemo, useState } from "react";
import type { VaultMedia } from "./backend.ts";
import { t } from "./messages.ts";
import { noteFiles } from "./noteFiles.ts";
import { PropertiesPanel } from "./PropertiesPanel.tsx";
import { type NotePart, noteLinks } from "./noteLinks.ts";
import { useGraph } from "./useGraph.ts";
import { useNote } from "./useNote.ts";

export type NoteMode = "blocks" | "source";

// CodeMirror loads the first time a note shows its source.
const SourceEditor = lazy(() =>
  import("@nether/editor/source").then(({ SourceEditor: editor }) => ({ default: editor })),
);

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
  readonly graph: LinkGraph;
  readonly id: NoteId;
  /** Where a link asked to go in this note. */
  readonly focus: (NotePart & { readonly key: number }) | undefined;
  /** Opens another note, or a part of one, as a link in this one does. */
  readonly onOpenNote: (id: NoteId, part?: NotePart) => void;
  /** Shows the notes with a tag, as a tag in this note does. */
  readonly onOpenTag: (name: string) => void;
  readonly mode: NoteMode;
  readonly onMode: (mode: NoteMode) => void;
}) {
  const { vault, media, graph, id, focus, mode, onMode, onOpenNote, onOpenTag } = props;
  const note = vault.note(id);
  const { state, saveError, editText, refresh } = useNote(vault, id);
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
  const links = useMemo(
    () =>
      noteLinks(
        vault,
        graph,
        id,
        onOpenNote,
        (error) => {
          setFileError(error instanceof Error ? error.message : String(error));
        },
        onOpenTag,
      ),
    [vault, graph, id, onOpenNote, onOpenTag],
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
    <div className="note-layout">
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
        {saveError === undefined ? null : (
          <p role="alert">{t("saveFailed", { error: saveError })}</p>
        )}
        {fileError === undefined ? null : (
          <p role="alert">{t("fileFailed", { error: fileError })}</p>
        )}
        {state.status === "failed" ? (
          <p role="alert">{state.error.message}</p>
        ) : state.status === "binary" ? (
          <p className="placeholder">{t("binaryNote")}</p>
        ) : state.status === "loading" ? null : mode === "source" ? (
          <Suspense fallback={null}>
            <SourceEditor
              // The text read again starts a new editor.
              key={state.version}
              text={state.text}
              onChange={editText}
              label={t("noteSource", { title: note.title })}
              placeholder={t("emptySource")}
              vim={vim}
              autofocus={switched}
            />
          </Suspense>
        ) : (
          <>
            {state.frontmatterError === undefined ? (
              <PropertiesPanel key={state.document.guid} document={state.document} vault={vault} />
            ) : (
              <p className="notice" role="status">
                {t("unreadableFrontmatter", { error: state.frontmatterError })}
              </p>
            )}
            <NoteEditor
              // The editor shows the document as it changes; a new document starts a new editor.
              key={state.document.guid}
              document={state.document}
              label={t("noteBody", { title: note.title })}
              placeholder={t("emptyNote")}
              files={files}
              links={links}
              autofocus={switched}
              {...(focus === undefined ? {} : { focus })}
            />
          </>
        )}
      </article>
      <NotePanel graph={graph} id={id} onOpenNote={onOpenNote} />
    </div>
  );
}

/** Beside the note: its outline, and the notes that link to it with the text around each link. */
function NotePanel(props: {
  readonly graph: LinkGraph;
  readonly id: NoteId;
  readonly onOpenNote: (id: NoteId, part?: NotePart) => void;
}) {
  const { graph, id, onOpenNote } = props;
  const version = useGraph(graph);
  const headings = useMemo(() => graph.note(id)?.index.headings ?? [], [graph, id, version]);
  const backlinks = useMemo(() => graph.backlinks(id), [graph, id, version]);
  return (
    <aside className="note-panel" aria-label={t("aboutNote")}>
      <section aria-labelledby="outline-title">
        <h2 id="outline-title">{t("outline")}</h2>
        {headings.length === 0 ? (
          <p className="placeholder">{t("noHeadings")}</p>
        ) : (
          <ul className="outline">
            {headings.map((heading, index) => (
              <li
                key={`${String(index)}-${heading.text}`}
                style={{ paddingInlineStart: `${String(heading.level - 1)}rem` }}
              >
                <button
                  type="button"
                  onClick={() => {
                    onOpenNote(id, { heading: heading.text });
                  }}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="backlinks-title">
        <h2 id="backlinks-title">{t("backlinks")}</h2>
        {backlinks.length === 0 ? (
          <p className="placeholder">{t("noBacklinks")}</p>
        ) : (
          <ul className="backlinks">
            {backlinks.map((backlink) => {
              const source = graph.note(backlink.source);
              const contexts = [...new Set(backlink.links.map((link) => link.context))].filter(
                (context) => context !== "",
              );
              return (
                <li key={backlink.source}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenNote(backlink.source);
                    }}
                  >
                    {source?.title ?? ""}
                  </button>
                  {contexts.map((context) => (
                    <p key={context} className="backlink-context">
                      {context}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
