/**
 * Port of `tests/test_install_hermes_skill.py` (the repo-level installer that
 * `install_codex_skill.py` and `install_openclaw_skill.py` also implement).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installRepoSkill } from "../src/install/hosts.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-hermes-"));
}

test("install copies the repo layout", () => {
  const root = tempDir();
  try {
    const source = join(root, "source");
    const destination = join(root, "dest", "distilly");
    mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "name: distilly\n", "utf8");
    writeFileSync(join(source, "README.md"), "# Distilly\n", "utf8");

    const installed = installRepoSkill({ source, destination });
    assert.equal(installed, destination);
    assert.ok(existsSync(join(destination, "SKILL.md")));
    assert.ok(existsSync(join(destination, "README.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install skips metadata a host should not receive", () => {
  const root = tempDir();
  try {
    const source = join(root, "source");
    mkdirSync(join(source, "__pycache__"), { recursive: true });
    mkdirSync(join(source, ".git"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "name: distilly\n", "utf8");
    writeFileSync(join(source, "__pycache__", "x.pyc"), "", "utf8");
    writeFileSync(join(source, ".git", "config"), "", "utf8");
    writeFileSync(join(source, "stale.pyc"), "", "utf8");

    const destination = join(root, "dest", "distilly");
    installRepoSkill({ source, destination });

    assert.ok(existsSync(join(destination, "SKILL.md")));
    assert.equal(existsSync(join(destination, "__pycache__")), false);
    assert.equal(existsSync(join(destination, ".git")), false);
    assert.equal(existsSync(join(destination, "stale.pyc")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry run does not write and tolerates an existing destination", () => {
  const root = tempDir();
  try {
    const source = join(root, "source");
    const destination = join(root, "dest", "distilly");
    mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "name: distilly\n", "utf8");

    installRepoSkill({ source, destination, dryRun: true });
    assert.equal(existsSync(destination), false);

    mkdirSync(destination, { recursive: true });
    const result = installRepoSkill({ source, destination, dryRun: true });
    assert.equal(result, destination);
    assert.ok(existsSync(destination));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry run does not delete the source when it is already the destination", () => {
  const root = tempDir();
  try {
    const source = join(root, "distilly");
    mkdirSync(source);
    const skillFile = join(source, "SKILL.md");
    writeFileSync(skillFile, "name: distilly\n", "utf8");

    const result = installRepoSkill({ source, destination: source, force: true });

    assert.equal(result, source);
    assert.ok(existsSync(skillFile));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install rejects nested or ancestor destinations", () => {
  const root = tempDir();
  try {
    const source = join(root, "parent", "source");
    mkdirSync(source, { recursive: true });
    const skillFile = join(source, "SKILL.md");
    writeFileSync(skillFile, "name: distilly\n", "utf8");
    const nested = join(source, ".hermes", "skills", "distilly");

    assert.throws(() => installRepoSkill({ source, destination: nested, force: true }), /must not overlap/);
    assert.throws(
      () => installRepoSkill({ source, destination: join(root, "parent"), force: true }),
      /must not overlap/,
    );

    assert.ok(existsSync(skillFile));
    assert.equal(existsSync(nested), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
