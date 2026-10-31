// A web vault's index, in SQLite in a worker (webIndex.worker.ts): the
// database SqliteStore takes, its calls sent to the worker and answered in
// order.
import type { Database, SqlValue, Statement } from "@nether/storage";
import { t } from "./messages.ts";
import type { IndexAnswer, IndexRequest } from "./webIndex.worker.ts";

/** What the worker takes, without the number each request is given. */
type Ask = IndexRequest extends infer Request
  ? Request extends { readonly id: number }
    ? Omit<Request, "id">
    : never
  : never;

/**
 * The worker waits for the lock another page holds on the index; the
 * pool's files can stay open a moment after it is let go, so it tries a
 * few times more.
 */
const tries = 4;
const pause = 300;

/** A worker for the index, and how to ask it. */
function indexWorker() {
  const worker = new Worker(new URL("./webIndex.worker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let next = 0;
  worker.onmessage = (event: MessageEvent<IndexAnswer>) => {
    const answer = event.data;
    const pending = waiting.get(answer.id);
    if (pending === undefined) return;
    waiting.delete(answer.id);
    if (answer.ok) {
      pending.resolve(answer.result);
    } else {
      const error = new Error(answer.error.message);
      error.name = answer.error.name;
      pending.reject(error);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    const error = new Error(event.message || "The index's worker failed.");
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };
  const ask = (request: Ask) =>
    new Promise<unknown>((resolve, reject) => {
      next += 1;
      waiting.set(next, { resolve, reject });
      worker.postMessage({ ...request, id: next });
    });
  return { worker, ask };
}

/**
 * The index of a workspace, opened in a worker of its own, which lets it
 * go as the page goes; it throws when another tab keeps it open.
 */
export async function openWebIndex(workspace: string): Promise<Database> {
  for (let attempt = 1; ; attempt++) {
    const { worker, ask } = indexWorker();
    try {
      await ask({ op: "open", workspace });
    } catch (error) {
      worker.terminate();
      const name = error instanceof Error ? error.name : "";
      if (name === "IndexElsewhere" || (name === "IndexBusy" && attempt === tries)) {
        throw new Error(t("webOpenElsewhere"), { cause: error });
      }
      if (name !== "IndexBusy") throw error;
      await new Promise((resolve) => setTimeout(resolve, pause));
      continue;
    }
    // A page going away lets its index go at once, for the next to open.
    const leave = () => {
      worker.terminate();
    };
    addEventListener("pagehide", leave);
    return {
      async execute(sql: string, params?: readonly SqlValue[]) {
        return ask({ op: "execute", sql, ...(params === undefined ? {} : { params }) });
      },
      async query(sql: string, params?: readonly SqlValue[]) {
        return (await ask({ op: "query", sql, ...(params === undefined ? {} : { params }) })) as {
          readonly columns: readonly string[];
          readonly rows: readonly (readonly SqlValue[])[];
        };
      },
      async transaction(statements: readonly Statement[]) {
        return ask({ op: "transaction", statements });
      },
      async close() {
        removeEventListener("pagehide", leave);
        await ask({ op: "close" });
        worker.terminate();
      },
    };
  }
}
