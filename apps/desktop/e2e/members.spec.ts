// A workspace's members, from the app: the list, changing a role, removing
// someone, inviting by a link and withdrawing it; and someone joining with
// that link, making their account. The server here is the test's.
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, fakeServer, openSample, pageErrors, violations } from "./helpers.ts";

const ada = { id: "u1", name: "Ada", email: "ada@example.org", instanceAdmin: false };

async function command(page: Page, name: string) {
  await page.keyboard.press("Control+p");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
}

async function signIn(page: Page) {
  await command(page, "servers");
  const servers = page.getByRole("dialog", { name: "Servers" });
  await servers.getByRole("textbox", { name: "Server address" }).fill("nether.test");
  await servers.getByRole("button", { name: "Continue" }).click();
  await servers.getByRole("textbox", { name: "Email address" }).fill("ada@example.org");
  await servers.getByLabel("Password").fill("a long password");
  await servers.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(servers.getByRole("status")).toHaveText("Signed in to nether.test as Ada.");
  await page.keyboard.press("Escape");
}

test("an owner changes a role, removes a member, and invites by a link", async ({ page }) => {
  const errors = errorsOf(page);
  let people = [
    { ...ada, role: "owner" },
    { id: "u2", name: "Bea", email: "bea@example.org", role: "member" },
    { id: "u3", name: "Cal", email: "cal@example.org", role: "member" },
  ];
  let waiting: object[] = [];
  const sent = await fakeServer(page, {
    "GET /api/sign-in-methods": () => [200, { password: true, emailCode: false, oidc: null }],
    "POST /api/sessions": () => [201, { token: "session-token", expiresAt: "", user: ada }],
    "GET /api/me": () => [
      200,
      { user: ada, workspaces: [{ id: "w-team", name: "Team", role: "owner" }] },
    ],
    "GET /api/workspaces/w-team/documents": () => [200, { documents: [], more: false }],
    "GET /api/workspaces/w-team/members": () => [200, { members: people }],
    "GET /api/workspaces/w-team/invitations": () => [200, { invitations: waiting }],
    "PATCH /api/workspaces/w-team/members/u2": () => {
      people = people.map((person) => (person.id === "u2" ? { ...person, role: "guest" } : person));
      return [200, { id: "u2", role: "guest" }];
    },
    "DELETE /api/workspaces/w-team/members/u3": () => {
      people = people.filter((person) => person.id !== "u3");
      return [204];
    },
    "POST /api/workspaces/w-team/invitations": () => {
      waiting = [{ id: "i1", role: "member", email: null, expiresAt: "2026-11-07T09:00:00.000Z" }];
      return [201, { ...waiting[0], token: "invitation-token" }];
    },
    "DELETE /api/workspaces/w-team/invitations/i1": () => {
      waiting = [];
      return [204];
    },
  });
  await openSample(page);
  await signIn(page);
  await command(page, "sync this vault");
  const sync = page.getByRole("dialog", { name: "Sync" });
  await sync.getByRole("button", { name: "Sync this vault" }).click();
  await expect(sync.getByText("This vault syncs with Team on nether.test.")).toBeVisible();
  await page.keyboard.press("Escape");

  await command(page, "workspace members");
  const dialog = page.getByRole("dialog", { name: "Members of Team" });
  const list = dialog.getByRole("list", { name: "Members" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  expect(await violations(page)).toEqual([]);

  await dialog.getByRole("combobox", { name: "Role of Bea" }).selectOption("guest");
  await expect(dialog.getByRole("status")).toHaveText("Bea's role is now Guest.");
  await dialog.getByRole("button", { name: "Remove Cal" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Cal is no longer in the workspace.");
  await expect(list.getByRole("listitem")).toHaveCount(2);

  await dialog.getByRole("button", { name: "Make an invitation link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Invitation link" })).toHaveValue(
    "https://nether.test/invite#invitation-token",
  );
  await expect(dialog.getByText("Anyone with the link", { exact: true })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Withdraw" }).click();
  await expect(dialog.getByRole("status")).toHaveText("The invitation was withdrawn.");

  const asked = sent.map((request) => `${request.method()} ${new URL(request.url()).pathname}`);
  expect(asked).toContain("PATCH /api/workspaces/w-team/members/u2");
  const patch = sent.find((request) => request.method() === "PATCH");
  expect(patch?.postDataJSON()).toEqual({ role: "guest" });
  expect(pageErrors(errors).filter((error) => !error.includes("WebSocket"))).toEqual([]);
});

test("someone invited joins with the link, making their account", async ({ page }) => {
  const errors = errorsOf(page);
  const bea = { id: "u2", name: "Bea", email: "bea@example.org", instanceAdmin: false };
  const sent = await fakeServer(page, {
    "POST /api/invitations/lookup": () => [
      200,
      {
        workspace: { id: "w-team", name: "Team" },
        role: "member",
        email: "bea@example.org",
        invitedBy: "Ada",
        expiresAt: "2026-11-07T09:00:00.000Z",
      },
    ],
    "POST /api/invitations/accept": () => [
      201,
      {
        token: "bea-session",
        expiresAt: "",
        user: bea,
        workspace: { id: "w-team", name: "Team", role: "member" },
      },
    ],
  });
  await openSample(page);
  await command(page, "servers");
  const servers = page.getByRole("dialog", { name: "Servers" });
  await servers.getByRole("button", { name: "Join with an invitation" }).click();
  const link = servers.getByRole("textbox", { name: "Invitation link" });
  await link.fill("not a link");
  await servers.getByRole("button", { name: "Continue" }).click();
  await expect(servers.getByRole("alert")).toHaveText(
    "That is not an invitation's link: it ends with /invite# and a code.",
  );
  await link.fill("https://nether.test/invite#invitation-token");
  await servers.getByRole("button", { name: "Continue" }).click();

  await expect(
    servers.getByText("You are invited to Team, on nether.test, as Member. Ada invited you."),
  ).toBeVisible();
  // The invitation is for one address, which the account takes.
  await expect(servers.getByRole("textbox", { name: "Email address" })).toHaveValue(
    "bea@example.org",
  );
  await servers.getByRole("textbox", { name: "Your name" }).fill("Bea");
  await servers.getByLabel("Password").fill("bea's long password");
  expect(await violations(page)).toEqual([]);
  await servers.getByRole("button", { name: "Make the account and join" }).click();
  await expect(servers.getByRole("status")).toHaveText(
    "You joined Team. Open an empty folder as a vault, then Sync this vault to fetch its notes.",
  );
  await expect(servers.getByRole("list", { name: "Servers" })).toContainText("Bea");

  const accept = sent.find((request) => new URL(request.url()).pathname.endsWith("/accept"));
  expect(accept?.postDataJSON()).toEqual({
    token: "invitation-token",
    name: "Bea",
    email: "bea@example.org",
    password: "bea's long password",
  });
  expect(pageErrors(errors)).toEqual([]);
});
