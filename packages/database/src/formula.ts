// Formulas (ADR 0020): expressions worked out for each row when a view
// shows it, never written to a row's file. The language is read by its own
// parser and run by its own interpreter over a fixed set of operators,
// functions and methods, so a formula can reach nothing but the row's
// values: no code runs, and every step is counted.
import {
  type DatabaseSchema,
  type JsonValue,
  type PropertyDefinition,
  addToDate,
  formatDate,
} from "@nether/core";
import { type Row, linkName, rowValue } from "./rows.ts";

/** A value a formula works with: JSON's, or a date. */
export type FormulaValue = null | boolean | number | string | Date | readonly FormulaValue[];

/** What makes a formula unreadable or unworkable, with where in its text when that is known. */
export class FormulaError extends Error {
  override readonly name = "FormulaError";
  readonly at: number | undefined;

  constructor(message: string, at?: number) {
    super(message);
    this.at = at;
  }
}

type Token =
  | { readonly kind: "number"; readonly value: number; readonly at: number }
  | { readonly kind: "string"; readonly value: string; readonly at: number }
  | { readonly kind: "name" | "op"; readonly value: string; readonly at: number }
  | { readonly kind: "end"; readonly at: number };

const operators = [
  "&&",
  "||",
  "==",
  "!=",
  ">=",
  "<=",
  ">",
  "<",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
];

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(text.slice(at));
    if (number !== null) {
      tokens.push({ kind: "number", value: Number(number[0]), at });
      at += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(at));
    if (name !== null) {
      tokens.push({ kind: "name", value: name[0], at });
      at += name[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      let value = "";
      let end = at + 1;
      for (; end < text.length && text.charAt(end) !== char; end++) {
        let next = text.charAt(end);
        if (next === "\\") {
          end++;
          const escaped = text.charAt(end);
          next = escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        }
        value += next;
      }
      if (end >= text.length) throw new FormulaError("A text is not closed", at);
      tokens.push({ kind: "string", value, at });
      at = end + 1;
      continue;
    }
    const operator = operators.find((candidate) => text.startsWith(candidate, at));
    if (operator === undefined) throw new FormulaError(`"${char}" cannot be read`, at);
    tokens.push({ kind: "op", value: operator, at });
    at += operator.length;
  }
  tokens.push({ kind: "end", at });
  return tokens;
}

/** A formula, read. */
export type FormulaNode =
  | { readonly type: "literal"; readonly value: FormulaValue }
  | { readonly type: "list"; readonly items: readonly FormulaNode[] }
  | { readonly type: "name"; readonly name: string; readonly at: number }
  | {
      readonly type: "member";
      readonly object: FormulaNode;
      readonly name: string;
      readonly at: number;
    }
  | { readonly type: "index"; readonly object: FormulaNode; readonly index: FormulaNode }
  | {
      readonly type: "call";
      readonly callee: FormulaNode;
      readonly args: readonly FormulaNode[];
      readonly at: number;
    }
  | { readonly type: "unary"; readonly op: string; readonly operand: FormulaNode }
  | {
      readonly type: "binary";
      readonly op: string;
      readonly left: FormulaNode;
      readonly right: FormulaNode;
      readonly at: number;
    };

/** How deep a formula's parts can nest, as `((((1))))` does. */
const deepest = 64;

