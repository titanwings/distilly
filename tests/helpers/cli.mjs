/**
 * Shared CLI test helper: spawn `bin/distilly.mjs` and parse its receipt.
 * Plain `.mjs` (not `*.test.mjs`) so `node --test` does not collect it twice.
 */

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const cliPath = join(projectRoot, "bin", "distilly.mjs");

export function runCli(args, { cwd = projectRoot, env = {} } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** `--json` output is one object; everything before it is whitespace. */
export function parseReceipt(stdout) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1, `no JSON receipt in stdout: ${stdout}`);
  return JSON.parse(stdout.slice(start));
}
