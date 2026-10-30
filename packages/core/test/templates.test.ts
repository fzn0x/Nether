import { describe, expect, it } from "vitest";
import { fillTemplate } from "../src/index.ts";

// Dates here are local, as the user's clock reads them.
const friday = new Date(2026, 10, 6, 9, 5, 7, 42);

describe("fillTemplate", () => {
  const values = { title: "Weekly review", date: friday, now: new Date(2026, 10, 7, 14, 30) };

  it("fills the title, date and time", () => {
    expect(fillTemplate("# {{title}}\nMade {{date}} at {{time}}", values)).toBe(
      "# Weekly review\nMade 2026-11-06 at 14:30",
    );
    expect(fillTemplate("{{ Title }} {{DATE}}", values)).toBe("Weekly review 2026-11-06");
  });

  it("writes dates and times in a format given after a colon, or the vault's", () => {
    expect(fillTemplate("{{date:dddd, MMMM Do}} {{time:h A}}", values)).toBe(
      "Friday, November 6th 2 PM",
    );
    expect(
      fillTemplate("{{date}} {{time}} {{date: }}", {
        ...values,
        dateFormat: "DD/MM/YYYY",
        timeFormat: "HH:mm:ss",
      }),
    ).toBe("06/11/2026 14:30:00 06/11/2026");
  });

  it("moves dates by an amount, and knows yesterday and tomorrow", () => {
    expect(fillTemplate("[[{{date-1d}}]] [[{{date+1w:YYYY-[W]WW}}]] {{date+1M}}", values)).toBe(
      "[[2026-11-05]] [[2026-W46]] 2026-12-06",
    );
    expect(fillTemplate("{{yesterday}} {{tomorrow:ddd}}", values)).toBe("2026-11-05 Sat");
  });

  it("puts the cursor marker where the first {{cursor}} was, and drops the rest", () => {
    expect(fillTemplate("a {{cursor}} b {{cursor}}", values, "|")).toBe("a | b ");
    expect(fillTemplate("a {{cursor}}", values)).toBe("a ");
  });

  it("leaves what is not a variable as it is", () => {
    const kept =
      "{{name}} {{ date }x {{title:upper}} {{title+1d}} {{cursor:x}} {{yesterday+1d}} {{date+1m}}";
    expect(fillTemplate(kept, values)).toBe(kept);
  });

  it("takes the note's date for the time when no time is given", () => {
    expect(fillTemplate("{{time}}", { title: "", date: friday })).toBe("09:05");
  });
});
