// A database's schema as its note's frontmatter holds it, under `database`
// (ADR 0018): core's schema, but with no view IDs, as a view's name names
// it, and with links where core has note IDs, as Obsidian writes them.
import {
  type DatabaseSchema,
  type JsonValue,
  ModelError,
  type NoteId,
  type PropertyEntry,
  type ViewId,
  readDatabaseSchema,
} from "@nether/core";

/** The frontmatter key that makes a note a database. */
export const databaseKey = "database";

/**
 * A 128-bit hash of a string: cyrb128, by bryc, in the public domain. Not
 * for secrets; it gives a view the same ID each time its name is read.
 */
function hash128(text: string): readonly [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** A view's ID, made from its name: a UUID of version 8, the same for the same name. */
export function viewIdOf(name: string): ViewId {
  const hex = hash128(name)
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ViewId;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finds the note a link names, as `[[Clients]]`, or undefined when none. */
export type ResolveLink = (link: string) => NoteId | undefined;

/** The link that names a note, as `[[Clients]]`. */
export type LinkTo = (note: NoteId) => string;

/**
 * Reads a schema as a database's note holds it, checking it as core does:
 * each view gets an ID from its name, and each relation's database, a
 * link, the ID of the note it finds.
 */
export function readDatabase(
  value: unknown,
  resolve: ResolveLink,
  path = databaseKey,
): DatabaseSchema {
  if (!isObject(value)) throw new ModelError(path, "must be an object");
  const properties = Array.isArray(value.properties)
    ? value.properties.map((property: unknown, index) => {
        if (!isObject(property) || !isObject(property.relation)) return property;
        const link = property.relation.database;
        const where = `${path}.properties[${String(index)}].relation.database`;
        if (typeof link !== "string") throw new ModelError(where, "must be a link to a database");
        const database = resolve(link);
        if (database === undefined) throw new ModelError(where, `finds no note: ${link}`);
        return { ...property, relation: { ...property.relation, database } };
      })
    : value.properties;
  const names = new Set<string>();
  const views = Array.isArray(value.views)
    ? value.views.map((view: unknown, index) => {
        if (!isObject(view)) return view;
        const where = `${path}.views[${String(index)}]`;
        if ("id" in view)
          throw new ModelError(`${where}.id`, "is not written: a view's name names it");
        if (typeof view.name !== "string") return view;
        // Said of the name, as two views of one name would get one ID.
        if (names.has(view.name)) {
          throw new ModelError(`${where}.name`, `repeats the view name "${view.name}"`);
        }
        names.add(view.name);
        return { id: viewIdOf(view.name), ...view };
      })
    : value.views;
  return readDatabaseSchema({ ...value, properties, views }, path);
}

/** The schema of a note's frontmatter, if the note is a database. */
export function databaseOf(
  properties: readonly PropertyEntry[],
  resolve: ResolveLink,
): DatabaseSchema | undefined {
  const entry = properties.find((property) => property.key === databaseKey);
  return entry === undefined ? undefined : readDatabase(entry.value, resolve);
}

/** A schema as its database's note holds it, the value of its `database` key. */
export function writeDatabase(schema: DatabaseSchema, linkTo: LinkTo): JsonValue {
  return {
    properties: schema.properties.map((property) => {
      const { relation, options, ...rest } = property;
      return {
        ...rest,
        ...(options === undefined
          ? {}
          : {
              options: options.map((option) =>
                option.color === undefined
                  ? { name: option.name }
                  : { name: option.name, color: option.color },
              ),
            }),
        ...(relation === undefined
          ? {}
          : {
              relation: {
                database: linkTo(relation.database),
                ...(relation.backlink === undefined ? {} : { backlink: relation.backlink }),
              },
            }),
      };
    }),
    // Without its ID, as its name names it.
    views: schema.views.map(
      (view) =>
        Object.fromEntries(Object.entries(view).filter(([key]) => key !== "id")) as JsonValue,
    ),
  };
}
