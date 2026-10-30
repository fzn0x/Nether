// Dates written out by a format of moment.js tokens, as Obsidian's templates
// and daily notes write them, so a vault's formats work as they do there.
// Text in [brackets] is written as it is, and so is any letter that is not
// a token. Weeks are counted two ways, as moment counts them: `W` and `GGGG`
// by ISO 8601, from Monday, and `w` and `gggg` from Sunday, the week with
// January 1 first.

/** A span a periodic note is for. */
export type Period = "day" | "week" | "month";

const tokenPattern =
  /\[([^\]]*)\]|YYYY|YY|Q|MMMM|MMM|MM|M|Do|DDDD|DDD|DD|D|dddd|ddd|dd|d|E|e|GGGG|GG|WW|W|gggg|gg|ww|w|HH|H|hh|h|mm|m|ss|s|SSS|A|a|X|x|ZZ|Z/g;

const dayLength = 86_400_000;

/** The day's number since 1970, by its date where the user is, so clock changes do not shift it. */
function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) / dayLength;
}

function yearOfDay(number: number): number {
  return new Date(number * dayLength).getUTCFullYear();
}

/** The week a date is in, and the year that week counts in. */
function weekOf(date: Date, iso: boolean): { readonly year: number; readonly week: number } {
  const today = dayNumber(date.getFullYear(), date.getMonth(), date.getDate());
  // ISO weeks belong to the year of their Thursday; the others to that of their Saturday.
  const anchor = iso ? today - ((date.getDay() + 6) % 7) + 3 : today - date.getDay() + 6;
  const year = yearOfDay(anchor);
  return { year, week: Math.floor((anchor - dayNumber(year, 0, 1)) / 7) + 1 };
}

function pad(number: number, width = 2): string {
  const text = String(Math.abs(number)).padStart(width, "0");
  return number < 0 ? `-${text}` : text;
}

function ordinal(number: number): string {
  const tens = number % 100;
  if (tens >= 11 && tens <= 13) return `${String(number)}th`;
  const suffix = ["th", "st", "nd", "rd"][number % 10] ?? "th";
  return `${String(number)}${suffix}`;
}

function offset(date: Date, separator: string): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}${separator}${pad(Math.abs(minutes) % 60)}`;
}

function name(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function token(date: Date, value: string, locale: string): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const hours = date.getHours();
  switch (value) {
    case "YYYY":
      return pad(year, 4);
    case "YY":
      return pad(year % 100);
    case "Q":
      return String(Math.floor(month / 3) + 1);
    case "MMMM":
      return name(date, locale, { month: "long" });
    case "MMM":
      return name(date, locale, { month: "short" });
    case "MM":
      return pad(month + 1);
    case "M":
      return String(month + 1);
    case "Do":
      return ordinal(day);
    case "DDDD":
    case "DDD": {
      const number = dayNumber(year, month, day) - dayNumber(year, 0, 1) + 1;
      return value === "DDDD" ? pad(number, 3) : String(number);
    }
    case "DD":
      return pad(day);
    case "D":
      return String(day);
    case "dddd":
      return name(date, locale, { weekday: "long" });
    case "ddd":
      return name(date, locale, { weekday: "short" });
    case "dd":
      return name(date, locale, { weekday: "short" }).slice(0, 2);
    case "d":
    case "e":
      return String(date.getDay());
    case "E":
      return String(((date.getDay() + 6) % 7) + 1);
    case "GGGG":
    case "GG":
    case "gggg":
    case "gg": {
      const { year: weekYear } = weekOf(date, value.startsWith("G"));
      return value.length === 4 ? pad(weekYear, 4) : pad(weekYear % 100);
    }
    case "WW":
    case "W":
    case "ww":
    case "w": {
      const { week } = weekOf(date, value.startsWith("W"));
      return value.length === 2 ? pad(week) : String(week);
    }
    case "HH":
      return pad(hours);
    case "H":
      return String(hours);
    case "hh":
      return pad(hours % 12 === 0 ? 12 : hours % 12);
    case "h":
      return String(hours % 12 === 0 ? 12 : hours % 12);
    case "mm":
      return pad(date.getMinutes());
    case "m":
      return String(date.getMinutes());
    case "ss":
      return pad(date.getSeconds());
    case "s":
      return String(date.getSeconds());
    case "SSS":
      return pad(date.getMilliseconds(), 3);
    case "A":
      return hours < 12 ? "AM" : "PM";
    case "a":
      return hours < 12 ? "am" : "pm";
    case "X":
      return String(Math.floor(date.getTime() / 1000));
    case "x":
      return String(date.getTime());
    case "ZZ":
      return offset(date, "");
    default:
      return offset(date, ":");
  }
}

/**
 * A date written by a moment.js format, such as `YYYY-MM-DD` or
 * `dddd, MMMM Do`, in the time zone where the user is. Names of months and
 * days are in `locale`.
 */
export function formatDate(date: Date, format: string, locale = "en"): string {
  return format.replace(
    tokenPattern,
    (match: string, literal: string | undefined) => literal ?? token(date, match, locale),
  );
}

/** The start of the day, ISO week or month a date is in, at midnight where the user is. */
export function startOfPeriod(date: Date, period: Period): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  switch (period) {
    case "day":
      return new Date(year, month, date.getDate());
    case "week":
      return new Date(year, month, date.getDate() - ((date.getDay() + 6) % 7));
    case "month":
      return new Date(year, month, 1);
  }
}

/** A date moved by whole days, weeks, months or years, its time of day kept. */
export function addToDate(date: Date, amount: number, unit: "d" | "w" | "M" | "y"): Date {
  const next = new Date(date.getTime());
  switch (unit) {
    case "d":
      next.setDate(next.getDate() + amount);
      break;
    case "w":
      next.setDate(next.getDate() + amount * 7);
      break;
    case "M": {
      // The last day of a shorter month, not the first of the next: Jan 31 and a month is Feb 28.
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + amount);
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, last));
      break;
    }
    case "y": {
      const day = next.getDate();
      next.setDate(1);
      next.setFullYear(next.getFullYear() + amount);
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, last));
      break;
    }
  }
  return next;
}
