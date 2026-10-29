// Workspaces, also called vaults: the unit of sync, permission and encryption.
import { now } from "./dates.ts";
import { type WorkspaceId, newWorkspaceId, readWorkspaceId } from "./ids.ts";
import { formatVersion, readEnvelope, readTimestamp } from "./notes.ts";
import { readFields, readName, readOneOf } from "./read.ts";

export const encryptionModes = ["none", "end-to-end"] as const;
export type EncryptionMode = (typeof encryptionModes)[number];

export interface Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  /** Whether its notes sync end-to-end encrypted, so the server stores only ciphertext. */
  readonly encryption: EncryptionMode;
  readonly created: string;
}

export function workspaceFromJson(value: unknown, path = "workspace"): Workspace {
  const fields = readFields(value, path, ["id", "name", "encryption", "created"]);
  return {
    id: readWorkspaceId(fields.id, `${path}.id`),
    name: readName(fields.name, `${path}.name`),
    encryption: readOneOf(fields.encryption, `${path}.encryption`, encryptionModes),
    created: readTimestamp(fields.created, `${path}.created`),
  };
}

export function serializeWorkspace(workspace: Workspace): string {
  const body = {
    format: "nether.workspace",
    version: formatVersion,
    workspace: workspaceFromJson(workspace),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function parseWorkspace(text: string): Workspace {
  return workspaceFromJson(readEnvelope(text, "nether.workspace", "workspace"));
}

export function createWorkspace(
  name: string,
  encryption: EncryptionMode = "none",
  at: string = now(),
): Workspace {
  return workspaceFromJson({ id: newWorkspaceId(), name, encryption, created: at });
}
