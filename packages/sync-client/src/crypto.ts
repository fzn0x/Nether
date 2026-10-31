// The cryptography of encrypted workspaces (ADR 0038), with libsodium:
//
// - an account's X25519 key pair, its private key in a box that a key from
//   its 24-word recovery phrase (BIP39's English list) opens;
// - a workspace's key, sealed to each member's public key;
// - each Yjs update, encrypted with XChaCha20-Poly1305 under the workspace's
//   key, its document's name as additional data:
//   [format 1 byte][key version 4 bytes][nonce 24 bytes][ciphertext];
// - each attachment, in the same format, its nonce a keyed hash of its
//   bytes, so a file encrypts the same way each time and is kept once.
import {
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import sodium from "libsodium-wrappers";

/** The format of a private key's box, and of an encrypted update. */
const format = 1;
/** What the recovery key is derived under, so it serves nothing else. */
const recoveryContext = "nether recovery key 1";
/** What the key of attachments' nonces is derived under. */
const fileNonceContext = "nether attachment nonce 1";
/** The additional data of an attachment, which no update has. */
const fileData = "nether attachment";

async function ready(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

export interface KeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

/** A new key pair for an account. */
export async function newKeyPair(): Promise<KeyPair> {
  const lib = await ready();
  const { publicKey, privateKey } = lib.crypto_box_keypair();
  return { publicKey, privateKey };
}

/** The key pair a private key makes, its public key worked out from it. */
export async function keyPairOf(privateKey: Uint8Array): Promise<KeyPair> {
  const lib = await ready();
  return { publicKey: lib.crypto_scalarmult_base(privateKey), privateKey };
}

/** A new recovery phrase: 24 words, 256 random bits. */
export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

/** A phrase as someone types it: lowercase, one space between words. */
function tidy(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

/** Whether a phrase is a recovery phrase: its words in the list, its checksum right. */
export function isRecoveryPhrase(phrase: string): boolean {
  const words = tidy(phrase);
  return words.split(" ").length === 24 && validateMnemonic(words, wordlist);
}

/** The key a recovery phrase gives, for a private key's box. */
async function recoveryKey(phrase: string): Promise<Uint8Array> {
  const lib = await ready();
  if (!isRecoveryPhrase(phrase)) throw new Error("That is not a recovery phrase.");
  const entropy = mnemonicToEntropy(tidy(phrase), wordlist);
  // The phrase's bits are random: a keyed hash is enough to make a key of them.
  return lib.crypto_generichash(32, entropy, lib.from_string(recoveryContext));
}

/** The additional data of an account's private key's box: it opens for that account only. */
function boxData(userId: string): Uint8Array {
  return sodium.from_string(`nether private key ${userId}`);
}

/** A private key in a box only the recovery phrase opens, for the server to keep. */
export async function lockPrivateKey(
  privateKey: Uint8Array,
  phrase: string,
  userId: string,
): Promise<Uint8Array> {
  const lib = await ready();
  const key = await recoveryKey(phrase);
  const nonce = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const sealed = lib.crypto_aead_xchacha20poly1305_ietf_encrypt(
    privateKey,
    boxData(userId),
    null,
    nonce,
    key,
  );
  return concat(new Uint8Array([format]), nonce, sealed);
}

/** Opens a private key's box with the recovery phrase; it throws for another phrase. */
export async function unlockPrivateKey(
  box: Uint8Array,
  phrase: string,
  userId: string,
): Promise<Uint8Array> {
  const lib = await ready();
  const key = await recoveryKey(phrase);
  const nonceLength = lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  if (box[0] !== format || box.length < 1 + nonceLength) {
    throw new Error("That is not a private key's box.");
  }
  try {
    return lib.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      box.subarray(1 + nonceLength),
      boxData(userId),
      box.subarray(1, 1 + nonceLength),
      key,
    );
  } catch {
    throw new Error("That recovery phrase does not open this account's key.");
  }
}

/** The 24 words a phrase's bits make again, as a check of what was typed. */
export function recoveryWords(phrase: string): readonly string[] {
  return entropyToMnemonic(mnemonicToEntropy(tidy(phrase), wordlist), wordlist).split(" ");
}

/** A new key for a workspace. */
export async function newWorkspaceKey(): Promise<Uint8Array> {
  const lib = await ready();
  return lib.crypto_aead_xchacha20poly1305_ietf_keygen();
}

/** A workspace's key, sealed to a member's public key: only their private key opens it. */
export async function sealKey(key: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
  const lib = await ready();
  return lib.crypto_box_seal(key, publicKey);
}

/** Opens a workspace's key sealed to this key pair. */
export async function openKey(sealed: Uint8Array, keyPair: KeyPair): Promise<Uint8Array> {
  const lib = await ready();
  try {
    return lib.crypto_box_seal_open(sealed, keyPair.publicKey, keyPair.privateKey);
  } catch {
    throw new Error("This workspace's key was not sealed to this account's key.");
  }
}

/** A workspace's key and its version. */
export interface WorkspaceKey {
  readonly version: number;
  readonly key: Uint8Array;
}

/** An update, encrypted for the document it belongs to. */
export async function encryptUpdate(
  update: Uint8Array,
  key: WorkspaceKey,
  name: string,
): Promise<Uint8Array> {
  const lib = await ready();
  const nonce = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  return seal(lib, update, key, name, nonce);
}

/**
 * An update decrypted with the workspace's key of its version; it throws
 * if the key is not there, or the update was changed or made for another document.
 */
export async function decryptUpdate(
  data: Uint8Array,
  keys: ReadonlyMap<number, Uint8Array>,
  name: string,
): Promise<Uint8Array> {
  return open(await ready(), data, keys, name, {
    format: "That is not an encrypted update.",
    key: `An update of ${name} does not open with this workspace's key.`,
  });
}

/**
 * An attachment's bytes, encrypted. Its nonce is a hash of the bytes,
 * keyed by a key derived from the workspace's: the same file encrypts the
 * same way, so the server keeps it once, and only members can tell which
 * file it is.
 */
export async function encryptFile(data: Uint8Array, key: WorkspaceKey): Promise<Uint8Array> {
  const lib = await ready();
  const nonceKey = lib.crypto_generichash(32, key.key, lib.from_string(fileNonceContext));
  const nonce = lib.crypto_generichash(
    lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    data,
    nonceKey,
  );
  return seal(lib, data, key, fileData, nonce);
}

/** An attachment decrypted with the workspace's key of its version; it throws as `decryptUpdate` does. */
export async function decryptFile(
  data: Uint8Array,
  keys: ReadonlyMap<number, Uint8Array>,
): Promise<Uint8Array> {
  return open(await ready(), data, keys, fileData, {
    format: "That is not an encrypted file.",
    key: "A file does not open with this workspace's key.",
  });
}

/** Bytes encrypted under a workspace's key, in the format above. */
function seal(
  lib: typeof sodium,
  data: Uint8Array,
  key: WorkspaceKey,
  additional: string,
  nonce: Uint8Array,
): Uint8Array {
  const header = new Uint8Array(5);
  header[0] = format;
  new DataView(header.buffer).setUint32(1, key.version);
  const sealed = lib.crypto_aead_xchacha20poly1305_ietf_encrypt(
    data,
    lib.from_string(additional),
    null,
    nonce,
    key.key,
  );
  return concat(header, nonce, sealed);
}

/** What `seal` made, opened with the key of its version; it throws with `fails`' messages. */
function open(
  lib: typeof sodium,
  data: Uint8Array,
  keys: ReadonlyMap<number, Uint8Array>,
  additional: string,
  fails: { readonly format: string; readonly key: string },
): Uint8Array {
  const nonceLength = lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  if (data[0] !== format || data.length < 5 + nonceLength) throw new Error(fails.format);
  const version = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1);
  const key = keys.get(version);
  if (key === undefined) throw new Error(`This device has no key of version ${String(version)}.`);
  try {
    return lib.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      data.subarray(5 + nonceLength),
      lib.from_string(additional),
      data.subarray(5, 5 + nonceLength),
      key,
    );
  } catch {
    throw new Error(fails.key);
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}
