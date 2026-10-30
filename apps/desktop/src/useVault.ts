// Opens a vault for the interface: connects to its files and index, brings
// the index up to date, follows the folder's changes, and re-renders when
// its notes change.
import { type NoteEntry, Vault } from "@nether/storage";
import { useEffect, useState, useSyncExternalStore } from "react";
import { backend } from "./backend.ts";
import type { VaultInfo } from "./mygo.ts";

export type VaultState =
  | { readonly status: "opening" }
  | { readonly status: "open"; readonly vault: Vault }
  | { readonly status: "failed"; readonly error: Error };

export function useVault(info: VaultInfo): VaultState {
  const [state, setState] = useState<VaultState>({ status: "opening" });

  useEffect(() => {
    const controller = new AbortController();
    // A function, so each await reads the signal again.
    const aborted = () => controller.signal.aborted;
    let closeStore: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        const { files, store } = await backend.connect(info);
        closeStore = () => store.close();
        if (aborted()) {
          await store.close();
          return;
        }
        const vault = new Vault(files, store);
        await vault.open();
        if (aborted()) return;
        setState({ status: "open", vault });
        await vault.watch(controller.signal);
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
