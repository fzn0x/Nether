// Node's built-in SQLite, shaped as MyGO's SQLite plugin, for the tests.
import { DatabaseSync } from "node:sqlite";
import type { Database, SqlValue, Statement } from "../src/index.ts";

export function nodeDatabase(file = ":memory:"): Database & { readonly raw: DatabaseSync } {
  const raw = new DatabaseSync(file);
  const run = (sql: string, params: readonly SqlValue[] = []): void => {
    raw.prepare(sql).run(...params);
  };
  return {
    raw,
    execute(sql, params) {
      run(sql, params);
      return Promise.resolve();
    },
    query(sql, params = []) {
      const rows = raw.prepare(sql).all(...params);
      const columns = rows[0] === undefined ? [] : Object.keys(rows[0]);
      return Promise.resolve({
        columns,
        rows: rows.map((row) => columns.map((column) => row[column] as SqlValue)),
      });
    },
    transaction(statements: readonly Statement[]) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        for (const { sql, params } of statements) run(sql, params);
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
    close() {
      raw.close();
      return Promise.resolve();
    },
  };
}
