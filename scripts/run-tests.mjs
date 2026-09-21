#!/usr/bin/env node
/** Runs the compiled test files.
 *
 * `node --test .build-test/test/*.test.js` relies on the shell expanding the
 * glob, which PowerShell does not do, and on Node expanding it itself, which
 * only Node 22+ does. Listing the files here works the same everywhere. */

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(root, ".build-test", "test");

let files;
try {
  files = readdirSync(directory).filter((name) => name.endsWith(".test.js"));
} catch {
  console.error(`No compiled tests in ${directory} — run \`npm run pretest\` first.`);
  process.exit(1);
}
if (!files.length) {
  console.error(`No *.test.js files in ${directory}.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", ...process.argv.slice(2), ...files.map((file) => join(directory, file))],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
