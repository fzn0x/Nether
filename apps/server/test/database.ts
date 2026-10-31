// A database for a test: PGlite, PostgreSQL in the test's own process, or,
// when NETHER_TEST_DATABASE_URL names a PostgreSQL server, as CI's does, a
// schema of its own there, dropped when the test closes it.
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { type Database, type Queryable, type Row, connectPostgres } from "../src/db.ts";

// Without parameters node-postgres runs several statements at once, as the
// migrations do; PGlite does that only through exec.
function wrap(lite: Pick<PGlite, "query" | "exec">): Queryable["query"] {
  return async (text, params) => {
    if (params === undefined) {
      const results = await lite.exec(text);
      return { rows: results.at(-1)?.rows ?? [] };
    }
    const result = await lite.query<Row>(text, [...params]);
    return { rows: result.rows };
  };
}

export async function testDatabase(): Promise<Database> {
  const url = process.env.NETHER_TEST_DATABASE_URL ?? "";
  if (url !== "") {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const admin = connectPostgres(url);
    await admin.query(`CREATE SCHEMA ${schema}`);
    const separator = url.includes("?") ? "&" : "?";
    const db = connectPostgres(`${url}${separator}options=-c%20search_path%3D${schema}`);
    return {
      query: db.query.bind(db),
      transaction: db.transaction.bind(db),
      async close() {
        await db.close();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.close();
      },
    };
  }
  const lite = await PGlite.create();
  return {
    query: wrap(lite),
    transaction: (work) => lite.transaction((tx) => work({ query: wrap(tx) })),
    close: () => lite.close(),
  };
}
