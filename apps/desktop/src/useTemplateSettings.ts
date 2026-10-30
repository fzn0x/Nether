// The vault's settings for templates and periodic notes, read when it
// opens: Nether's own, or Obsidian's when the vault has only those. Saving
// writes Nether's own, and never Obsidian's.
import type { Vault } from "@nether/storage";
import { useCallback, useEffect, useState } from "react";
import { type TemplateSettings, defaultSettings, readSettings } from "./templates.ts";

const settingsName = "templates";

export function useTemplateSettings(vault: Vault | undefined): {
  readonly settings: TemplateSettings;
  readonly save: (settings: TemplateSettings) => Promise<void>;
} {
  const [settings, setSettings] = useState<TemplateSettings>(defaultSettings);

  useEffect(() => {
    if (vault === undefined) return;
    let current = true;
    void Promise.all([
      vault.readData(settingsName),
      vault.readObsidianData("templates"),
      vault.readObsidianData("daily-notes"),
      vault.readObsidianData("plugins/periodic-notes/data"),
    ]).then(([own, templates, dailyNotes, periodicNotes]) => {
      if (current) setSettings(readSettings(own, { templates, dailyNotes, periodicNotes }));
    });
    return () => {
      current = false;
    };
  }, [vault]);

  const save = useCallback(
    async (next: TemplateSettings) => {
      if (vault === undefined) return;
      await vault.writeData(settingsName, next);
      setSettings(next);
    },
    [vault],
  );

  return { settings, save };
}
