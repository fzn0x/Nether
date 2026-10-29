// Generates the reference vault that performance tests run against: plain
// Markdown files laid out and linked the way real vaults are. The same seed
// and size always give the same files, byte for byte.
import { PowerLaw, Random } from "./random.ts";
import { adjectives, calloutKinds, languages, nouns, tags, verbs } from "./words.ts";

/** Bumped whenever the output for a given seed and size changes. */
export const generatorVersion = 1;

export interface VaultOptions {
  /** How many notes to write. */
  readonly notes: number;
  readonly seed: number;
}

export interface VaultFile {
  /** The path inside the vault, with forward slashes. */
  readonly path: string;
  readonly content: string;
}

export interface VaultStats {
  notes: number;
  dailyNotes: number;
  databaseRows: number;
  folders: number;
  bytes: number;
  links: number;
  unresolvedLinks: number;
  embeds: number;
  tags: number;
  tasks: number;
}

interface Database {
  readonly name: string;
  readonly properties: (random: Random, link: () => string) => string[];
}

interface Plan {
  readonly title: string;
  readonly folder: string;
  readonly kind: "note" | "daily" | "row";
  readonly database?: Database;
  /** A block other notes link to with [[title^id]], when the note has one. */
  readonly blockId?: string;
}

const databases: readonly Database[] = [
  {
    name: "Tasks",
    properties: (random, link) => [
      `status: ${random.pick(["Todo", "Doing", "Done"])}`,
      `due: ${date(random.int(0, 1460))}`,
      `priority: ${String(random.int(1, 3))}`,
      `done: ${String(random.chance(0.4))}`,
      `project: "${link()}"`,
    ],
  },
  {
    name: "Books",
    properties: (random) => [
      `author: ${capitalize(random.pick(adjectives))} ${capitalize(random.pick(nouns))}`,
      `rating: ${String(random.int(1, 5))}`,
      `finished: ${date(random.int(0, 1460))}`,
      `tags: [reading, ${random.pick(["fiction", "history", "science", "design"])}]`,
    ],
  },
  {
    name: "Meetings",
    properties: (random, link) => [
      `date: ${date(random.int(0, 1460))}T${pad(random.int(8, 17))}:${random.pick(["00", "30"])}`,
      `attendees: [${Array.from({ length: random.int(1, 4) }, () => `"${link()}"`).join(", ")}]`,
      `recorded: ${String(random.chance(0.3))}`,
    ],
  },
  {
    name: "People",
    properties: (random) => [
      `role: ${capitalize(random.pick(nouns))} ${random.pick(["lead", "owner", "advisor", "partner"])}`,
      `met: ${date(random.int(0, 1460))}`,
      "tags: [person]",
    ],
  },
  {
    name: "Projects",
    properties: (random) => [
      `status: ${random.pick(["Planned", "Active", "Paused", "Shipped"])}`,
      `start: ${date(random.int(0, 1200))}`,
      `end: ${date(random.int(1200, 1460))}`,
      `budget: ${String(random.int(1, 400) * 250)}`,
    ],
  },
];