/** Reads a formula's text, or throws a FormulaError saying what is wrong and where. */
export function parseFormula(text: string): FormulaNode {
  const tokens = tokenize(text);
  let position = 0;
  let depth = 0;
  const peek = (): Token => tokens[position] ?? { kind: "end", at: text.length };
  const take = (): Token => {
    const token = peek();
    position++;
    return token;
  };
  const isOp = (value: string) => {
    const token = peek();
    return token.kind === "op" && token.value === value;
  };
  const expect = (value: string) => {
    const token = take();
    if (token.kind !== "op" || token.value !== value) {
      throw new FormulaError(`"${value}" is missing`, token.at);
    }
  };
  const deeper = <T>(read: () => T): T => {
    if (++depth > deepest)
      throw new FormulaError(`The formula nests deeper than ${String(deepest)} levels`, peek().at);
    try {
      return read();
    } finally {
      depth--;
    }
  };
  const binary = (ops: readonly string[], next: () => FormulaNode) => (): FormulaNode => {
    let left = next();
    for (;;) {
      const token = peek();
      if (token.kind !== "op" || !ops.includes(token.value)) return left;
      take();
      left = { type: "binary", op: token.value, left, right: next(), at: token.at };
    }
  };
  const args = (): FormulaNode[] => {
    const list: FormulaNode[] = [];
    if (isOp(")")) {
      take();
      return list;
    }
    for (;;) {
      list.push(expression());
      if (isOp(",")) {
        take();
        continue;
      }
      expect(")");
      return list;
    }
  };
  const primary = (): FormulaNode => {
    const token = take();
    switch (token.kind) {
      case "number":
      case "string":
        return { type: "literal", value: token.value };
      case "name":
        if (token.value === "true" || token.value === "false")
          return { type: "literal", value: token.value === "true" };
        if (token.value === "null") return { type: "literal", value: null };
        return { type: "name", name: token.value, at: token.at };
      case "op":
        if (token.value === "(") {
          const inner = deeper(expression);
          expect(")");
          return inner;
        }
        if (token.value === "[") {
          const items: FormulaNode[] = [];
          if (isOp("]")) {
            take();
            return { type: "list", items };
          }
          for (;;) {
            items.push(deeper(expression));
            if (isOp(",")) {
              take();
              continue;
            }
            expect("]");
            return { type: "list", items };
          }
        }
        throw new FormulaError(`"${token.value}" cannot start a value`, token.at);
      case "end":
        throw new FormulaError("The formula ends too soon", token.at);
    }
  };
  const postfix = (): FormulaNode => {
    let node = primary();
    for (;;) {
      const token = peek();
      if (token.kind !== "op") return node;
      if (token.value === ".") {
        take();
        const name = take();
        if (name.kind !== "name") throw new FormulaError('A name must follow "."', name.at);
        node = { type: "member", object: node, name: name.value, at: name.at };
      } else if (token.value === "[") {
        take();
        const index = deeper(expression);
        expect("]");
        node = { type: "index", object: node, index };
      } else if (token.value === "(") {
        take();
        node = { type: "call", callee: node, args: deeper(args), at: token.at };
      } else {
        return node;
      }
    }
  };
  const unary = (): FormulaNode => {
    if (isOp("!") || isOp("-")) {
      const op = take();
      return { type: "unary", op: op.kind === "op" ? op.value : "!", operand: deeper(unary) };
    }
    return postfix();
  };
  const multiplicative = binary(["*", "/", "%"], unary);
  const additive = binary(["+", "-"], multiplicative);
  const comparison = binary([">", "<", ">=", "<="], additive);
  const equality = binary(["==", "!="], comparison);
  const and = binary(["&&"], equality);
  const or = binary(["||"], and);
  function expression(): FormulaNode {
    return or();
  }
  const node = expression();
  const rest = peek();
  if (rest.kind !== "end")
    throw new FormulaError("The formula goes on after its value ends", rest.at);
  return node;
}

/** What a formula reads of a row's file, as Obsidian's `file.` does. */
export interface FormulaFile {
  /** Relative to the vault, with its extension; its name, folder and extension are read from it. */
  readonly path: string;
  readonly ctime?: Date;
  readonly mtime: Date;
  /** Its tags, without `#`. */
  readonly tags: readonly string[];
  /** Whether it has a property by that name, even an empty one. */
  hasProperty(key: string): boolean;
}

/** What a formula reads a row's values through. */
export interface FormulaContext {
  /** A property's value, by its key: a note's own, a rollup's, or another formula's. */
  property(key: string): FormulaValue;
  /** A formula's value, as `formula.` reads it; without it, `formula.` reads as `note.` does. */
  formula?(key: string): FormulaValue;
  readonly file: FormulaFile;
  readonly now: Date;
}

