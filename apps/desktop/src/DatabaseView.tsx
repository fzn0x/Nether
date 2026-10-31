// A database below its note's text (ADR 0018): its views as tabs, and the
// chosen one as a table of its rows, which its filters, sorts and grouping
// shape. The schema lives in the note's frontmatter, so changes to it go to
// the note's document; a row's values live in the row's file.
import {
  type Condition,
  type DatabaseSchema,
  type Filter,
  type FilterOperator,
  type JsonValue,
  type NoteId,
  type PropertyDefinition,
  type PropertyType,
  type PropertyEntry,
  type Rollup,
  type RollupFunction,
  type View,
  rollupFunctions,
} from "@nether/core";
import {
  type FindRow,
  type Row,
  basePath,
  databaseKey,
  databaseOf,
  linkName,
  rowTitle,
  runView,
  viewIdOf,
  withRollups,
  writeDatabase,
} from "@nether/database";
import { documentProperties, setDocumentProperties } from "@nether/editor";
import type { LinkGraph } from "@nether/graph";
import type { Vault } from "@nether/storage";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  BoardLayout,
  CalendarLayout,
  GalleryLayout,
  ListLayout,
  TimelineLayout,
  boardTypes,
  groupLabel,
  valueText,
} from "./DatabaseLayouts.tsx";
import { ListEditor } from "./PropertiesPanel.tsx";
import type { VaultMedia } from "./backend.ts";
import {
  createRow,
  databaseNotes,
  databaseRows,
  linkToNote,
  resolveLink,
  setNoteProperty,
  shortLink,
  syncBacklinks,
  syncBase,
} from "./databases.ts";
import { type MessageKey, language, t } from "./messages.ts";
import { editableTypes, isListType, newPropertyKey } from "./properties.ts";
import { useGraph } from "./useGraph.ts";
import { useNotes } from "./useVault.ts";

/** The operators a filter offers for each kind of property, in its menu's order. */
function operatorsFor(type: PropertyType | "$title" | "$created" | "$updated"): FilterOperator[] {
  switch (type) {
    case "number":
      return [
        "equals",
        "notEquals",
        "greaterThan",
        "greaterOrEqual",
        "lessThan",
        "lessOrEqual",
        "isEmpty",
        "isNotEmpty",
      ];
    case "date":
    case "$created":
    case "$updated":
      return ["equals", "before", "after", "onOrBefore", "onOrAfter", "isEmpty", "isNotEmpty"];
    case "select":
      return ["equals", "notEquals", "isEmpty", "isNotEmpty"];
    case "multiSelect":
      return ["contains", "notContains", "isEmpty", "isNotEmpty"];
    case "checkbox":
      return ["equals"];
    default:
      return [
        "contains",
        "notContains",
        "equals",
        "notEquals",
        "startsWith",
        "endsWith",
        "isEmpty",
        "isNotEmpty",
      ];
  }
}

const unary: readonly FilterOperator[] = ["isEmpty", "isNotEmpty"];

/** What a rollup compares as: a date for the earliest or latest, else a number. */
function rollupKind(schema: DatabaseSchema, key: string): PropertyType | undefined {
  const rollup = schema.properties.find((property) => property.key === key)?.rollup;
  if (rollup === undefined) return undefined;
  return rollup.function === "earliest" || rollup.function === "latest" ? "date" : "number";
}

const numberFormat = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });

/** A rollup's value as its cell shows it: a number rounded for reading, a date as it is. */
function rollupText(value: JsonValue | undefined): string {
  return typeof value === "number" ? numberFormat.format(value) : valueText(value);
}

/** An object without one of its keys, as a view without its filter. */
function without<T extends object, K extends keyof T>(object: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key)) as Omit<T, K>;
}

/** The note's properties, kept current as its document changes. */
function useDocumentProperties(document: Y.Doc): readonly PropertyEntry[] {
  const [entries, setEntries] = useState(() => documentProperties(document));
  useEffect(() => {
    const refresh = () => {
      setEntries(documentProperties(document));
    };
    refresh();
    document.on("update", refresh);
    return () => {
      document.off("update", refresh);
    };
  }, [document]);
  return entries;
}

