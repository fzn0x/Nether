// A vault's sync with a workspace, as the desktop app keeps it (ADR 0037):
// the workspace it is linked to, what this device knows of its sync, in
// the vault's index outside its folder, and how it is going, in words. The
// engine and the vault it sees (syncVault.ts) load only for a linked vault.
import type { Vault, VaultSettings } from "@nether/storage";
import type { SyncRecord, SyncStatus, SyncStore } from "@nether/sync-client";
import { t } from "./messages.ts";

/** Which workspace of which server a vault syncs with. */
export interface VaultLink {
  /** The server, as `https://nether.example.org`. */
  readonly server: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** Whether the workspace is end-to-end encrypted, and syncs through the relay (ADR 0038). */
  readonly encrypted?: boolean;
}

const linkKey = "sync.link";
const recordKey = "sync.record";
const vaultKey = "sync.vault";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function readJson(bytes: Uint8Array | undefined): unknown {
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** The workspace this device syncs a vault with, if any. */
export async function vaultLink(vault: Vault): Promise<VaultLink | undefined> {
  const value = readJson(await vault.settings.setting(linkKey)) as Partial<VaultLink> | undefined;
  if (
    typeof value?.server !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.workspaceName !== "string"
  ) {
    return undefined;
  }
  return {
    server: value.server,
    workspaceId: value.workspaceId,
    workspaceName: value.workspaceName,
    ...(value.encrypted === true ? { encrypted: true } : {}),
  };
}

/** Links a vault to a workspace, or unlinks it, forgetting what sync knew. */
/** Where a unit's vault document is kept, besides General's (ADR 0042). */
function unitVaultKey(unit: string): string {
  return `${vaultKey}.${unit}`;
}

/** The units whose vault documents the record kept. */
function keptUnits(record: unknown): string[] {
  const ids = (record as { vaultIds?: unknown } | undefined)?.vaultIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function setVaultLink(vault: Vault, link: VaultLink | undefined): Promise<void> {
  const kept = keptUnits(readJson(await vault.settings.setting(recordKey)));
  for (const unit of kept) await vault.settings.setSetting(unitVaultKey(unit), undefined);
  await vault.settings.setSetting(recordKey, undefined);
  await vault.settings.setSetting(vaultKey, undefined);
  await vault.settings.setSetting(
    linkKey,
    link === undefined ? undefined : encoder.encode(JSON.stringify(link)),
  );
}

/**
 * Links a vault to a workspace in its index before it opens, as each of
 * the web app's vaults is its workspace (ADR 0053); one linked already is
 * left as it is.
 */
export async function linkVaultStore(store: VaultSettings, link: VaultLink): Promise<void> {
  if ((await store.setting(linkKey)) !== undefined) return;
  await store.setSetting(linkKey, encoder.encode(JSON.stringify(link)));
}

/** What sync knows between runs, in the vault's index on this device. */
export function settingsStore(vault: Vault): SyncStore {
  return {
    async load(): Promise<SyncRecord | undefined> {
      const record = readJson(await vault.settings.setting(recordKey)) as
        Partial<Omit<SyncRecord, "vault">> | undefined;
      if (record === undefined || typeof record.cursor !== "number") return undefined;
      const vaults: Record<string, Uint8Array> = {};
      for (const unit of keptUnits(record)) {
        const state = await vault.settings.setting(unitVaultKey(unit));
        if (state !== undefined) vaults[unit] = state;
      }
      return {
        cursor: record.cursor,
        base: typeof record.base === "object" ? record.base : {},
        pending: Array.isArray(record.pending) ? record.pending : [],
        ...(typeof record.files === "object" ? { files: record.files } : {}),
        vault: (await vault.settings.setting(vaultKey)) ?? null,
        // The engine reads the units again, leaving out any it cannot use.
        ...(Array.isArray(record.units) ? { units: record.units } : {}),
        vaults,
        ...(record.channel === undefined ? {} : { channel: record.channel }),
      };
    },
    async save(record: SyncRecord): Promise<void> {
      const { vault: document, vaults = {}, ...rest } = record;
      const before = keptUnits(readJson(await vault.settings.setting(recordKey)));
      const units = Object.keys(vaults);
      await vault.settings.setSetting(
        recordKey,
        encoder.encode(JSON.stringify({ ...rest, vaultIds: units })),
      );
      await vault.settings.setSetting(vaultKey, document ?? undefined);
      for (const [unit, state] of Object.entries(vaults)) {
        await vault.settings.setSetting(unitVaultKey(unit), state);
      }
      // A unit let go takes its vault document with it.
      for (const unit of before) {
        if (!units.includes(unit)) await vault.settings.setSetting(unitVaultKey(unit), undefined);
      }
    },
  };
}

/** A server's address as people know it: its host, and port if any. */
export function hostOf(url: string): string {
  return new URL(url).host;
}

/** How a linked vault's sync is going, in a few words. */
export function syncSummary(
  link: VaultLink,
  status: SyncStatus | undefined,
  signedOut: boolean,
  problem?: string,
): string {
  const values = { workspace: link.workspaceName, server: hostOf(link.server) };
  if (signedOut) return t("syncSignedOut", values);
  if (problem !== undefined) return t("syncFailed", { ...values, error: problem });
  if (status === undefined) return t("syncStarting", values);
  if (status.state === "offline") {
    return status.error === undefined
      ? t("syncOffline", values)
      : t("syncFailed", { ...values, error: status.error });
  }
  if (status.state === "syncing" || status.pending > 0) {
    return status.pending === 0
      ? t("syncSyncing", values)
      : t("syncPending", { ...values, count: status.pending });
  }
  const [file, ...others] = status.refused ?? [];
  if (file !== undefined) {
    return others.length === 0
      ? t("syncRefused", { ...values, file })
      : t("syncRefusedMore", { ...values, file, count: others.length });
  }
  return t("syncSynced", values);
}
