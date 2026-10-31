// Signing in to a Nether server from the app: its address, then a password,
// a code it emails, or its provider in the browser, as it offers; the
// account it signs in to, and signing out. The server here is the test's,
// answering the browser preview's requests.
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, fakeServer, openSample, pageErrors, violations } from "./helpers.ts";

const user = { id: "u1", name: "Ada", email: "ada@example.org", instanceAdmin: true };
const session = { token: "session-token", expiresAt: "2027-01-29T00:00:00.000Z", user };

async function openServers(page: Page) {
  await page.keyboard.press("Control+p");
  await page.keyboard.type("servers");
  await page.keyboard.press("Enter");
  return page.getByRole("dialog", { name: "Servers" });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`signs in with a password, shows the account and signs out, in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    const errors = errorsOf(page);
    const sent = await fakeServer(page, {
      "GET /api/sign-in-methods": () => [
        200,
        { password: true, emailCode: true, oidc: { name: "Example SSO" } },
      ],
      "POST /api/sessions": (request) =>
        (request.postDataJSON() as { password: string }).password === "a long password"
          ? [201, session]
          : [401, { message: "That email address and password do not match an account." }],
      "DELETE /api/sessions/current": () => [204],
    });
    await openSample(page);
    const dialog = await openServers(page);
    const address = dialog.getByRole("textbox", { name: "Server address" });
    await expect(address).toBeFocused();
    expect(await violations(page)).toEqual([]);

    await address.fill("not a server/at all");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("That is not a server's address.");

    await address.fill("nether.test");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("group", { name: "Sign in to nether.test" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Sign in with Example SSO" })).toBeVisible();
    expect(await violations(page)).toEqual([]);

    await dialog.getByRole("textbox", { name: "Email address" }).fill("ada@example.org");
    await dialog.getByLabel("Password").fill("not it");
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "That email address and password do not match an account.",
    );
    await dialog.getByLabel("Password").fill("a long password");
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("Signed in to nether.test as Ada.");
    const list = dialog.getByRole("list", { name: "Servers" });
    await expect(list.getByRole("listitem")).toHaveText(/nether\.test Ada \(ada@example\.org\)/);
    expect(await violations(page)).toEqual([]);

    // Kept for the next time the dialog opens.
    await page.keyboard.press("Escape");
    const again = await openServers(page);
    await again.getByRole("button", { name: "Sign out of nether.test" }).click();
    await expect(again.getByRole("status")).toHaveText("Signed out of nether.test.");
    await expect(again.getByText(/signed in to no server/)).toBeVisible();
    const signOut = sent.find((request) => request.method() === "DELETE");
    expect(await signOut?.headerValue("authorization")).toBe("Bearer session-token");
    expect(pageErrors(errors)).toEqual([]);
  });
}

test("signs in with a code the server emails", async ({ page }) => {
  const errors = errorsOf(page);
  const sent = await fakeServer(page, {
    "GET /api/sign-in-methods": () => [200, { password: false, emailCode: true, oidc: null }],
    "POST /api/sign-in-codes": () => [202, { message: "On its way." }],
    "POST /api/sign-in-codes/redeem": (request) =>
      (request.postDataJSON() as { code: string }).code === "1234 5678"
        ? [201, session]
        : [401, { message: "That code is not this address's." }],
  });
  await openSample(page);
  const dialog = await openServers(page);
  await dialog.getByRole("textbox", { name: "Server address" }).fill("https://nether.test/");
  await dialog.getByRole("button", { name: "Continue" }).click();
  // Without passwords, the code is the way in.
  await expect(dialog.getByLabel("Password")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
  const ask = dialog.getByRole("button", { name: "Email me a code" });
  await expect(ask).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Email address" }).fill(" ada@example.org ");
  await ask.click();
  await expect(dialog.getByText("If ada@example.org has an account here")).toBeVisible();
  const code = dialog.getByRole("textbox", { name: "Code" });
  await code.fill("0000 0000");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That code is not this address's.");
  await code.fill("1234 5678");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Signed in to nether.test as Ada.");
  const asked = sent.find((request) => new URL(request.url()).pathname === "/api/sign-in-codes");
  expect(asked?.postDataJSON()).toEqual({ email: "ada@example.org" });
  expect(pageErrors(errors)).toEqual([]);
});

test("signs in with the server's provider, in the browser", async ({ page, context }) => {
  const errors = errorsOf(page);
  const sent = await fakeServer(page, {
    "GET /api/sign-in-methods": () => [
      200,
      { password: false, emailCode: false, oidc: { name: "Example SSO" } },
    ],
    "POST /api/oidc/flows": () => [201, { url: "https://login.test/authorize" }],
    "POST /api/oidc/redeem": () => [201, session],
  });
  // The provider's page, which the app opens in a browser window.
  await context.route("https://login.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Provider</title>" }),
  );
  await openSample(page);
  // The browser comes back to the app's loopback address with a code.
  await page.evaluate(() => {
    (
      globalThis as unknown as {
        netherPreview: { loopback: () => unknown };
      }
    ).netherPreview.loopback = () => ({
      redirect: "http://127.0.0.1:43123/back",
      wait: () => Promise.resolve({ code: "handoff" }),
      close: () => Promise.resolve(),
    });
  });
  const dialog = await openServers(page);
  await dialog.getByRole("textbox", { name: "Server address" }).fill("nether.test");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Sign in with Example SSO" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Signed in to nether.test as Ada.");
  const flow = sent.find((request) => new URL(request.url()).pathname === "/api/oidc/flows");
  const redeem = sent.find((request) => new URL(request.url()).pathname === "/api/oidc/redeem");
  expect(flow?.postDataJSON()).toMatchObject({ redirect: "http://127.0.0.1:43123/back" });
  expect(redeem?.postDataJSON()).toMatchObject({ code: "handoff" });
  expect(pageErrors(errors)).toEqual([]);
});

test("says when an address is no Nether server's", async ({ page }) => {
  await fakeServer(page, { "GET /api/sign-in-methods": () => [200, { hello: "world" }] });
  await openSample(page);
  const dialog = await openServers(page);
  await dialog.getByRole("textbox", { name: "Server address" }).fill("nether.test");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "https://nether.test does not answer as a Nether server.",
  );
});
