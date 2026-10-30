// An open vault: its notes, or its tags, on the left, and the selected note
// in the editor on the right. A tag shows the notes with it.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Indexer } from "./indexer.ts";
import { t } from "./messages.ts";
import type { VaultInfo } from "./mygo.ts";
import { NoteList } from "./NoteList.tsx";
import { QuickSwitcher } from "./QuickSwitcher.tsx";
import { SearchPanel } from "./SearchPanel.tsx";
import type { NotePart } from "./noteLinks.ts";
import type { NoteMode } from "./NoteView.tsx";
import { useGraph } from "./useGraph.ts";
import { useNotes, useVault } from "./useVault.ts";

// The editor and the Markdown parser load on their own, so the vault's notes
// show while they do.
const loadNoteView = () => import("./NoteView.tsx");
const NoteView = lazy(loadNoteView);

const numbers = new Intl.NumberFormat();

/** How far the link index has read, while it is reading. */
function IndexStatus(props: { readonly indexer: Indexer }) {
  const { indexer } = props;
  const progress = useSyncExternalStore(
    (listener) => indexer.subscribe(listener),
    () => indexer.progress(),
  );
  if (progress.done >= progress.total) return null;
  return (
    <p className="count" role="status">
      {t("indexingLinks", {
        done: numbers.format(progress.done),
        total: numbers.format(progress.total),
      })}
    </p>
  );
}

/** The vault's tags, nested ones under theirs, with how many notes have each. */
function TagList(props: { readonly graph: LinkGraph; readonly onSelect: (tag: string) => void }) {
  const { graph, onSelect } = props;
  const version = useGraph(graph);
  const tags = useMemo(() => graph.tags(), [graph, version]);
  if (tags.length === 0) return <p className="placeholder">{t("noTags")}</p>;
  return (
    <ul className="tag-list" aria-label={t("tags")}>
      {tags.map(({ tag, count }) => {
        const depth = tag.split("/").length - 1;
        return (
          <li key={tag.toLowerCase()} style={{ paddingInlineStart: `${String(depth)}rem` }}>
            <button
              type="button"
              onClick={() => {
                onSelect(tag);
              }}
            >
              <span className="tag-name">
                #{depth === 0 ? tag : tag.slice(tag.lastIndexOf("/") + 1)}
              </span>
              <span className="tag-count">{numbers.format(count)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function VaultView(props: { readonly info: VaultInfo; readonly onClose: () => void }) {
  const { info, onClose } = props;
  const state = useVault(info);
  const vault = state.status === "open" ? state.vault : undefined;
  const graph = state.status === "open" ? state.indexer.graph : undefined;
  const notes = useNotes(vault);
  const [selected, setSelected] = useState<NoteId | undefined>();
  // Where a link to a heading or block asked to go, in the note it opened.
  const [focus, setFocus] = useState<(NotePart & { readonly key: number }) | undefined>();
  // Blocks or source, kept from note to note.
  const [mode, setMode] = useState<NoteMode>("blocks");
  const [panel, setPanel] = useState<"notes" | "tags" | "search">("notes");
  const [switcher, setSwitcher] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState<string | undefined>();
  const version = useGraph(graph);

  useEffect(() => {
    // Start loading the editor as the vault opens, before a note is picked.
    void loadNoteView();
  }, []);

  // Ctrl or Cmd and O opens the quick switcher; with Shift and F, search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        setSwitcher(true);
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setPanel("search");
        // Once the panel shows.
        requestAnimationFrame(() => searchInput.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const openNote = useCallback((id: NoteId, part?: NotePart) => {
    setSelected(id);
    setFocus(
      part !== undefined && (part.heading !== undefined || part.block !== undefined)
        ? { ...part, key: Date.now() }
        : undefined,
    );
  }, []);

  const showTag = useCallback((name: string) => {
    setTag(name);
    setPanel("notes");
  }, []);

  const shown = useMemo(() => {
    if (tag === undefined || graph === undefined) return notes;
    const tagged = new Set(graph.notesWithTag(tag));
    return notes.filter((note) => tagged.has(note.id));
  }, [notes, tag, graph, version]);

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
        ) : (
          <>
            <div className="sidebar-tabs">
              <button
                type="button"
                aria-pressed={panel === "notes"}
                onClick={() => {
                  setPanel("notes");
                }}
              >
                {t("notes")}
              </button>
              <button
                type="button"
                aria-pressed={panel === "tags"}
                onClick={() => {
                  setPanel("tags");
                }}
              >
                {t("tags")}
              </button>
              <button
                type="button"
                aria-pressed={panel === "search"}
                aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
                onClick={() => {
                  setPanel("search");
                }}
              >
                {t("search")}
              </button>
            </div>
            {panel === "search" ? (
              <SearchPanel
                vault={state.vault}
                graph={state.indexer.graph}
                onOpen={openNote}
                input={searchInput}
              />
            ) : panel === "tags" ? (
              <TagList graph={state.indexer.graph} onSelect={showTag} />
            ) : notes.length === 0 ? (
              <p className="placeholder">{t("noNotes")}</p>
            ) : (
              <>
                {tag === undefined ? null : (
                  <p className="filter">
                    {t("taggedWith", { tag })}
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        setTag(undefined);
                      }}
                    >
                      {t("allNotes")}
                    </button>
                  </p>
                )}
                <NoteList
                  notes={shown}
                  selected={selected}
                  onSelect={openNote}
                  label={t("notes")}
                />
                <p className="count" role="status">
                  {notes.length === 1
                    ? t("oneNote")
                    : t("noteCount", { count: numbers.format(notes.length) })}
                </p>
              </>
            )}
            <IndexStatus indexer={state.indexer} />
          </>
        )}
      </aside>
      {switcher && state.status === "open" ? (
        <QuickSwitcher
          vault={state.vault}
          graph={state.indexer.graph}
          onOpen={openNote}
          onClose={() => {
            setSwitcher(false);
          }}
        />
      ) : null}
      <main className="pane">
        {state.status === "open" && selected !== undefined ? (
          <Suspense fallback={null}>
            <NoteView
              vault={state.vault}
              media={state.media}
              graph={state.indexer.graph}
              id={selected}
              focus={focus}
              onOpenNote={openNote}
              onOpenTag={showTag}
              mode={mode}
              onMode={setMode}
            />
          </Suspense>
        ) : (
          <p className="placeholder">{t("selectNote")}</p>
        )}
      </main>
    </div>
  );
}
