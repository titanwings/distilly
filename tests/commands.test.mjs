/**
 * Coverage for the CLI surface this branch adds: install / uninstall / doctor /
 * legacy forwarding, plus the receipt discipline (`--json` stdout is one object).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "./dispatcher.test.mjs";
import { supportedHosts } from "../src/install/hosts.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-cmd-"));
}

function parseReceipt(stdout) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1, `no receipt on stdout: ${stdout}`);
  return JSON.parse(stdout.slice(start));
}

test("install --path copies the payload and reports it with a receipt", () => {
  const root = tempDir();
  try {
    const target = join(root, "host", "skills", "distilly");
    const result = runCli(["install", "--path", target, "--json"]);

    assert.equal(result.status, 0, result.stderr);
    const receipt = parseReceipt(result.stdout);
    assert.equal(receipt.command, "install");
    assert.equal(receipt.ok, true);
    assert.equal(receipt.host, null);
    assert.ok(receipt.outputs.length > 0);
    for (const output of receipt.outputs) {
      assert.equal(typeof output.path, "string");
      assert.equal(typeof output.sha256, "string");
      assert.equal(typeof output.bytes, "number");
    }
    assert.ok(existsSync(join(target, "SKILL.md")));
    assert.ok(existsSync(join(target, "src", "commands", "index.mjs")));

    // A second install without --force refuses and points at the remedy.
    const again = runCli(["install", "--path", target, "--json"]);
    assert.notEqual(again.status, 0);
    const failed = parseReceipt(again.stdout);
    assert.equal(failed.ok, false);
    assert.match(failed.error.remedy, /--force/);

    // --force replaces it and preserves the previous copy.
    const forced = runCli(["install", "--path", target, "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /Previous install preserved at/);
    assert.ok(existsSync(target));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install refuses a target whose final segment is not distilly", () => {
  const root = tempDir();
  try {
    const result = runCli(["install", "--path", join(root, "somewhere-else")]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must end with a directory named distilly/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install <host> resolves the documented directory from the shared matrix", () => {
  const home = tempDir();
  try {
    for (const host of supportedHosts()) {
      const result = runCli(["install", host, "--dry-run", "--json"], { env: { HOME: home } });
      assert.equal(result.status, 0, `${host}: ${result.stderr}`);
      const receipt = parseReceipt(result.stdout);
      assert.equal(receipt.host, host);
      assert.equal(receipt.dry_run, true);
      assert.equal(receipt.outputs.length, 0, "dry run must not write");
    }
    // the project scope is only offered where the host documents one
    const openclawProject = runCli(["install", "openclaw", "--project", "--dry-run"], { env: { HOME: home } });
    assert.notEqual(openclawProject.status, 0);
    assert.match(openclawProject.stderr, /no documented project-local directory/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall removes an install, keeps a backup on request and refuses strangers", () => {
  const root = tempDir();
  try {
    const target = join(root, "host", "skills", "distilly");
    assert.equal(runCli(["install", "--path", target]).status, 0);

    const dryRun = runCli(["uninstall", "--path", target, "--dry-run"]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.ok(existsSync(target), "dry run must not delete");

    const removed = runCli(["uninstall", "--path", target, "--backup"]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /kept at/);
    assert.equal(existsSync(target), false);

    // A directory that is not a Distilly install needs --force.
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "---\nname: something-else\n---\n", "utf8");
    const refused = runCli(["uninstall", "--path", target]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /not a Distilly install/);
    assert.equal(existsSync(target), true);

    const forced = runCli(["uninstall", "--path", target, "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor inventories every host and names what this build cannot do yet", () => {
  const home = tempDir();
  try {
    const result = runCli(["doctor", "--json"], { env: { HOME: home } });
    assert.equal(result.status, 0, result.stderr);
    const receipt = parseReceipt(result.stdout);

    assert.equal(receipt.command, "doctor");
    assert.ok(Array.isArray(receipt.hosts));
    assert.deepEqual(
      receipt.hosts.map((row) => row.host),
      supportedHosts(),
    );
    for (const row of receipt.hosts) {
      assert.equal(row.installed, false);
      assert.equal(typeof row.path, "string");
    }
    // This assertion used to require `harvest`, `retrospect`, `view` and
    // `collect` to be listed as unavailable — written when they were still
    // planned. Every CONTRACT §1 command ships in v2 and `PLANNED` is empty
    // (`scripts/audit-objective.mjs` asserts exactly that), so the honest
    // assertion is now the opposite: nothing is outstanding, and a non-empty
    // list would mean a command regressed to "planned".
    assert.deepEqual(
      receipt.unavailable.map((item) => item.channel),
      [],
      "every CONTRACT §1 command is implemented in this build",
    );
    assert.deepEqual(receipt.anchors, { total: 0, cited: 0 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the legacy adapter forwards old command lines with a deprecation warning", () => {
  const root = tempDir();
  try {
    writeFileSync(join(root, "work.md"), "Work body\n", "utf8");
    const create = runCli(
      [
        "legacy",
        "tools/skill_writer.py",
        "--action",
        "create",
        "--character",
        "colleague",
        "--slug",
        "eulalie",
        "--name",
        "Eulalie",
        "--work",
        "work.md",
        "--base-dir",
        "skills/colleague",
      ],
      { cwd: root },
    );
    assert.equal(create.status, 0, create.stderr);
    assert.match(create.stdout, /Created skill:/);
    assert.match(create.stderr, /deprecated/);
    assert.ok(existsSync(join(root, "skills", "colleague", "eulalie", "SKILL.md")));

    const list = runCli(
      ["legacy", "skill_writer.py", "--action", "list", "--character", "colleague", "--base-dir", "skills/colleague"],
      { cwd: root },
    );
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /Found 1 skills:/);

    const version = runCli(
      ["legacy", "version_manager.py", "--action", "backup", "--slug", "eulalie", "--base-dir", "skills/colleague"],
      { cwd: root },
    );
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /archived version v1/);

    const unknown = runCli(["legacy", "feishu_parser.py"]);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /no legacy adapter/);

    const badAction = runCli(["legacy", "skill_writer.py", "--action", "explode"]);
    assert.notEqual(badAction.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--json keeps stdout machine-readable for every command this branch ships", () => {
  const root = tempDir();
  try {
    const invocations = [
      ["skill", "list", "--character", "colleague", "--base-dir", "skills/colleague", "--json"],
      ["doctor", "--json"],
      ["install", "codex", "--dry-run", "--json"],
    ];
    for (const args of invocations) {
      const result = runCli(args, { cwd: root, env: { HOME: root } });
      assert.doesNotThrow(() => JSON.parse(result.stdout), `${args.join(" ")} stdout is not pure JSON`);
      assert.equal(result.stdout.trim().startsWith("{"), true);
      assert.equal(result.stdout.trim().endsWith("}"), true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the packaged payload is complete", () => {
  const result = runCli(["--check-package"]);
  assert.equal(result.status, 0, result.stderr);
  // The verdict goes to stderr: `prepack` shares stdout with `npm pack --json`.
  assert.match(result.stderr, /payload is valid/);
  assert.equal(result.stdout, "", "`--check-package` must leave stdout clean for machine consumers");
  const skill = readFileSync(join(projectRoot, "SKILL.md"), "utf8");
  const version = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
  assert.ok(skill.includes(`version: "${version}"`));
});
