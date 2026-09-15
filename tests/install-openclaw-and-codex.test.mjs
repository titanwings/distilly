/**
 * Port of `tests/test_install_openclaw_and_codex.py`: the repo-level installers
 * share one implementation, the generated-skill installers differ only in the
 * host id they record.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installGeneratedSkill, installRepoSkill } from "../src/install/hosts.mjs";
import { createSkill } from "../src/skill/writer.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-openclaw-"));
}

test("openclaw and codex repo installers copy the repo layout", () => {
  const root = tempDir();
  try {
    const source = join(root, "source");
    mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "name: distilly\n", "utf8");
    writeFileSync(join(source, "README.md"), "# Distilly\n", "utf8");

    const openclawDest = join(root, "openclaw", "distilly");
    const codexDest = join(root, "agents", "distilly");

    assert.equal(installRepoSkill({ source, destination: openclawDest }), openclawDest);
    assert.equal(installRepoSkill({ source, destination: codexDest }), codexDest);
    assert.ok(existsSync(join(openclawDest, "SKILL.md")));
    assert.ok(existsSync(join(codexDest, "SKILL.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repo installers do not delete the source when it is already the destination", () => {
  const root = tempDir();
  try {
    const source = join(root, "distilly");
    mkdirSync(source);
    const skillFile = join(source, "SKILL.md");
    writeFileSync(skillFile, "name: distilly\n", "utf8");

    assert.equal(installRepoSkill({ source, destination: source, force: true }), source);
    assert.ok(existsSync(skillFile));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repo installers reject nested or ancestor destinations", () => {
  const root = tempDir();
  try {
    const source = join(root, "parent", "source");
    mkdirSync(source, { recursive: true });
    const skillFile = join(source, "SKILL.md");
    writeFileSync(skillFile, "name: distilly\n", "utf8");
    const nested = join(source, ".agents", "skills", "distilly");

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

test("openclaw generated-skill installer writes the host skill folder", () => {
  const root = tempDir();
  try {
    const generatedRoot = join(root, "skills", "relationship");
    const openclawSkills = join(root, ".openclaw", "workspace", "skills");

    const skillDir = createSkill(
      generatedRoot,
      "mireille",
      { character: "relationship", name: "Mireille" },
      "Work body",
      "Persona body",
    );

    const result = installGeneratedSkill({
      skillDir,
      skillsDir: openclawSkills,
      force: true,
      host: "openclaw",
    });

    const installedFile = join(openclawSkills, "relationship-mireille", "SKILL.md");
    const metadataFile = join(openclawSkills, "relationship-mireille", ".distilly-install.json");

    assert.equal(result.command_name, "relationship-mireille");
    assert.ok(existsSync(installedFile));
    assert.ok(existsSync(metadataFile));
    assert.match(readFileSync(installedFile, "utf8"), /name: relationship-mireille/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("codex generated-skill installer writes the host skill folder", () => {
  const root = tempDir();
  try {
    const generatedRoot = join(root, "skills", "celebrity");
    const codexSkills = join(root, ".agents", "skills");

    const skillDir = createSkill(
      generatedRoot,
      "zhou-qimo",
      { character: "celebrity", name: "周奇墨", classification: { language: "zh-CN" } },
      "Work body",
      "Persona body",
    );

    const result = installGeneratedSkill({ skillDir, skillsDir: codexSkills, force: true, host: "codex" });

    const installedFile = join(codexSkills, "celebrity-zhou-qimo", "SKILL.md");
    const metadataFile = join(codexSkills, "celebrity-zhou-qimo", ".distilly-install.json");

    assert.equal(result.command_name, "celebrity-zhou-qimo");
    assert.ok(existsSync(installedFile));
    assert.ok(existsSync(metadataFile));
    assert.match(readFileSync(installedFile, "utf8"), /name: celebrity-zhou-qimo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an existing install is only replaced with force", () => {
  const root = tempDir();
  try {
    const generatedRoot = join(root, "skills", "relationship");
    const skillsDir = join(root, ".agents", "skills");
    const skillDir = createSkill(
      generatedRoot,
      "mireille",
      { character: "relationship", name: "Mireille" },
      "Work body",
      "Persona body",
    );

    installGeneratedSkill({ skillDir, skillsDir, host: "codex" });
    assert.throws(() => installGeneratedSkill({ skillDir, skillsDir, host: "codex" }), /already exists/);
    installGeneratedSkill({ skillDir, skillsDir, host: "codex", force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
