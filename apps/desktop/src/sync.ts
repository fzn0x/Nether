// A vault's sync with a workspace, as the desktop app keeps it (ADR 0037):
// the workspace it is linked to, what this device knows of its sync, in
// the vault's index outside its folder, and how it is going, in words. The
// engine and the vault it sees (syncVault.ts) load only for a linked vault.
import type { Vault } from "@nether/storage";
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
export async function setVaultLink(vault: Vault, link: VaultLink | undefined): Promise<void> {
  await vault.settings.setSetting(recordKey, undefined);
  await vault.settings.setSetting(vaultKey, undefined);
  await vault.settings.setSetting(
    linkKey,
    link === undefined ? undefined : encoder.encode(JSON.stringify(link)),
  );
}

/** What sync knows between runs, in the vault's index on this device. */
export function settingsStore(vault: Vault): SyncStore {
  return {
    async load(): Promise<SyncRecord | undefined> {
      const record = readJson(await vault.settings.setting(recordKey)) as
        Partial<Omit<SyncRecord, "vault">> | undefined;
      if (record === undefined || typeof record.cursor !== "number") return undefined;
      return {
        cursor: record.cursor,
        base: typeof record.base === "object" ? record.base : {},
        pending: Array.isArray(record.pending) ? record.pending : [],
        vault: (await vault.settings.setting(vaultKey)) ?? null,
        ...(record.channel === undefined ? {} : { channel: record.channel }),
      };
    },
    async save(record: SyncRecord): Promise<void> {
      const { vault: document, ...rest } = record;
      await vault.settings.setSetting(recordKey, encoder.encode(JSON.stringify(rest)));
      await vault.settings.setSetting(vaultKey, document ?? undefined);
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
  return t("syncSynced", values);
}
