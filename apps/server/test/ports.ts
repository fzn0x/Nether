// A port fetch and WebSocket will reach. The system may hand out one of the
// ports the fetch standard refuses, as 6000 or 10080, which fails a test's
// first request with "bad port".
import { createServer } from "node:net";

/** The ports at or above 1024 that fetch refuses to reach. */
const refused = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

/** A free port on the loopback address that fetch reaches. */
export async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const found = typeof address === "object" && address !== null ? address.port : 0;
        probe.close(() => {
          resolve(found);
        });
      });
    });
    if (port !== 0 && !refused.has(port)) return port;
  }
}
