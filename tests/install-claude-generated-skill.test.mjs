/**
 * Port of `tests/test_install_claude_generated_skill.py`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installGeneratedSkillForClaude, shouldInstallCommandShim } from "../src/install/hosts.mjs";
import { createSkill } from "../src/skill/writer.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-claude-"));
}

test("install writes the Claude skill folder and its install metadata", () => {
  const root = tempDir();
  try {
    const generatedRoot = join(root, "skills", "celebrity");
    const claudeSkills = join(root, ".claude", "skills");

    const skillDir = createSkill(
      generatedRoot,
      "zhou-qimo",
      { character: "celebrity", name: "周奇墨", classification: { language: "zh-CN" } },
      "Work body",
      "Persona body",
    );

    const result = installGeneratedSkillForClaude({ skillDir, skillsDir: claudeSkills, force: true });

    const installedFile = join(claudeSkills, "celebrity-zhou-qimo", "SKILL.md");
    const metadataFile = join(claudeSkills, "celebrity-zhou-qimo", ".distilly-install.json");

    assert.equal(result.command_name, "celebrity-zhou-qimo");
    assert.ok(existsSync(installedFile));
    assert.ok(existsSync(metadataFile));
    assert.match(readFileSync(installedFile, "utf8"), /name: celebrity-zhou-qimo/);
    assert.equal(result.command_shim_installed, false);
    assert.equal(result.command_path, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install can write the Windows command shim", () => {
  const root = tempDir();
  try {
    const generatedRoot = join(root, "skills", "relationship");
    const claudeSkills = join(root, ".claude", "skills");
    const claudeCommands = join(root, ".claude", "commands");

    const skillDir = createSkill(
      generatedRoot,
      "mireille",
      { character: "relationship", name: "Mireille" },
      "Work body",
      "Persona body",
    );

    const result = installGeneratedSkillForClaude({
      skillDir,
      skillsDir: claudeSkills,
      commandsDir: claudeCommands,
      force: true,
      installCommandShim: true,
    });

    const commandFile = join(claudeCommands, "relationship-mireille.md");
    assert.equal(result.command_shim_installed, true);
    assert.equal(result.command_path, commandFile);
    assert.ok(existsSync(commandFile));
    assert.match(readFileSync(commandFile, "utf8"), /name: relationship-mireille/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows detection only enables the command shim on Windows", () => {
  assert.equal(shouldInstallCommandShim("Windows"), true);
  assert.equal(shouldInstallCommandShim("Darwin"), false);
});
