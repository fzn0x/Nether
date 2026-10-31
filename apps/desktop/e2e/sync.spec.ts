// Syncing the open vault with a workspace, from the app: signing in first,
// the account's workspaces, linking only when one side has no notes, how
// sync is going at the foot of the sidebar, and stopping. The server here is
// the test's: it answers the app's requests, and its sync socket, which the
// preview cannot reach, leaves sync offline.
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, fakeServer, openSample, pageErrors, violations } from "./helpers.ts";

const user = { id: "u1", name: "Ada", email: "ada@example.org", instanceAdmin: true };

async function command(page: Page, name: string) {
  await page.keyboard.press("Control+p");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
}

/** Signs in to the test's server, through the servers dialog, with a password. */
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

test("asks to sign in to a server before syncing", async ({ page }) => {
  await openSample(page);
  await command(page, "sync this vault");
  const dialog = page.getByRole("dialog", { name: "Sync" });
  await expect(dialog.getByText("Sign in to a Nether server to sync this vault.")).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Servers and signing in" }).click();
  await expect(page.getByRole("dialog", { name: "Servers" })).toBeVisible();
});

test("links the vault to an empty workspace, says how sync goes, and stops", async ({ page }) => {
  const errors = errorsOf(page);
  let workspaceNotes: { name: string; seq: number }[] = [{ name: "someone-else", seq: 1 }];
  await fakeServer(page, {
    "GET /api/sign-in-methods": () => [200, { password: true, emailCode: false, oidc: null }],
    "POST /api/sessions": () => [201, { token: "session-token", expiresAt: "", user }],
    "GET /api/me": () => [
      200,
      {
        user,
        workspaces: [
          { id: "w-team", name: "Team", role: "owner" },
          { id: "w-home", name: "Home", role: "member" },
        ],
      },
    ],
    "GET /api/workspaces/w-team/documents": () => [200, { documents: workspaceNotes, more: false }],
  });
  await openSample(page);
  await signIn(page);

  await command(page, "sync this vault");
  const dialog = page.getByRole("dialog", { name: "Sync" });
  await expect(dialog.getByRole("combobox", { name: "Server" })).toHaveValue("https://nether.test");
  const workspace = dialog.getByRole("combobox", { name: "Workspace" });
  await expect(workspace).toHaveValue("w-team");
  await expect(workspace.getByRole("option")).toHaveText(["Team", "Home"]);
  expect(await violations(page)).toEqual([]);

  // Both have notes: linking would make each note twice.
  await dialog.getByRole("button", { name: "Sync this vault" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Team has notes already, and so does this vault. Open Team in an empty folder to sync it there.",
  );

  workspaceNotes = [];
  await dialog.getByRole("button", { name: "Sync this vault" }).click();
  await expect(dialog.getByText("This vault syncs with Team on nether.test.")).toBeVisible();
  const line = page.locator(".sync-line").getByRole("button");
  await expect(line).toHaveText(/Team/);
  expect(await violations(page)).toEqual([]);

  await dialog.getByRole("button", { name: "Stop syncing" }).click();
  await expect(dialog.getByRole("combobox", { name: "Workspace" })).toBeVisible();
  await expect(page.locator(".sync-line")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Kept for the vault: opening the dialog again shows no link.
  await command(page, "sync this vault");
  await expect(
    page.getByRole("dialog", { name: "Sync" }).getByRole("button", { name: "Sync this vault" }),
  ).toBeVisible();
  // The preview cannot reach the test's sync socket; the browser says so.
  expect(pageErrors(errors).filter((error) => !error.includes("WebSocket"))).toEqual([]);
});
