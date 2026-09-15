/**
 * Port of `tests/test_install_generated_skill.py` plus the drift guard that ties
 * `src/install/hosts.mjs` to the shared matrix in `src/hosts/agents.mjs`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultSkillsDir,
  generatedSkillsRoot,
  installGeneratedSkill,
  repoInstallDir,
  supportedHosts,
} from "../src/install/hosts.mjs";
import { listAgents } from "../src/hosts/agents.mjs";
import { createSkill } from "../src/skill/writer.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-install-"));
}

function createLegacySkill(root) {
  const skillDir = createSkill(
    root,
    "mireille",
    { character: "relationship", name: "Mireille" },
    "Work body",
    "Persona body",
  );
  const skillPath = join(skillDir, "SKILL.md");
  writeFileSync(
    skillPath,
    readFileSync(skillPath, "utf8").replace("name: relationship-mireille", "name: relationship_mireille"),
    "utf8",
  );
  const metaPath = join(skillDir, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  delete meta.artifacts;
  writeFileSync(metaPath, JSON.stringify(meta), "utf8");
  return skillDir;
}

test("the installer host list is exactly the shared coding-agent matrix", () => {
  assert.deepEqual([...supportedHosts()].sort(), [...listAgents()].sort());
  for (const host of listAgents()) {
    assert.equal(typeof repoInstallDir(host, { home: "/h", env: {} }), "string");
    assert.equal(typeof generatedSkillsRoot(host, { home: "/h", env: {} }), "string");
  }
});

test("default skills dirs cover all documented hosts", () => {
  const home = "/example/home";
  const expected = {
    "claude-code": join(home, ".claude", "skills"),
    openclaw: join(home, ".openclaw", "workspace", "skills"),
    hermes: join(home, ".hermes", "skills", "distilly-generated"),
    codex: join(home, ".agents", "skills"),
    "deepseek-harness": join(home, ".dsh", "skills"),
    pi: join(home, ".pi", "agent", "skills"),
    "grok-build": join(home, ".grok", "skills"),
    opencode: join(home, ".config", "opencode", "skills"),
  };
  for (const [host, dir] of Object.entries(expected)) {
    assert.equal(defaultSkillsDir(host, { home, env: {} }), dir, host);
  }
  assert.equal(
    defaultSkillsDir("deepseek-harness", { home, env: { DSH_HOME: "/custom/dsh" } }),
    join("/custom/dsh", "skills"),
  );
});

test("install rewrites only the legacy copy to the canonical name", () => {
  const root = tempDir();
  try {
    const source = createLegacySkill(join(root, "generated"));
    const skillsDir = join(root, ".hermes", "skills", "distilly-generated");

    const result = installGeneratedSkill({ skillDir: source, skillsDir, force: true, host: "hermes" });

    const installed = result.skill_dir;
    assert.equal(installed.split("/").pop(), "relationship-mireille");
    assert.deepEqual(readdirSync(installed).sort(), [".distilly-install.json", "SKILL.md"]);
    assert.match(readFileSync(join(installed, "SKILL.md"), "utf8"), /name: relationship-mireille/);
    assert.match(readFileSync(join(source, "SKILL.md"), "utf8"), /name: relationship_mireille/);

    const record = JSON.parse(readFileSync(join(installed, ".distilly-install.json"), "utf8"));
    assert.equal(record.host, "hermes");
    assert.equal(record.command_name, "relationship-mireille");
    assert.equal(record.slug, "mireille");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install rejects ancestor or descendant destinations", () => {
  const root = tempDir();
  try {
    const source = createLegacySkill(join(root, "generated"));

    assert.throws(
      () => installGeneratedSkill({ skillDir: source, skillsDir: source, force: true, host: "test" }),
      /must not overlap/,
    );

    const ancestorInstall = join(root, "host", "relationship-bundle");
    mkdirSync(ancestorInstall, { recursive: true });
    const nestedSource = join(ancestorInstall, "bundle");
    const { renameSync } = await_rename();
    renameSync(source, nestedSource);
    assert.throws(
      () =>
        installGeneratedSkill({
          skillDir: nestedSource,
          skillsDir: join(root, "host"),
          force: true,
          host: "test",
        }),
      /must not overlap/,
    );

    assert.ok(readFileSync(join(nestedSource, "meta.json"), "utf8"));
    assert.ok(readFileSync(join(nestedSource, "work.md"), "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// `renameSync` is imported lazily so the test file keeps a single import style.
function await_rename() {
  return { renameSync: (from, to) => import("node:fs").then(() => from && to) && renameSyncImpl(from, to) };
}
