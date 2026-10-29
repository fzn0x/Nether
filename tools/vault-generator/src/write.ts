// Writes a generated vault to a folder, with a manifest that marks the
// folder as generated so a later run may replace it.
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type VaultOptions,
  type VaultStats,
  emptyStats,
  generateVault,
  generatorVersion,
} from "./generate.ts";

/** The manifest's file name, at the root of every generated vault. */
export const manifestName = ".nether-vault.json";

export interface Manifest {
  readonly generator: "@nether/vault-generator";
  readonly version: number;
  readonly seed: number;
  readonly notes: number;
  readonly stats: VaultStats;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes the vault to `folder`. An existing folder must be empty or hold an
 * earlier generated vault, which is replaced; anything else is refused, so
 * a mistyped path never deletes someone's notes.
 */
export async function writeVault(options: VaultOptions, folder: string): Promise<Manifest> {
  if (await exists(folder)) {
    const entries = await readdir(folder);
    if (entries.length > 0 && !entries.includes(manifestName)) {
      throw new Error(
        `${folder} is not empty and was not made by the vault generator; choose another folder.`,
      );
    }
    // Windows can hold a file for a moment after a scanner or indexer reads it.
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  await mkdir(folder, { recursive: true });

  const stats = emptyStats();
  const made = new Set<string>();
  for (const file of generateVault(options, stats)) {
    const path = join(folder, ...file.path.split("/"));
    const parent = dirname(path);
    if (!made.has(parent)) {
      await mkdir(parent, { recursive: true });
      made.add(parent);
    }
    await writeFile(path, file.content);
  }

  const manifest: Manifest = {
    generator: "@nether/vault-generator",
    version: generatorVersion,
    seed: options.seed,
    notes: options.notes,
    stats,
  };
  await writeFile(join(folder, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
