// node --test ".github/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";
import { permits } from "./licenses.mjs";

test("allows the licenses ADR 0001 lists, alone and combined", () => {
  for (const expression of [
    "MIT",
    "Apache-2.0",
    "(MIT OR Apache-2.0)",
    "Apache-2.0 AND LGPL-3.0-or-later",
    "MIT AND (BSD-3-Clause OR GPL-2.0-only)",
    "GPL-3.0 OR PROPRIETARY",
    "Apache-2.0 WITH LLVM-exception",
    "GPL-3.0+",
  ]) {
    assert.equal(permits(expression), true, expression);
  }
});

test("refuses other licenses, unknown ones and malformed expressions", () => {
  for (const expression of [
    "GPL-2.0-only",
    "MIT AND GPL-2.0-only",
    "BUSL-1.1",
    "SSPL-1.0",
    "GPL-2.0-only WITH Classpath-exception-2.0",
    "MIT WITH Some-exception",
    "SEE LICENSE IN LICENSE.md",
    "Unknown",
    "UNLICENSED",
    "",
    "(MIT",
    "MIT)",
    "MIT OR",
  ]) {
    assert.equal(permits(expression), false, expression);
  }
});
