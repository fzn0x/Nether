// A web vault's index in SQLite's WebAssembly build, in a worker (ADR 0053),
// kept in the origin private file system through the `opfs-sahpool` store,
// which needs no cross-origin isolation. Each workspace has its own pool, so
// two tabs may open two workspaces; a second tab on the same one is refused,
// as the pool holds its files open. The page reaches the database through
// webIndex.ts, which gives it the shape SqliteStore takes.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

type SqlValue = string | number | bigint | Uint8Array | null;

interface Statement {
  readonly sql: string;
  readonly params?: readonly SqlValue[];
}

export type IndexRequest =
  | { readonly id: number; readonly op: "open"; readonly workspace: string }
  | {
      readonly id: number;
      readonly op: "execute" | "query";
      readonly sql: string;
      readonly params?: readonly SqlValue[];
    }
  | { readonly id: number; readonly op: "transaction"; readonly statements: readonly Statement[] }
  | { readonly id: number; readonly op: "close" };

export type IndexAnswer =
  | { readonly id: number; readonly ok: true; readonly result?: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string };
    };

interface Db {
  exec(options: {
    sql: string;
    bind?: readonly SqlValue[];
    rowMode?: "array";
    resultRows?: SqlValue[][];
    columnNames?: string[];
  }): unknown;
  transaction<T>(work: (db: Db) => T): T;
  close(): void;
}

let db: Db | undefined;

/** How long to wait for another page to let a workspace's index go. */
const lockWait = 5_000;

/**
 * Holds the workspace's lock while this worker lives, which the browser
 * lets go as it ends: a page opening the index after another, as a reload
 * does, waits for it rather than finding the pool's files still open.
 * False when another page keeps it.
 */
function holdLock(workspace: string): Promise<boolean> {
  return new Promise((resolve) => {
    navigator.locks
      .request(`nether-index-${workspace}`, { signal: AbortSignal.timeout(lockWait) }, () => {
        resolve(true);
        return new Promise<never>(() => undefined);
      })
      .catch(() => {
        resolve(false);
      });
  });
}

/** IndexElsewhere: another page keeps the index; IndexBusy: its files are not let go yet. */
function refused(name: "IndexElsewhere" | "IndexBusy", message: string, cause?: unknown): Error {
  const error = new Error(message, { cause });
  error.name = name;
  return error;
}

/** The workspace's pool, and its database, opened once. */
async function open(workspace: string): Promise<void> {
  if (!(await holdLock(workspace))) {
    throw refused("IndexElsewhere", "Another page has this workspace's index open.");
  }
  const sqlite3 = await sqlite3InitModule();
  let pool;
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({
      name: `nether-${workspace}`,
      directory: `/indexes/${workspace}`,
      // A pool another tab holds is left as it is, not cleared.
      preserveOnInitFailure: true,
    });
  } catch (error) {
    // The pool's files are open still, as the page that had them lets them go.
    throw refused("IndexBusy", error instanceof Error ? error.message : String(error), error);
  }
  // With the pool's rollback journal: it has no shared memory for WAL.
  db = new pool.OpfsSAHPoolDb("/index.sqlite3");
}

function opened(): Db {
  if (db === undefined) throw new Error("The index is not open.");
  return db;
}

function run(request: IndexRequest): unknown {
  switch (request.op) {
    case "open":
      return open(request.workspace);
    case "execute":
      opened().exec({ sql: request.sql, bind: request.params ?? [] });
      return undefined;
    case "query": {
      const rows: SqlValue[][] = [];
      const columns: string[] = [];
      opened().exec({
        sql: request.sql,
        bind: request.params ?? [],
        rowMode: "array",
        resultRows: rows,
        columnNames: columns,
      });
      return { columns, rows };
    }
    case "transaction":
      opened().transaction((inside) => {
        for (const statement of request.statements) {
          inside.exec({ sql: statement.sql, bind: statement.params ?? [] });
        }
      });
      return undefined;
    case "close":
      db?.close();
      db = undefined;
      return undefined;
  }
}

// One request at a time, in order, as they come.
let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<IndexRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let answer: IndexAnswer;
    try {
      answer = { id: request.id, ok: true, result: await run(request) };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      answer = {
        id: request.id,
        ok: false,
        error: { name: failure.name, message: failure.message },
      };
    }
    self.postMessage(answer);
  });
};
