// Dates as properties hold them, and timestamps as notes record them.

const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))?)?$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function inRange(text: string | undefined, min: number, max: number): boolean {
  if (text === undefined) return true;
  const number = Number(text);
  return number >= min && number <= max;
}

/**
 * Whether a string is a date as a date property holds it: `2026-11-06`, or
 * a date and time such as `2026-11-06T09:30`, with optional seconds and an
 * optional `Z` or UTC offset.
 */
export function isDate(value: string): boolean {
  const match = dateTimePattern.exec(value);
  if (match === null) return false;
  const [, year, month, day, hour, minute, second, , offsetHours, offsetMinutes] = match;
  const monthNumber = Number(month);
  return (
    monthNumber >= 1 &&
    monthNumber <= 12 &&
    inRange(day, 1, daysInMonth(Number(year), monthNumber)) &&
    inRange(hour, 0, 23) &&
    inRange(minute, 0, 59) &&
    inRange(second, 0, 59) &&
    inRange(offsetHours, 0, 23) &&
    inRange(offsetMinutes, 0, 59)
  );
}

/** Whether a string is an instant in UTC, as `Date.prototype.toISOString` writes it. */
export function isTimestamp(value: string): boolean {
  return timestampPattern.test(value) && isDate(value);
}

/** The current time as a timestamp. */
export function now(): string {
  return new Date().toISOString();
}
