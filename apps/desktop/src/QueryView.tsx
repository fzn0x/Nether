// A query block's notes (ADR 0021): what the base in a `base` code block
// finds across the vault, shown below its code as a table, a list or
// cards, and found again as the vault's notes change. It only shows
// notes: a note opens from its name, and nothing is written.
import type { NoteId } from "@nether/core";
import {
  type Query,
  type QueryResult,
  type Row,
  readQuery,
  rowTitle,
  runQuery,
  viewIdOf,
} from "@nether/database";
import type { LinkGraph } from "@nether/graph";
import type { Vault } from "@nether/storage";
import { useDeferredValue, useMemo, useState } from "react";
import { GalleryLayout, ListLayout, Sections, valueText } from "./DatabaseLayouts.tsx";
import type { VaultMedia } from "./backend.ts";
import { imageUrl, queryNotes } from "./databases.ts";
import { t } from "./messages.ts";
import { useGraph } from "./useGraph.ts";
import { useNotes } from "./useVault.ts";

/** How many notes show at first, and how many more each time the user asks. */
const page = 100;

function QueryTable(props: {
  readonly result: QueryResult;
  readonly rows: readonly Row[];
  readonly onOpen: (note: NoteId) => void;
}) {
  const { result, rows, onOpen } = props;
  return (
    <table className="database-table">
      <thead>
        <tr>
          <th scope="col">{t("builtIn_title")}</th>
          {result.columns.map((column) => (
            <th key={column.property} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">
              <button
                type="button"
                className="database-row-title"
                onClick={() => {
                  onOpen(row.id);
                }}
              >
                {rowTitle(row)}
              </button>
            </th>
            {result.columns.map((column) => {
              const error = row.errors?.get(column.label);
              return (
                <td key={column.property}>
                  {error === undefined ? (
                    valueText(row.properties.find((entry) => entry.key === column.label)?.value)
                  ) : (
                    <span className="database-error">{t("formulaError", { error })}</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function QueryView(props: {
  /** The block's code: a base, as Obsidian writes one. */
  readonly source: string;
  readonly vault: Vault;
  readonly media: VaultMedia;
  readonly graph: LinkGraph;
  readonly onOpen: (note: NoteId) => void;
}) {
  const { vault, media, graph, onOpen } = props;
  // Typing in the block finds its notes again when the typing lets it.
  const source = useDeferredValue(props.source);
  const read = useMemo((): Query | string => {
    try {
      return readQuery(source);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [source]);
  const version = useGraph(graph);
  const notes = useNotes(vault);
  const [chosen, setChosen] = useState(0);
  const [shown, setShown] = useState(page);
  const query = typeof read === "string" ? undefined : read;
  const at = query === undefined ? 0 : Math.min(chosen, query.views.length - 1);
  const view = query?.views[at];
  const result = useMemo(
    () =>
      query === undefined || view === undefined
        ? undefined
        : runQuery(query, view, queryNotes(notes, graph)),
    [query, view, notes, graph, version],
  );

  if (typeof read === "string") {
    return <p className="query-problem">{t("queryUnreadable", { error: read })}</p>;
  }
  if (query === undefined || view === undefined || result === undefined) return null;

  // Only so many notes show, in their groups when the view groups.
  const rows = result.rows.slice(0, shown);
  const showing = new Set(rows.map((row) => row.id));
  const groups = result.groups
    ?.map((group) => ({ ...group, rows: group.rows.filter((row) => showing.has(row.id)) }))
    .filter((group) => group.rows.length > 0);
  const visible = result.columns.map((column) => ({ key: column.label, type: "text" as const }));
  const layout = {
    view: { id: viewIdOf(view.name), name: view.name, layout: "list", visible: [] },
    rows,
    ...(groups === undefined ? {} : { groups }),
    visible,
    onOpen,
  } as const;
  let body;
  switch (view.type) {
    case "list":
      body = <ListLayout {...layout} />;
      break;
    case "cards":
      body = (
        <GalleryLayout
          {...layout}
          coverOf={(row) => imageUrl(vault, media, result.images.get(row.id), row.path)}
        />
      );
      break;
    default:
      body = (
        <Sections
          rows={rows}
          {...(groups === undefined ? {} : { groups })}
          render={(list) => <QueryTable result={result} rows={list} onOpen={onOpen} />}
        />
      );
  }
  const total = result.total;
  const found = (
    <>
      {result.error === undefined ? null : (
        <p className="query-problem">{t("queryFilterFailed", { error: result.error })}</p>
      )}
      {result.rows.length === 0 ? <p className="placeholder">{t("queryNone")}</p> : body}
      <p className="query-count">
        {total === 1 ? t("oneNote") : t("noteCount", { count: total })}
        {result.rows.length > shown ? (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setShown(shown + page);
            }}
          >
            {t("showMore", { count: Math.min(page, result.rows.length - shown) })}
          </button>
        ) : null}
      </p>
    </>
  );
  return (
    <section className="database query" aria-label={t("queryResults")}>
      {query.views.length > 1 ? (
        <div className="database-tabs">
          <div role="tablist" aria-label={t("queryViews")}>
            {query.views.map((item, index) => (
              <button
                // Views may share a name; their places tell them apart.
                key={index}
                type="button"
                role="tab"
                aria-selected={index === at}
                onClick={() => {
                  setChosen(index);
                  setShown(page);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {query.views.length > 1 ? (
        <div role="tabpanel" aria-label={view.name}>
          {found}
        </div>
      ) : (
        found
      )}
    </section>
  );
}
