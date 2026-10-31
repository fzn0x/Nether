// Sessions in a cookie, for the web app (ADR 0053): signing in from a page
// sets the token in an HttpOnly cookie and keeps it out of the answer; the
// cookie signs requests in, those that change anything only with the CSRF
// value sent back; bearer tokens work as before; signing out takes the
// cookies off; sockets take the cookie from this server's pages alone; and
// the sign-in email links to the web app.
import { afterEach, describe, expect, it } from "vitest";
import { readCookies, socketCookieToken } from "../src/cookies.ts";
import { type TestServer, TestMailer, admin, bearer, startServer } from "./app.ts";

let running: TestServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** The cookies an answer sets, by name, with their attributes. */
function setCookies(header: string | string[] | undefined): Map<string, string> {
  const list = Array.isArray(header) ? header : header === undefined ? [] : [header];
  return new Map(list.map((cookie) => [cookie.slice(0, cookie.indexOf("=")), cookie]));
}

/** A Cookie header holding the values set. */
function cookieHeader(set: Map<string, string>): string {
  return [...set.values()].map((cookie) => cookie.slice(0, cookie.indexOf(";"))).join("; ");
}

describe("sessions in a cookie", () => {
  it("are set when a page signs in, and sign its requests in, with CSRF for changes", async () => {
    running = await startServer();
    const setup = await running.server.inject({
      method: "POST",
      url: "/api/setup",
      headers: { "x-nether-session": "cookie" },
      payload: { ...admin, code: running.setupCode },
    });
    expect(setup.statusCode).toBe(201);
    const body = setup.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("token");
    expect(body).toHaveProperty("expiresAt");
    const set = setCookies(setup.headers["set-cookie"]);
    expect(set.get("nether_session")).toMatch(/HttpOnly/);
    expect(set.get("nether_session")).toMatch(/SameSite=Strict/);
    expect(set.get("nether_csrf")).not.toMatch(/HttpOnly/);
    const cookie = cookieHeader(set);
    const csrf = readCookies(cookie).get("nether_csrf") ?? "";

    const me = await running.server.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);

    const make = (headers: Record<string, string>) =>
      running?.server.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: { cookie, ...headers },
        payload: { name: "Second" },
      });
    expect((await make({}))?.statusCode).toBe(403);
    expect((await make({ "x-nether-csrf": "guessed" }))?.statusCode).toBe(403);
    expect((await make({ "x-nether-csrf": csrf }))?.statusCode).toBe(201);

    // Signing out takes the cookies off, and the session ends.
    const out = await running.server.inject({
      method: "DELETE",
      url: "/api/sessions/current",
      headers: { cookie, "x-nether-csrf": csrf },
    });
    expect(out.statusCode).toBe(204);
    expect(setCookies(out.headers["set-cookie"]).get("nether_session")).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
    expect(
      (await running.server.inject({ method: "GET", url: "/api/me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it("leave bearer tokens as they were", async () => {
    running = await startServer();
    const setup = await running.server.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, code: running.setupCode },
    });
    const { token } = setup.json<{ token: string }>();
    expect(setup.headers["set-cookie"]).toBeUndefined();
    const made = await running.server.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: bearer(token),
      payload: { name: "Second" },
    });
    expect(made.statusCode).toBe(201);
  });

  it("sign sockets in from this server's own pages alone", () => {
    const headers = (entries: Record<string, string>) => new Headers(entries);
    const cookie = "nether_session=abc; nether_csrf=x";
    expect(
      socketCookieToken(
        headers({ origin: "https://n.example.org", host: "n.example.org", cookie }),
      ),
    ).toBe("abc");
    expect(
      socketCookieToken(headers({ origin: "https://evil.example", host: "n.example.org", cookie })),
    ).toBeUndefined();
    expect(socketCookieToken(headers({ host: "n.example.org", cookie }))).toBeUndefined();
    expect(
      socketCookieToken(headers({ origin: "not a url", host: "n.example.org", cookie })),
    ).toBeUndefined();
    expect(
      socketCookieToken(
        headers({
          origin: "https://n.example.org",
          host: "10.0.0.2:3000",
          "x-forwarded-host": "n.example.org",
          cookie,
        }),
      ),
    ).toBe("abc");
  });

  it("read cookies as a browser sends them", () => {
    expect([...readCookies("a=1; b=%20two ; c; =d; a=again; e=%E0")]).toEqual([
      ["a", "1"],
      ["b", " two"],
    ]);
    expect(readCookies(undefined).size).toBe(0);
  });
});

describe("the sign-in email", () => {
  it("links to the web app, the code after the #", async () => {
    const mailer = new TestMailer();
    running = await startServer({
      mailer,
      env: { NETHER_PUBLIC_URL: "https://notes.example.org/" },
    });
    await running.server.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, code: running.setupCode },
    });
    await running.server.inject({
      method: "POST",
      url: "/api/sign-in-codes",
      payload: { email: admin.email },
    });
    const message = await mailer.next();
    expect(message.text).toMatch(
      /https:\/\/notes\.example\.org\/sign-in#email=Ada%40Example\.org&code=\d{8}/,
    );
  });
});
