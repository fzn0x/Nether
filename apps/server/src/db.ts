// The server's database (ADR 0031): PostgreSQL through node-postgres, behind
// the small interface the rest of the server uses, so its tests run it on
// PGlite, PostgreSQL in the test's own process, and CI on a real server.
import pg from "pg";

/** A row as the database returns it; whoever reads a column checks its type. */
export type Row = Record<string, unknown>;

function unexpected(column: string, value: unknown, expected: string): TypeError {
  return new TypeError(`The database returned ${typeof value} for ${column}, not ${expected}`);
}

/** A column's text, such as a name or a UUID. */
export function readText(row: Row | undefined, column: string): string {
  const value = row?.[column];
  if (typeof value !== "string") throw unexpected(column, value, "text");
  return value;
}

/** A column's text, or null where it has none. */
export function readTextOrNull(row: Row | undefined, column: string): string | null {
  const value = row?.[column];
  if (value === null) return null;
  return readText(row, column);
}

/** An `integer` column, which both drivers return as a number. */
export function readNumber(row: Row | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value !== "number") throw unexpected(column, value, "a number");
  return value;
}

export function readBoolean(row: Row | undefined, column: string): boolean {
  const value = row?.[column];
  if (typeof value !== "boolean") throw unexpected(column, value, "a boolean");
  return value;
}

/** A `timestamptz` column, which both drivers return as a Date. */
export function readTime(row: Row | undefined, column: string): Date {
  const value = row?.[column];
  if (!(value instanceof Date)) throw unexpected(column, value, "a time");
  return value;
}

/**
 * What runs SQL: the database, or a transaction in it. Parameters are `$1`,
 * `$2`… Without parameters, `text` may hold several statements.
 */
export interface Queryable {
  query(text: string, params?: readonly unknown[]): Promise<{ readonly rows: Row[] }>;
}

export interface Database extends Queryable {
  /** Runs `work` in a transaction: committed when it returns, rolled back when it throws. */
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** A pool of connections to the PostgreSQL database at `url`. */
export function connectPostgres(url: string): Database {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    async query(text, params) {
      const result = await pool.query<Row>(text, params === undefined ? undefined : [...params]);
      return { rows: result.rows };
    },
    async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({
          async query(text, params) {
            const result = await client.query<Row>(
              text,
              params === undefined ? undefined : [...params],
            );
            return { rows: result.rows };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
