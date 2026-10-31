// The link index when its worker cannot load: it says why, rather than
// show it reading the vault's first notes for ever.
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it } from "vitest";
import { Indexer } from "../src/indexer.ts";

/** A worker that only takes its handlers, as one whose module failed. */
function brokenWorker(): Worker & { fail(message: string): void } {
  const worker = {
    onmessage: null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: () => undefined,
    terminate: () => undefined,
    fail(message: string) {
      this.onerror?.({ message, preventDefault: () => undefined } as unknown as ErrorEvent);
    },
  };
  return worker as unknown as Worker & { fail(message: string): void };
}

describe("Indexer", () => {
  it("tells its listeners why its worker failed", () => {
    const worker = brokenWorker();
    const indexer = new Indexer(new Vault(new MemoryFiles(), new MemoryStore()), worker);
    let told = 0;
    indexer.subscribe(() => {
      told++;
    });
    expect(indexer.error()).toBeUndefined();
    worker.fail("document is not defined");
    expect(indexer.error()).toBe("document is not defined");
    expect(told).toBe(1);
  });

  it("names a failure that came with no message", () => {
    const worker = brokenWorker();
    const indexer = new Indexer(new Vault(new MemoryFiles(), new MemoryStore()), worker);
    worker.fail("");
    expect(indexer.error()).toBe("The worker stopped.");
  });
});
