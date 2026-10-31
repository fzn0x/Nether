// A note in the editor, with its title and what happened to its last save.
// It shows as blocks, or as its Markdown source, which Ctrl or Cmd and /
// switches between.
import type { NoteId } from "@nether/core";
import { NoteEditor } from "@nether/editor";
import "@nether/editor/math.css";
import type { Backlink, LinkGraph, NoteIndex } from "@nether/graph";
import type { Vault } from "@nether/storage";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { type VaultMedia, backend } from "./backend.ts";
import { readIndexRow } from "./indexer.ts";
import { t } from "./messages.ts";
import { ariaKeys, formatKeys } from "./shortcuts.ts";
import { linkPreviews } from "./linkPreviews.ts";
import { noteFiles } from "./noteFiles.ts";
import { DatabaseView } from "./DatabaseView.tsx";
import { PropertiesPanel } from "./PropertiesPanel.tsx";
import { QueryView } from "./QueryView.tsx";
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
  /** Moves the note to the vault's trash. */
  readonly onTrash: () => void;
  /** Exports the note, its folder or the vault. */
  readonly onExport: () => void;
  /** Renames the note in its folder, and the links to it; rejects with why it could not. */
  readonly onRename: (name: string) => Promise<void>;
  /** Changes when the user asks to switch between blocks and source. */
  readonly sourceRequest: number;
  /** Changes when the user asks to rename the note: its name takes focus. */
  readonly renameRequest: number;
  /** The shortcut that switches modes, for its button's hint. */
  readonly sourceKeys: string | undefined;
  /** Called when the note's text shows. */
  readonly onShown: () => void;
}) {
  const {
    vault,
    media,
    graph,
    id,
    focus,
    mode,
    onMode,
    onOpenNote,
    onOpenTag,
    onTrash,
    onExport,
    onRename,
    sourceRequest,
    renameRequest,
    sourceKeys,
    onShown,
  } = props;
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
    () => ({
      ...noteLinks(
        vault,
        graph,
        id,
        onOpenNote,
        (error) => {
          setFileError(error instanceof Error ? error.message : String(error));
        },
        onOpenTag,
      ),
      // A `base` code block shows the notes its query finds.
      renderQuery: (source: string) => (
        <QueryView
          source={source}
          vault={vault}
          media={media}
          graph={graph}
          onOpen={(note) => {
            onOpenNote(note);
          }}
        />
      ),
    }),
    [vault, media, graph, id, onOpenNote, onOpenTag],
  );

  const toggle = async () => {
    // Save what either editor has, so the other starts from it.
    await refresh();
    setSwitched(true);
    onMode(mode === "blocks" ? "source" : "blocks");
  };

  // When a note's text shows, and for performance measurements.
  const shown = state.status === "ready";
  useEffect(() => {
    if (!shown) return;
    backend.mark("note-shown");
    onShown();
  }, [shown, id, onShown]);

  // The app's commands ask for a switch, or a rename; a request made before this view does nothing.
  const handledSource = useRef(sourceRequest);
  useEffect(() => {
    if (sourceRequest === handledSource.current) return;
    handledSource.current = sourceRequest;
    void toggle();
  }, [sourceRequest]);
  const handledRename = useRef(renameRequest);
  useEffect(() => {
    if (renameRequest === handledRename.current) return;
    handledRename.current = renameRequest;
    const title = document.getElementById("note-title");
    if (title === null) return;
    title.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(title);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [renameRequest]);

  if (note === undefined || state.status === "missing") {
    return <p className="placeholder">{t("missingNote")}</p>;
  }
  return (
    <div className="note-layout">
      <article className="note" aria-labelledby="note-title">
        <header className="note-header">
          <NoteTitle
            title={note.title}
            onRename={onRename}
            onError={(error) => {
              setFileError(error);
            }}
          />
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
                aria-keyshortcuts={sourceKeys === undefined ? undefined : ariaKeys(sourceKeys)}
                title={
                  sourceKeys === undefined
                    ? t("sourceModeHint")
                    : `${t("sourceModeHint")} (${formatKeys(sourceKeys)})`
                }
                onClick={() => void toggle()}
              >
                {t("sourceMode")}
              </button>
              <button
                type="button"
                className="quiet"
                aria-haspopup="dialog"
                title={t("exportHint")}
                onClick={onExport}
              >
                {t("export")}
              </button>
              <button
                type="button"
                className="quiet"
                title={t("moveToTrashHint")}
                onClick={onTrash}
              >
                {t("moveToTrash")}
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
              <PropertiesPanel
                key={`properties-${state.document.guid}`}
                document={state.document}
                vault={vault}
              />
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
              previews={linkPreviews(vault)}
              autofocus={switched}
              {...(focus === undefined ? {} : { focus })}
            />
            <DatabaseView
              // Its panels, view and errors are the note's: another note starts afresh.
              // Each sibling's key its own, or React keeps the last note's editor too.
              key={`database-${state.document.guid}`}
              vault={vault}
              media={media}
              graph={graph}
              document={state.document}
              path={note.path}
              onOpenNote={(row) => {
                onOpenNote(row);
              }}
            />
          </>
        )}
      </article>
      <NotePanel vault={vault} graph={graph} id={id} onOpenNote={onOpenNote} />
    </div>
  );
}

