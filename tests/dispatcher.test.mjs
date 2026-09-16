/**
 * Entry-point contract: dispatch, bilingual help, JSON receipts, exit codes.
 *
 * Ported/expanded from the CLI half of `tests/test_cli_lifecycle.py`, plus the
 * registration point promised by `docs/v2/CONTRACT.md` §1.
 */

import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PLANNED, listCommandDetails, listCommands, missingCommandError, resolveCommand } from "../src/commands/index.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(projectRoot, "bin", "distilly.mjs");

/**
 * A scratch home for the host lookups the CLI performs.
 *
 * `install <host>` and `doctor` resolve `$DSH_HOME/skills/distilly` (and every other
 * host's directory) from the environment. Inheriting the developer's real
 * `$DSH_HOME` made both depend on whether *this machine* happens to have Distilly
 * installed for DeepSeek Harness: with one installed, `install --dry-run` found an
 * existing directory and reported outputs, and `doctor` inventoried it — red for a
 * reason that had nothing to do with the code under test.
 */
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "dst-test-home-"));

export function runCli(args, { cwd = projectRoot, env = {} } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      DSH_HOME: join(ISOLATED_HOME, "dsh"),
      DSH_AGENTS_HOME: join(ISOLATED_HOME, "agents"),
      ...env,
    },
  });
}

function parseReceipt(stdout) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1, `no JSON receipt in stdout: ${stdout}`);
  return JSON.parse(stdout.slice(start));
}

test("--help prints one Chinese section, a --- divider and an English section", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /用法：/);
  assert.match(result.stdout, /\n---\n/);
  assert.match(result.stdout, /## English/);
  assert.match(result.stdout, /Usage:/);
});

test("--version prints the package version", () => {
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("an unknown command exits non-zero and is not confused with a planned one", () => {
  const result = runCli(["definitely-not-a-command"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown command: definitely-not-a-command/);
});

test("a contract-frozen command with no implementation fails loudly and names its branch", () => {
  // v2 ships every CONTRACT §1 command, so `PLANNED` is empty and no *live*
  // command can be used to exercise this path. The mechanism still carries the
  // ds/02..ds/09 traffic while those branches are in flight, so it is asserted
  // directly, with a temporary entry, instead of being dropped.
  assert.deepEqual(Object.keys(PLANNED), [], "PLANNED must be empty once every command ships");
  PLANNED["harvest"] = "ds/02-parse-zero-cred";
  try {
    const planned = missingCommandError("harvest");
    assert.equal(planned.code, "not-implemented");
    assert.match(planned.message, /not implemented/i);
    assert.match(planned.remedy, /ds\/02-parse-zero-cred/);
  } finally {
    delete PLANNED["harvest"];
  }
  assert.equal(missingCommandError("definitely-not-a-command").code, "unknown-command");
});

test("skill commands are registered and answer with a receipt", () => {
  const names = listCommands();
  for (const name of ["skill", "skill create", "skill update", "skill list", "skill version"]) {
    assert.ok(names.includes(name), `${name} is not registered`);
  }
});

test("--json emits a receipt with the contract shape and nothing else on stdout", () => {
  const result = runCli(["skill", "list", "--character", "colleague", "--skills-dir", "tests", "--json"]);
  assert.equal(result.status, 0);
  const receipt = parseReceipt(result.stdout);
  assert.deepEqual(Object.keys(receipt).slice(0, 8), [
    "command",
    "person",
    "ok",
    "inputs",
    "outputs",
    "anchors",
    "warnings",
    "unavailable",
  ]);
  assert.equal(typeof receipt.ok, "boolean");
  assert.ok(Array.isArray(receipt.inputs));
  assert.ok(Array.isArray(receipt.outputs));
});

test("the registry is the single registration point and prefers two-token names", () => {
  const names = listCommands();
  assert.ok(names.includes("skill create"), `registered: ${names.join(", ")}`);
  assert.deepEqual(resolveCommand(["skill", "create", "--slug", "x"]), {
    name: "skill create",
    rest: ["--slug", "x"],
  });
  assert.deepEqual(resolveCommand(["install", "claude-code"]), {
    name: "install",
    rest: ["claude-code"],
  });
  for (const [name, branch] of Object.entries(PLANNED)) {
    assert.match(branch, /^ds\/\d\d-/);
    assert.ok(!names.includes(name), `${name} should not be registered by this branch yet`);
  }
});

test("every registered command answers --help with bilingual text", () => {
  for (const command of listCommandDetails({ includeHidden: true })) {
    const result = runCli(command.name.split(" ").concat("--help"));
    assert.equal(result.status, 0, `${command.name} --help exited ${result.status}`);
    assert.match(result.stdout, /\n---\n/, `${command.name} help is not bilingual`);
  }
});
