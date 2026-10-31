// People in properties, and what is assigned to someone: names read as
// written or as links; the names used across the vault; and the rows of
// every database, and the notes outside them, whose person properties name
// someone, each with how it stands.
import { LinkGraph, indexNote } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AssignedGroup,
  assignedTo,
  myName,
  peopleNames,
  personName,
  samePerson,
  setMyName,
  subscribeMyName,
} from "../src/people.ts";

async function setUp(files: Record<string, string>) {
  const vault = new Vault(new MemoryFiles(files), new MemoryStore());
  await vault.open();
  const graph = new LinkGraph();
  for (const note of vault.notes()) {
    const parsed = parseMarkdown(files[note.path] ?? "");
    graph.set(note.id, note.path, indexNote(parsed, parsed.writtenIds));
  }
  return { vault, graph };
}

/** Groups as their names and their notes' titles and standing, without IDs. */
function shape(groups: readonly AssignedGroup[]) {
  return groups.map((group) => ({
    database: group.database?.title,
    notes: group.notes.map(({ title, status, date }) => ({ title, status, date })),
  }));
}

const database = (properties: string) => `---
database:
  properties: ${properties}
  views:
    - name: Table
      layout: table
      visible: []
---
`;

const files = {
  "Tasks.md": database(
    "[{key: owner, type: person}, {key: status, type: select}, {key: due, type: date}]",
  ),
  "Tasks/Write the guide.md": "---\nowner: [Ana, Ben]\nstatus: Doing\ndue: 2026-11-10\n---\n",
  "Tasks/Fix the build.md": "---\nowner: ['[[ana|A.]]']\ndue: 2026-11-03\n---\n",
  "Tasks/Plan.md": "---\nowner: Ben\n---\n",
  "Clients.md": database("[{key: lead, type: person}]"),
  "Clients/Acme.md": "---\nlead: [Ana]\n---\n",
  "Notes/Call.md": "---\nwith: Ana\n---\n",
  "Notes/Elsewhere.md": "---\nowner: Ana\n---\n",
};

describe("people", () => {
  it("reads a person as a name or a link's target, alike in any case", () => {
    expect(personName(" Ana ")).toBe("Ana");
    expect(personName("[[People/Ana]]")).toBe("People/Ana");
    expect(personName("[[Ana|A.]]")).toBe("Ana");
    expect(personName("[[Ana#Contact]]")).toBe("Ana");
    expect(samePerson("[[ana]]", "Ana")).toBe(true);
    expect(samePerson("Ann", "Ana")).toBe(false);
    expect(samePerson("", "")).toBe(false);
  });

  it("gives the names person properties hold, once each", async () => {
    const { graph } = await setUp(files);
    expect(peopleNames(graph, {})).toEqual(["Ana", "Ben"]);
    expect(peopleNames(new LinkGraph(), {})).toEqual([]);
  });
});

describe("assignedTo", () => {
  it("finds a person's rows in every database, by date, and how each stands", async () => {
    const { vault, graph } = await setUp(files);
    const groups = shape(assignedTo("ana", vault.notes(), graph, {}));
    expect(groups).toEqual([
      { database: "Clients", notes: [{ title: "Acme" }] },
      {
        database: "Tasks",
        notes: [
          { title: "Fix the build", date: "2026-11-03" },
          { title: "Write the guide", status: "Doing", date: "2026-11-10" },
        ],
      },
    ]);
    expect(
      assignedTo("Ben", vault.notes(), graph, {}).flatMap((group) =>
        group.notes.map((note) => note.title),
      ),
    ).toEqual(["Write the guide", "Plan"]);
    expect(assignedTo(" ", vault.notes(), graph, {})).toEqual([]);
  });

  it("finds notes outside databases by the vault's person properties", async () => {
    const { vault, graph } = await setUp(files);
    const groups = assignedTo("Ana", vault.notes(), graph, { with: "person", owner: "person" });
    expect(shape(groups).at(-1)).toEqual({
      database: undefined,
      notes: [{ title: "Call" }, { title: "Elsewhere" }],
    });
  });
});

describe("my name", () => {
  afterEach(() => {
    setMyName("");
  });

  it("is kept, tells its listeners, and is forgotten when emptied", () => {
    let told = 0;
    const stop = subscribeMyName(() => {
      told++;
    });
    setMyName("  Ana ");
    expect(myName()).toBe("Ana");
    setMyName("");
    expect(myName()).toBe("");
    stop();
    setMyName("Ben");
    expect(told).toBe(2);
  });
});
