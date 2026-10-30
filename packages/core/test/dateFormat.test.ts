import { describe, expect, it } from "vitest";
import { addToDate, formatDate, startOfPeriod } from "../src/index.ts";

// Dates here are local, as the user's clock reads them.
const friday = new Date(2026, 10, 6, 9, 5, 7, 42);

describe("formatDate", () => {
  it("writes each moment.js token", () => {
    expect(formatDate(friday, "YYYY YY Q M MM MMM MMMM")).toBe("2026 26 4 11 11 Nov November");
    expect(formatDate(friday, "D DD Do DDD DDDD d e E dd ddd dddd")).toBe(
      "6 06 6th 310 310 5 5 5 Fr Fri Friday",
    );
    expect(formatDate(friday, "H HH h hh m mm s ss SSS A a")).toBe("9 09 9 09 5 05 7 07 042 AM am");
    expect(formatDate(new Date(2026, 0, 1, 0, 30), "h:mm a, H")).toBe("12:30 am, 0");
    expect(formatDate(new Date(2026, 0, 1, 15), "hh A")).toBe("03 PM");
    expect(formatDate(friday, "X x")).toBe(
      `${String(Math.floor(friday.getTime() / 1000))} ${String(friday.getTime())}`,
    );
  });

  it("writes the time zone's offset", () => {
    const minutes = -friday.getTimezoneOffset();
    const sign = minutes < 0 ? "-" : "+";
    const hours = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0");
    const rest = String(Math.abs(minutes) % 60).padStart(2, "0");
    expect(formatDate(friday, "Z ZZ")).toBe(`${sign}${hours}:${rest} ${sign}${hours}${rest}`);
  });

  it("keeps text in brackets, and letters that are not tokens", () => {
    expect(formatDate(friday, "[Week] W, [YYYY] YYYY")).toBe("Week 45, YYYY 2026");
    expect(formatDate(friday, "YYYY/MM/[notes]-DD")).toBe("2026/11/notes-06");
    expect(formatDate(friday, "")).toBe("");
  });

  it("writes ordinals as English does", () => {
    const days = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31];
    expect(days.map((day) => formatDate(new Date(2026, 0, day), "Do"))).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "31st",
    ]);
  });

  it("counts ISO weeks from Monday, in the year of their Thursday", () => {
    const iso = (year: number, month: number, day: number) =>
      formatDate(new Date(year, month, day), "GGGG-[W]WW GG W");
    expect(iso(2026, 0, 1)).toBe("2026-W01 26 1");
    expect(iso(2025, 11, 29)).toBe("2026-W01 26 1");
    expect(iso(2025, 11, 28)).toBe("2025-W52 25 52");
    expect(iso(2027, 0, 1)).toBe("2026-W53 26 53");
    expect(iso(2027, 0, 4)).toBe("2027-W01 27 1");
    expect(iso(2026, 10, 6)).toBe("2026-W45 26 45");
  });

  it("counts locale weeks from Sunday, the week with January 1 first", () => {
    const locale = (year: number, month: number, day: number) =>
      formatDate(new Date(year, month, day), "gggg-[W]ww gg w");
    expect(locale(2026, 0, 1)).toBe("2026-W01 26 1");
    expect(locale(2025, 11, 28)).toBe("2026-W01 26 1");
    expect(locale(2025, 11, 27)).toBe("2025-W52 25 52");
    expect(locale(2022, 0, 1)).toBe("2022-W01 22 1");
    expect(locale(2022, 0, 2)).toBe("2022-W02 22 2");
  });

  it("names months and days in the language asked for", () => {
    expect(formatDate(friday, "dddd D MMMM", "fr")).toBe("vendredi 6 novembre");
  });
});

describe("startOfPeriod", () => {
  it("finds the start of a day, ISO week and month", () => {
    expect(startOfPeriod(friday, "day")).toEqual(new Date(2026, 10, 6));
    expect(startOfPeriod(friday, "week")).toEqual(new Date(2026, 10, 2));
    expect(startOfPeriod(new Date(2026, 10, 8, 23), "week")).toEqual(new Date(2026, 10, 2));
    expect(startOfPeriod(new Date(2026, 10, 9), "week")).toEqual(new Date(2026, 10, 9));
    expect(startOfPeriod(friday, "month")).toEqual(new Date(2026, 10, 1));
  });
});

describe("addToDate", () => {
  it("moves a date by days, weeks, months and years", () => {
    expect(addToDate(friday, -1, "d")).toEqual(new Date(2026, 10, 5, 9, 5, 7, 42));
    expect(addToDate(friday, 2, "w")).toEqual(new Date(2026, 10, 20, 9, 5, 7, 42));
    expect(addToDate(friday, 3, "M")).toEqual(new Date(2027, 1, 6, 9, 5, 7, 42));
    expect(addToDate(friday, -1, "y")).toEqual(new Date(2025, 10, 6, 9, 5, 7, 42));
  });

  it("stops at the last day of a shorter month", () => {
    expect(addToDate(new Date(2026, 0, 31), 1, "M")).toEqual(new Date(2026, 1, 28));
    expect(addToDate(new Date(2028, 1, 29), 1, "y")).toEqual(new Date(2029, 1, 28));
  });
});
