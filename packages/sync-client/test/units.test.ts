// Sync units (ADR 0042), through a real Nether server: a teamspace's notes
// reach its members alone, with their comments; a note moved into a
// teamspace's folder leaves the vaults of those outside it; and a guest
// syncs the page shared with them, its subpages, and nothing else.
import { afterEach, describe, expect, it } from "vitest";
import { unitForPath } from "../src/units.ts";
import { MemoryVault, database, device, startServer, stopAll, until } from "./harness.ts";

afterEach(stopAll);

type Served = Awaited<ReturnType<typeof startServer>>;

async function api(served: Served, token: string, method: string, path: string, body?: object) {
  const response = await fetch(`${served.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${String(response.status)}`);
  return response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>);
}

/** Someone who accepts an invitation, as a member, or as a guest to a page. */
async function invitee(served: Served, name: string, invitation: object = { role: "member" }) {
  const workspace = `/api/workspaces/${served.workspaceId}`;
  const invited = await api(served, served.token, "POST", `${workspace}/invitations`, invitation);
  const response = await fetch(`${served.url}/api/invitations/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: invited.token,
      name,
      email: `${name.toLowerCase()}@example.org`,
      password: `${name}'s long password`,
    }),
  });
  const body = (await response.json()) as { token: string; user: { id: string } };
  return { token: body.token, id: body.user.id };
}

async function teamspace(served: Served, name: string): Promise<string> {
  const made = await api(
    served,
    served.token,
    "POST",
    `/api/workspaces/${served.workspaceId}/teamspaces`,
    {
      name,
    },
  );
  return made.id as string;
}

async function grant(served: Served, unit: string, user: string, level: string) {
  await api(
    served,
    served.token,
    "PUT",
    `/api/workspaces/${served.workspaceId}/units/${unit}/grants/${user}`,
    {
      level,
    },
  );
}

