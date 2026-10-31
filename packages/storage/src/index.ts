export {
  ChangedOnDisk,
  type FileBytes,
  type FileEvent,
  type FileHash,
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
  type NoteIndexData,
  type NoteIndexRow,
  type NoteTextRow,
  type NoteVersion,
  type StoredDocument,
  type StoredUpdate,
  type TextHit,
  commentsDocument,
  matchEnd,
  matchStart,
} from "./store.ts";
export {
  type TrashItem,
  defaultKeepDays,
  numberedPath,
  readTrashRecord,
  trashFolder,
} from "./trash.ts";
export {
  type NoteDocuments,
  type VaultSettings,
  type NoteEntry,
  type NoteIndexes,
  Vault,
  type VaultOptions,
  defaultHistoryDays,
  matchMoves,
  versionEvery,
} from "./vault.ts";
