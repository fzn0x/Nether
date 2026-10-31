// Signing in by email: a code sent to an address that has an account,
// which signs in once, within 15 minutes and five tries.
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "../src/mail.ts";
import { type TestServer, TestMailer, admin, bearer, setUp, startServer } from "./app.ts";

let running: TestServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(): Promise<TestServer & { mailer: TestMailer }> {
  const mailer = new TestMailer();
  running = await startServer({ mailer });
  await setUp(running);
  return { ...running, mailer };
}

function ask(test: TestServer, email: string) {
  return test.server.inject({ method: "POST", url: "/api/sign-in-codes", payload: { email } });
}

function redeem(test: TestServer, email: string, code: string) {
  return test.server.inject({
    method: "POST",
    url: "/api/sign-in-codes/redeem",
    payload: { email, code },
  });
}

/** The code in a message, as it shows it: two groups of four digits. */
function codeIn(message: Message): string {
  const code = /^ {4}(\d{4} \d{4})$/m.exec(message.text)?.[1];
  if (code === undefined) throw new Error(`No code in ${message.text}`);
  return code;
}

describe("signing in by email", () => {
  it("emails a code to an address with an account, which signs in once", async () => {
    const test = await start();
    const asked = await ask(test, "ada@example.org");
    expect(asked.statusCode).toBe(202);
    const message = await test.mailer.next();
    const code = codeIn(message);
    expect(message.to).toBe("Ada@Example.org");
    expect(message.subject).toBe(`Nether sign-in code ${code}`);
    expect(message.text).toMatch(/^Hello Ada,\n/);
    expect(message.text).toContain("within 15 minutes");

    const { rows } = await test.db.query("SELECT code_hash FROM sign_in_codes");
    expect(JSON.stringify(rows)).not.toContain(code.replace(" ", ""));

    // As someone types it: without the space, or with a dash.
    const signedIn = await redeem(test, "ADA@example.org", code.replace(" ", "-"));
    expect(signedIn.statusCode).toBe(201);
    const body = signedIn.json<{ token: string; user: object }>();
    expect(body.user).toMatchObject({ name: "Ada", instanceAdmin: true });
    const me = await test.server.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(body.token),
    });
    expect(me.statusCode).toBe(200);
    expect((await redeem(test, admin.email, code)).statusCode).toBe(401);
  });

  it("answers alike for an address without an account, and emails it nothing", async () => {
    const test = await start();
    const unknown = await ask(test, "eve@example.org");
    const known = await ask(test, admin.email);
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json()).toEqual(known.json());
    await test.close();
    running = undefined;
    expect(test.mailer.sent.map((message) => message.to)).toEqual(["Ada@Example.org"]);
  });

  it("spends a code after five wrong tries, and binds it to its address", async () => {
    const test = await start();
    await ask(test, admin.email);
    const code = codeIn(await test.mailer.next());
    const wrong = code.startsWith("0") ? "1111 1111" : "0000 0000";
    expect((await redeem(test, "eve@example.org", code)).statusCode).toBe(401);
    for (const attempt of [wrong, wrong, "not a code", wrong]) {
      const response = await redeem(test, admin.email, attempt);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        message: expect.stringContaining("That code") as unknown,
      });
    }
    expect((await redeem(test, admin.email, code)).statusCode).toBe(201);

    await ask(test, admin.email);
    const next = codeIn(await test.mailer.next());
    for (let attempt = 0; attempt < 5; attempt++) await redeem(test, admin.email, wrong);
    expect((await redeem(test, admin.email, next)).statusCode).toBe(401);
  });

  it("replaces a code with the next one asked for, and lets one expire", async () => {
    const test = await start();
    await ask(test, admin.email);
    const first = codeIn(await test.mailer.next());
    await ask(test, admin.email);
    const second = codeIn(await test.mailer.next());
    if (first !== second) expect((await redeem(test, admin.email, first)).statusCode).toBe(401);
    expect((await redeem(test, admin.email, second)).statusCode).toBe(201);

    await ask(test, admin.email);
    const late = codeIn(await test.mailer.next());
    await test.db.query("UPDATE sign_in_codes SET expires_at = now() - interval '1 second'");
    expect((await redeem(test, admin.email, late)).statusCode).toBe(401);
  });

  it("sends one address three emails in 15 minutes at most", async () => {
    const test = await start();
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await ask(test, admin.email)).statusCode).toBe(202);
    }
    const limited = await ask(test, "ADA@example.org");
    expect(limited.statusCode).toBe(429);
    expect((await ask(test, "eve@example.org")).statusCode).toBe(202);
  });
});

describe("a server without email", () => {
  it("has no way to sign in by email, and says so", async () => {
    running = await startServer();
    const methods = await running.server.inject({ method: "GET", url: "/api/sign-in-methods" });
    expect(methods.json()).toEqual({ password: true, emailCode: false, oidc: null });
    expect((await ask(running, admin.email)).statusCode).toBe(404);
    await running.close();

    running = await startServer({ mailer: new TestMailer() });
    const withMail = await running.server.inject({ method: "GET", url: "/api/sign-in-methods" });
    expect(withMail.json()).toEqual({ password: true, emailCode: true, oidc: null });
  });
});
