// A note made from a template: the template's text with its variables
// filled, as Obsidian fills them. `{{title}}` is the new note's name;
// `{{date}}` and `{{time}}` its date and the time it was made, each in the
// vault's format or one given after a colon, as `{{date:dddd, MMMM Do}}`,
// and moved by an amount, as `{{date-1d}}` for the day before. `{{yesterday}}`
// and `{{tomorrow}}` are the days either side. `{{cursor}}` is where the
// cursor goes. Anything else in braces stays as it is.
import { addToDate, formatDate } from "./dateFormat.ts";

export interface TemplateValues {
  /** The new note's name. */
  readonly title: string;
  /** The note's date: today's, or that of the day, week or month a periodic note is for. */
  readonly date: Date;
  /** When the note is made, for `{{time}}`; the note's date when not given. */
  readonly now?: Date;
  /** How `{{date}}` is written without a format of its own; `YYYY-MM-DD` when not given. */
  readonly dateFormat?: string;
  /** How `{{time}}` is written without a format of its own; `HH:mm` when not given. */
  readonly timeFormat?: string;
  /** The language of month and day names. */
  readonly locale?: string;
}

const variablePattern = /\{\{\s*([A-Za-z]+)\s*(?:([+-])\s*(\d+)\s*([dwMy]))?\s*(?::([^}]*))?\}\}/g;

const variables = new Set(["title", "date", "time", "yesterday", "tomorrow", "cursor"]);

/**
 * A template's text with its variables filled. The first `{{cursor}}`
 * becomes `cursor`, so the caller can find where it was; any other is
 * dropped.
 */
export function fillTemplate(template: string, values: TemplateValues, cursor = ""): string {
  const dateFormat = values.dateFormat ?? "YYYY-MM-DD";
  const timeFormat = values.timeFormat ?? "HH:mm";
  const locale = values.locale ?? "en";
  let cursorPlaced = false;
  return template.replace(
    variablePattern,
    (
      match: string,
      name: string,
      sign: string | undefined,
      amount: string | undefined,
      unit: "d" | "w" | "M" | "y" | undefined,
      format: string | undefined,
    ) => {
      const variable = name.toLowerCase();
      if (!variables.has(variable)) return match;
      if (variable === "title")
        return sign === undefined && format === undefined ? values.title : match;
      if (variable === "cursor") {
        if (sign !== undefined || format !== undefined) return match;
        if (cursorPlaced) return "";
        cursorPlaced = true;
        return cursor;
      }
      let date = variable === "time" ? (values.now ?? values.date) : values.date;
      if (variable === "yesterday" || variable === "tomorrow") {
        if (sign !== undefined) return match;
        date = addToDate(date, variable === "yesterday" ? -1 : 1, "d");
      }
      if (sign !== undefined && amount !== undefined && unit !== undefined) {
        date = addToDate(date, Number(amount) * (sign === "-" ? -1 : 1), unit);
      }
      const written = format?.trim();
      return formatDate(
        date,
        written === undefined || written === ""
          ? variable === "time"
            ? timeFormat
            : dateFormat
          : written,
        locale,
      );
    },
  );
}
