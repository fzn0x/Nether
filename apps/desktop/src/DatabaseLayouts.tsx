// A database view's rows as a board, a gallery or a list (ADR 0018); the
// table is the database view's own. A board's columns are the groups of
// the property it groups by, and a card moves between them by dragging or
// by its Move to menu, which changes that property in the row's file.
import type { JsonValue, NoteId, PropertyDefinition, PropertyType, View } from "@nether/core";
import { type Group, type Row, rowTitle } from "@nether/database";
import { type DragEvent, type ReactNode, useState } from "react";
import { t } from "./messages.ts";

/** The properties a board's columns can come from, as core allows. */
export const boardTypes: readonly PropertyType[] = ["select", "multiSelect", "checkbox", "person"];

/** A value as a card or list shows it. */
export function valueText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items.map((item) => valueText(item)).join(", ");
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** What a group is called: its value, a checkbox's state, or that it has none. */
export function groupLabel(value: JsonValue): string {
  if (value === null) return t("noValue");
  if (typeof value === "boolean") return t(value ? "checked" : "unchecked");
  return valueText(value);
}

export interface LayoutProps {
  readonly view: View;
  readonly rows: readonly Row[];
  readonly groups?: readonly Group[];
  readonly visible: readonly PropertyDefinition[];
  readonly onOpen: (row: NoteId) => void;
}

/** The values of a row's visible properties, those it has, under its name. */
function Details(props: { readonly row: Row; readonly visible: readonly PropertyDefinition[] }) {
  const shown = props.visible
    .map((property) => ({
      key: property.key,
      text: valueText(props.row.properties.find((entry) => entry.key === property.key)?.value),
    }))
    .filter((item) => item.text !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="database-details">
      {shown.map((item) => (
        <div key={item.key}>
          <dt>{item.key}</dt>
          <dd>{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Title(props: { readonly row: Row; readonly onOpen: (row: NoteId) => void }) {
  return (
    <button
      type="button"
      className="database-row-title"
      onClick={() => {
        props.onOpen(props.row.id);
      }}
    >
      {rowTitle(props.row)}
    </button>
  );
}

/** Rows in sections, one for each group when the view groups. */
function Sections(props: {
  readonly rows: readonly Row[];
  readonly groups?: readonly Group[];
  readonly render: (rows: readonly Row[]) => ReactNode;
}) {
  const { rows, groups, render } = props;
  if (groups === undefined) return render(rows);
  return groups.map((group) => {
    const label = groupLabel(group.value);
    return (
      <section key={label} className="database-section" aria-label={label}>
        <h3>
          {label} <span className="count">{group.rows.length}</span>
        </h3>
        {render(group.rows)}
      </section>
    );
  });
}

export function ListLayout(props: LayoutProps) {
  const { rows, groups, visible, onOpen } = props;
  return (
    <Sections
      rows={rows}
      {...(groups === undefined ? {} : { groups })}
      render={(list) => (
        <ul className="database-list">
          {list.map((row) => (
            <li key={row.id}>
              <Title row={row} onOpen={onOpen} />
              <Details row={row} visible={visible} />
            </li>
          ))}
        </ul>
      )}
    />
  );
}

export function GalleryLayout(
  props: LayoutProps & { readonly coverOf: (row: Row) => string | undefined },
) {
  const { rows, groups, visible, onOpen, coverOf } = props;
  return (
    <Sections
      rows={rows}
      {...(groups === undefined ? {} : { groups })}
      render={(list) => (
        <ul className="database-gallery">
          {list.map((row) => {
            const cover = coverOf(row);
            return (
              <li key={row.id}>
                {cover === undefined ? (
                  <div className="database-cover" aria-hidden="true" />
                ) : (
                  // The card's name says what it is; the cover only shows it.
                  <img className="database-cover" src={cover} alt="" />
                )}
                <Title row={row} onOpen={onOpen} />
                <Details row={row} visible={visible} />
              </li>
            );
          })}
        </ul>
      )}
    />
  );
}

export function BoardLayout(
  props: LayoutProps & {
    /** Moves a row from one column to another, by the values of their groups. */
    readonly onMove: (row: NoteId, from: JsonValue, to: JsonValue) => void;
    /** Makes a row in a column. */
    readonly onCreate: (value: JsonValue) => void;
  },
) {
  const { groups = [], visible, onOpen, onMove, onCreate } = props;
  const [over, setOver] = useState<string | undefined>();
  const keyOf = (value: JsonValue) => JSON.stringify(value);
  const drop = (to: JsonValue) => (event: DragEvent) => {
    event.preventDefault();
    setOver(undefined);
    const data = event.dataTransfer.getData("application/x-nether-card");
    if (data === "") return;
    const { row, from } = JSON.parse(data) as { row: NoteId; from: JsonValue };
    if (keyOf(from) !== keyOf(to)) onMove(row, from, to);
  };
  return (
    <div className="database-board">
      {groups.map((group) => {
        const label = groupLabel(group.value);
        const key = keyOf(group.value);
        return (
          <section
            key={key}
            className="database-column"
            aria-label={label}
            data-over={over === key ? "" : undefined}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(key);
            }}
            onDragLeave={() => {
              setOver(undefined);
            }}
            onDrop={drop(group.value)}
          >
            <h3>
              {label} <span className="count">{group.rows.length}</span>
            </h3>
            <ul>
              {group.rows.map((row) => {
                const title = rowTitle(row);
                return (
                  <li
                    key={row.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/x-nether-card",
                        JSON.stringify({ row: row.id, from: group.value }),
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <Title row={row} onOpen={onOpen} />
                    <Details row={row} visible={visible} />
                    {/* The keyboard's way to do what dragging does. */}
                    <select
                      aria-label={t("moveTo", { name: title })}
                      value={key}
                      onChange={(event) => {
                        const target = groups.find(
                          (item) => keyOf(item.value) === event.target.value,
                        );
                        if (target !== undefined) onMove(row.id, group.value, target.value);
                      }}
                    >
                      {groups.map((item) => (
                        <option key={keyOf(item.value)} value={keyOf(item.value)}>
                          {groupLabel(item.value)}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                onCreate(group.value);
              }}
            >
              {t("newRowIn", { name: label })}
            </button>
          </section>
        );
      })}
    </div>
  );
}
