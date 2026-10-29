// Stable IDs. Notes, workspaces and views get UUIDs; blocks get short IDs in
// the form Obsidian writes as `^id`, unique within their note.
import { fail, readString } from "./read.ts";

declare const brand: unique symbol;
type Branded<T, Name extends string> = T & { readonly [brand]: Name };

/** A note's ID: a UUID that never changes, whatever its title or path. */
export type NoteId = Branded<string, "NoteId">;
/** A workspace's (vault's) ID: a UUID. */
export type WorkspaceId = Branded<string, "WorkspaceId">;
/** A database view's ID: a UUID. */
export type ViewId = Branded<string, "ViewId">;
/** A block's ID: letters, digits and dashes, unique within its note. */
export type BlockId = Branded<string, "BlockId">;

// The Web Crypto API, which browsers, Node.js and the desktop webviews share.
interface RandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T;
}
const { crypto } = globalThis as unknown as { crypto: RandomSource };

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether a string is a UUID in canonical form: lowercase, with an RFC 9562 version and variant. */
export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

const maxTimestamp = 2 ** 48 - 1;

/**
 * A UUID version 7 (RFC 9562): 48 bits of Unix time in milliseconds, then
 * random bits, so IDs created later sort later.
 */
export function uuidV7(now: number = Date.now(), random: Uint8Array = randomBytes(10)): string {
  if (!Number.isInteger(now) || now < 0 || now > maxTimestamp) {
    throw new RangeError(`uuidV7 needs a time from 0 to ${String(maxTimestamp)} ms`);
  }
  if (random.length < 10) throw new RangeError("uuidV7 needs 10 random bytes");
  const bytes = new Uint8Array(16);
  let time = now;
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
  bytes.set(random.subarray(3, 10), 9);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function newNoteId(): NoteId {
  return uuidV7() as NoteId;
}

export function newWorkspaceId(): WorkspaceId {
  return uuidV7() as WorkspaceId;
}

export function newViewId(): ViewId {
  return uuidV7() as ViewId;
}

const blockIdPattern = /^[A-Za-z0-9-]{1,64}$/;
const blockIdAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const blockIdLength = 8;

/** Whether a string can be a block ID, as Obsidian's `^id` allows: letters, digits and dashes. */
export function isBlockId(value: string): boolean {
  return blockIdPattern.test(value);
}

/** A new block ID of eight lowercase letters and digits, none of those in `taken`. */
export function newBlockId(taken: ReadonlySet<string> = new Set()): BlockId {
  for (;;) {
    let id = "";
    while (id.length < blockIdLength) {
      for (const byte of randomBytes(blockIdLength)) {
        // 252 is the largest multiple of 36 below 256: rejecting the rest
        // keeps every character equally likely.
        if (byte < 252 && id.length < blockIdLength) id += blockIdAlphabet.charAt(byte % 36);
      }
    }
    if (!taken.has(id)) return id as BlockId;
  }
}

export function readNoteId(value: unknown, path: string): NoteId {
  if (!isUuid(readString(value, path))) fail(path, "must be a note ID (a lowercase UUID)");
  return value as NoteId;
}

export function readWorkspaceId(value: unknown, path: string): WorkspaceId {
  if (!isUuid(readString(value, path))) fail(path, "must be a workspace ID (a lowercase UUID)");
  return value as WorkspaceId;
}

export function readViewId(value: unknown, path: string): ViewId {
  if (!isUuid(readString(value, path))) fail(path, "must be a view ID (a lowercase UUID)");
  return value as ViewId;
}

export function readBlockId(value: unknown, path: string): BlockId {
  if (!isBlockId(readString(value, path))) {
    fail(path, "must be a block ID: 1 to 64 letters, digits or dashes");
  }
  return value as BlockId;
}
