// What every build knows of the web app (ADR 0053), kept apart from its
// backend (webBackend.ts), which only the web app's build loads: the server
// that serves the page, the page a provider sends the browser back to, and
// fetch with the session's cookie.

/** The server the page is served by, which is the only one it talks to. */
export const webServer = location.origin;

/** The page a provider sends the browser back to, and the channel it hands the query over by. */
export const providerReturn = "/sign-in/provider";
export const providerChannel = "nether-provider";

/** A cookie the page may read, by name. */
function cookie(name: string): string | undefined {
  for (const part of document.cookie.split(";")) {
    const at = part.indexOf("=");
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * fetch for the server, with the session's cookie: an empty bearer token,
 * which stands for it, is left out, sign-ins ask for the cookie, and
 * requests that change anything send the CSRF value back.
 */
export const webFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (/^Bearer\s*$/i.test(headers.get("authorization") ?? "x")) headers.delete("authorization");
  headers.set("x-nether-session", "cookie");
  const method = (init?.method ?? "GET").toUpperCase();
  const csrf = cookie("nether_csrf");
  if (!safeMethods.has(method) && csrf !== undefined) headers.set("x-nether-csrf", csrf);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
};
