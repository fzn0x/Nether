// Databases: a note with a schema, whose rows are the notes under it. Views
// show the rows as a table, board, calendar, timeline, gallery or list.
import { type ViewId, readViewId } from "./ids.ts";
import { type JsonValue, readJson } from "./json.ts";
import {
  type PropertyDefinition,
  type PropertyEntry,
  type PropertyType,
  checkPropertyValue,
  readPropertyDefinition,
} from "./properties.ts";
import {
  fail,
  readArray,
  readFields,
  readName,
  readOneOf,
  readOptional,
  readString,
} from "./read.ts";

export const viewLayouts = ["table", "board", "calendar", "timeline", "gallery", "list"] as const;
export type ViewLayout = (typeof viewLayouts)[number];

/** Properties every row has without a schema entry; views refer to them by these names. */
export const builtInProperties = ["$title", "$created", "$updated"] as const;

export const filterOperators = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "greaterThan",
  "greaterOrEqual",
  "lessThan",
  "lessOrEqual",
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "isEmpty",
  "isNotEmpty",
] as const;
export type FilterOperator = (typeof filterOperators)[number];

const unaryOperators: readonly FilterOperator[] = ["isEmpty", "isNotEmpty"];

export interface Condition {
  readonly property: string;
  readonly operator: FilterOperator;
  /** What the property is compared with; absent for isEmpty and isNotEmpty. */
  readonly value?: JsonValue;
}

export type Filter =
  { readonly and: readonly Filter[] } | { readonly or: readonly Filter[] } | Condition;

export interface Sort {
  readonly property: string;
  readonly direction: "ascending" | "descending";
}

export interface View {
  readonly id: ViewId;
  readonly name: string;
  readonly layout: ViewLayout;
  /** The properties shown, in order. */
  readonly visible: readonly string[];
  readonly filter?: Filter;
  readonly sorts?: readonly Sort[];
  /** The property rows are grouped by; a board's columns. */
  readonly groupBy?: string;
  /** A calendar's date property, or the start of a timeline's bars. */
  readonly date?: string;
  /** The end of a timeline's bars. */
  readonly end?: string;
  /** A gallery's cover image: a file property. */
  readonly cover?: string;
}

export interface DatabaseSchema {
  readonly properties: readonly PropertyDefinition[];
  readonly views: readonly View[];
}

const dateTypes: readonly (PropertyType | "$created" | "$updated")[] = [
  "date",
  "$created",
  "$updated",
];
const groupableOnBoards: readonly PropertyType[] = ["select", "multiSelect", "checkbox", "person"];

function readFilter(
  value: unknown,
  path: string,
  typeOf: (key: string, path: string) => string,
  depth: number,
): Filter {
  if (depth > 8) fail(path, "nests filter groups deeper than 8 levels");
  if (typeof value === "object" && value !== null && ("and" in value || "or" in value)) {
    const fields = readFields(value, path, [], ["and", "or"]);
    const join = fields.and !== undefined ? "and" : "or";
    if (fields.and !== undefined && fields.or !== undefined) fail(path, "has both and and or");
    const parts = readArray(fields[join], `${path}.${join}`).map((item, index) =>
      readFilter(item, `${path}.${join}[${String(index)}]`, typeOf, depth + 1),
    );
    if (parts.length === 0) fail(`${path}.${join}`, "needs at least one filter");
    return join === "and" ? { and: parts } : { or: parts };
  }
  const fields = readFields(value, path, ["property", "operator"], ["value"]);
  const property = readString(fields.property, `${path}.property`);
  typeOf(property, `${path}.property`);
  const operator = readOneOf(fields.operator, `${path}.operator`, filterOperators);
  if (unaryOperators.includes(operator)) {
    if (fields.value !== undefined) fail(`${path}.value`, `is not used by ${operator}`);
    return { property, operator };
  }
  if (fields.value === undefined) fail(`${path}.value`, `is needed by ${operator}`);
  return { property, operator, value: readJson(fields.value, `${path}.value`) };
}

