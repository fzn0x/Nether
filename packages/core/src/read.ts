// Helpers that check untrusted values field by field. Each one returns the
// value with its type narrowed, or throws a ModelError that names the path.
import { ModelError } from "./errors.ts";

export function fail(path: string, problem: string): never {
  throw new ModelError(path, problem);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** An object with exactly the given fields: every required one, any optional one, nothing else. */
export function readFields(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainObject(value)) fail(path, "must be an object");
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      fail(`${path}.${key}`, "is not a known field");
    }
  }
  for (const key of required) {
    if (value[key] === undefined) fail(`${path}.${key}`, "is missing");
  }
  return value;
}

export function readString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

/** A string with no line breaks. */
export function readLine(value: unknown, path: string): string {
  const text = readString(value, path);
  if (/[\r\n]/.test(text)) fail(path, "must be a single line");
  return text;
}

/** A single line with something in it besides spaces. */
export function readName(value: unknown, path: string): string {
  const text = readLine(value, path);
  if (text.trim() === "") fail(path, "must not be empty");
  return text;
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be true or false");
  return value;
}

export function readNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a finite number");
  return value;
}

export function readInteger(value: unknown, path: string, min: number, max: number): number {
  const number = readNumber(value, path);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(path, `must be a whole number from ${String(min)} to ${String(max)}`);
  }
  return number;
}

export function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value as readonly unknown[];
}

export function readOneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(path, `must be one of ${allowed.map((item) => `"${item}"`).join(", ")}`);
  }
  return value as T;
}

/** Reads an optional field: undefined when absent, else the reader's result. */
export function readOptional<T>(
  fields: Record<string, unknown>,
  key: string,
  path: string,
  read: (value: unknown, path: string) => T,
): T | undefined {
  const value = fields[key];
  return value === undefined ? undefined : read(value, `${path}.${key}`);
}