/** How many steps a formula may take for one row, as a long list would make it. */
const steps = 100_000;

function isDate(value: FormulaValue | undefined): value is Date {
  return value instanceof Date;
}

function isList(value: FormulaValue | undefined): value is readonly FormulaValue[] {
  return Array.isArray(value);
}

/** Whether a value holds as a condition: not `null`, `false`, `0`, `""` or `[]`. */
export function truthy(value: FormulaValue): boolean {
  if (value === null || value === false || value === 0 || value === "") return false;
  if (isList(value)) return value.length > 0;
  return !(typeof value === "number" && Number.isNaN(value));
}

const pad = (part: number) => String(part).padStart(2, "0");

/** A date as rows write one: its day, and its time when it has one. */
function dateText(date: Date): string {
  const day = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0
    ? day
    : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A value as text, as `+` joins it to text. */
export function formulaText(value: FormulaValue): string {
  if (value === null) return "";
  if (isDate(value)) return dateText(value);
  if (isList(value)) return value.map(formulaText).join(", ");
  return typeof value === "string" ? linkName(value) : String(value);
}

/** A date from `YYYY-MM-DD`, with a time after a space or `T`, where the user is. */
function readDate(text: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (match === null) return undefined;
  const [, year = "", month = "", day = "", hour = "0", minute = "0", second = "0"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return date.getMonth() === Number(month) - 1 ? date : undefined;
}

const durationUnits: Record<string, "m" | "h" | "d" | "w" | "M" | "y"> = {
  minute: "m",
  minutes: "m",
  hour: "h",
  hours: "h",
  day: "d",
  days: "d",
  week: "w",
  weeks: "w",
  month: "M",
  months: "M",
  year: "y",
  years: "y",
};

/** A date moved by a duration as text, as `"2 weeks"`, forward or back. */
function moveDate(date: Date, duration: string, sign: 1 | -1, at: number): Date {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/.exec(duration);
  const unit = match === null ? undefined : durationUnits[(match[2] ?? "").toLowerCase()];
  if (match === null || unit === undefined) {
    throw new FormulaError(`"${duration}" is not a duration, as "3 days" is`, at);
  }
  const amount = Number(match[1]) * sign;
  if (unit === "m" || unit === "h")
    return new Date(date.getTime() + amount * (unit === "m" ? 60_000 : 3_600_000));
  return addToDate(date, Math.round(amount), unit);
}

function same(a: FormulaValue, b: FormulaValue): boolean {
  if (isDate(a) && isDate(b)) return a.getTime() === b.getTime();
  if (isList(a) && isList(b))
    return a.length === b.length && a.every((item, index) => same(item, b[index] ?? null));
  if (typeof a === "string" && typeof b === "string") return linkName(a) === linkName(b);
  return a === b;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** How two values of a kind are ordered; undefined for values of different kinds. */
export function order(a: FormulaValue, b: FormulaValue): number | undefined {
  if (isDate(a) && isDate(b)) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string")
    return collator.compare(linkName(a), linkName(b));
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return undefined;
}

function kindName(value: FormulaValue): string {
  if (value === null) return "nothing";
  if (isDate(value)) return "a date";
  if (isList(value)) return "a list";
  return typeof value === "string"
    ? "text"
    : typeof value === "number"
      ? "a number"
      : "true or false";
}

/** A file's name, with its extension, from its path. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** A file's folder, `/` at the vault's top, as Obsidian names it. */
function fileFolder(path: string): string {
  const end = path.lastIndexOf("/");
  return end === -1 ? "/" : path.slice(0, end);
}

/** A file's extension, without its dot; "" when it has none. */
function fileExtension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

/** What `file.` names: a part of the row's file. */
function fileMember(file: FormulaFile, name: string, at: number): FormulaValue {
  switch (name) {
    case "name":
      return fileName(file.path);
    case "basename": {
      const extension = fileExtension(file.path);
      const whole = fileName(file.path);
      return extension === "" ? whole : whole.slice(0, -extension.length - 1);
    }
    case "path":
      return file.path;
    case "folder":
      return fileFolder(file.path);
    case "ext":
      return fileExtension(file.path);
    case "ctime":
      return file.ctime ?? null;
    case "mtime":
      return file.mtime;
    case "tags":
      return [...file.tags];
  }
  throw new FormulaError(`file has no "${name}"`, at);
}

/** What `file.` does: whether the row's file has a tag, is in a folder, or has a property. */
function fileMethod(
  file: FormulaFile,
  name: string,
  args: readonly FormulaValue[],
  at: number,
): FormulaValue {
  switch (name) {
    case "hasTag": {
      // Any of the tags, or a tag below one, as `#area/project` is below `#area`.
      const tags = file.tags.map((tag) => tag.toLowerCase());
      return args.some((arg) => {
        const wanted = formulaText(arg).replace(/^#/, "").toLowerCase();
        return tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`));
      });
    }
    case "inFolder": {
      // The folder, or one below it; the vault's top holds every file.
      const folder = formulaText(args[0] ?? null)
        .replace(/^\/+|\/+$/g, "")
        .toLowerCase();
      return folder === "" || file.path.toLowerCase().startsWith(`${folder}/`);
    }
    case "hasProperty":
      return file.hasProperty(formulaText(args[0] ?? null));
  }
  throw new FormulaError(`file has no ${name}()`, at);
}

/** Works out a read formula for one row. */
export function evaluateFormula(node: FormulaNode, context: FormulaContext): FormulaValue {
  let left = steps;
  const step = () => {
    if (--left < 0) throw new FormulaError(`The formula takes more than ${String(steps)} steps`);
  };
  const number = (value: FormulaValue, at: number, what: string): number => {
    if (typeof value !== "number")
      throw new FormulaError(`${what} needs a number, not ${kindName(value)}`, at);
    return value;
  };
  const text = (value: FormulaValue, at: number, what: string): string => {
    if (typeof value !== "string")
      throw new FormulaError(`${what} needs text, not ${kindName(value)}`, at);
    return value;
  };

  const functions: Record<string, (args: readonly FormulaNode[], at: number) => FormulaValue> = {
    // Only the branch it takes is worked out.
    if: (args, at) => {
      if (args.length < 2 || args.length > 3)
        throw new FormulaError("if() takes a condition, a value, and maybe another", at);
      const [condition, then, otherwise] = args as [FormulaNode, FormulaNode, FormulaNode?];
      if (truthy(run(condition))) return run(then);
      return otherwise === undefined ? null : run(otherwise);
    },
    min: (args, at) => extreme(args, at, Math.min),
    max: (args, at) => extreme(args, at, Math.max),
    abs: (args, at) => Math.abs(number(one(args, at, "abs"), at, "abs()")),
    floor: (args, at) => Math.floor(number(one(args, at, "floor"), at, "floor()")),
    ceil: (args, at) => Math.ceil(number(one(args, at, "ceil"), at, "ceil()")),
    round: (args, at) => {
      const [value, digits] = args.map(run);
      return roundTo(
        number(value ?? null, at, "round()"),
        digits === undefined ? 0 : number(digits, at, "round()"),
      );
    },
    number: (args, at) => {
      const value = one(args, at, "number");
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return Number(value);
      const read = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
      return Number.isFinite(read) ? read : null;
    },
    text: (args, at) => formulaText(one(args, at, "text")),
    date: (args, at) => {
      const value = one(args, at, "date");
      if (isDate(value) || value === null) return value;
      const date = readDate(text(value, at, "date()"));
      if (date === undefined)
        throw new FormulaError(`"${String(value)}" is not a date, as "2026-11-15" is`, at);
      return date;
    },
    today: () => new Date(context.now.getFullYear(), context.now.getMonth(), context.now.getDate()),
    now: () => new Date(context.now.getTime()),
  };

  function one(args: readonly FormulaNode[], at: number, name: string): FormulaValue {
    const [only] = args;
    if (args.length !== 1 || only === undefined) {
      throw new FormulaError(`${name}() takes one value`, at);
    }
    return run(only);
  }

  function extreme(
    args: readonly FormulaNode[],
    at: number,
    pick: (...numbers: number[]) => number,
  ): FormulaValue {
    const values = args.map(run).flatMap((value) => (isList(value) ? value : [value]));
    const numbers = values
      .filter((value) => value !== null)
      .map((value) => number(value, at, "min() and max()"));
    return numbers.length === 0 ? null : pick(...numbers);
  }

  function roundTo(value: number, digits: number): number {
    const scale = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
    return Math.round(value * scale) / scale;
  }

  function member(value: FormulaValue, name: string, at: number): FormulaValue {
    if (value === null) return null;
    if (name === "length") {
      if (typeof value === "string" || isList(value)) return value.length;
    }
    if (isDate(value)) {
      switch (name) {
        case "year":
          return value.getFullYear();
        case "month":
          return value.getMonth() + 1;
        case "day":
          return value.getDate();
        case "hour":
          return value.getHours();
        case "minute":
          return value.getMinutes();
      }
    }
    throw new FormulaError(`${kindName(value)} has no "${name}"`, at);
  }

  function method(
    value: FormulaValue,
    name: string,
    args: readonly FormulaValue[],
    at: number,
  ): FormulaValue {
    if (name === "isEmpty")
      return value === null || value === "" || (isList(value) && value.length === 0);
    // A missing value stays missing, rather than stopping the formula.
    if (value === null) return null;
    const arg = (index: number) => args[index] ?? null;
    if (typeof value === "string") {
      switch (name) {
        case "lower":
          return value.toLowerCase();
        case "upper":
          return value.toUpperCase();
        case "trim":
          return value.trim();
        case "contains":
          return value.toLowerCase().includes(formulaText(arg(0)).toLowerCase());
        case "startsWith":
          return value.toLowerCase().startsWith(formulaText(arg(0)).toLowerCase());
        case "endsWith":
          return value.toLowerCase().endsWith(formulaText(arg(0)).toLowerCase());
        case "slice":
          return value.slice(
            number(arg(0), at, "slice()"),
            args.length > 1 ? number(arg(1), at, "slice()") : undefined,
          );
        case "replace":
          return value.split(formulaText(arg(0))).join(formulaText(arg(1)));
        case "split":
          return value.split(formulaText(arg(0)));
      }
    }
    if (isList(value)) {
      switch (name) {
        case "contains":
          return value.some((item) => same(item, arg(0)));
        case "join":
          return value.map(formulaText).join(args.length > 0 ? formulaText(arg(0)) : ", ");
        case "first":
          return value[0] ?? null;
        case "last":
          return value[value.length - 1] ?? null;
      }
    }
    if (typeof value === "number") {
      switch (name) {
        case "round":
          return roundTo(value, args.length > 0 ? number(arg(0), at, "round()") : 0);
        case "toFixed":
          return value.toFixed(
            Math.max(0, Math.min(10, Math.trunc(number(arg(0), at, "toFixed()")))),
          );
      }
    }
    if (isDate(value) && name === "format") {
      return formatDate(value, args.length > 0 ? text(arg(0), at, "format()") : "YYYY-MM-DD");
    }
    throw new FormulaError(`${kindName(value)} has no ${name}()`, at);
  }

  function binary(op: string, a: FormulaValue, b: FormulaValue, at: number): FormulaValue {
    switch (op) {
      case "==":
        return same(a, b);
      case "!=":
        return !same(a, b);
      case ">":
      case "<":
      case ">=":
      case "<=": {
        const compared = order(a, b);
        if (compared === undefined) return false;
        return op === ">"
          ? compared > 0
          : op === "<"
            ? compared < 0
            : op === ">="
              ? compared >= 0
              : compared <= 0;
      }
      case "+":
        if (isDate(a) && typeof b === "string") return moveDate(a, b, 1, at);
        if (typeof a === "string" || typeof b === "string") return formulaText(a) + formulaText(b);
        if (isList(a) && isList(b)) return [...a, ...b];
        if (a === null || b === null) return null;
        return number(a, at, "+") + number(b, at, "+");
      case "-":
        if (isDate(a) && typeof b === "string") return moveDate(a, b, -1, at);
        // The days from one date to another.
        if (isDate(a) && isDate(b)) return (a.getTime() - b.getTime()) / 86_400_000;
        if (a === null || b === null) return null;
        return number(a, at, "-") - number(b, at, "-");
      case "*":
        if (a === null || b === null) return null;
        return number(a, at, "*") * number(b, at, "*");
      case "/":
      case "%": {
        if (a === null || b === null) return null;
        const divisor = number(b, at, op);
        if (divisor === 0) throw new FormulaError("The formula divides by zero", at);
        return op === "/" ? number(a, at, op) / divisor : number(a, at, op) % divisor;
      }
    }
    throw new FormulaError(`"${op}" cannot be worked out`, at);
  }

  function formula(key: string): FormulaValue {
    return context.formula === undefined ? context.property(key) : context.formula(key);
  }

  function run(node: FormulaNode): FormulaValue {
    step();
    switch (node.type) {
      case "literal":
        return node.value;
      case "list":
        return node.items.map(run);
      case "name":
        if (node.name === "note" || node.name === "file" || node.name === "formula") {
          throw new FormulaError(
            `"${node.name}" needs a name after it, as ${node.name}.name`,
            node.at,
          );
        }
        return context.property(node.name);
      case "member": {
        const object = node.object;
        if (object.type === "name" && object.name === "note") return context.property(node.name);
        if (object.type === "name" && object.name === "formula") return formula(node.name);
        if (object.type === "name" && object.name === "file") {
          return fileMember(context.file, node.name, node.at);
        }
        return member(run(object), node.name, node.at);
      }
      case "index": {
        if (node.object.type === "name" && node.object.name === "note") {
          return context.property(formulaText(run(node.index)));
        }
        if (node.object.type === "name" && node.object.name === "formula") {
          return formula(formulaText(run(node.index)));
        }
        const list = run(node.object);
        const index = run(node.index);
        if (list === null) return null;
        if (!isList(list) || typeof index !== "number") {
          throw new FormulaError(`${kindName(list)} cannot be indexed by ${kindName(index)}`);
        }
        return list[index < 0 ? list.length + index : index] ?? null;
      }
      case "call": {
        const callee = node.callee;
        if (callee.type === "name") {
          const call = functions[callee.name];
          if (call === undefined)
            throw new FormulaError(`There is no function ${callee.name}()`, callee.at);
          return call(node.args, node.at);
        }
        if (callee.type === "member" && callee.object.type === "name") {
          if (callee.object.name === "file")
            return fileMethod(context.file, callee.name, node.args.map(run), callee.at);
        }
        if (callee.type === "member")
          return method(run(callee.object), callee.name, node.args.map(run), callee.at);
        throw new FormulaError("Only a function or a method can be called", node.at);
      }
      case "unary": {
        const value = run(node.operand);
        if (node.op === "!") return !truthy(value);
        return value === null ? null : -number(value, 0, "-");
      }
      case "binary": {
        if (node.op === "&&") return truthy(run(node.left)) && truthy(run(node.right));
        if (node.op === "||") return truthy(run(node.left)) || truthy(run(node.right));
        return binary(node.op, run(node.left), run(node.right), node.at);
      }
    }
  }

  return run(node);
}

/** A row's value as a formula reads it: a date property's as a date, a list's items each so. */
export function readValue(
  value: JsonValue | undefined,
  definition: PropertyDefinition | undefined,
  key: string,
): FormulaValue {
  if (value === undefined || value === null) return null;
  const dated = definition?.type === "date" || key === "$created" || key === "$updated";
  if (typeof value === "number" && (key === "$created" || key === "$updated"))
    return new Date(value);
  if (typeof value === "string") return dated ? (readDate(value) ?? value) : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item: JsonValue) => readValue(item, definition, key));
  return null;
}

/** A formula's value as rows hold values: a date as its day, or its day and time. */
export function formulaJson(value: FormulaValue): JsonValue {
  if (value === null) return null;
  if (isDate(value)) return Number.isNaN(value.getTime()) ? null : dateText(value);
  if (isList(value)) return value.map(formulaJson);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value;
}

/** Formulas read from their text, by their names, or why each cannot be read. */
export function readFormulas(
  entries: Iterable<readonly [string, string]>,
): Map<string, FormulaNode | FormulaError> {
  const formulas = new Map<string, FormulaNode | FormulaError>();
  for (const [key, text] of entries) {
    try {
      formulas.set(key, parseFormula(text));
    } catch (error) {
      formulas.set(key, error instanceof FormulaError ? error : new FormulaError(String(error)));
    }
  }
  return formulas;
}

/**
 * Works out one row's formulas by name, each once, through the context
 * made for it; a formula that reads itself, directly or through others,
 * is an error.
 */
export function formulaWork(
  formulas: ReadonlyMap<string, FormulaNode | FormulaError>,
  contextOf: (work: (key: string) => FormulaValue) => FormulaContext,
): { readonly work: (key: string) => FormulaValue; readonly context: FormulaContext } {
  const worked = new Map<string, FormulaValue | FormulaError>();
  const working = new Set<string>();
  const work = (key: string): FormulaValue => {
    const done = worked.get(key);
    if (done instanceof FormulaError) throw done;
    if (done !== undefined) return done;
    if (working.has(key)) throw new FormulaError(`The formula refers to itself through ${key}`);
    const formula = formulas.get(key);
    if (formula instanceof FormulaError) throw formula;
    working.add(key);
    try {
      if (formula === undefined) throw new FormulaError(`There is no formula ${key}`);
      const value = evaluateFormula(formula, context);
      worked.set(key, value);
      return value;
    } catch (error) {
      const failure = error instanceof FormulaError ? error : new FormulaError(String(error));
      worked.set(key, failure);
      throw failure;
    } finally {
      working.delete(key);
    }
  };
  const context = contextOf(work);
  return { work, context };
}

/** What a formula reads of a row's file. */
export function fileOf(row: Row): FormulaFile {
  return {
    path: row.path,
    mtime: new Date(row.updated),
    ...(row.created === undefined ? {} : { ctime: new Date(row.created) }),
    tags: row.tags ?? [],
    hasProperty: (key) => row.properties.some((entry) => entry.key === key),
  };
}

/**
 * Rows with each formula's value in place of whatever their files hold
 * under its key, a formula reading the others, rollups and the row's own
 * values; what a formula cannot work out is in the row's `errors`.
 */
export function withFormulas(
  rows: readonly Row[],
  schema: DatabaseSchema,
  now = new Date(),
): Row[] {
  const formulas = readFormulas(
    schema.properties.flatMap((property) =>
      property.formula === undefined ? [] : [[property.key, property.formula] as const],
    ),
  );
  if (formulas.size === 0) return [...rows];
  const definitions = new Map(schema.properties.map((property) => [property.key, property]));
  return rows.map((row) => {
    // In a database a formula is a property: a name reads either.
    const { work } = formulaWork(formulas, (formula) => ({
      property: (key) =>
        formulas.has(key) ? formula(key) : readValue(rowValue(row, key), definitions.get(key), key),
      file: fileOf(row),
      now,
    }));
    const errors = new Map<string, string>();
    const values = [...formulas.keys()].map((key) => {
      try {
        return { key, value: formulaJson(work(key)) };
      } catch (error) {
        errors.set(key, error instanceof Error ? error.message : String(error));
        return { key, value: null };
      }
    });
    return {
      ...row,
      properties: [...row.properties.filter((entry) => !formulas.has(entry.key)), ...values],
      ...(errors.size === 0 ? {} : { errors }),
    };
  });
}
