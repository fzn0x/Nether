import { fail } from "./read.ts";

/** A value that JSON can hold, as properties and plugin attributes do. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

const maxDepth = 64;

/** Checks that a value is plain JSON, with finite numbers and plain objects, and copies it. */
export function readJson(value: unknown, path: string, depth = 0): JsonValue {
  if (depth > maxDepth) fail(path, `nests deeper than ${String(maxDepth)} levels`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must be a finite number");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown, index) =>
      readJson(item, `${path}[${String(index)}]`, depth + 1),
    );
  }
  return readJsonObject(value, path, depth);
}

/** Checks that a value is a plain JSON object and copies it. */
export function readJsonObject(value: unknown, path: string, depth = 0): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be a JSON object");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, "must be a plain object");
  // Object.fromEntries defines own properties, so a "__proto__" key stays data.
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, readJson(item, `${path}.${key}`, depth + 1)]),
  );
}
