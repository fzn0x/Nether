// End-to-end encryption from the app: turning it on shows the recovery
// phrase once, behind a promise it was written down; a new device unlocks
// with the phrase; and an encrypted workspace is made with its key sealed
// to its maker. The server here is the test's.
import { lockPrivateKey, newKeyPair, newRecoveryPhrase } from "@nether/sync-client";
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, fakeServer, openSample, pageErrors, violations } from "./helpers.ts";

const user = { id: "u1", name: "Ada", email: "ada@example.org", instanceAdmin: true };
const signInRoutes = {
  "GET /api/sign-in-methods": () =>
    [200, { password: true, emailCode: false, oidc: null }] as const,
  "POST /api/sessions": () => [201, { token: "session-token", expiresAt: "", user }] as const,
};

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
  return servers;
}

test("turns encryption on, showing the recovery phrase once", async ({ page }) => {
  const errors = errorsOf(page);
  let kept: { publicKey: string; recoveryBox: string } | undefined;
  await fakeServer(page, {
    ...signInRoutes,
    "GET /api/me/keys": () => (kept === undefined ? [404, { message: "No keys." }] : [200, kept]),
    "PUT /api/me/keys": (request) => {
      kept = request.postDataJSON() as typeof kept;
      return [204];
    },
  });
  await openSample(page);
  const servers = await signIn(page);
  await expect(servers.getByText("End-to-end encryption is off.")).toBeVisible();
  await servers.getByRole("button", { name: "Turn on end-to-end encryption" }).click();

  const words = servers.getByRole("list", { name: "Recovery phrase" }).getByRole("listitem");
  await expect(words).toHaveCount(24);
  const turnOn = servers.getByRole("button", { name: "Turn on end-to-end encryption" });
  await expect(turnOn).toBeDisabled();
  expect(await violations(page)).toEqual([]);
  await servers.getByRole("checkbox", { name: "I have written these 24 words down" }).check();
  await turnOn.click();
  await expect(servers.getByRole("status")).toHaveText(
    "End-to-end encryption is on for nether.test.",
  );
  await expect(servers.getByText("End-to-end encryption is on.")).toBeVisible();
  expect(Buffer.from(kept?.publicKey ?? "", "base64")).toHaveLength(32);
  expect(Buffer.from(kept?.recoveryBox ?? "", "base64").length).toBeGreaterThan(32);
  expect(pageErrors(errors)).toEqual([]);
});

test("unlocks encrypted workspaces on a new device with the recovery phrase", async ({ page }) => {
  const errors = errorsOf(page);
  const pair = await newKeyPair();
  const phrase = newRecoveryPhrase();
  const recoveryBox = Buffer.from(await lockPrivateKey(pair.privateKey, phrase, user.id)).toString(
    "base64",
  );
  await fakeServer(page, {
    ...signInRoutes,
    "GET /api/me/keys": () => [
      200,
      { publicKey: Buffer.from(pair.publicKey).toString("base64"), recoveryBox },
    ],
  });
  await openSample(page);
  const servers = await signIn(page);
  await expect(servers.getByText("Encrypted workspaces are locked on this device.")).toBeVisible();
  await servers.getByRole("button", { name: "Unlock with the recovery phrase" }).click();
  const field = servers.getByRole("textbox", { name: "Recovery phrase" });
  await expect(field).toBeFocused();
  expect(await violations(page)).toEqual([]);

  await field.fill("not my words");
  await servers.getByRole("button", { name: "Unlock with the recovery phrase" }).click();
  await expect(servers.getByRole("alert")).toHaveText(/That is not a recovery phrase/);
  await field.fill(newRecoveryPhrase());
  await servers.getByRole("button", { name: "Unlock with the recovery phrase" }).click();
  await expect(servers.getByRole("alert")).toHaveText(
    "That recovery phrase does not open this account's key.",
  );
  await field.fill(phrase.toUpperCase());
  await servers.getByRole("button", { name: "Unlock with the recovery phrase" }).click();
  await expect(servers.getByRole("status")).toHaveText(
    "Encrypted workspaces on nether.test are unlocked on this device.",
  );
  await expect(servers.getByText("End-to-end encryption is on.")).toBeVisible();
  expect(pageErrors(errors)).toEqual([]);
});

test("makes an encrypted workspace, its key sealed to its maker", async ({ page }) => {
  const errors = errorsOf(page);
  let kept: { publicKey: string; recoveryBox: string } | undefined;
  let made: { name: string; encryption: string; sealedKey: string } | undefined;
  await fakeServer(page, {
    ...signInRoutes,
    "GET /api/me/keys": () => (kept === undefined ? [404, { message: "No keys." }] : [200, kept]),
    "PUT /api/me/keys": (request) => {
      kept = request.postDataJSON() as typeof kept;
      return [204];
    },
    "GET /api/me": () => [
      200,
      { user, workspaces: [{ id: "w-team", name: "Team", role: "owner", encryption: "none" }] },
    ],
    "POST /api/workspaces": (request) => {
      made = request.postDataJSON() as typeof made;
      return [201, { id: "w-secret", name: made?.name, role: "owner", encryption: "end-to-end" }];
    },
  });
  await openSample(page);
  const servers = await signIn(page);
  await servers.getByRole("button", { name: "Turn on end-to-end encryption" }).click();
  await servers.getByRole("checkbox", { name: "I have written these 24 words down" }).check();
  await servers.getByRole("button", { name: "Turn on end-to-end encryption" }).click();
  await expect(servers.getByText("End-to-end encryption is on.")).toBeVisible();
  await page.keyboard.press("Escape");

  await command(page, "sync this vault");
  const sync = page.getByRole("dialog", { name: "Sync" });
  await sync.getByRole("textbox", { name: "Name of the new workspace" }).fill("Secret");
  await sync.getByRole("button", { name: "Make it encrypted" }).click();
  const workspace = sync.getByRole("combobox", { name: "Workspace" });
  await expect(workspace).toHaveValue("w-secret");
  await expect(workspace.getByRole("option")).toHaveText(["Team", "Secret, encrypted"]);
  expect(made).toMatchObject({ name: "Secret", encryption: "end-to-end" });
  expect(Buffer.from(made?.sealedKey ?? "", "base64")).toHaveLength(80);
  expect(await violations(page)).toEqual([]);
  expect(pageErrors(errors)).toEqual([]);
});
