import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBlockId,
  isUuid,
  newBlockId,
  newNoteId,
  newViewId,
  newWorkspaceId,
  uuidV7,
} from "../src/index.ts";

const crypto = (
  globalThis as unknown as { crypto: { getRandomValues: (array: Uint8Array) => Uint8Array } }
).crypto;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uuidV7", () => {
  it("puts the time in the first 48 bits, then the version and variant", () => {
    const time = 1_761_811_200_000;
    const id = uuidV7(time, new Uint8Array(10));
    expect(id.replaceAll("-", "").slice(0, 12)).toBe(time.toString(16).padStart(12, "0"));
    expect(id.endsWith("-7000-8000-000000000000")).toBe(true);
  });

  it("places the random bytes after the version and variant bits", () => {
    expect(uuidV7(0, new Uint8Array(10).fill(0xff))).toBe("00000000-0000-7fff-bfff-ffffffffffff");
  });

  it("sorts IDs created later after earlier ones", () => {
    const random = new Uint8Array(10).fill(0x55);
    const ids = [3, 1_000, 1_000_000, 2 ** 40].map((time) => uuidV7(time, random));
    expect([...ids].sort()).toEqual(ids);
  });

  it("is a valid UUID, different every time", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidV7()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isUuid(id)).toBe(true);
  });

  it("rejects times and random bytes it cannot encode", () => {
    expect(() => uuidV7(-1)).toThrow(RangeError);
    expect(() => uuidV7(1.5)).toThrow(RangeError);
    expect(() => uuidV7(2 ** 48)).toThrow(RangeError);
    expect(() => uuidV7(0, new Uint8Array(9))).toThrow(RangeError);
  });
});

describe("isUuid", () => {
  it("accepts canonical UUIDs of any RFC 9562 version", () => {
    expect(isUuid("01929f4c-7b00-7a00-8000-000000000001")).toBe(true);
    expect(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("rejects other forms", () => {
    expect(isUuid("F47AC10B-58CC-4372-A567-0E02B2C3D479")).toBe(false);
    expect(isUuid("f47ac10b-58cc-0372-a567-0e02b2c3d479")).toBe(false);
    expect(isUuid("f47ac10b-58cc-4372-c567-0e02b2c3d479")).toBe(false);
    expect(isUuid("f47ac10b58cc4372a5670e02b2c3d479")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("new IDs", () => {
  it("are UUIDs for notes, workspaces and views", () => {
    expect(isUuid(newNoteId())).toBe(true);
    expect(isUuid(newWorkspaceId())).toBe(true);
    expect(isUuid(newViewId())).toBe(true);
  });

  it("are eight lowercase letters and digits for blocks", () => {
    for (let index = 0; index < 200; index++) expect(newBlockId()).toMatch(/^[a-z0-9]{8}$/);
  });

  it("skip block IDs that are taken", () => {
    vi.spyOn(crypto, "getRandomValues")
      .mockImplementationOnce((array) => array.fill(0))
      .mockImplementationOnce((array) => array.fill(1));
    expect(newBlockId(new Set(["aaaaaaaa"]))).toBe("bbbbbbbb");
  });

  it("draw block ID characters without bias, discarding bytes from 252 up", () => {
    vi.spyOn(crypto, "getRandomValues")
      .mockImplementationOnce((array) => {
        array.fill(0);
        array[0] = 252;
        return array;
      })
      .mockImplementationOnce((array) => array.fill(35));
    expect(newBlockId()).toBe("aaaaaaa9");
  });
});

describe("isBlockId", () => {
  it("accepts what Obsidian accepts after ^", () => {
    expect(isBlockId("req-sync")).toBe(true);
    expect(isBlockId("A1")).toBe(true);
    expect(isBlockId("a".repeat(64))).toBe(true);
  });

  it("rejects the rest", () => {
    expect(isBlockId("")).toBe(false);
    expect(isBlockId("a b")).toBe(false);
    expect(isBlockId("^abc")).toBe(false);
    expect(isBlockId("a".repeat(65))).toBe(false);
  });
});