const topFolders = ["Projects", "Areas", "Resources", "Archive"] as const;
const firstDay = Date.UTC(2023, 0, 2);

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The date `days` after 2 January 2023, as YYYY-MM-DD. */
function date(days: number): string {
  return new Date(firstDay + days * 86_400_000).toISOString().slice(0, 10);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A name not taken yet, compared without case, as file systems on Windows and macOS compare. */
function uniqueName(random: Random, taken: Set<string>): string {
  const base = `${capitalize(random.pick(adjectives))} ${random.pick(nouns)}`;
  let name = base;
  for (let count = 2; taken.has(name.toLowerCase()); count++) name = `${base} ${String(count)}`;
  taken.add(name.toLowerCase());
  return name;
}

function planVault(random: Random, total: number, stats: VaultStats): Plan[] {
  const taken = new Set<string>();
  const daily = Math.min(Math.round(total * 0.03), 1460);
  const rowsPerDatabase = Math.floor((total * 0.1) / databases.length);
  const notes = total - daily - rowsPerDatabase * databases.length;

  const folders = Array.from({ length: Math.max(1, Math.round(notes / 250)) }, () => {
    const name = uniqueName(random, taken);
    return `${random.pick(topFolders)}/${name}`;
  });

  const plans: Plan[] = [];
  for (let index = 0; index < notes; index++) {
    const title = uniqueName(random, taken);
    const folder = random.chance(0.1) ? random.pick(topFolders) : random.pick(folders);
    const blockId = random.chance(0.2) ? `ref-${index.toString(36)}` : undefined;
    plans.push({ title, folder, kind: "note", ...(blockId === undefined ? {} : { blockId }) });
  }
  for (let day = 0; day < daily; day++) {
    const title = date(day);
    taken.add(title);
    plans.push({ title, folder: `Daily/${title.slice(0, 4)}`, kind: "daily" });
  }
  for (const database of databases) {
    for (let row = 0; row < rowsPerDatabase; row++) {
      const title = uniqueName(random, taken);
      plans.push({ title, folder: `Databases/${database.name}`, kind: "row", database });
    }
  }
  // Every folder that holds notes, and the folders above it.
  const directories = new Set<string>();
  for (const plan of plans) {
    const parts = plan.folder.split("/");
    for (let depth = 1; depth <= parts.length; depth++)
      directories.add(parts.slice(0, depth).join("/"));
  }
  stats.folders = directories.size;
  return plans;
}

/** Generates the vault's files in a fixed order, and fills `stats` as it goes. */
export function* generateVault(
  options: VaultOptions,
  stats: VaultStats = emptyStats(),
): Generator<VaultFile> {
  if (!Number.isInteger(options.notes) || options.notes < 1) {
    throw new RangeError("notes must be a whole number of at least 1");
  }
  const random = new Random(options.seed);
  const plans = planVault(random, options.notes, stats);

  // Shuffle which notes are the popular ones, so they are spread across
  // folders rather than being the first notes planned.
  const order = plans.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const other = random.int(0, index);
    [order[index], order[other]] = [order[other] ?? 0, order[index] ?? 0];
  }
  const popularity = new PowerLaw(plans.length);

  const target = (): Plan => {
    const plan = plans[order[popularity.sample(random)] ?? 0];
    if (plan === undefined) throw new Error("no note to link to");
    return plan;
  };

  const link = (): string => {
    stats.links++;
    if (random.chance(0.01)) {
      stats.unresolvedLinks++;
      return `[[Unwritten ${random.pick(nouns)} ${random.pick(nouns)}]]`;
    }
    const plan = target();
    const roll = random.next();
    if (roll < 0.1 && plan.kind === "note") return `[[${plan.title}#Summary]]`;
    if (roll < 0.15 && plan.blockId !== undefined) return `[[${plan.title}^${plan.blockId}]]`;
    if (roll < 0.3) return `[[${plan.title}|${random.pick(adjectives)} ${random.pick(nouns)}]]`;
    return `[[${plan.title}]]`;
  };

  const sentence = (): string => {
    const subject = `${random.pick(["The", "A", "Every", "This"])} ${random.pick(adjectives)} ${random.pick(nouns)}`;
    const object = `the ${random.pick(adjectives)} ${random.pick(nouns)}`;
    let text = `${subject} ${random.pick(verbs)} ${object}`;
    if (random.chance(0.22)) text += ` with ${link()}`;
    if (random.chance(0.05)) {
      stats.tags++;
      text += ` #${random.pick(tags)}`;
    }
    return `${text}.`;
  };

  const paragraph = (sentences = random.int(3, 6)): string =>
    Array.from({ length: sentences }, sentence).join(" ");

  const list = (task: boolean): string =>
    Array.from({ length: random.int(2, 6) }, () => {
      const marker = task ? `- [${random.chance(0.4) ? "x" : " "}] ` : "- ";
      if (task) stats.tasks++;
      const nested = !task && random.chance(0.2) ? `\n  - ${sentence()}` : "";
      return `${marker}${sentence()}${nested}`;
    }).join("\n");

  const section = (): string => {
    const roll = random.next();
    if (roll < 0.45) return paragraph();
    if (roll < 0.6) return list(false);
    if (roll < 0.7) return list(true);
    if (roll < 0.76) return `> ${paragraph(2)}`;
    if (roll < 0.82)
      return `> [!${random.pick(calloutKinds)}] ${capitalize(random.pick(nouns))}\n> ${paragraph(2)}`;
    if (roll < 0.87) {
      const language = random.pick(languages);
      return `\`\`\`${language}\n${random.pick(nouns)} = ${String(random.int(1, 999))}\n\`\`\``;
    }
    if (roll < 0.91) {
      const rows = Array.from(
        { length: random.int(2, 5) },
        () =>
          `| ${capitalize(random.pick(nouns))} | ${String(random.int(1, 99))} | ${random.pick(adjectives)} |`,
      );
      return ["| Item | Count | Note |", "| --- | ---: | --- |", ...rows].join("\n");
    }
    if (roll < 0.94)
      return `$$\n${random.pick(["a^2 + b^2 = c^2", "e^{i\\pi} + 1 = 0", "\\sum_{k=1}^{n} k"])}\n$$`;
    if (roll < 0.96) {
      stats.embeds++;
      return `![[${target().title}]]`;
    }
    return paragraph(1);
  };

  for (const plan of plans) {
    const blocks: string[] = [];
    if (plan.kind === "note") {
      const front: string[] = [];
      if (random.chance(0.4)) {
        front.push(`tags: [${random.pick(tags)}, ${random.pick(tags)}]`);
        stats.tags += 2;
        if (random.chance(0.15)) front.push(`aliases: [${capitalize(random.pick(nouns))} notes]`);
        front.push(`created: ${date(random.int(0, 1460))}`);
      }
      if (front.length > 0) blocks.push(["---", ...front, "---"].join("\n"));
      if (random.chance(0.3)) blocks.push(`# ${plan.title}`);
      blocks.push(paragraph());
      const summary = paragraph(random.int(1, 3));
      blocks.push(
        "## Summary",
        plan.blockId === undefined ? summary : `${summary} ^${plan.blockId}`,
      );
      const length = random.next();
      const sections =
        length < 0.4 ? random.int(2, 3) : length < 0.85 ? random.int(4, 7) : random.int(8, 16);
      for (let index = 0; index < sections; index++) {
        if (random.chance(0.3))
          blocks.push(`## ${capitalize(random.pick(adjectives))} ${random.pick(nouns)}`);
        blocks.push(section());
      }
    } else if (plan.kind === "daily") {
      blocks.push("## Log", list(false), "## Tasks", list(true));
      if (random.chance(0.5)) blocks.push("## Notes", paragraph());
    } else {
      const database = plan.database;
      if (database === undefined) throw new Error("a row needs its database");
      blocks.push(["---", ...database.properties(random, link), "---"].join("\n"));
      blocks.push(paragraph(random.int(1, 3)));
    }

    const content = `${blocks.join("\n\n")}\n`;
    stats.notes++;
    if (plan.kind === "daily") stats.dailyNotes++;
    if (plan.kind === "row") stats.databaseRows++;
    stats.bytes += new TextEncoder().encode(content).length;
    yield { path: `${plan.folder}/${plan.title}.md`, content };
  }
}

export function emptyStats(): VaultStats {
  return {
    notes: 0,
    dailyNotes: 0,
    databaseRows: 0,
    folders: 0,
    bytes: 0,
    links: 0,
    unresolvedLinks: 0,
    embeds: 0,
    tags: 0,
    tasks: 0,
  };
}
