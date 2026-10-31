// Passwords, kept only as argon2id hashes with OWASP's parameters: 19 MiB
// of memory, two passes, one lane. hash-wasm runs argon2 in WebAssembly, so
// the server needs no native build on any system its image runs on.
import { randomBytes } from "node:crypto";
import { argon2Verify, argon2id } from "hash-wasm";

/** The shortest password an account may have. */
export const minimumPasswordLength = 12;

/** A password's hash, as the encoded string argon2 writes, its salt and parameters in it. */
export function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 2,
    memorySize: 19_456,
    hashLength: 32,
    outputType: "encoded",
  });
}

/** Whether a password is the one an encoded hash was made from. */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2Verify({ password, hash });
}
