// Comments, from the app (ADR 0044): in a vault linked to a workspace, a
// thread started on the selection with its shortcut, its text highlighted
// in the note; a reply; a comment edited; and the thread resolved, folded
// away, and reopened. And mentions (ADR 0045): a person picked as @ is
// typed, the server told, and the notifications that come back. The server
// here is the test's.
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, fakeServer, openSample, pageErrors, settle, violations } from "./helpers.ts";

const ada = { id: "u1", name: "Ada", email: "ada@example.org", instanceAdmin: false };

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

test("comments on the selection, replies, edits, resolves and reopens", async ({ page }) => {
  const errors = errorsOf(page);
  await fakeServer(page, {
    "GET /api/sign-in-methods": () => [200, { password: true, emailCode: false, oidc: null }],
    "POST /api/sessions": () => [201, { token: "session-token", expiresAt: "", user: ada }],
    "GET /api/me": () => [
      200,
      { user: ada, workspaces: [{ id: "w", name: "Team", role: "owner" }] },
    ],
    "GET /api/workspaces/w/documents": () => [200, { documents: [], more: false }],
    "GET /api/workspaces/w/units": () => [
      200,
      { units: [{ id: "general", kind: "general", level: "full", document: "vault" }] },
    ],
  });
  await linked(page);
  await page
    .getByRole("list", { name: "Notes" })
    .getByRole("button", { name: /Welcome/ })
    .click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  const comments = page.getByRole("region", { name: "Comments" });
  await expect(comments.getByText(/No comments yet/)).toBeVisible();

  // The heading, selected from its end, then its shortcut.
  const heading = editor.locator("h1");
  await heading.click();
  await settle(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+Alt+M");
  const draft = comments.getByRole("group", { name: "New comment" });
  await expect(draft).toContainText("Welcome to Nether");
  const box = draft.getByRole("textbox", { name: "Write a comment" });
  await expect(box).toBeFocused();
  await box.fill("Is this the right title?");
  await page.keyboard.press("Control+Enter");

  const thread = comments.getByRole("listitem", { name: "Comments on “Welcome to Nether”" });
  await expect(thread).toContainText("Ada");
  await expect(thread).toContainText("Is this the right title?");
  await expect(editor.locator(".comment-highlight")).toHaveText("Welcome to Nether");
  expect(await violations(page)).toEqual([]);

  await thread.getByRole("textbox", { name: "Reply" }).fill("It is for now.");
  await thread.getByRole("button", { name: "Reply" }).click();
  await expect(thread.getByRole("listitem")).toHaveCount(2);

  await thread.getByRole("button", { name: "Edit" }).first().click();
  const edit = thread.getByRole("textbox", { name: "Edit the comment" });
  await edit.fill("Is this the best title?");
  await thread.getByRole("button", { name: "Save" }).click();
  const first = thread.getByRole("listitem").first();
  await expect(first).toContainText("Is this the best title?");
  await expect(first.locator(".comment-meta")).toContainText("(edited)");

  // Resolved, it folds away, and its text is no longer marked.
  await thread.getByRole("button", { name: "Resolve" }).click();
  await expect(editor.locator(".comment-highlight")).toHaveCount(0);
  const resolved = comments.getByText("Resolved (1)");
  await resolved.click();
  const folded = comments.getByRole("listitem", { name: "Comments on “Welcome to Nether”" });
  await expect(folded).toContainText("Resolved by Ada");
  expect(await violations(page)).toEqual([]);
  await folded.getByRole("button", { name: "Reopen" }).click();
  await expect(editor.locator(".comment-highlight")).toHaveText("Welcome to Nether");
  await expect(comments.getByText("Resolved (1)")).toHaveCount(0);

  // The note's file is its own: comments stay out of it.
  const text = await page.evaluate(async () => {
    const preview = (
      globalThis as unknown as {
        netherPreview: { files: { read(path: string): Promise<{ text: string }> } };
      }
    ).netherPreview;
    return (await preview.files.read("Welcome.md")).text;
  });
  expect(text).not.toContain("right title");
  expect(pageErrors(errors).filter((error) => !error.includes("WebSocket"))).toEqual([]);
});

test("mentions someone picked as @ is typed, and lists the notifications that come", async ({
  page,
}) => {
  const errors = errorsOf(page);
  let told: Record<string, unknown> | undefined;
  let read = false;
  let emails = true;
  const sent = await fakeServer(page, {
    "GET /api/sign-in-methods": () => [200, { password: true, emailCode: false, oidc: null }],
    "POST /api/sessions": () => [201, { token: "session-token", expiresAt: "", user: ada }],
    "GET /api/me": () => [
      200,
      { user: ada, workspaces: [{ id: "w", name: "Team", role: "owner" }] },
    ],
    "GET /api/workspaces/w/documents": () => [200, { documents: [], more: false }],
    "GET /api/workspaces/w/members": () => [
      200,
      {
        members: [
          { ...ada, role: "owner" },
          { id: "u2", name: "Bea Lane", email: "bea@example.org", role: "member" },
        ],
      },
    ],
    "POST /api/workspaces/w/notifications": (request) => {
      told = request.postDataJSON() as Record<string, unknown>;
      return [201, { notified: ["u2"] }];
    },
    // Bea answers in kind: one notification, about the note Ada commented on.
    "GET /api/notifications": () => [
      200,
      told === undefined
        ? { notifications: [], unread: 0 }
        : {
            notifications: [
              {
                id: "n1",
                workspace: { id: "w", name: "Team" },
                kind: "mention",
                note: told.note,
                thread: told.thread,
                title: "Welcome",
                excerpt: "@Ada, done.",
                actor: { id: "u2", name: "Bea Lane" },
                created: "2026-10-31T12:00:00.000Z",
                read: read ? "2026-10-31T12:05:00.000Z" : null,
              },
            ],
            unread: read ? 0 : 1,
          },
    ],
    "POST /api/notifications/read": () => {
      read = true;
      return [204];
    },
    "GET /api/me/notification-settings": () => [200, { email: emails }],
    "PUT /api/me/notification-settings": (request) => {
      emails = (request.postDataJSON() as { email: boolean }).email;
      return [200, { email: emails }];
    },
  });
  await linked(page);
  await page
    .getByRole("list", { name: "Notes" })
    .getByRole("button", { name: /Welcome/ })
    .click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await editor.locator("h1").click();
  await settle(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+Alt+M");
  const comments = page.getByRole("region", { name: "Comments" });
  const box = comments.getByRole("textbox", { name: "Write a comment" });
  await expect(box).toBeFocused();
  await page.keyboard.type("Ask @la");
  // Found by a word of the name; Ada, who writes, is not offered.
  const picker = comments.getByRole("listbox", { name: "People to mention" });
  await expect(picker.getByRole("option")).toHaveText(["Bea Lane"]);
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await expect(box).toHaveValue("Ask @Bea Lane ");
  await page.keyboard.type("to check.");
  await page.keyboard.press("Control+Enter");

  const thread = comments.getByRole("listitem", { name: "Comments on “Welcome to Nether”" });
  await expect(thread.locator(".mention")).toHaveText("@Bea Lane");
  await expect
    .poll(() => told)
    .toMatchObject({
      kind: "mention",
      people: ["u2"],
      title: "Welcome",
      excerpt: "Ask @Bea Lane to check.",
    });

  // Bea's answer comes as a notification, which opens its note and marks it read.
  const line = page.getByRole("button", { name: "Notifications (1 new)" });
  await expect(line).toBeVisible({ timeout: 10_000 });
  await line.click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  const item = dialog.getByRole("button", { name: /Bea Lane mentioned you on .Welcome./ });
  await expect(item).toContainText("@Ada, done.");
  expect(await violations(page)).toEqual([]);
  await dialog.getByRole("checkbox", { name: "Email me when someone mentions me" }).uncheck();
  await expect.poll(() => emails).toBe(false);
  await item.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  expect(
    sent.some(
      (request) =>
        request.url().endsWith("/api/notifications/read") &&
        JSON.stringify(request.postDataJSON()) === JSON.stringify({ ids: ["n1"] }),
    ),
  ).toBe(true);
  expect(pageErrors(errors).filter((error) => !error.includes("WebSocket"))).toEqual([]);
});
