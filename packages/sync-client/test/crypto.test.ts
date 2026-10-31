// The cryptography of encrypted workspaces: the recovery phrase and the
// private key's box, sealed workspace keys, and encrypted updates bound to
// their document and key version.
import { describe, expect, it } from "vitest";
import {
  decryptUpdate,
  encryptUpdate,
  isRecoveryPhrase,
  keyPairOf,
  lockPrivateKey,
  newKeyPair,
  newRecoveryPhrase,
  newWorkspaceKey,
  openKey,
  recoveryWords,
  sealKey,
  unlockPrivateKey,
} from "../src/crypto.ts";

describe("the recovery phrase", () => {
  it("is 24 words of BIP39's list, typed in any case and spacing", () => {
    const phrase = newRecoveryPhrase();
    expect(phrase.split(" ")).toHaveLength(24);
    expect(newRecoveryPhrase()).not.toBe(phrase);
    expect(isRecoveryPhrase(phrase)).toBe(true);
    expect(isRecoveryPhrase(`  ${phrase.toUpperCase().replaceAll(" ", "\n  ")} `)).toBe(true);
    expect(recoveryWords(phrase.toUpperCase())).toEqual(phrase.split(" "));
    // A word off, a word short, or a word not in the list.
    const words = phrase.split(" ");
    expect(
      isRecoveryPhrase([...words.slice(0, 23), words[0] === "zoo" ? "abandon" : "zoo"].join(" ")),
    ).toBe(false);
    expect(isRecoveryPhrase(words.slice(0, 23).join(" "))).toBe(false);
    expect(isRecoveryPhrase([...words.slice(0, 23), "nether"].join(" "))).toBe(false);
  });

  it("locks the private key in a box that opens with it, for its account only", async () => {
    const pair = await newKeyPair();
    const phrase = newRecoveryPhrase();
    const box = await lockPrivateKey(pair.privateKey, phrase, "user-1");
    expect(box.length).toBeLessThanOrEqual(256);
    expect(await unlockPrivateKey(box, ` ${phrase.toUpperCase()} `, "user-1")).toEqual(
      pair.privateKey,
    );
    await expect(unlockPrivateKey(box, newRecoveryPhrase(), "user-1")).rejects.toThrow(
      "That recovery phrase does not open this account's key.",
    );
    await expect(unlockPrivateKey(box, phrase, "user-2")).rejects.toThrow();
    await expect(unlockPrivateKey(box, "not a phrase", "user-1")).rejects.toThrow(
      "That is not a recovery phrase.",
    );
    expect((await keyPairOf(pair.privateKey)).publicKey).toEqual(pair.publicKey);
  });
});

describe("workspace keys and updates", () => {
  it("seals a workspace's key so only its member's private key opens it", async () => {
    const ada = await newKeyPair();
    const eve = await newKeyPair();
    const key = await newWorkspaceKey();
    const sealed = await sealKey(key, ada.publicKey);
    expect(await openKey(sealed, ada)).toEqual(key);
    await expect(openKey(sealed, eve)).rejects.toThrow(
      "This workspace's key was not sealed to this account's key.",
    );
  });

  it("encrypts an update for its document, readable with its key's version only", async () => {
    const key = { version: 3, key: await newWorkspaceKey() };
    const keys = new Map([[3, key.key]]);
    const update = new TextEncoder().encode("a secret plan");
    const name = "workspace/note";
    const data = await encryptUpdate(update, key, name);
    expect(new TextDecoder().decode(data)).not.toContain("secret");
    expect(await decryptUpdate(data, keys, name)).toEqual(update);
    // Moved to another document, changed, or of a key this device lacks.
    await expect(decryptUpdate(data, keys, "workspace/other")).rejects.toThrow(
      "does not open with this workspace's key",
    );
    const changed = data.slice();
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    await expect(decryptUpdate(changed, keys, name)).rejects.toThrow();
    await expect(decryptUpdate(data, new Map([[1, key.key]]), name)).rejects.toThrow(
      "This device has no key of version 3.",
    );
    // A new nonce each time.
    expect(await encryptUpdate(update, key, name)).not.toEqual(data);
  });
});
