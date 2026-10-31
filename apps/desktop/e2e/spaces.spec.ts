// Spaces and sharing, from the app (ADR 0042): making a teamspace from a
// folder, giving a member access and renaming it, making a private space;
// and sharing a page on its own, restricting it, giving a member access and
// inviting a guest. The server here is the test's.
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, fakeServer, openSample, pageErrors, violations } from "./helpers.ts";

const ada = { id: "u1", name: "Ada", email: "ada@example.org", instanceAdmin: false };
const people = [
  { ...ada, role: "owner" },
  { id: "u2", name: "Bea", email: "bea@example.org", role: "member" },
];

async function command(page: Page, name: string) {
  await page.keyboard.press("Control+p");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
}

/** Signs in to the test's server and syncs the sample vault with its empty workspace. */
async function linked(page: Page) {
  await openSample(page);
  await command(page, "servers");
  const servers = page.getByRole("dialog", { name: "Servers" });
  await servers.getByRole("textbox", { name: "Server address" }).fill("nether.test");
  await servers.getByRole("button", { name: "Continue" }).click();
  await servers.getByRole("textbox", { name: "Email address" }).fill("ada@example.org");
  await servers.getByLabel("Password").fill("a long password");
  await servers.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(servers.getByRole("status")).toHaveText("Signed in to nether.test as Ada.");
  await page.keyboard.press("Escape");
  await command(page, "sync this vault");
  const sync = page.getByRole("dialog", { name: "Sync" });
  await sync.getByRole("button", { name: "Sync this vault" }).click();
  await expect(sync.getByText("This vault syncs with Team on nether.test.")).toBeVisible();
  await sync.getByRole("button", { name: "Done" }).click();
  await expect(sync).toBeHidden();
}

const base = {
  "GET /api/sign-in-methods": () =>
    [200, { password: true, emailCode: false, oidc: null }] as const,
  "POST /api/sessions": () => [201, { token: "session-token", expiresAt: "", user: ada }] as const,
  "GET /api/me": () =>
    [200, { user: ada, workspaces: [{ id: "w", name: "Team", role: "owner" }] }] as const,
  "GET /api/workspaces/w/documents": () => [200, { documents: [], more: false }] as const,
  "GET /api/workspaces/w/members": () => [200, { members: people }] as const,
};

