// The SMTP mailer, against a small SMTP server of the test's own that
// accepts every message and keeps what it was sent.
import { type AddressInfo, type Server, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { smtpMailer } from "../src/mail.ts";

let server: Server | undefined;

afterEach(async () => {
  const closing = server;
  server = undefined;
  if (closing !== undefined) await new Promise((resolve) => closing.close(resolve));
});

/** Starts an SMTP server on a free port; gives its port and the messages it receives. */
async function smtpServer(): Promise<{ port: number; messages: string[][] }> {
  const messages: string[][] = [];
  server = createServer((socket) => {
    let buffer = "";
    let message: string[] | undefined;
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (message !== undefined) {
          if (line === ".") {
            messages.push(message);
            message = undefined;
            socket.write("250 queued\r\n");
          } else {
            message.push(line);
          }
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "DATA") {
          message = [];
          socket.write("354 go on\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, messages };
}

describe("smtpMailer", () => {
  it("sends plain text from the admin's address through the SMTP server", async () => {
    const { port, messages } = await smtpServer();
    const mailer = smtpMailer(`smtp://127.0.0.1:${String(port)}`, "Nether <nether@example.org>");
    await mailer.send({
      to: "ada@example.org",
      subject: "Nether sign-in code 1234 5678",
      text: "Your code to sign in to Nether is\n\n    1234 5678\n",
    });
    mailer.close();
    expect(messages).toHaveLength(1);
    const text = messages[0]?.join("\n") ?? "";
    expect(text).toMatch(/^From: Nether <nether@example\.org>$/m);
    expect(text).toMatch(/^To: ada@example\.org$/m);
    expect(text).toMatch(/^Subject: Nether sign-in code 1234 5678$/m);
    expect(text).toMatch(/^Content-Type: text\/plain/m);
    expect(text).toContain("    1234 5678");
  });
});
