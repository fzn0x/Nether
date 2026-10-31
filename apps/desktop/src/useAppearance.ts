// A vault's appearance on the page while the vault is open: its light or
// dark, its theme and its snippets, put on when it opens, changed as the
// user changes them, and taken off when it closes.
import type { Vault } from "@nether/storage";
import { useCallback, useEffect, useState } from "react";
import {
  type Appearance,
  applyMode,
  applyStyles,
  defaultAppearance,
  loadAppearance,
  removeStyles,
  saveAppearance,
} from "./appearance.ts";

export interface AppearanceState {
  readonly appearance: Appearance;
  /** The themes and snippets it names that the vault does not have. */
  readonly missing: readonly string[];
  /** Puts an appearance on the page and keeps it for the vault; rejects with why it could not be kept. */
  readonly change: (next: Appearance) => Promise<void>;
  /** Reads the theme and snippets again, as after they are edited. */
  readonly reload: () => Promise<void>;
}

export function useAppearance(vault: Vault | undefined): AppearanceState {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  const [missing, setMissing] = useState<readonly string[]>([]);

  useEffect(() => {
    if (vault === undefined) return;
    let current = true;
    // A function, so each await reads the flag again.
    const live = () => current;
    void loadAppearance(vault).then(async (loaded) => {
      if (!live()) return;
      setAppearance(loaded);
      applyMode(loaded.mode);
      const gone = await applyStyles(vault, loaded);
      if (live()) setMissing(gone);
    });
    return () => {
      current = false;
      // Closed: the page as the app shows it without a vault.
      applyMode("system");
      removeStyles();
    };
  }, [vault]);

  const change = useCallback(
    async (next: Appearance) => {
      if (vault === undefined) return;
      setAppearance(next);
      applyMode(next.mode);
      setMissing(await applyStyles(vault, next));
      await saveAppearance(vault, next);
    },
    [vault],
  );

  const reload = useCallback(async () => {
    if (vault === undefined) return;
    setMissing(await applyStyles(vault, appearance));
  }, [vault, appearance]);

  return { appearance, missing, change, reload };
}
