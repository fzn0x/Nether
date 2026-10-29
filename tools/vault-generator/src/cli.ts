// Writes the reference vault:
//   pnpm vault:generate                         50,000 notes, seed 1, into .vaults/reference
//   pnpm vault:generate --notes 1000 --seed 7 --out .vaults/small
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeVault } from "./write.ts";

const usage = `Usage: pnpm vault:generate [--notes 50000] [--seed 1] [--out .vaults/reference]`;

function wholeNumber(name: string, value: string, max: number): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number > max) {
    throw new Error(`--${name} must be a whole number up to ${String(max)}, not "${value}"`);
  }
  return number;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      notes: { type: "string", default: "50000" },
      seed: { type: "string", default: "1" },
      out: { type: "string", default: ".vaults/reference" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const notes = wholeNumber("notes", values.notes, 1_000_000);
  if (notes < 1) throw new Error("--notes must be at least 1");
  const seed = wholeNumber("seed", values.seed, 2 ** 32 - 1);
  // pnpm runs scripts in the package's folder; INIT_CWD is where it was called.
  const folder = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);

  const started = performance.now();
  const manifest = await writeVault({ notes, seed }, folder);
  const seconds = (performance.now() - started) / 1000;
  const { stats } = manifest;
  console.log(
    `Wrote ${String(stats.notes)} notes (${(stats.bytes / 1e6).toFixed(1)} MB, ` +
      `${String(stats.links)} links, ${String(stats.folders)} folders) ` +
      `to ${folder} in ${seconds.toFixed(1)} s.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exitCode = 1;
});
