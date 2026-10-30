// The sidebar's search: words, "phrases", -exclusions and filters by tag,
// path and property, each note found with the text around a match.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import { isEmptyQuery, parseQuery } from "@nether/search";
import type { Vault } from "@nether/storage";
import { type RefObject, useEffect, useState } from "react";
import { t } from "./messages.ts";
import { type SearchResult, searchVault, snippetParts } from "./search.ts";
import { useGraph } from "./useGraph.ts";

const numbers = new Intl.NumberFormat();

/** How long typing pauses before a search runs. */
const pause = 150;

function folderOf(path: string): string | undefined {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? undefined : path.slice(0, slash);
}

export function SearchPanel(props: {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly onOpen: (id: NoteId) => void;
  readonly input: RefObject<HTMLInputElement | null>;
}) {
  const { vault, graph, onOpen, input } = props;
  const [text, setText] = useState("");
  const [results, setResults] = useState<readonly SearchResult[] | undefined>();
  const version = useGraph(graph);

  useEffect(() => {
    const query = parseQuery(text);
    if (isEmptyQuery(query)) {
      setResults(undefined);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void searchVault(vault, graph, query).then((found) => {
        if (current) setResults(found);
      });
    }, pause);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, vault, graph, version]);

  return (
    <div className="search-panel">
      <input
        ref={input}
        type="search"
        className="search-input"
        aria-label={t("searchLabel")}
        aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
        placeholder={t("searchHint")}
        value={text}
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {results === undefined ? null : (
        <p className="count" role="status">
          {results.length === 0
            ? t("noResults")
            : results.length === 1
              ? t("oneNote")
              : t("noteCount", { count: numbers.format(results.length) })}
        </p>
      )}
      {results === undefined || results.length === 0 ? null : (
        <ul className="search-results" aria-label={t("searchResults")}>
          {results.map(({ note, snippet }) => {
            const folder = folderOf(note.path);
            return (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(note.id);
                  }}
                >
                  <span className="note-title">{note.title}</span>
                  {folder === undefined ? null : <span className="note-folder">{folder}</span>}
                </button>
                {snippet === undefined || snippet === "" ? null : (
                  <p className="search-snippet">
                    {snippetParts(snippet).map((part, index) =>
                      part.match ? (
                        <mark key={index}>{part.text}</mark>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