test("makes a teamspace from a folder, gives a member access, renames it, and a private space", async ({
  page,
}) => {
  const errors = errorsOf(page);
  let units: object[] = [{ id: "general", kind: "general", level: "full", document: "vault" }];
  let grants: object[] = [];
  const sent = await fakeServer(page, {
    ...base,
    "GET /api/workspaces/w/units": () => [200, { units }],
    "POST /api/workspaces/w/teamspaces": () => {
      units = [
        ...units,
        { id: "t", kind: "team", level: "full", document: "vault.t", name: "Projects" },
      ];
      grants = [{ user: "u1", name: "Ada", email: "ada@example.org", level: "full" }];
      return [201, { id: "t" }];
    },
    "GET /api/workspaces/w/units/t/grants": () => [
      200,
      { kind: "team", restricted: false, grants, invitations: [] },
    ],
    "PUT /api/workspaces/w/units/t/grants/u2": () => {
      grants = [...grants, { user: "u2", name: "Bea", email: "bea@example.org", level: "edit" }];
      return [200, { user: "u2", level: "edit" }];
    },
    "PATCH /api/workspaces/w/teamspaces/t": () => {
      units = units.map((unit) => ("name" in unit ? { ...unit, name: "Studio" } : unit));
      return [200, { id: "t", name: "Studio" }];
    },
    "PUT /api/workspaces/w/private": () => {
      units = [
        ...units,
        { id: "p", kind: "private", level: "full", document: "vault.p", folder: "Private" },
      ];
      return [200, { id: "p" }];
    },
  });
  await linked(page);

  await command(page, "spaces");
  const dialog = page.getByRole("dialog", { name: "Spaces of Team" });
  await expect(dialog.getByRole("list", { name: "Spaces" }).getByRole("listitem")).toHaveCount(1);
  // The sample vault's top-level folders are offered as names.
  await dialog.getByRole("combobox", { name: "New teamspace" }).fill("Projects");
  await dialog.getByRole("button", { name: "Make the teamspace" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Projects is made. Its members open the Projects folder.",
  );
  await dialog.getByRole("button", { name: "Manage Projects" }).click();
  await expect(dialog.getByRole("list", { name: "People with access of their own" })).toContainText(
    "Ada",
  );
  await dialog.getByRole("combobox", { name: "Access", exact: true }).selectOption("edit");
  await dialog.getByRole("button", { name: "Give access" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Bea has access: Can edit.");
  expect(await violations(page)).toEqual([]);

  await dialog.getByRole("textbox", { name: "New name" }).fill("Studio");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "The teamspace is now Studio, and so is its folder.",
  );
  await dialog.getByRole("button", { name: "Make my private space" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Your private space is made: the Private folder is yours alone.",
  );
  await expect(dialog.getByRole("list", { name: "Spaces" }).getByRole("listitem")).toHaveCount(3);

  const grant = sent.find(
    (request) => request.method() === "PUT" && request.url().includes("/grants/"),
  );
  expect(grant?.postDataJSON()).toEqual({ level: "edit" });
  expect(pageErrors(errors).filter((error) => !error.includes("WebSocket"))).toEqual([]);
});

test("shares a page on its own, restricts it, and invites a guest to it", async ({ page }) => {
  const errors = errorsOf(page);
  let units: object[] = [{ id: "general", kind: "general", level: "full", document: "vault" }];
  let restricted = false;
  const sent = await fakeServer(page, {
    ...base,
    "GET /api/workspaces/w/units": () => [200, { units }],
    "POST /api/workspaces/w/pages": (request) => {
      const note = (request.postDataJSON() as { note: string }).note;
      units = [
        ...units,
        { id: "g", kind: "page", level: "full", document: "vault.g", rootNote: note },
      ];
      return [201, { id: "g" }];
    },
    "PATCH /api/workspaces/w/pages/g": () => {
      restricted = true;
      units = units.map((unit) => ("rootNote" in unit ? { ...unit, restricted } : unit));
      return [200, { id: "g", restricted }];
    },
    "GET /api/workspaces/w/units/g/grants": () => [
      200,
      {
        kind: "page",
        restricted,
        grants: [{ user: "u1", name: "Ada", email: "ada@example.org", level: "full" }],
        invitations: [],
      },
    ],
    "POST /api/workspaces/w/invitations": () => [
      201,
      { id: "i", token: "guest-token", role: "guest", email: null, expiresAt: "" },
    ],
  });
  await linked(page);
  await page
    .getByRole("list", { name: "Notes" })
    .getByRole("button", { name: /Roadmap/ })
    .click();

  await command(page, "share this page");
  const dialog = page.getByRole("dialog", { name: "Share Roadmap" });
  await expect(dialog.getByText("This page goes with the space it is in")).toBeVisible();
  await dialog.getByRole("button", { name: "Share it on its own, with its subpages" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Roadmap is shared on its own.");
  // Checked once the server has it so.
  const only = dialog.getByRole("checkbox", { name: "Only the people below" });
  await only.click();
  await expect(dialog.getByRole("status")).toHaveText("Only its own people open it now.");
  await expect(only).toBeChecked();

  await dialog.getByRole("button", { name: "Invite a guest" }).click();
  await expect(dialog.getByRole("textbox", { name: "Invitation link" })).toHaveValue(
    "https://nether.test/invite#guest-token",
  );
  expect(await violations(page)).toEqual([]);

  const shared = sent.find(
    (request) => new URL(request.url()).pathname === "/api/workspaces/w/pages",
  );
  expect(Object.keys(shared?.postDataJSON() as object)).toEqual(["note"]);
  const invited = sent.find((request) => new URL(request.url()).pathname.endsWith("/invitations"));
  expect(invited?.postDataJSON()).toEqual({ role: "guest", unit: "g", level: "view" });
  expect(pageErrors(errors).filter((error) => !error.includes("WebSocket"))).toEqual([]);
});
