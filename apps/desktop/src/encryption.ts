// Encrypted workspaces in the desktop app (ADR 0038): turning encryption on
// for an account, with its recovery phrase; unlocking it on another device
// with the phrase; making an encrypted workspace; opening a workspace's key
// to sync it; and sealing it for members who wait for it. The account's
// private key stays in the system's keychain. This module, with libsodium,
// loads only when encryption is used.
import {
  type SyncOptions,
  isRecoveryPhrase,
  keyPairOf,
  lockPrivateKey,
  newKeyPair,
  newRecoveryPhrase,
  newWorkspaceKey,
  openKey,
  sealKey,
  unlockPrivateKey,
} from "@nether/sync-client";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import {
  type Workspace,
  accountKeys,
  keylessMembers,
  makeWorkspace,
  saveAccountKeys,
  sealForMember,
  sealedWorkspaceKey,
} from "./server.ts";

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A key pair and its recovery phrase, made but not yet kept: the person writes the phrase down first. */
export interface PreparedKeys {
  readonly phrase: string;
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly recoveryBox: Uint8Array;
}

export async function prepareKeys(userId: string): Promise<PreparedKeys> {
  const pair = await newKeyPair();
  const phrase = newRecoveryPhrase();
  return { phrase, ...pair, recoveryBox: await lockPrivateKey(pair.privateKey, phrase, userId) };
}

/** Keeps prepared keys: the public key and the box on the server, the private key in the keychain. */
export async function keepKeys(server: string, token: string, keys: PreparedKeys): Promise<void> {
  await saveAccountKeys(backend.serverFetch, server, token, {
    publicKey: toBase64(keys.publicKey),
    recoveryBox: toBase64(keys.recoveryBox),
  });
  await backend.saveServerKey(server, keys.privateKey);
}

/** Opens the account's private key with its recovery phrase, and keeps it on this device. */
export async function unlockKeys(
  server: string,
  token: string,
  userId: string,
  phrase: string,
): Promise<void> {
  if (!isRecoveryPhrase(phrase)) throw new Error(t("recoveryPhraseInvalid"));
  const keys = await accountKeys(backend.serverFetch, server, token);
  if (keys === undefined) throw new Error(t("encryptionOff"));
  let privateKey: Uint8Array;
  try {
    privateKey = await unlockPrivateKey(fromBase64(keys.recoveryBox), phrase, userId);
  } catch {
    throw new Error(t("recoveryPhraseWrong"));
  }
  await backend.saveServerKey(server, privateKey);
}

async function keyPair(server: string) {
  const privateKey = await backend.serverKey(server);
  if (privateKey === undefined) throw new Error(t("encryptionLocked"));
  return keyPairOf(privateKey);
}

/** Makes a workspace encrypted from the start, its key sealed to its maker. */
export async function makeEncryptedWorkspace(
  server: string,
  token: string,
  name: string,
): Promise<Workspace> {
  const pair = await keyPair(server);
  const sealed = await sealKey(await newWorkspaceKey(), pair.publicKey);
  return makeWorkspace(backend.serverFetch, server, token, name, toBase64(sealed));
}

/** The keys an encrypted workspace syncs with, opened with this device's private key. */
export async function workspaceEncryption(
  server: string,
  token: string,
  workspaceId: string,
): Promise<NonNullable<SyncOptions["encryption"]>> {
  const pair = await keyPair(server);
  const sealed = await sealedWorkspaceKey(backend.serverFetch, server, token, workspaceId);
  if (sealed === undefined) throw new Error(t("encryptionWaiting"));
  const key = await openKey(fromBase64(sealed.sealedKey), pair);
  return { key: { version: sealed.version, key }, keys: new Map([[sealed.version, key]]) };
}

/** Seals the workspace's key for each member waiting for it; gives how many there were. */
export async function shareWorkspaceKey(
  server: string,
  token: string,
  workspaceId: string,
  encryption: NonNullable<SyncOptions["encryption"]>,
): Promise<number> {
  const waiting = await keylessMembers(backend.serverFetch, server, token, workspaceId);
  for (const member of waiting) {
    const key = encryption.keys.get(member.version);
    if (key === undefined) continue;
    const sealed = await sealKey(key, fromBase64(member.publicKey));
    await sealForMember(backend.serverFetch, server, token, workspaceId, member.userId, {
      version: member.version,
      sealedKey: toBase64(sealed),
    });
  }
  return waiting.length;
}
