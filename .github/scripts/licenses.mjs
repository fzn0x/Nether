// What ADR 0001 allows (docs/adr/0001-license-agpl-and-dco.md), and a
// check of SPDX license expressions against it.

export const allowed = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "Zlib",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "MPL-2.0",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  // Content licenses, for data only, such as browser support tables.
  "CC-BY-4.0",
]);
export const allowedExceptions = new Set(["LLVM-exception"]);

// Packages whose license field is missing or not SPDX, checked by hand:
// "name": "the license found, and where".
export const reviewed = {};

/** Whether an SPDX expression such as "(MIT OR Apache-2.0)" is allowed. */
export function permits(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function either() {
    let result = both();
    while (peek()?.toUpperCase() === "OR") {
      take();
      result = both() || result;
    }
    return result;
  }
  function both() {
    let result = single();
    while (peek()?.toUpperCase() === "AND") {
      take();
      result = single() && result;
    }
    return result;
  }
  function single() {
    const token = take();
    if (token === "(") {
      const result = either();
      if (take() !== ")") throw new Error("unbalanced parentheses");
      return result;
    }
    if (token === undefined || token === ")") throw new Error("missing license");
    const id = token.replace(/\+$/, "");
    if (peek()?.toUpperCase() === "WITH") {
      take();
      return allowed.has(id) && allowedExceptions.has(take() ?? "");
    }
    return allowed.has(id);
  }

  try {
    const result = either();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}