/** A cell of a row: an editor for its property's type, which writes when it is done. */
function Cell(props: {
  readonly label: string;
  readonly property: PropertyDefinition;
  readonly value: JsonValue | undefined;
  readonly onCommit: (value: JsonValue) => void;
  /** A relation's rows, by name, and the link a name is written as. */
  readonly related?: {
    readonly names: readonly string[];
    readonly toValue: (name: string) => string;
  };
}) {
  const { label, property, value, onCommit, related } = props;
  const shown =
    value === undefined || value === null || typeof value === "object" ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => {
    setDraft(shown);
  }, [shown]);
  if (property.type === "checkbox") {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        onChange={(event) => {
          onCommit(event.target.checked);
        }}
      />
    );
  }
  if (isListType(property.type)) {
    const values = (
      Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
    ).map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
    return (
      <ListEditor
        label={label}
        values={values}
        onChange={onCommit}
        {...(related === undefined
          ? {}
          : { suggestions: related.names, toValue: related.toValue, show: linkName })}
      />
    );
  }
  const commit = () => {
    if (draft === shown) return;
    if (property.type === "number") onCommit(draft.trim() === "" ? null : Number(draft));
    else onCommit(draft === "" ? null : draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    else if (event.key === "Escape") setDraft(shown);
  };
  const options = property.options?.map((option) => option.name) ?? [];
  const list = options.length > 0 ? `options-${property.key}` : undefined;
  return (
    <>
      <input
        type={
          property.type === "number"
            ? "number"
            : property.type === "date"
              ? "date"
              : property.type === "url"
                ? "url"
                : "text"
        }
        aria-label={label}
        value={draft}
        list={list}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {list === undefined ? null : (
        <datalist id={list}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** The view's filter as the bar edits it: conditions joined by all or any; undefined when nested deeper. */
function flatFilter(
  filter: Filter | undefined,
): { join: "and" | "or"; conditions: Condition[] } | undefined {
  if (filter === undefined) return { join: "and", conditions: [] };
  if ("and" in filter || "or" in filter) {
    const join = "and" in filter ? "and" : "or";
    const parts = "and" in filter ? filter.and : filter.or;
    if (parts.some((part) => "and" in part || "or" in part)) return undefined;
    return { join, conditions: parts as Condition[] };
  }
  return { join: "and", conditions: [filter] };
}

function FilterBar(props: {
  readonly view: View;
  readonly schema: DatabaseSchema;
  readonly onChange: (filter: Filter | undefined) => void;
}) {
  const { view, schema, onChange } = props;
  const flat = flatFilter(view.filter);
  if (flat === undefined) return <p className="placeholder">{t("filterTooDeep")}</p>;
  const { join, conditions } = flat;
  const keys = [
    "$title",
    ...schema.properties.map((property) => property.key),
    "$created",
    "$updated",
  ];
  const typeOf = (key: string): PropertyType | "$title" | "$created" | "$updated" =>
    rollupKind(schema, key) ?? typeOfKey(key);
  const typeOfKey = (key: string) =>
    key.startsWith("$")
      ? (key as "$title" | "$created" | "$updated")
      : (schema.properties.find((property) => property.key === key)?.type ?? "text");
  const save = (next: Condition[], nextJoin = join) => {
    onChange(next.length === 0 ? undefined : nextJoin === "and" ? { and: next } : { or: next });
  };
  const nameOf = (key: string) =>
    key.startsWith("$") ? t(`builtIn_${key.slice(1)}` as MessageKey) : key;
  return (
    <div className="database-filters" role="group" aria-label={t("filter")}>
      {conditions.length > 1 ? (
        <select
          aria-label={t("filterJoin")}
          value={join}
          onChange={(event) => {
            save(conditions, event.target.value === "or" ? "or" : "and");
          }}
        >
          <option value="and">{t("filterAll")}</option>
          <option value="or">{t("filterAny")}</option>
        </select>
      ) : null}
      {conditions.map((condition, index) => {
        const type = typeOf(condition.property);
        const replace = (next: Condition) => {
          save(conditions.map((item, at) => (at === index ? next : item)));
        };
        const number = String(index + 1);
        return (
          <div key={number} className="database-condition">
            <select
              aria-label={t("filterProperty", { number })}
              value={condition.property}
              onChange={(event) => {
                const property = event.target.value;
                const operator = operatorsFor(typeOf(property))[0] ?? "isNotEmpty";
                replace(
                  unary.includes(operator)
                    ? { property, operator }
                    : { property, operator, value: typeOf(property) === "checkbox" ? true : "" },
                );
              }}
            >
              {keys.map((key) => (
                <option key={key} value={key}>
                  {nameOf(key)}
                </option>
              ))}
            </select>
            <select
              aria-label={t("filterOperator", { number })}
              value={condition.operator}
              onChange={(event) => {
                const operator = event.target.value as FilterOperator;
                const rest = without(condition, "value");
                replace(
                  unary.includes(operator)
                    ? { ...rest, operator }
                    : { ...rest, operator, value: condition.value ?? "" },
                );
              }}
            >
              {operatorsFor(type).map((operator) => (
                <option key={operator} value={operator}>
                  {t(`operator_${operator}` as MessageKey)}
                </option>
              ))}
            </select>
            {unary.includes(condition.operator) ? null : type === "checkbox" ? (
              <select
                aria-label={t("filterValue", { number })}
                value={condition.value === true ? "true" : "false"}
                onChange={(event) => {
                  replace({ ...condition, value: event.target.value === "true" });
                }}
              >
                <option value="true">{t("checked")}</option>
                <option value="false">{t("unchecked")}</option>
              </select>
            ) : (
              <input
                aria-label={t("filterValue", { number })}
                type={
                  type === "number"
                    ? "number"
                    : type === "date" || type === "$created" || type === "$updated"
                      ? "date"
                      : "text"
                }
                value={valueText(condition.value)}
                onChange={(event) => {
                  const text = event.target.value;
                  replace({
                    ...condition,
                    value: type === "number" && text !== "" ? Number(text) : text,
                  });
                }}
              />
            )}
            <button
              type="button"
              className="quiet"
              aria-label={t("removeCondition", { number })}
              onClick={() => {
                save(conditions.filter((_, at) => at !== index));
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="quiet"
        onClick={() => {
          save([...conditions, { property: "$title", operator: "contains", value: "" }]);
        }}
      >
        {t("addCondition")}
      </button>
    </div>
  );
}

/** The form that adds a property to the database and shows it in the view. */
/** A relation as the form makes it: the database it points to, and the property there that points back. */
interface NewRelation {
  readonly database: NoteId;
  readonly backlink?: string;
}

function AddProperty(props: {
  readonly taken: readonly string[];
  /** The vault's databases a relation can point to, and this one's name. */
  readonly databases: readonly { readonly id: NoteId; readonly title: string }[];
  readonly self: string;
  /** This database's relations, each with the properties of the rows it links to, for a rollup. */
  readonly relations: readonly { readonly key: string; readonly properties: readonly string[] }[];
  readonly onAdd: (
    key: string,
    type: PropertyType,
    more?: { readonly relation?: NewRelation; readonly rollup?: Rollup },
  ) => void;
}) {
  const { taken, databases, self, relations, onAdd } = props;
  const [key, setKey] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [chosenTarget, setTarget] = useState<NoteId | undefined>();
  const [twoWay, setTwoWay] = useState(true);
  const [back, setBack] = useState(self);
  const [chosenThrough, setThrough] = useState<string | undefined>();
  // The first there is until one is chosen: the lists change as the vault and schema do.
  const target = databases.some((database) => database.id === chosenTarget)
    ? chosenTarget
    : databases[0]?.id;
  const through = relations.some((relation) => relation.key === chosenThrough)
    ? chosenThrough
    : relations[0]?.key;
  const [source, setSource] = useState("$title");
  const [calculate, setCalculate] = useState<RollupFunction>("count");
  const name = key.trim();
  const backName = back.trim();
  const free =
    name !== "" &&
    !name.startsWith("$") &&
    name !== databaseKey &&
    !taken.includes(name) &&
    (type !== "relation" ||
      (target !== undefined && (!twoWay || (backName !== "" && backName !== name)))) &&
    (type !== "rollup" || through !== undefined);
  const sources = relations.find((relation) => relation.key === through)?.properties ?? [];
  return (
    <form
      className="database-add-property"
      onSubmit={(event) => {
        event.preventDefault();
        if (!free) return;
        if (type === "relation" && target !== undefined) {
          onAdd(name, type, {
            relation: twoWay ? { database: target, backlink: backName } : { database: target },
          });
        } else if (type === "rollup" && through !== undefined) {
          onAdd(name, type, {
            rollup: { relation: through, property: source, function: calculate },
          });
        } else {
          onAdd(name, type);
        }
        setKey("");
      }}
    >
      <input
        aria-label={t("propertyName")}
        placeholder={newPropertyKey(taken)}
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
        }}
      />
      <select
        aria-label={t("newPropertyType")}
        value={type}
        onChange={(event) => {
          setType(event.target.value as PropertyType);
        }}
      >
        {[...editableTypes, ...(relations.length > 0 ? (["rollup"] as const) : [])]
          .filter((option) => option !== "relation" || databases.length > 0)
          .map((option) => (
            <option key={option} value={option}>
              {t(`type_${option}` as MessageKey)}
            </option>
          ))}
      </select>
      {type === "rollup" ? (
        <>
          <select
            aria-label={t("rollupRelation")}
            value={through ?? ""}
            onChange={(event) => {
              setThrough(event.target.value);
              setSource("$title");
            }}
          >
            {relations.map((relation) => (
              <option key={relation.key} value={relation.key}>
                {relation.key}
              </option>
            ))}
          </select>
          <select
            aria-label={t("rollupProperty")}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
            }}
          >
            <option value="$title">{t("builtIn_title")}</option>
            {sources.map((property) => (
              <option key={property} value={property}>
                {property}
              </option>
            ))}
          </select>
          <select
            aria-label={t("rollupFunction")}
            value={calculate}
            onChange={(event) => {
              setCalculate(event.target.value as RollupFunction);
            }}
          >
            {rollupFunctions.map((option) => (
              <option key={option} value={option}>
                {t(`rollup_${option}`)}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {type === "relation" ? (
        <>
          <select
            aria-label={t("relationDatabase")}
            value={target ?? ""}
            onChange={(event) => {
              setTarget(event.target.value as NoteId);
            }}
          >
            {databases.map((database) => (
              <option key={database.id} value={database.id}>
                {database.title}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={twoWay}
              onChange={(event) => {
                setTwoWay(event.target.checked);
              }}
            />
            {t("relationBothWays")}
          </label>
          {twoWay ? (
            <input
              aria-label={t("relationBacklink")}
              value={back}
              onChange={(event) => {
                setBack(event.target.value);
              }}
            />
          ) : null}
        </>
      ) : null}
      <button type="submit" disabled={!free}>
        {t("addProperty")}
      </button>
    </form>
  );
}

interface DatabaseProps {
  readonly vault: Vault;
  readonly media: VaultMedia;
  readonly graph: LinkGraph;
  readonly document: Y.Doc;
  readonly path: string;
  readonly onOpenNote: (id: NoteId) => void;
}

/**
 * The note's database, when its frontmatter has one; nothing otherwise, and
 * then without following the vault's notes, as a database does for its rows.
 */
export function DatabaseView(props: DatabaseProps) {
  const entries = useDocumentProperties(props.document);
  if (!entries.some((entry) => entry.key === databaseKey)) return null;
  return <Database {...props} entries={entries} />;
}

function Database(props: DatabaseProps & { readonly entries: readonly PropertyEntry[] }) {
  const { vault, media, graph, document, path, onOpenNote, entries } = props;
  const version = useGraph(graph);
  const notes = useNotes(vault);
  const [chosen, setChosen] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [panel, setPanel] = useState<"filter" | "properties" | undefined>();

  const read = useMemo(() => {
    try {
      return { schema: databaseOf(entries, resolveLink(graph, path)) };
    } catch (problem) {
      return { problem: problem instanceof Error ? problem.message : String(problem) };
    }
  }, [entries, graph, path, version]);
  const rows = useMemo(() => databaseRows(notes, graph, path), [notes, graph, path, version]);

  // The Obsidian base beside the database, kept in step when its schema
  // or the base itself changes, one sync after another.
  const base = vault.fileInfo(basePath(path));
  const schemaText =
    "schema" in read && read.schema !== undefined ? JSON.stringify(read.schema) : undefined;
  const syncing = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!("schema" in read) || read.schema === undefined) return;
    const current = read.schema;
    const save = (next: DatabaseSchema) => {
      const value = writeDatabase(next, linkToNote(graph));
      setDocumentProperties(
        document,
        entries.map((entry) => (entry.key === databaseKey ? { key: databaseKey, value } : entry)),
      );
    };
    syncing.current = syncing.current
      .then(() => syncBase(vault, path, current, save))
      .catch((problem: unknown) => {
        setError(problem instanceof Error ? problem.message : String(problem));
      });
    // Again when the schema's text or the base's file changes, not on every render.
  }, [schemaText, base?.modified, base?.size, path]);

  if ("problem" in read)
    return <p role="alert">{t("unreadableDatabase", { error: read.problem })}</p>;
  const schema = read.schema;
  if (schema === undefined) return null;
  const view = schema.views.find((item) => item.name === chosen) ?? schema.views[0];

  const saveSchema = (next: DatabaseSchema) => {
    const value = writeDatabase(next, linkToNote(graph));
    setDocumentProperties(
      document,
      entries.map((entry) => (entry.key === databaseKey ? { key: databaseKey, value } : entry)),
    );
  };
  const saveView = (next: View) => {
    saveSchema({
      ...schema,
      views: schema.views.map((item) => (item.id === next.id ? next : item)),
    });
  };
  const self = vault.noteAt(path);
  /** The rows a relation's database has, by name, for its cells to offer. */
  const relatedRows = (property: PropertyDefinition) => {
    const database =
      property.relation === undefined ? undefined : graph.note(property.relation.database);
    return database === undefined ? [] : databaseRows(notes, graph, database.path);
  };
  /** Adds a relation, and its other end to the database it points to when it goes both ways. */
  const addRelation = (key: string, relation: NewRelation, visibleIn: View) => {
    const own: PropertyDefinition = { key, type: "relation", relation };
    const back =
      relation.backlink === undefined || self === undefined
        ? undefined
        : ({
            key: relation.backlink,
            type: "relation",
            relation: { database: self.id, backlink: key },
          } satisfies PropertyDefinition);
    const show = (views: readonly View[]) =>
      views.map((item) =>
        item.id === visibleIn.id ? { ...item, visible: [...item.visible, key] } : item,
      );
    if (relation.database === self?.id) {
      const taken = back !== undefined && schema.properties.some((item) => item.key === back.key);
      saveSchema({
        properties: [...schema.properties, own, ...(back === undefined || taken ? [] : [back])],
        views: show(schema.views),
      });
      return;
    }
    saveSchema({ properties: [...schema.properties, own], views: show(schema.views) });
    const other = graph.note(relation.database);
    if (back === undefined || other === undefined) return;
    const theirs = databaseOf(other.index.properties, resolveLink(graph, other.path));
    if (theirs === undefined || theirs.properties.some((item) => item.key === back.key)) return;
    setNoteProperty(
      vault,
      other.id,
      databaseKey,
      writeDatabase({ ...theirs, properties: [...theirs.properties, back] }, linkToNote(graph)),
    ).catch(fail);
  };
  const write = (row: NoteId, key: string, value: JsonValue) => {
    setError(undefined);
    // A select's new value becomes one of its options.
    const property = schema.properties.find((item) => item.key === key);
    const added = (Array.isArray(value) ? value : [value]).filter(
      (item): item is string =>
        typeof item === "string" &&
        item !== "" &&
        property?.options !== undefined &&
        !property.options.some((option) => option.name === item),
    );
    if (property !== undefined && added.length > 0) {
      saveSchema({
        ...schema,
        properties: schema.properties.map((item) =>
          item.key === key
            ? { ...item, options: [...(item.options ?? []), ...added.map((name) => ({ name }))] }
            : item,
        ),
      });
    }
    const before = rows.find((item) => item.id === row);
    const backlink = property?.relation?.backlink;
    setNoteProperty(vault, row, key, value)
      .then(() =>
        // The other end of a two-way relation, in the rows it now names or no longer does.
        backlink === undefined || before === undefined
          ? undefined
          : syncBacklinks(
              vault,
              graph,
              before,
              before.properties.find((entry) => entry.key === key)?.value,
              value,
              backlink,
            ),
      )
      .catch((problem: unknown) => {
        setError(problem instanceof Error ? problem.message : String(problem));
      });
  };

  const nameOf = (key: string) =>
    key.startsWith("$") ? t(`builtIn_${key.slice(1)}` as MessageKey) : key;
  const header = (key: string) => {
    const sort = view?.sorts?.find((item) => item.property === key);
    const label = nameOf(key);
    return (
      <th key={key} scope="col" aria-sort={sort === undefined ? "none" : sort.direction}>
        <button
          type="button"
          className="quiet"
          title={t("sortBy", { name: label })}
          onClick={() => {
            if (view === undefined) return;
            // Ascending, then descending, then not sorted by it.
            const next =
              sort === undefined
                ? [{ property: key, direction: "ascending" as const }]
                : sort.direction === "ascending"
                  ? [{ property: key, direction: "descending" as const }]
                  : [];
            const rest = without(view, "sorts");
            saveView(next.length === 0 ? rest : { ...rest, sorts: next });
          }}
        >
          {label}
          {sort === undefined ? null : (
            <span aria-hidden="true">{sort.direction === "ascending" ? " ↑" : " ↓"}</span>
          )}
        </button>
      </th>
    );
  };

  const fail = (problem: unknown) => {
    setError(problem instanceof Error ? problem.message : String(problem));
  };
  const typeOf = (key: string | undefined) =>
    schema.properties.find((property) => property.key === key)?.type;
  /** A view in another layout, without what only its old one has, and with a board's columns. */
  const changeLayout = (current: View, layout: View["layout"]) => {
    let next: View = without(without(without(current, "cover"), "date"), "end");
    next = { ...next, layout };
    if (layout === "board" && !boardTypes.includes(typeOf(current.groupBy) ?? "text")) {
      const columns = schema.properties.find((property) => boardTypes.includes(property.type));
      if (columns === undefined) {
        setError(t("boardNeedsColumns"));
        return;
      }
      next = { ...next, groupBy: columns.key };
    }
    if (layout === "calendar" || layout === "timeline") {
      const date =
        current.date ??
        schema.properties.find((property) => property.type === "date")?.key ??
        "$created";
      next = {
        ...next,
        date,
        ...(layout === "timeline" && current.end !== undefined ? { end: current.end } : {}),
      };
    }
    setError(undefined);
    saveView(next);
  };
  /** Makes a row on a calendar's day, with its date. */
  const createOn = (day: string) => {
    const key = view?.date;
    setError(undefined);
    createRow(vault, path, t("untitled"))
      .then((created) =>
        key === undefined || key.startsWith("$")
          ? undefined
          : setNoteProperty(vault, created.id, key, day),
      )
      .catch(fail);
  };
  /** Moves a card to another column: the value it is grouped by becomes the column's. */
  const move = (row: NoteId, from: JsonValue, to: JsonValue) => {
    const key = view?.groupBy;
    if (key === undefined) return;
    const current = rows
      .find((item) => item.id === row)
      ?.properties.find((entry) => entry.key === key)?.value;
    let value: JsonValue = to;
    if (typeOf(key) === "multiSelect") {
      // Out of the column it left, into the one it went to.
      const listed: readonly JsonValue[] = Array.isArray(current)
        ? current
        : current === undefined || current === null
          ? []
          : [current];
      const items = listed.filter((item) => JSON.stringify(item) !== JSON.stringify(from));
      value = to === null ? items : [...items, to];
    }
    write(row, key, value);
  };
  /** Makes a row in a board's column, with its value. */
  const createIn = (value: JsonValue) => {
    const key = view?.groupBy;
    setError(undefined);
    createRow(vault, path, t("untitled"))
      .then((created) =>
        key === undefined || value === null
          ? undefined
          : setNoteProperty(
              vault,
              created.id,
              key,
              typeOf(key) === "multiSelect" ? [value] : value,
            ),
      )
      .catch(fail);
  };
  /** A gallery card's cover: the file or address its cover property names. */
  const coverOf = (row: Row): string | undefined => {
    const key = view?.cover;
    const raw = row.properties.find((entry) => entry.key === key)?.value;
    const values: readonly JsonValue[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    const first = values[0];
    if (typeof first !== "string" || first.trim() === "") return undefined;
    const link =
      first
        .trim()
        .replace(/^!?\[\[|\]\]$/g, "")
        .split("|")[0] ?? "";
    if (/^https?:\/\//i.test(link)) return link;
    const file = vault.resolveFile(link, row.path);
    return file === undefined ? undefined : media.url(file);
  };

  // Each related row as the link index read it, for the rollups to work out from.
  const findRow: FindRow = (link, from) => {
    const id = resolveLink(graph, from.path)(link);
    const note = id === undefined ? undefined : graph.note(id);
    return note === undefined
      ? undefined
      : {
          id: note.id,
          path: note.path,
          updated: vault.note(note.id)?.modified ?? 0,
          properties: note.index.properties,
        };
  };
  const shown = withRollups(rows, schema, findRow);
  const result = view === undefined ? undefined : runView(shown, view, schema);
  const visible = (view?.visible ?? [])
    .map((key) => schema.properties.find((property) => property.key === key))
    .filter((property): property is PropertyDefinition => property !== undefined);
  const rowLines = (list: readonly Row[]) =>
    list.map((row) => {
      const title = rowTitle(row);
      return (
        <tr key={row.id}>
          <th scope="row">
            <button
              type="button"
              className="database-row-title"
              onClick={() => {
                onOpenNote(row.id);
              }}
            >
              {title}
            </button>
          </th>
          {visible.map((property) => (
            <td key={property.key}>
              {property.type === "rollup" ? (
                <span className="database-rollup">
                  {rollupText(row.properties.find((entry) => entry.key === property.key)?.value)}
                </span>
              ) : (
                <Cell
                  label={t("cellLabel", { name: property.key, row: title })}
                  property={property}
                  value={row.properties.find((entry) => entry.key === property.key)?.value}
                  onCommit={(value) => {
                    write(row.id, property.key, value);
                  }}
                  {...(property.type === "relation"
                    ? {
                        related: {
                          names: relatedRows(property).map(rowTitle),
                          // The row of that name, by the shortest link that finds it; else a link to a note not yet written.
                          toValue: (name: string) => {
                            const found = relatedRows(property).find(
                              (item) => rowTitle(item).toLowerCase() === name.toLowerCase(),
                            );
                            return found === undefined
                              ? `[[${name}]]`
                              : shortLink(vault, found.path, row.path);
                          },
                        },
                      }
                    : {})}
                />
              )}
            </td>
          ))}
        </tr>
      );
    });

  return (
    <section className="database" aria-label={t("database")}>
      <div className="database-tabs">
        {/* Only tabs in the list; adding a view is beside it. */}
        <div role="tablist" aria-label={t("databaseViews")}>
          {schema.views.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === view?.id}
              onClick={() => {
                setChosen(item.name);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            const names = schema.views.map((item) => item.name);
            let name = t("newViewName");
            for (let count = 2; names.includes(name); count++)
              name = `${t("newViewName")} ${String(count)}`;
            saveSchema({
              ...schema,
              views: [...schema.views, { id: viewIdOf(name), name, layout: "table", visible: [] }],
            });
            setChosen(name);
          }}
        >
          {t("addView")}
        </button>
      </div>
      {view === undefined || result === undefined ? (
        <p className="placeholder">{t("noViews")}</p>
      ) : (
        <div role="tabpanel" aria-label={view.name}>
          <div className="database-toolbar">
            <label>
              {t("layout")}
              <select
                value={view.layout}
                onChange={(event) => {
                  changeLayout(view, event.target.value as View["layout"]);
                }}
              >
                {(["table", "board", "gallery", "list", "calendar", "timeline"] as const).map(
                  (layout) => (
                    <option key={layout} value={layout}>
                      {t(`layout_${layout}`)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button
              type="button"
              className="quiet"
              aria-expanded={panel === "filter"}
              onClick={() => {
                setPanel(panel === "filter" ? undefined : "filter");
              }}
            >
              {view.filter === undefined
                ? t("filter")
                : t("filterCount", { count: flatFilter(view.filter)?.conditions.length ?? 1 })}
            </button>
            {view.layout === "calendar" || view.layout === "timeline" ? (
              <label>
                {t("dateProperty")}
                <select
                  value={view.date ?? "$created"}
                  onChange={(event) => {
                    saveView({ ...view, date: event.target.value });
                  }}
                >
                  {[
                    ...schema.properties
                      .filter((property) => property.type === "date")
                      .map((property) => property.key),
                    "$created",
                    "$updated",
                  ].map((key) => (
                    <option key={key} value={key}>
                      {key.startsWith("$")
                        ? t(key === "$created" ? "builtIn_created" : "builtIn_updated")
                        : key}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {view.layout === "timeline" ? (
              <label>
                {t("endProperty")}
                <select
                  value={view.end ?? ""}
                  onChange={(event) => {
                    const rest = without(view, "end");
                    saveView(
                      event.target.value === "" ? rest : { ...rest, end: event.target.value },
                    );
                  }}
                >
                  <option value="">{t("endNone")}</option>
                  {schema.properties
                    .filter((property) => property.type === "date")
                    .map((property) => (
                      <option key={property.key} value={property.key}>
                        {property.key}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {view.layout === "calendar" || view.layout === "timeline" ? null : (
              <label>
                {view.layout === "board" ? t("columns") : t("groupBy")}
                <select
                  value={view.groupBy ?? ""}
                  onChange={(event) => {
                    const rest = without(view, "groupBy");
                    saveView(
                      event.target.value === "" ? rest : { ...rest, groupBy: event.target.value },
                    );
                  }}
                >
                  {/* A board always groups, and only by what can make columns. */}
                  {view.layout === "board" ? null : <option value="">{t("groupByNone")}</option>}
                  {schema.properties
                    .filter(
                      (property) => view.layout !== "board" || boardTypes.includes(property.type),
                    )
                    .map((property) => (
                      <option key={property.key} value={property.key}>
                        {property.key}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {view.layout === "gallery" ? (
              <label>
                {t("cover")}
                <select
                  value={view.cover ?? ""}
                  onChange={(event) => {
                    const rest = without(view, "cover");
                    saveView(
                      event.target.value === "" ? rest : { ...rest, cover: event.target.value },
                    );
                  }}
                >
                  <option value="">{t("coverNone")}</option>
                  {schema.properties
                    .filter((property) => property.type === "file")
                    .map((property) => (
                      <option key={property.key} value={property.key}>
                        {property.key}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className="quiet"
              aria-expanded={panel === "properties"}
              onClick={() => {
                setPanel(panel === "properties" ? undefined : "properties");
              }}
            >
              {t("properties")}
            </button>
          </div>
          {panel === "filter" ? (
            <FilterBar
              view={view}
              schema={schema}
              onChange={(filter) => {
                const rest = without(view, "filter");
                saveView(filter === undefined ? rest : { ...rest, filter });
              }}
            />
          ) : null}
          {panel === "properties" ? (
            <div className="database-properties" role="group" aria-label={t("properties")}>
              {schema.properties.map((property) => (
                <label key={property.key}>
                  <input
                    type="checkbox"
                    checked={view.visible.includes(property.key)}
                    onChange={(event) => {
                      saveView({
                        ...view,
                        visible: event.target.checked
                          ? [...view.visible, property.key]
                          : view.visible.filter((key) => key !== property.key),
                      });
                    }}
                  />
                  {property.key}
                </label>
              ))}
              <AddProperty
                taken={schema.properties.map((property) => property.key)}
                databases={databaseNotes(graph).map((note) => ({ id: note.id, title: note.title }))}
                self={self?.title ?? ""}
                relations={schema.properties.flatMap((property) => {
                  if (property.relation === undefined) return [];
                  const other = graph.note(property.relation.database);
                  const theirs =
                    other === undefined
                      ? undefined
                      : databaseOf(other.index.properties, resolveLink(graph, other.path));
                  return [
                    {
                      key: property.key,
                      properties: (theirs?.properties ?? [])
                        .filter((item) => item.rollup === undefined)
                        .map((item) => item.key),
                    },
                  ];
                })}
                onAdd={(key, type, more) => {
                  if (more?.relation !== undefined) {
                    addRelation(key, more.relation, view);
                    return;
                  }
                  if (more?.rollup !== undefined) {
                    saveSchema({
                      properties: [
                        ...schema.properties,
                        { key, type: "rollup", rollup: more.rollup },
                      ],
                      views: schema.views.map((item) =>
                        item.id === view.id ? { ...item, visible: [...item.visible, key] } : item,
                      ),
                    });
                    return;
                  }
                  const property: PropertyDefinition =
                    type === "select" || type === "multiSelect"
                      ? { key, type, options: [] }
                      : { key, type };
                  saveSchema({
                    properties: [...schema.properties, property],
                    views: schema.views.map((item) =>
                      item.id === view.id ? { ...item, visible: [...item.visible, key] } : item,
                    ),
                  });
                }}
              />
            </div>
          ) : null}
          {error === undefined ? null : <p role="alert">{t("cellFailed", { error })}</p>}
          {view.layout === "board" ? (
            <BoardLayout
              {...{
                view,
                rows: result.rows,
                ...(result.groups === undefined ? {} : { groups: result.groups }),
                visible,
                onOpen: onOpenNote,
              }}
              onMove={move}
              onCreate={createIn}
            />
          ) : view.layout === "gallery" ? (
            <GalleryLayout
              {...{
                view,
                rows: result.rows,
                ...(result.groups === undefined ? {} : { groups: result.groups }),
                visible,
                onOpen: onOpenNote,
              }}
              coverOf={coverOf}
            />
          ) : view.layout === "calendar" ? (
            <CalendarLayout
              view={view}
              rows={result.rows}
              visible={visible}
              onOpen={onOpenNote}
              dateKey={view.date ?? "$created"}
              {...(view.date === undefined || view.date.startsWith("$")
                ? {}
                : { onCreate: createOn })}
            />
          ) : view.layout === "timeline" ? (
            <TimelineLayout
              view={view}
              rows={result.rows}
              visible={visible}
              onOpen={onOpenNote}
              dateKey={view.date ?? "$created"}
              {...(view.end === undefined ? {} : { endKey: view.end })}
            />
          ) : view.layout === "list" ? (
            <ListLayout
              {...{
                view,
                rows: result.rows,
                ...(result.groups === undefined ? {} : { groups: result.groups }),
                visible,
                onOpen: onOpenNote,
              }}
            />
          ) : (
            <table className="database-table">
              <caption className="visually-hidden">{view.name}</caption>
              <thead>
                <tr>
                  {header("$title")}
                  {visible.map((property) => header(property.key))}
                </tr>
              </thead>
              {result.groups === undefined ? (
                <tbody>{rowLines(result.rows)}</tbody>
              ) : (
                result.groups.map((group) => {
                  const label = groupLabel(group.value);
                  return (
                    <tbody key={label} aria-label={label}>
                      <tr className="database-group">
                        <th scope="rowgroup" colSpan={visible.length + 1}>
                          {label} <span className="count">{group.rows.length}</span>
                        </th>
                      </tr>
                      {rowLines(group.rows)}
                    </tbody>
                  );
                })
              )}
            </table>
          )}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setError(undefined);
              createRow(vault, path, t("untitled")).catch((problem: unknown) => {
                setError(problem instanceof Error ? problem.message : String(problem));
              });
            }}
          >
            {t("newRow")}
          </button>
        </div>
      )}
    </section>
  );
}
