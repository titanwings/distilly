/**
 * Schema v4 migration: additive, idempotent, never rewrites a body.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { SCHEMA_VERSION } from "../src/skill/schema.mjs";
import { V4_DIRECTORIES, findSkillDirs, migrateSkillDir, readSchemaVersion } from "../src/skill/migrate.mjs";

const BIN = join(import.meta.dirname, "..", "bin", "distilly.mjs");
const PERSONA = "# 张三\n\n先说结论，再讲为什么。\n";
const SKILL = "---\nname: 张三\n---\n\n# 张三\n";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-migrate-"));
}

/** A minimal v3 directory: six artifacts minus the v4 layout. */
function makeV3(baseDir, slug = "old-person") {
  const dir = join(baseDir, "skills", "colleague", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), SKILL, "utf8");
  writeFileSync(join(dir, "persona.md"), PERSONA, "utf8");
  writeFileSync(join(dir, "work.md"), "# 工作\n", "utf8");
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ name: "张三", slug, character: "colleague", schema_version: "3", lifecycle: { version: "v1" } }, null, 2),
    "utf8",
  );
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ slug, schema_version: "3", artifacts: {} }, null, 2), "utf8");
  return dir;
}

/** Every file under `dir` with its sha256, for byte-equality assertions. */
function fingerprint(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[relative(dir, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

test("the engine reports schema v4", () => {
  assert.equal(SCHEMA_VERSION, "4");
});

test("migrating a v3 directory adds the v4 layout and touches no body", () => {
  const base = tempDir();
  try {
    const dir = makeV3(base);
    const before = { persona: readFileSync(join(dir, "persona.md")), skill: readFileSync(join(dir, "SKILL.md")) };

    assert.equal(readSchemaVersion(dir), "3");
    const result = migrateSkillDir(dir);

    assert.equal(result.from, "3");
    assert.equal(result.to, "4");
    assert.equal(result.changed, true);
    for (const relativePath of V4_DIRECTORIES) {
      assert.ok(existsSync(join(dir, relativePath)), `${relativePath} must exist after migration`);
    }
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "knowledge", "index.json"), "utf8")), []);

    assert.equal(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).schema_version, "4");
    assert.equal(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).schema_version, "4");
    assert.ok(readFileSync(join(dir, "persona.md")).equals(before.persona), "persona.md must keep its bytes");
    assert.ok(readFileSync(join(dir, "SKILL.md")).equals(before.skill), "SKILL.md must keep its bytes");
    assert.equal(readSchemaVersion(dir), "4");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("running the migration twice writes nothing the second time", () => {
  const base = tempDir();
  try {
    const dir = makeV3(base);
    migrateSkillDir(dir);
    const after = fingerprint(dir);
    const stamps = Object.fromEntries(Object.keys(after).map((key) => [key, statSync(join(dir, key)).mtimeMs]));

    const second = migrateSkillDir(dir);

    assert.equal(second.changed, false);
    assert.deepEqual(second.actions, []);
    assert.deepEqual(fingerprint(dir), after, "no file may change on a second run");
    for (const [key, mtime] of Object.entries(stamps)) {
      assert.equal(statSync(join(dir, key)).mtimeMs, mtime, `${key} was rewritten`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("--dry-run reports the plan and writes nothing", () => {
  const base = tempDir();
  try {
    const dir = makeV3(base);
    const before = fingerprint(dir);

    const result = migrateSkillDir(dir, { dryRun: true });

    assert.equal(result.changed, true);
    assert.ok(result.actions.some((action) => action.includes("knowledge/raw")));
    assert.deepEqual(fingerprint(dir), before, "a dry run must not touch the directory");
    assert.equal(readSchemaVersion(dir), "3");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("findSkillDirs walks families and skips directories without artifacts", () => {
  const base = tempDir();
  try {
    makeV3(base, "one");
    makeV3(base, "two");
    mkdirSync(join(base, "skills", "colleague", "not-a-skill"), { recursive: true });
    mkdirSync(join(base, "skills", "relationship", "three"), { recursive: true });
    writeFileSync(join(base, "skills", "relationship", "three", "meta.json"), JSON.stringify({ slug: "three" }), "utf8");

    const found = findSkillDirs(base).map((dir) => relative(base, dir).replaceAll("\\", "/"));

    assert.deepEqual(found, ["skills/colleague/one", "skills/colleague/two", "skills/relationship/three"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the CLI reports a contract-shaped receipt and is idempotent", () => {
  const base = tempDir();
  try {
    makeV3(base);
    const run = () => {
      const result = spawnSync(process.execPath, [BIN, "skill", "migrate", "--base-dir", base, "--json"], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    };

    const first = run();
    assert.equal(first.command, "skill migrate");
    assert.equal(first.ok, true);
    assert.equal(first.target_schema_version, "4");
    assert.equal(first.skills.length, 1);
    assert.equal(first.skills[0].from, "3");
    assert.equal(first.skills[0].changed, true);

    const second = run();
    assert.equal(second.skills[0].changed, false, "a migrated directory must report no change");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
