// Formulas: read by their own parser, worked out by their own interpreter.
import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  type FormulaContext,
  FormulaError,
  type FormulaValue,
  type Row,
  evaluateFormula,
  formulaJson,
  parseFormula,
  readDatabase,
  withFormulas,
} from "../src/index.ts";

const now = new Date(2026, 10, 12, 15, 30);
const values: Record<string, FormulaValue> = {
  price: 12,
  pages: 4,
  name: "Launch",
  "Big points": 7,
  tags: ["web", "launch"],
  client: "[[Clients/Acme|Acme Inc]]",
  due: new Date(2026, 10, 15),
  empty: null,
};
const context: FormulaContext = {
  property: (key) => values[key] ?? null,
  file: {
    name: "Launch",
    path: "Projects/Launch.md",
    mtime: new Date(2026, 10, 1),
    ctime: new Date(2026, 9, 1),
  },
  now,
};
const run = (text: string) => evaluateFormula(parseFormula(text), context);
const fails = (text: string) => {
  try {
    run(text);
  } catch (error) {
    if (error instanceof FormulaError) return error.message;
    throw error;
  }
  return "no error";
};

describe("parseFormula", () => {
  it("says what it cannot read, and where", () => {
    const at = (text: string) => {
      try {
        parseFormula(text);
      } catch (error) {
        if (error instanceof FormulaError) return [error.message, error.at];
        throw error;
      }
      return undefined;
    };
    expect(at('"open')).toEqual(["A text is not closed", 0]);
    expect(at("1 # 2")).toEqual(['"#" cannot be read', 2]);
    expect(at("1 +")).toEqual(["The formula ends too soon", 3]);
    expect(at("1 2")).toEqual(["The formula goes on after its value ends", 2]);
    expect(at("round(1, 2")).toEqual(['")" is missing', 10]);
    expect(at("a.")).toEqual(['A name must follow "."', 2]);
    expect(at(")")).toEqual(['")" cannot start a value', 0]);
    expect(at("[1, 2")).toEqual(['"]" is missing', 5]);
    expect(at(`${"(".repeat(70)}1${")".repeat(70)}`)?.[0]).toBe(
      "The formula nests deeper than 64 levels",
    );
  });
});

describe("evaluateFormula", () => {
  it("works out numbers in the usual order", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("price / pages - 1")).toBe(2);
    expect(run("7 % 4")).toBe(3);
    expect(run("-price + 2.5")).toBe(-9.5);
    expect(run("empty + 1")).toBeNull();
    expect(run("empty * 2")).toBeNull();
    expect(fails("price / 0")).toBe("The formula divides by zero");
    expect(fails("price * name")).toBe("* needs a number, not text");
  });

  it("joins and reads text, a link by the name of its note", () => {
    expect(run('name + " " + price')).toBe("Launch 12");
    expect(run('"Client: " + client')).toBe("Client: Acme");
    expect(run('"x" + empty')).toBe("x");
    expect(run("name.lower() + name.upper()")).toBe("launchLAUNCH");
    expect(run('"  a  ".trim()')).toBe("a");
    expect(run('name.contains("UNCH")')).toBe(true);
    expect(run('name.startsWith("la") && name.endsWith("CH")')).toBe(true);
    expect(run("name.slice(1, 3)")).toBe("au");
    expect(run("name.slice(2)")).toBe("unch");
    expect(run('name.replace("a", "o")')).toBe("Lounch");
    expect(run('"a,b,c".split(",")')).toEqual(["a", "b", "c"]);
    expect(run("name.length")).toBe(6);
    expect(run("empty.lower()")).toBeNull();
    expect(fails("name.year")).toBe('text has no "year"');
    expect(fails("price.lower()")).toBe("a number has no lower()");
  });

  it("decides with logic, comparisons and if, working out only the branch it takes", () => {
    expect(run("price > 10 && pages < 5")).toBe(true);
    expect(run("price < 10 || !empty")).toBe(true);
    expect(run('client == "Acme"')).toBe(true);
    expect(run('name != "Launch"')).toBe(false);
    expect(run('due >= date("2026-11-15")')).toBe(true);
    expect(run('"b" > "a" && true > false')).toBe(true);
    expect(run('price > "x"')).toBe(false);
    expect(run('if(price > 10, "big", "small")')).toBe("big");
    expect(run("if(false, 1)")).toBeNull();
    expect(run("if(true, 1, price / 0)")).toBe(1);
    expect(run('if("", 1, 2) + if([], 1, 2) + if(0, 1, 2)')).toBe(6);
    expect(fails("if(true)")).toBe("if() takes a condition, a value, and maybe another");
  });

  it("has functions for numbers, text and dates", () => {
    expect(run("min(3, price, [1, 9])")).toBe(1);
    expect(run("max(tags.length, pages, empty)")).toBe(4);
    expect(run("min(empty)")).toBeNull();
    expect(run("abs(-2) + floor(2.7) + ceil(2.1)")).toBe(7);
    expect(run("round(2.345, 2)")).toBe(2.35);
    expect(run("round(2.5)")).toBe(3);
    expect(run('number("3.5") + number(true)')).toBe(4.5);
    expect(run('number("x")')).toBeNull();
    expect(run("text(price) + text(tags)")).toBe("12web, launch");
    expect(run("today()")).toEqual(new Date(2026, 10, 12));
    expect(run("now()")).toEqual(now);
    expect(fails('date("soon")')).toBe('"soon" is not a date, as "2026-11-15" is');
    expect(fails('date("2026-02-30")')).toBe('"2026-02-30" is not a date, as "2026-11-15" is');
    expect(fails("abs(1, 2)")).toBe("abs() takes one value");
    expect(fails("sum(1)")).toBe("There is no function sum()");
  });

  it("moves dates by durations, and tells the days between them", () => {
    expect(run('due + "1 week"')).toEqual(new Date(2026, 10, 22));
    expect(run('due - "2 days"')).toEqual(new Date(2026, 10, 13));
    expect(run('due + "1 month"')).toEqual(new Date(2026, 11, 15));
    expect(run('due + "3 hours"')).toEqual(new Date(2026, 10, 15, 3));
    expect(run("due - today()")).toBe(3);
    expect(run('date("2026-11-15 09:30") - due')).toBeCloseTo(0.396, 3);
    expect(run('due.format("dddd, MMMM Do")')).toBe("Sunday, November 15th");
    expect(run("due.format()")).toBe("2026-11-15");
    expect(run("due.year * 10000 + due.month * 100 + due.day")).toBe(20261115);
    expect(fails('due + "soon"')).toBe('"soon" is not a duration, as "3 days" is');
  });

  it("reads the row's values by name, as a note's or a formula's, and its file's", () => {
    expect(run('note["Big points"] + note.price + formula.pages')).toBe(23);
    expect(run('file.name + " " + file.path')).toBe("Launch Projects/Launch.md");
    expect(run("file.mtime < file.ctime")).toBe(false);
    expect(run("file.basename")).toBe("Launch");
    expect(run("unknown")).toBeNull();
    expect(fails("note")).toBe('"note" needs a name after it, as note.name');
    expect(fails("file.size")).toBe('file has no "size"');
    expect(fails("price()")).toBe("There is no function price()");
  });

  it("holds lists, indexed from the start or the end", () => {
    expect(run("[1, 2] + [3]")).toEqual([1, 2, 3]);
    expect(run("tags[0] + tags[-1]")).toBe("weblaunch");
    expect(run("tags[5]")).toBeNull();
    expect(run('tags.contains("web") && !tags.contains("docs")')).toBe(true);
    expect(run('tags.join(" + ")')).toBe("web + launch");
    expect(run("tags.join()")).toBe("web, launch");
    expect(run("tags.first() + tags.last()")).toBe("weblaunch");
    expect(run("[].isEmpty() && empty.isEmpty() && !tags.isEmpty()")).toBe(true);
    expect(run("[1, [2]] == [1, [2]]")).toBe(true);
    expect(run("price.toFixed(2) + price.round()")).toBe("12.0012");
    expect(fails("price[0]")).toBe("a number cannot be indexed by a number");
  });
});

