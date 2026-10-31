// Opens a vault for the interface: connects to its files and index, brings
// the index up to date, follows the folder's changes, and re-renders when
// its notes change.
import { type NoteEntry, Vault } from "@nether/storage";
import { useEffect, useState, useSyncExternalStore } from "react";
import { type Exporter, type Importer, type VaultMedia, backend } from "./backend.ts";
import { Indexer } from "./indexer.ts";
import type { VaultInfo } from "./mygo.ts";

export type VaultState =
  | { readonly status: "opening" }
  | {
      readonly status: "open";
      readonly vault: Vault;
      readonly media: VaultMedia;
      /** Where the vault's exports go. */
      readonly exporter: Exporter;
      /** Where what is imported into the vault comes from. */
      readonly importer: Importer;
      /** The vault's link index, which reads notes in the background. */
      readonly indexer: Indexer;
    }
  | { readonly status: "failed"; readonly error: Error };

export function useVault(info: VaultInfo): VaultState {
  const [state, setState] = useState<VaultState>({ status: "opening" });

  useEffect(() => {
    const controller = new AbortController();
    // A function, so each await reads the signal again.
    const aborted = () => controller.signal.aborted;
    let closeStore: (() => Promise<void>) | undefined;
    let indexer: Indexer | undefined;
    void (async () => {
      try {
        const { files, store, media, exporter, importer } = await backend.connect(info);
        backend.mark("store-open");
        closeStore = () => store.close();
        if (aborted()) {
          await store.close();
          return;
        }
        const vault = new Vault(files, store);
        await vault.open();
        backend.mark("vault-listed");
        if (aborted()) return;
        indexer = new Indexer(
          vault,
          new Worker(new URL("./indexer.worker.ts", import.meta.url), { type: "module" }),
        );
        // The vault shows at once; the view starts its links loading.
        setState({ status: "open", vault, media, exporter, importer, indexer });
        backend.mark("vault-open");
        // The page's heap as the vault settles, for the memory target.
        for (const seconds of [10, 30, 60]) {
          setTimeout(() => {
            const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
            if (heap === undefined) return;
            backend.mark(`heap-mb-${String(Math.round(heap.usedJSHeapSize / 2 ** 20))}`);
          }, seconds * 1000);
        }
        // What has been in the trash too long goes; what cannot is tried again next time.
        vault.purgeTrash().catch(() => undefined);
        // And notes' versions older than this device keeps them (ADR 0041).
        vault.purgeHistory().catch(() => undefined);
        // When another app's change is in the index, for measuring how soon.
        await vault.watch(controller.signal, () => {
          backend.mark("change-applied");
        });
      } catch (error) {
        if (!aborted()) {
          setState({
            status: "failed",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    })();
    return () => {
      controller.abort();
      indexer?.stop();
      void closeStore?.();
    };
  }, [info]);

  return state;
}

const none: readonly NoteEntry[] = [];

/** The vault's notes, kept current as they change. */
export function useNotes(vault: Vault | undefined): readonly NoteEntry[] {
  return useSyncExternalStore(
    (listener) => vault?.subscribe(listener) ?? (() => undefined),
    () => vault?.notes() ?? none,
  );
}
