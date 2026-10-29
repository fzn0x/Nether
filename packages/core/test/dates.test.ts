import { describe, expect, it } from "vitest";
import { isDate, isTimestamp, now } from "../src/index.ts";

describe("isDate", () => {
  it.each([
    "2026-11-06",
    "2024-02-29",
    "2000-02-29",
    "2026-11-06T09:30",
    "2026-11-06T09:30:15",
    "2026-11-06T09:30:15.123Z",
    "2026-11-06T23:59:59.123456789+07:00",
    "2026-11-06T00:00-05:30",
  ])("accepts %s", (value) => {
    expect(isDate(value)).toBe(true);
  });

  it.each([
    "2026-02-29",
    "1900-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-11-00",
    "2026-11-06T24:00",
    "2026-11-06T09:60",
    "2026-11-06T09:30:60",
    "2026-11-06T09:30+24:00",
    "2026-11-06T09:30+07:60",
    "2026-11-06 09:30",
    "26-11-06",
    "2026-11-6",
    "",
  ])("rejects %s", (value) => {
    expect(isDate(value)).toBe(false);
  });
});

describe("isTimestamp", () => {
  it("accepts UTC instants as toISOString writes them", () => {
    expect(isTimestamp("2026-10-30T08:00:00.000Z")).toBe(true);
    expect(isTimestamp("2026-10-30T08:00:00Z")).toBe(true);
    expect(isTimestamp(now())).toBe(true);
  });

  it("rejects other forms", () => {
    expect(isTimestamp("2026-10-30T08:00Z")).toBe(false);
    expect(isTimestamp("2026-10-30T08:00:00+00:00")).toBe(false);
    expect(isTimestamp("2026-10-30")).toBe(false);
    expect(isTimestamp("2026-02-30T08:00:00Z")).toBe(false);
  });
});
