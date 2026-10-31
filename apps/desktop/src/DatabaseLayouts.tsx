// A database view's rows as a board, a gallery or a list (ADR 0018); the
// table is the database view's own. A board's columns are the groups of
// the property it groups by, and a card moves between them by dragging or
// by its Move to menu, which changes that property in the row's file.
import {
  type JsonValue,
  type NoteId,
  type PropertyDefinition,
  type PropertyType,
  type View,
  addToDate,
  startOfPeriod,
} from "@nether/core";
import { type Group, type Row, linkName, rowDate, rowTitle } from "@nether/database";
import { type CSSProperties, type DragEvent, type ReactNode, useState } from "react";
import { language, t } from "./messages.ts";

/** The properties a board's columns can come from, as core allows. */
export const boardTypes: readonly PropertyType[] = ["select", "multiSelect", "checkbox", "person"];

/** A value as a card or list shows it. */
export function valueText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items.map((item) => valueText(item)).join(", ");
  }
  if (typeof value === "string") return linkName(value);
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

/** A day as rows write it, `YYYY-MM-DD`, where the user is. */
export function dayKey(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The date a `YYYY-MM-DD` names, at midnight where the user is. */
function dateOf(day: string): Date {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

/** How many days from one day to another, across changes of the clocks. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

const fullDate = new Intl.DateTimeFormat(language, { dateStyle: "full" });
const shortDate = new Intl.DateTimeFormat(language, { day: "numeric", month: "short" });

/** The rows without a date, under the calendar or timeline that cannot place them. */
function Undated(props: { readonly rows: readonly Row[]; readonly onOpen: (row: NoteId) => void }) {
  if (props.rows.length === 0) return null;
  return (
    <section className="database-section" aria-label={t("noDate")}>
      <h3>
        {t("noDate")} <span className="count">{props.rows.length}</span>
      </h3>
      <ul className="database-list">
        {props.rows.map((row) => (
          <li key={row.id}>
            <Title row={row} onOpen={props.onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A month of rows, each on the day of its date, the weeks from Monday as
 * the periodic notes have them. A day's New makes a row on that day.
 */
export function CalendarLayout(
  props: LayoutProps & {
    readonly dateKey: string;
    /** Makes a row on a day; absent when the date is a file's, which a row cannot be given. */
    readonly onCreate?: (day: string) => void;
  },
) {
  const { rows, onOpen, dateKey, onCreate } = props;
  const [month, setMonth] = useState(() => startOfPeriod(new Date(), "month"));
  const byDay = new Map<string, Row[]>();
  const undated: Row[] = [];
  for (const row of rows) {
    const day = rowDate(row, dateKey);
    if (day === undefined) undated.push(row);
    else byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  const first = startOfPeriod(month, "week");
  const weeks: Date[][] = [];
  for (let week = 0; week < 6; week++) {
    const days = Array.from({ length: 7 }, (_, index) => addToDate(first, week * 7 + index, "d"));
    // Only the weeks the month has a day in.
    if (week > 0 && days.every((day) => day.getMonth() !== month.getMonth())) break;
    weeks.push(days);
  }
  const today = dayKey(new Date());
  const title = new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(month);
  const weekday = (style: "short" | "long") =>
    new Intl.DateTimeFormat(language, { weekday: style });
  return (
    <div className="database-calendar">
      <div className="database-period">
        <button
          type="button"
          className="quiet"
          aria-label={t("previousMonth")}
          onClick={() => {
            setMonth(addToDate(month, -1, "M"));
          }}
        >
          ‹
        </button>
        <h3 aria-live="polite">{title}</h3>
        <button
          type="button"
          className="quiet"
          aria-label={t("nextMonth")}
          onClick={() => {
            setMonth(addToDate(month, 1, "M"));
          }}
        >
          ›
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setMonth(startOfPeriod(new Date(), "month"));
          }}
        >
          {t("today")}
        </button>
      </div>
      <table className="database-month">
        <caption className="visually-hidden">{title}</caption>
        <thead>
          <tr>
            {(weeks[0] ?? []).map((day) => (
              <th key={day.getDay()} scope="col" abbr={weekday("long").format(day)}>
                {weekday("short").format(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={dayKey(week[0] ?? first)}>
              {week.map((day) => {
                const key = dayKey(day);
                const placed = byDay.get(key) ?? [];
                return (
                  <td
                    key={key}
                    data-outside={day.getMonth() === month.getMonth() ? undefined : ""}
                    data-today={key === today ? "" : undefined}
                  >
                    <span className="database-day" aria-hidden="true">
                      {day.getDate()}
                    </span>
                    <span className="visually-hidden">{fullDate.format(day)}</span>
                    {placed.length === 0 ? null : (
                      <ul>
                        {placed.map((row) => (
                          <li key={row.id}>
                            <Title row={row} onOpen={onOpen} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {onCreate === undefined ? null : (
                      <button
                        type="button"
                        className="quiet database-day-add"
                        aria-label={t("newOnDay", { date: fullDate.format(day) })}
                        onClick={() => {
                          onCreate(key);
                        }}
                      >
                        +
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Undated rows={undated} onOpen={onOpen} />
    </div>
  );
}

/** How many days a timeline shows, and how far Earlier and Later move it. */
const span = 42;
const step = 28;

/**
 * Rows as bars from their date to their end, on six weeks of days that
 * Earlier and Later move; a row without an end is a day long.
 */
export function TimelineLayout(
  props: LayoutProps & { readonly dateKey: string; readonly endKey?: string },
) {
  const { rows, onOpen, dateKey, endKey } = props;
  const [start, setStart] = useState(() => addToDate(startOfPeriod(new Date(), "week"), -7, "d"));
  const end = addToDate(start, span - 1, "d");
  const undated: Row[] = [];
  let outside = 0;
  const bars: { row: Row; from: number; to: number; label: string }[] = [];
  for (const row of rows) {
    const first = rowDate(row, dateKey);
    if (first === undefined) {
      undated.push(row);
      continue;
    }
    const lastDay = endKey === undefined ? undefined : rowDate(row, endKey);
    const last = lastDay !== undefined && lastDay > first ? lastDay : first;
    const from = daysBetween(start, dateOf(first));
    const to = daysBetween(start, dateOf(last));
    if (to < 0 || from >= span) {
      outside++;
      continue;
    }
    const label =
      first === last
        ? fullDate.format(dateOf(first))
        : t("fromTo", { from: fullDate.format(dateOf(first)), to: fullDate.format(dateOf(last)) });
    bars.push({ row, from: Math.max(0, from), to: Math.min(span - 1, to), label });
  }
  const today = daysBetween(start, startOfPeriod(new Date(), "day"));
  const weekStarts = Array.from({ length: span / 7 }, (_, week) => addToDate(start, week * 7, "d"));
  const range = t("fromTo", { from: shortDate.format(start), to: shortDate.format(end) });
  return (
    <div className="database-timeline">
      <div className="database-period">
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setStart(addToDate(start, -step, "d"));
          }}
        >
          {t("earlier")}
        </button>
        <h3 aria-live="polite">{range}</h3>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setStart(addToDate(start, step, "d"));
          }}
        >
          {t("later")}
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setStart(addToDate(startOfPeriod(new Date(), "week"), -7, "d"));
          }}
        >
          {t("today")}
        </button>
      </div>
      <div className="database-timeline-grid" style={{ "--days": span } as CSSProperties}>
        <div className="database-timeline-weeks" aria-hidden="true">
          {weekStarts.map((week, index) => (
            <span key={dayKey(week)} style={{ gridColumn: `${String(index * 7 + 2)} / span 7` }}>
              {shortDate.format(week)}
            </span>
          ))}
          {today >= 0 && today < span ? (
            <span className="database-timeline-today" style={{ gridColumn: String(today + 2) }} />
          ) : null}
        </div>
        <ul className="database-timeline-rows">
          {bars.map(({ row, from, to, label }) => (
            <li key={row.id}>
              <Title row={row} onOpen={onOpen} />
              <span
                className="database-bar"
                style={{ gridColumn: `${String(from + 2)} / ${String(to + 3)}` }}
              >
                <span className="visually-hidden">{label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {outside === 0 ? null : (
        <p className="placeholder">{t("outsideTimeline", { count: outside })}</p>
      )}
      <Undated rows={undated} onOpen={onOpen} />
    </div>
  );
}
