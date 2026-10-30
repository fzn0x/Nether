# @nether/storage

A vault's files and its local index, for every client. The platform gives
access to the folder (`VaultFiles`: the desktop's Go service, or
`MemoryFiles` in the browser preview and tests) and a place for the index
(`IndexStore`: `SqliteStore` on the desktop, `MemoryStore` elsewhere).
`Vault` ties them together, as
[ADR 0007](../../docs/adr/0007-vault-folder-and-local-index.md) records:

```ts
import { Vault } from "@nether/storage";

const vault = new Vault(files, store);
await vault.open(); // loads the index, then catches up with the folder
vault.notes(); // every note, sorted as a file explorer sorts them
const off = vault.subscribe(() => render(vault.notes()));
void vault.watch(signal); // follows other apps' changes until signal aborts

const { text, hash } = await vault.read(id);
await vault.write(id, edited, hash); // refused if the file changed meanwhile
```

## How it is built

| File | What it does |
| --- | --- |
| `src/files.ts` | The file types and the `VaultFiles` interface a platform implements |
| `src/store.ts` | The index's records, the `IndexStore` interface, and `MemoryStore` |
| `src/sqlite.ts` | `SqliteStore` and its migrations, on any SQLite with MyGO's plugin's API |
| `src/memory.ts` | `MemoryFiles`, a vault folder in memory that behaves as the Go service does |
| `src/vault.ts` | `Vault`: reconciling, watching, and reading and writing notes |

## Tests

`pnpm test` runs the SQLite store on Node's built-in `node:sqlite`
(Node.js 22.13 or newer), and the vault against `MemoryFiles`: catching up
after changes made while it was closed, renames as a rename or as a removal
and a creation, folders moved and removed, the trash, and its own writes
coming back from the watch.