/** Waits until the server has stored a document. */
async function untilStored(name: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const { rows } = await database().query("SELECT 1 FROM documents WHERE name = $1", [name]);
    if (rows.length > 0) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${name} to be stored`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Waits a moment more, for anything still on its way. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 1500));

describe("unitForPath", () => {
  const units = [
    { id: "general", kind: "general", level: "full", document: "vault" },
    { id: "t", kind: "team", level: "edit", document: "vault.t", name: "Design" },
    { id: "p", kind: "private", level: "full", document: "vault.p" },
    { id: "g", kind: "page", level: "view", document: "vault.g", rootNote: "launch" },
  ] as const;
  const pages = new Map([["launch", "Design/Launch.md"]]);

  it("finds the deepest area holding a path, General's otherwise", () => {
    const of = (path: string) => unitForPath(path, units, pages)?.id;
    expect(of("Ideas.md")).toBe("general");
    expect(of("Designs.md")).toBe("general");
    expect(of("Design/Plan.md")).toBe("t");
    expect(of("design/plan.md")).toBe("t");
    expect(of("Design/Launch.md")).toBe("g");
    expect(of("Design/Launch/Tasks.md")).toBe("g");
    expect(of("Design/Launcher.md")).toBe("t");
    expect(of("Private/Diary.md")).toBe("p");
    // Without General, as for a guest, a path outside every area has no unit.
    expect(unitForPath("Ideas.md", units.slice(1), pages)).toBeUndefined();
  });
});

describe("syncing units", () => {
  it("brings a teamspace's notes to its members alone", async () => {
    const served = await startServer();
    const bea = await invitee(served, "Bea");
    const cal = await invitee(served, "Cal");
    const design = await teamspace(served, "Design");
    await grant(served, design, bea.id, "edit");

    const laptop = new MemoryVault();
    laptop.write("Ideas.md", "for everyone");
    const plan = laptop.write("Design/Plan.md", "for Design");
    const first = await device(served, served.token, laptop);
    await until(() => first.engine.status.state === "synced" && first.engine.status.pending === 0);

    const beas = await device(served, bea.token);
    const cals = await device(served, cal.token);
    await until(() => beas.vault.text(plan) === "for Design" && cals.vault.notes.size === 1);
    await settle();
    expect([...cals.vault.paths().values()]).toEqual(["Ideas.md"]);
    expect(beas.vault.paths().get(plan)).toBe("Design/Plan.md");
  });

  it("brings a teamspace's notes' comments to someone let in after they were made", async () => {
    const served = await startServer();
    const cal = await invitee(served, "Cal");
    const design = await teamspace(served, "Design");
    const laptop = new MemoryVault();
    const ideas = laptop.write("Ideas.md", "for everyone");
    const plan = laptop.write("Design/Plan.md", "for Design");
    laptop.comment(plan, (threads) => {
      threads.set("t1", "a comment");
    });
    await device(served, served.token, laptop);
    await untilStored(`${plan}.comments`);
    // Cal's device lists what is stored after the comments, which it may not see yet.
    const cals = await device(served, cal.token);
    await until(() => cals.vault.text(ideas) === "for everyone");
    laptop.edit(ideas, (text) => {
      text.insert(text.length, ", still");
    });
    await until(() => cals.vault.text(ideas) === "for everyone, still");

    await grant(served, design, cal.id, "comment");
    // The next round, as one an edit brings, finds the teamspace opened.
    laptop.edit(ideas, (text) => {
      text.insert(text.length, " and on");
    });
    await until(() => cals.vault.text(plan) === "for Design");
    await until(() => cals.vault.threads(plan).t1 === "a comment");
  });

  it("takes a note moved into a teamspace's folder out of the vaults of those outside it", async () => {
    const served = await startServer();
    const bea = await invitee(served, "Bea");
    const cal = await invitee(served, "Cal");
    const design = await teamspace(served, "Design");
    await grant(served, design, bea.id, "edit");
    const laptop = new MemoryVault();
    const shared = laptop.write("Shared.md", "soon Design's");
    await device(served, served.token, laptop);
    const beas = await device(served, bea.token);
    const cals = await device(served, cal.token);
    await until(() => cals.vault.notes.has(shared) && beas.vault.notes.has(shared));

    laptop.rename(shared, "Design/Shared.md");
    await until(
      () => !cals.vault.notes.has(shared) && beas.vault.paths().get(shared) === "Design/Shared.md",
    );
  });

  it("keeps a renamed teamspace's notes in it, at their new paths, on every device", async () => {
    const served = await startServer();
    const bea = await invitee(served, "Bea");
    const cal = await invitee(served, "Cal");
    const design = await teamspace(served, "Design");
    await grant(served, design, bea.id, "edit");
    const laptop = new MemoryVault();
    const plan = laptop.write("Design/Plan.md", "the plan");
    laptop.write("Ideas.md", "for everyone");
    await device(served, served.token, laptop);
    const beas = await device(served, bea.token);
    const cals = await device(served, cal.token);
    await until(() => beas.vault.text(plan) === "the plan" && cals.vault.notes.size === 1);

    await api(
      served,
      served.token,
      "PATCH",
      `/api/workspaces/${served.workspaceId}/teamspaces/${design}`,
      {
        name: "Studio",
      },
    );
    await until(
      () =>
        laptop.paths().get(plan) === "Studio/Plan.md" &&
        beas.vault.paths().get(plan) === "Studio/Plan.md",
    );
    await settle();
    expect([...cals.vault.paths().values()]).toEqual(["Ideas.md"]);
    expect(beas.vault.text(plan)).toBe("the plan");
  });

  it("keeps a page's notes on every device when it is no longer shared on its own", async () => {
    const served = await startServer();
    const bea = await invitee(served, "Bea");
    const laptop = new MemoryVault();
    const launch = laptop.write("Projects/Launch.md", "the launch");
    const tasks = laptop.write("Projects/Launch/Tasks.md", "the tasks");
    const first = await device(served, served.token, laptop);
    const beas = await device(served, bea.token);
    await until(() => beas.vault.text(tasks) === "the tasks");

    const page = await api(
      served,
      served.token,
      "POST",
      `/api/workspaces/${served.workspaceId}/pages`,
      {
        note: launch,
      },
    );
    // Once the page's unit has its notes, it stops being shared on its own.
    await until(() => first.store.record?.vaults?.[page.id as string] !== undefined);
    await settle();
    await api(
      served,
      served.token,
      "DELETE",
      `/api/workspaces/${served.workspaceId}/pages/${String(page.id)}`,
    );
    await settle();
    await settle();
    expect(beas.vault.text(launch)).toBe("the launch");
    expect(beas.vault.text(tasks)).toBe("the tasks");
    expect(laptop.text(tasks)).toBe("the tasks");
  });

  it("gives a guest the page shared with them and its subpages, to edit and add to", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const launch = laptop.write("Projects/Launch.md", "the launch");
    const tasks = laptop.write("Projects/Launch/Tasks.md", "the tasks");
    laptop.write("Other.md", "not for guests");
    const first = await device(served, served.token, laptop);
    await until(() => first.engine.status.state === "synced" && first.engine.status.pending === 0);

    const page = await api(
      served,
      served.token,
      "POST",
      `/api/workspaces/${served.workspaceId}/pages`,
      {
        note: launch,
        restricted: true,
      },
    );
    const gus = await invitee(served, "Gus", { role: "guest", unit: page.id, level: "edit" });
    const guests = await device(served, gus.token);
    // The subpage comes once the laptop has put it in the page's unit.
    await until(
      () => guests.vault.text(launch) === "the launch" && guests.vault.text(tasks) === "the tasks",
    );
    await settle();
    expect([...guests.vault.paths().values()].sort()).toEqual([
      "Projects/Launch.md",
      "Projects/Launch/Tasks.md",
    ]);

    guests.vault.edit(tasks, (text) => {
      text.insert(text.length, ", done");
    });
    const added = guests.vault.write("Projects/Launch/Notes.md", "the guest's");
    await until(
      () => laptop.text(tasks) === "the tasks, done" && laptop.text(added) === "the guest's",
    );
  });
});
