// Checks that every dependency's license is one that ADR 0001 allows
// (docs/adr/0001-license-agpl-and-dco.md): the npm packages pnpm installed
// on this platform, and the Go modules compiled into the desktop app for
// each of its platforms. Fails on any other license, and on a license it
// cannot read, which a person must then review and record below.
//
//   node .github/scripts/check-licenses.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { allowed, permits, reviewed } from "./licenses.mjs";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // On Windows, pnpm is a .cmd script that only a shell can start. Go is
    // a program, and its arguments must not pass through a shell.
    shell: process.platform === "win32" && command === "pnpm",
    ...options,
  });
}

function checkNpm() {
  const byLicense = JSON.parse(run("pnpm", ["licenses", "list", "--json"]));
  const problems = [];
  let count = 0;
  for (const [license, packages] of Object.entries(byLicense)) {
    for (const item of packages) {
      count++;
      if (permits(license) || reviewed[item.name] !== undefined) continue;
      problems.push(`${license}\t${item.name}@${item.versions.join(", ")}`);
    }
  }
  return { count, problems };
}

// Recognizes a license file by phrases from its text.
const licenseTexts = [
  ["MIT", ["Permission is hereby granted, free of charge", 'THE SOFTWARE IS PROVIDED "AS IS"']],
  ["Apache-2.0", ["Apache License", "Version 2.0"]],
  ["BSD-3-Clause", ["Redistribution and use in source and binary forms", "Neither the name of"]],
  ["BSD-2-Clause", ["Redistribution and use in source and binary forms"]],
  ["ISC", ["Permission to use, copy, modify, and/or distribute this software for any purpose"]],
  ["MPL-2.0", ["Mozilla Public License Version 2.0"]],
  ["Unlicense", ["This is free and unencumbered software released into the public domain"]],
];
const licenseFiles = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];

function identify(directory) {
  for (const name of licenseFiles) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").replace(/\s+/g, " ");
    const match = licenseTexts.find(([, phrases]) =>
      phrases.every((phrase) => text.includes(phrase)),
    );
    return match?.[0] ?? `unrecognized text in ${name}`;
  }
  return "no license file";
}

function checkGo(moduleDirectory) {
  const modules = new Map();
  for (const goos of ["linux", "windows", "darwin"]) {
    const output = run(
      "go",
      [
        "list",
        "-deps",
        "-f",
        "{{with .Module}}{{if not .Main}}{{.Path}}@{{.Version}}\t{{.Dir}}{{end}}{{end}}",
        "./...",
      ],
      { cwd: moduleDirectory, env: { ...process.env, GOOS: goos } },
    );
    for (const line of output.split("\n")) {
      const [module, directory] = line.trim().split("\t");
      if (module && directory) modules.set(module, directory);
    }
  }
  const problems = [];
  for (const [module, directory] of modules) {
    const license = identify(directory);
    if (!allowed.has(license)) problems.push(`${license}\t${module}`);
  }
  return { count: modules.size, problems };
}

const npm = checkNpm();
const go = checkGo("apps/desktop");
const problems = [...npm.problems, ...go.problems];
if (problems.length > 0) {
  console.error("These dependencies have a license ADR 0001 does not allow, or one to review:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Licenses allowed: ${String(npm.count)} npm packages, ${String(go.count)} Go modules.`,
  );
}
