// The previews of a vault's web links: fetched when the user asks, by the
// app, and kept in the vault's `.nether/previews.json`, so a note shows
// them again without reaching the page's server.
import type { LinkPreview, LinkPreviews } from "@nether/editor";
import type { Vault } from "@nether/storage";
import { backend } from "./backend.ts";

const previewsName = "previews";

function readPreviews(value: unknown): Map<string, LinkPreview> {
  const previews = new Map<string, LinkPreview>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return previews;
  for (const [url, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { title, description, site } = entry as Record<string, unknown>;
    previews.set(url, {
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof description === "string" ? { description } : {}),
      ...(typeof site === "string" ? { site } : {}),
    });
  }
  return previews;
}

const byVault = new WeakMap<Vault, LinkPreviews>();

/** The previews of a vault's web links, one set however many notes show them. */
export function linkPreviews(vault: Vault): LinkPreviews {
  let previews = byVault.get(vault);
  if (previews !== undefined) return previews;
  let kept = new Map<string, LinkPreview>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  void vault.readData(previewsName).then((data) => {
    kept = new Map([...readPreviews(data), ...kept]);
    changed();
  });
  previews = {
    get: (url) => kept.get(url),
    async fetch(url) {
      const preview = await backend.fetchPreview(url);
      kept.set(url, preview);
      changed();
      await vault.writeData(previewsName, Object.fromEntries(kept));
      return preview;
    },
    open(url) {
      void backend.openUrl(url);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  byVault.set(vault, previews);
  return previews;
}
