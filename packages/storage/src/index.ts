export {
  ChangedOnDisk,
  type FileEvent,
  type FileInfo,
  type FileOp,
  type FileText,
  type VaultFiles,
  folderOf,
  isInside,
  isNotePath,
  noteTitle,
} from "./files.ts";
export { LinkIndex, normalizeLink } from "./links.ts";
export { MemoryFiles, sha256 } from "./memory.ts";
export {
  type Database,
  type SqlValue,
  type Statement,
  SqliteStore,
  migrate,
  schemaVersion,
} from "./sqlite.ts";
export {
  type FileRecord,
  type IndexChange,
  type IndexStore,
  MemoryStore,
  type NoteIndexRow,
  type StoredDocument,
  type StoredUpdate,
} from "./store.ts";
export {
  type NoteDocuments,
  type NoteEntry,
  Vault,
  type VaultOptions,
  matchMoves,
} from "./vault.ts";
