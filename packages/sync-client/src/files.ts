// Attachments in the vault document (ADR 0040): a vault's files that are
// not notes, such as images and PDFs, each listed at its path with the
// SHA-256 hash of its bytes and the blob on the server that holds them. A
// file has no ID, as a note has, so a move is a removal and an addition;
// the blob, kept once per workspace, is not sent again.

import * as Y from "yjs";

/** A file the vault document lists. */
export interface VaultFile {
  /** The SHA-256 hash of its bytes, in hexadecimal. */
  readonly hash: string;
  /** Its blob on the server: the hash of its bytes, or in an encrypted workspace of their ciphertext. */
  readonly blob: string;
}

/** Files by path: each one's hash. */
export type FileHashes = ReadonlyMap<string, string>;

const sha256Hex = /^[0-9a-f]{64}$/;
/** Characters one system or another does not take in a name. */
const unsafe = /[\\:*?"<>|]/;
/** Names Windows keeps for devices, with any extension. */
const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

/**
 * Whether sync takes a file at a path: not a note, not hidden, as in
 * `.nether` or `.obsidian`, and a name every system can make. A path from
 * the server that is not is passed over, so no one writes where Nether or
 * another app keeps its settings or its plugins' code.
 */
export function isSyncedFile(path: string): boolean {
  if (/\.md$/i.test(path) || unsafe.test(path) || hasControl(path)) return false;
  return path
    .split("/")
    .every(
      (part) =>
        part !== "" &&
        !part.startsWith(".") &&
        !part.endsWith(".") &&
        !part.endsWith(" ") &&
        !reserved.test(part),
    );
}

/** Whether a text has a control character, below the space, which no name should. */
function hasControl(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) < 0x20) return true;
  }
  return false;
}

function filesOf(document: Y.Doc): Y.Map<unknown> {
  return document.getMap<unknown>("files");
}

function isVaultFile(value: unknown): value is VaultFile {
  if (typeof value !== "object" || value === null) return false;
  const { hash, blob } = value as Record<string, unknown>;
  return (
    typeof hash === "string" &&
    sha256Hex.test(hash) &&
    typeof blob === "string" &&
    sha256Hex.test(blob)
  );
}

/** The files the vault document lists, leaving out any it should not. */
export function vaultFiles(document: Y.Doc): Map<string, VaultFile> {
  const files = new Map<string, VaultFile>();
  for (const [path, value] of filesOf(document).entries()) {
    if (isSyncedFile(path) && isVaultFile(value)) {
      files.set(path, { hash: value.hash, blob: value.blob });
    }
  }
  return files;
}

/** Lists a file at a path, or its new bytes. */
export function setVaultFile(document: Y.Doc, path: string, file: VaultFile): void {
  const files = filesOf(document);
  const current = files.get(path);
  if (isVaultFile(current) && current.hash === file.hash && current.blob === file.blob) return;
  files.set(path, { hash: file.hash, blob: file.blob });
}

export function removeVaultFile(document: Y.Doc, path: string): void {
  filesOf(document).delete(path);
}

/** What to do to bring this vault's files and the server's list together. */
export interface FilePlan {
  /** Files made or changed here: sent, and listed. */
  readonly upload: readonly string[];
  /** Files made or changed elsewhere: fetched, and written here. */
  readonly download: readonly string[];
  /** Files removed here, to remove from the list. */
  readonly removeRemote: readonly string[];
  /** Files removed elsewhere, to send to the trash here. */
  readonly removeLocal: readonly string[];
  /** Files changed both here and elsewhere: this vault's moves aside, and both are kept. */
  readonly conflict: readonly string[];
}

/**
 * Compares this vault's files and the server's list with what the two last
 * agreed on, as notes are compared: a change on one side is made on the
 * other. A file removed on one side and changed on the other is kept, as
 * changed. A file changed on both sides, or made at one path on both, is
 * kept twice: the server's at its path, this vault's beside it.
 */
export function reconcileFiles(base: FileHashes, local: FileHashes, remote: FileHashes): FilePlan {
  const upload: string[] = [];
  const download: string[] = [];
  const removeRemote: string[] = [];
  const removeLocal: string[] = [];
  const conflict: string[] = [];

  for (const path of new Set([...local.keys(), ...remote.keys()])) {
    const here = local.get(path);
    const there = remote.get(path);
    const agreed = base.get(path);
    if (here === there) continue;
    if (there === undefined) {
      if (here === agreed) removeLocal.push(path);
      else upload.push(path);
    } else if (here === undefined) {
      if (there === agreed) removeRemote.push(path);
      else download.push(path);
    } else if (here === agreed) {
      download.push(path);
    } else if (there === agreed) {
      upload.push(path);
    } else {
      conflict.push(path);
    }
  }
  return { upload, download, removeRemote, removeLocal, conflict };
}

/** The first path like `path`, numbered as `photo 1.png`, that `taken` says is free. */
export function besidePath(path: string, taken: (path: string) => boolean): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, extension] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  for (let n = 1; ; n++) {
    const candidate = `${stem} ${String(n)}${extension}`;
    if (!taken(candidate)) return candidate;
  }
}

/** The SHA-256 hash of bytes, in hexadecimal. */
export async function sha256(data: Uint8Array): Promise<string> {
  // A copy: digest takes only bytes backed by an ArrayBuffer.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data.slice());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
