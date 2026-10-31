// ZIP files made and read in the browser (webZip.ts), checked against
// ZIP files Python's zipfile made, and against themselves.
import { describe, expect, it } from "vitest";
import { crc32, makeZip, readZip } from "../src/webZip.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Made with Python's zipfile: a folder, a deflated note with a name in
 * UTF-8, a stored file of every byte, and a comment.
 */
const python =
  "UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAGAAAATm90ZXMvUEsDBBQAAAgIAFkvYV0e3W5UGgAAALkEAAAOAAAATm" +
  "90ZXMvQ2Fmw6kubWRTVnBOTDu8kourPL8opVhhlBwlR8lRcvCTAFBLAwQUAAAAAABZL2Fdc4wFKQABAAAAAQAABwAA" +
  "AGltZy5iaW4AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Oj" +
  "s8PT4/QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl9gYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1+" +
  "f4CBgoOEhYaHiImKi4yNjo+QkZKTlJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/Awc" +
  "LDxMXGx8jJysvMzc7P0NHS09TV1tfY2drb3N3e3+Dh4uPk5ebn6Onq6+zt7u/w8fLz9PX29/j5+vv8/f7/UEsBAhQA" +
  "FAAAAAAAAAAhAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAIABAAAAAE5vdGVzL1BLAQIUABQAAAgIAFkvYV0e3W5UGg" +
  "AAALkEAAAOAAAAAAAAAAAAAACAASQAAABOb3Rlcy9DYWbDqS5tZFBLAQIUABQAAAAAAFkvYV1zjAUpAAEAAAABAAAH" +
  "AAAAAAAAAAAAAACAAWoAAABpbWcuYmluUEsFBgAAAAADAAMApQAAAI8BAAAOAG1hZGUgYnkgcHl0aG9u";

function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function bytesOfBlob(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("readZip", () => {
  it("reads what another tool made, folders left out", async () => {
    const files = readZip(bytesOf(python));
    expect(files.map((file) => [file.path, file.size])).toEqual([
      ["Notes/Café.md", 1209],
      ["img.bin", 256],
    ]);
    const [note, image] = files;
    expect(decoder.decode(await note?.bytes())).toBe(`# Café\n\n${"words ".repeat(200)}`);
    expect([...((await image?.bytes()) ?? [])]).toEqual(Array.from({ length: 256 }, (_, n) => n));
  });

  it("refuses what is not a ZIP file, and a damaged one", async () => {
    expect(() => readZip(encoder.encode("not a zip at all, not even close"))).toThrow(
      "This is not a ZIP file.",
    );
    const damaged = bytesOf(python);
    // A byte of the deflated note, which starts at 80.
    damaged[90] = (damaged[90] ?? 0) ^ 0xff;
    const [note] = readZip(damaged);
    await expect(note?.bytes()).rejects.toThrow();
  });
});

describe("makeZip", () => {
  it("makes what it reads back, deflating where that is smaller", async () => {
    const text = encoder.encode(`# Plan\n\n${"again ".repeat(500)}`);
    const noise = crypto.getRandomValues(new Uint8Array(300));
    const zip = await bytesOfBlob(
      await makeZip([
        { path: "Projects/Plan.md", data: text },
        { path: "attachments/noise.bin", data: noise },
        { path: "Empty.md", data: new Uint8Array() },
        { path: "Ünïcode ✓.md", data: encoder.encode("✓") },
      ]),
    );
    expect(zip.length).toBeLessThan(text.length);
    const files = readZip(zip);
    expect(files.map((file) => file.path)).toEqual([
      "Projects/Plan.md",
      "attachments/noise.bin",
      "Empty.md",
      "Ünïcode ✓.md",
    ]);
    expect(await files[0]?.bytes()).toEqual(text);
    expect(await files[1]?.bytes()).toEqual(noise);
    expect(await files[2]?.bytes()).toEqual(new Uint8Array());
    expect(decoder.decode(await files[3]?.bytes())).toBe("✓");
  });

  it("keeps the time it was made, as MS-DOS dates", async () => {
    const zip = await bytesOfBlob(
      await makeZip(
        [{ path: "A.md", data: encoder.encode("a") }],
        new Date(2026, 10, 1, 13, 45, 30),
      ),
    );
    const view = new DataView(zip.buffer);
    expect(view.getUint16(10, true)).toBe((13 << 11) | (45 << 5) | 15);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 1);
  });
});

describe("crc32", () => {
  it("gives the check value of the standard", () => {
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
  });
});
