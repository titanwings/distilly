/**
 * Entry guards must survive a symlinked path.
 *
 * The natural spelling — `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`
 * — compares a caller-supplied path against a realpath. Under a symlink they
 * differ, the file concludes it was imported, and it exits 0 having done nothing.
 * Both halves of that are real here: `/tmp` is a symlink to `/private/tmp` on
 * macOS, and an npm `bin` shim (`node_modules/.bin/distilly`) is a symlink, so a
 * published CLI would silently ignore every command.
 *
 * Each case runs the file through a symlink and asserts it produced its real
 * output, which is the difference between "did the work" and "exited cleanly".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isEntryPoint } from "../src/cli/entry.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Run `relative` through a symlink in a fresh temp directory. */
function throughSymlink(relative, args) {
  const dir = mkdtempSync(path.join(tmpdir(), "entry-"));
  try {
    const link = path.join(dir, path.basename(relative));
    symlinkSync(path.join(root, relative), link);
    return spawnSync(process.execPath, [link, ...args], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the helper agrees that a symlink to this file is this file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "entry-self-"));
  try {
    const link = path.join(dir, "entry.mjs");
    symlinkSync(fileURLToPath(import.meta.url), link);
    // Simulate being started as that symlink.
    const original = process.argv[1];
    process.argv[1] = link;
    try {
      assert.equal(isEntryPoint(import.meta.url), true);
      process.argv[1] = path.join(dir, "something-else.mjs");
      assert.equal(isEntryPoint(import.meta.url), false);
      process.argv[1] = path.join(dir, "does-not-exist.mjs");
      assert.equal(isEntryPoint(import.meta.url), false, "an unresolvable path is not an entry point");
    } finally {
      process.argv[1] = original;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`distilly --version` works when reached through a symlink", () => {
  // This is how npm invokes a package binary, so it is the shape that ships.
  const result = throughSymlink(path.join("bin", "distilly.mjs"), ["--version"]);
  assert.equal(result.status, 0, result.stderr);
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  assert.equal(result.stdout.trim(), version, "the CLI must not exit silently under a symlink");
});

test("`distilly help` works when reached through a symlink", () => {
  const result = throughSymlink(path.join("bin", "distilly.mjs"), ["help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法/, "help must render, not exit 0 with nothing");
});

test("`blind-test.mjs` dispatches when reached through a symlink", () => {
  // Before the fix this exited 0 with no output at all: the command was dropped.
  const result = throughSymlink(
    path.join("scripts", "blind-test.mjs"),
    ["score", "--scores", path.join(root, "no-such-scores.json")],
  );
  assert.notEqual(result.status, 0, "a missing scores file is an error, not a silent success");
  assert.match(
    `${result.stdout}${result.stderr}`,
    /no-such-scores\.json/,
    "the command must actually run and report the missing file",
  );
});