describe("withFormulas", () => {
  const schema = readDatabase(
    {
      properties: [
        { key: "price", type: "number" },
        { key: "due", type: "date" },
        { key: "total", type: "formula", formula: "price * 2" },
        { key: "label", type: "formula", formula: 'text(total) + " by " + due.format("D MMM")' },
        { key: "late", type: "formula", formula: "due < today()" },
        { key: "loop", type: "formula", formula: "loop2 + 1" },
        { key: "loop2", type: "formula", formula: "loop + 1" },
        { key: "broken", type: "formula", formula: "price +" },
        { key: "next", type: "formula", formula: 'due + "1 day"' },
      ],
      views: [],
    },
    () => undefined,
  );
  const row: Row = {
    id: "01929f4c-7b00-7a00-8000-000000000001" as NoteId,
    path: "Projects/Launch.md",
    updated: 0,
    properties: [
      { key: "price", value: 21 },
      { key: "due", value: "2026-11-05" },
      // A stale value, which the formula's replaces.
      { key: "total", value: 1 },
    ],
  };

  it("works out each formula for a row, one reading another, and keeps what fails apart", () => {
    const [worked] = withFormulas([row], schema, now);
    const value = (key: string) => worked?.properties.find((entry) => entry.key === key)?.value;
    expect(value("total")).toBe(42);
    expect(value("label")).toBe("42 by 5 Nov");
    expect(value("late")).toBe(true);
    expect(value("next")).toBe("2026-11-06");
    expect(value("loop")).toBeNull();
    expect(worked?.errors?.get("loop")).toBe("The formula refers to itself through loop");
    expect(worked?.errors?.get("loop2")).toBe("The formula refers to itself through loop");
    expect(worked?.errors?.get("broken")).toBe("The formula ends too soon");
    expect(worked?.errors?.has("total")).toBe(false);
    expect(worked?.properties.filter((entry) => entry.key === "total")).toHaveLength(1);
  });

  it("leaves rows as they are when a database has no formulas", () => {
    expect(withFormulas([row], { properties: [], views: [] })).toEqual([row]);
  });

  it("writes a formula's value as rows hold values", () => {
    expect(formulaJson(new Date(2026, 10, 5))).toBe("2026-11-05");
    expect(formulaJson(new Date(2026, 10, 5, 9, 30))).toBe("2026-11-05T09:30");
    expect(formulaJson(new Date(Number.NaN))).toBeNull();
    expect(formulaJson([1, Number.POSITIVE_INFINITY, "a"])).toEqual([1, null, "a"]);
  });
});