function readView(
  value: unknown,
  path: string,
  typeOf: (key: string, path: string) => string,
): View {
  const fields = readFields(
    value,
    path,
    ["id", "name", "layout", "visible"],
    ["filter", "sorts", "groupBy", "date", "end", "cover"],
  );
  const layout = readOneOf(fields.layout, `${path}.layout`, viewLayouts);
  const property = (key: string) => (item: unknown, itemPath: string) => {
    const name = readString(item, itemPath);
    const type = typeOf(name, itemPath);
    return { name, type, key };
  };

  const visible = readArray(fields.visible, `${path}.visible`).map((item, index) => {
    const itemPath = `${path}.visible[${String(index)}]`;
    return property("visible")(item, itemPath).name;
  });
  if (new Set(visible).size !== visible.length) fail(`${path}.visible`, "lists a property twice");

  const filter = readOptional(fields, "filter", path, (item, itemPath) =>
    readFilter(item, itemPath, typeOf, 0),
  );
  const sorts = readOptional(fields, "sorts", path, (item, itemPath) =>
    readArray(item, itemPath).map((sort, index) => {
      const sortPath = `${itemPath}[${String(index)}]`;
      const sortFields = readFields(sort, sortPath, ["property", "direction"]);
      return {
        property: property("sort")(sortFields.property, `${sortPath}.property`).name,
        direction: readOneOf(sortFields.direction, `${sortPath}.direction`, [
          "ascending",
          "descending",
        ] as const),
      };
    }),
  );
  const groupBy = readOptional(fields, "groupBy", path, property("groupBy"));
  const date = readOptional(fields, "date", path, property("date"));
  const end = readOptional(fields, "end", path, property("end"));
  const cover = readOptional(fields, "cover", path, property("cover"));

  if (layout === "board") {
    if (groupBy === undefined) fail(`${path}.groupBy`, "is needed by a board");
    if (!(groupableOnBoards as readonly string[]).includes(groupBy.type)) {
      fail(
        `${path}.groupBy`,
        "must be a select, multi-select, checkbox or person property on a board",
      );
    }
  }
  if (layout === "calendar" || layout === "timeline") {
    if (date === undefined) fail(`${path}.date`, `is needed by a ${layout}`);
    for (const field of [date, end]) {
      if (field !== undefined && !(dateTypes as readonly string[]).includes(field.type)) {
        fail(`${path}.${field.key}`, "must be a date property");
      }
    }
  } else if (date !== undefined) {
    fail(`${path}.date`, "is only for calendars and timelines");
  }
  if (end !== undefined && layout !== "timeline") fail(`${path}.end`, "is only for timelines");
  if (cover !== undefined) {
    if (layout !== "gallery") fail(`${path}.cover`, "is only for galleries");
    if (cover.type !== "file") fail(`${path}.cover`, "must be a file property");
  }

  return {
    id: readViewId(fields.id, `${path}.id`),
    name: readName(fields.name, `${path}.name`),
    layout,
    visible,
    ...(filter === undefined ? {} : { filter }),
    ...(sorts === undefined ? {} : { sorts }),
    ...(groupBy === undefined ? {} : { groupBy: groupBy.name }),
    ...(date === undefined ? {} : { date: date.name }),
    ...(end === undefined ? {} : { end: end.name }),
    ...(cover === undefined ? {} : { cover: cover.name }),
  };
}

export function readDatabaseSchema(value: unknown, path: string): DatabaseSchema {
  const fields = readFields(value, path, ["properties", "views"]);
  const properties = readArray(fields.properties, `${path}.properties`).map((item, index) =>
    readPropertyDefinition(item, `${path}.properties[${String(index)}]`),
  );
  const types = new Map<string, PropertyType>();
  properties.forEach((definition, index) => {
    if (types.has(definition.key)) {
      fail(`${path}.properties[${String(index)}].key`, `repeats the property "${definition.key}"`);
    }
    types.set(definition.key, definition.type);
  });
  const typeOf = (key: string, keyPath: string): string => {
    if ((builtInProperties as readonly string[]).includes(key)) return key;
    const type = types.get(key);
    if (type === undefined) fail(keyPath, `names no property of the database: "${key}"`);
    return type;
  };

  const views = readArray(fields.views, `${path}.views`).map((item, index) =>
    readView(item, `${path}.views[${String(index)}]`, typeOf),
  );
  const ids = new Set<string>();
  views.forEach((view, index) => {
    if (ids.has(view.id))
      fail(`${path}.views[${String(index)}].id`, `repeats the view ID "${view.id}"`);
    ids.add(view.id);
  });
  return { properties, views };
}

/**
 * Checks a row's properties against its database's schema: each property
 * the schema defines must hold a value of its type. A row may have other
 * properties too, as frontmatter allows.
 */
export function checkRow(
  properties: readonly PropertyEntry[],
  schema: DatabaseSchema,
  path: string,
): void {
  properties.forEach((entry, index) => {
    const definition = schema.properties.find((item) => item.key === entry.key);
    if (definition !== undefined) {
      checkPropertyValue(definition.type, entry.value, `${path}[${String(index)}].value`);
    }
  });
}