/**
 * The note's name, edited in place: Enter or leaving it renames the note,
 * Escape puts the name back.
 */
function NoteTitle(props: {
  readonly title: string;
  readonly onRename: (name: string) => Promise<void>;
  readonly onError: (error: string) => void;
}) {
  const { title, onRename, onError } = props;
  const element = useRef<HTMLHeadingElement>(null);
  const commit = () => {
    const name = element.current?.textContent.trim() ?? title;
    if (name === title) return;
    onRename(name).catch((error: unknown) => {
      if (element.current !== null) element.current.textContent = title;
      onError(error instanceof Error ? error.message : String(error));
    });
  };
  return (
    <h1
      // A new name starts the heading anew, so React and the browser agree on its text.
      key={title}
      id="note-title"
      ref={element}
      className="note-title-field"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={t("noteName")}
      aria-multiline="false"
      title={t("renameHint")}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          element.current?.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          if (element.current !== null) element.current.textContent = title;
          element.current?.blur();
        }
      }}
    >
      {title}
    </h1>
  );
}

/** How many linking notes' text the backlinks panel reads, the rest shown by name. */
const contextLimit = 100;

/**
 * The text around the links from each note that links to one, read from
 * the vault's index, which keeps it while the graph does not.
 */
function useBacklinkContexts(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
  backlinks: readonly Backlink[],
): ReadonlyMap<NoteId, readonly string[]> {
  const [contexts, setContexts] = useState<ReadonlyMap<NoteId, readonly string[]>>(new Map());
  useEffect(() => {
    let current = true;
    const sources = backlinks.slice(0, contextLimit).map((backlink) => backlink.source);
    void vault.indexes.noteIndexesOf(sources).then((rows) => {
      if (!current) return;
      const found = new Map<NoteId, readonly string[]>();
      for (const row of rows) {
        const path = graph.note(row.note)?.path;
        if (path === undefined) continue;
        let index: NoteIndex;
        try {
          index = readIndexRow(row);
        } catch {
          continue;
        }
        const texts = index.links
          .filter((link) => link.target !== "" && graph.resolve(link.target, path) === id)
          .map((link) => link.context)
          .filter((context) => context !== "");
        found.set(row.note, [...new Set(texts)]);
      }
      setContexts(found);
    });
    return () => {
      current = false;
    };
  }, [vault, graph, id, backlinks]);
  return contexts;
}

/** Beside the note: its outline, and the notes that link to it with the text around each link. */
function NotePanel(props: {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly id: NoteId;
  readonly onOpenNote: (id: NoteId, part?: NotePart) => void;
}) {
  const { vault, graph, id, onOpenNote } = props;
  const version = useGraph(graph);
  const headings = useMemo(() => graph.note(id)?.index.headings ?? [], [graph, id, version]);
  const backlinks = useMemo(() => graph.backlinks(id), [graph, id, version]);
  const contextsOf = useBacklinkContexts(vault, graph, id, backlinks);
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
              const contexts = contextsOf.get(backlink.source) ?? [];
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
