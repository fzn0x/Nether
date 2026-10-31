// The server's database (ADR 0031): PostgreSQL through node-postgres, behind
// the small interface the rest of the server uses, so its tests run it on
// PGlite, PostgreSQL in the test's own process, and CI on a real server.
import pg from "pg";

/** A row as the database returns it; whoever reads a column checks its type. */
export type Row = Record<string, unknown>;

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
