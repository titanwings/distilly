/**
 * Port of `tests/test_cli_lifecycle.py` driven through `bin/distilly.mjs`.
 *
 * The Python suite shelled out to `python3 tools/skill_writer.py` and
 * `python3 tools/version_manager.py`; this port runs the equivalent Node CLI
 * commands. The celebrity branch's research-tool steps
 * (`tools/research/srt_to_transcript.py`, `merge_research.py`, `quality_check.py`)
 * stay in Python until ds/02-parse-zero-cred ports them, and are therefore not
 * exercised here — see docs/evidence/pr-01-node-core.md.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(projectRoot, "bin", "distilly.mjs");

function runCmd(args, { cwd = projectRoot, env = {} } = {}) {
  const merged = { ...process.env, DISTILLY_AUTO_INSTALL_CLAUDE: "0", ...env };
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: merged });
}

function writeJson(path, payload) {
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-cli-"));
}

test("the default colleague CLI uses the skills/colleague root", () => {
  const root = tempDir();
  try {
    const workPath = join(root, "work.md");
    const personaPath = join(root, "persona.md");
    writeFileSync(workPath, "Work body\n", "utf8");
    writeFileSync(personaPath, "Persona body\n", "utf8");
    const metaPath = writeJson(join(root, "meta.json"), {
      character: "colleague",
      display_name: "Eulalie",
      classification: { language: "en" },
    });

    const create = runCmd(
      [
        "skill",
        "create",
        "--character",
        "colleague",
        "--slug",
        "eulalie",
        "--name",
        "Eulalie",
        "--meta",
        metaPath,
        "--work",
        workPath,
        "--persona",
        personaPath,
      ],
      { cwd: root },
    );

    assert.equal(create.status, 0, create.stderr);
    assert.match(create.stdout, /Created skill:/);
    assert.ok(existsSync(join(root, "skills", "colleague", "eulalie", "SKILL.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude auto-install is opt-in and keeps the legacy env variable working", () => {
  const root = tempDir();
  try {
    const home = join(root, "home");
    const baseDir = join(root, "skills", "colleague");
    mkdirSync(home);
    mkdirSync(baseDir, { recursive: true });
    const metaPath = writeJson(join(root, "meta.json"), {
      character: "colleague",
      display_name: "Eulalie",
      classification: { language: "en" },
    });
    const workPath = join(root, "work.md");
    const personaPath = join(root, "persona.md");
    writeFileSync(workPath, "Work body\n", "utf8");
    writeFileSync(personaPath, "Persona body\n", "utf8");

    const createWithEnv = (slug, settings, ...extraArgs) => {
      const env = { ...process.env, HOME: home };
      delete env.DISTILLY_AUTO_INSTALL_CLAUDE;
      delete env.DOT_SKILL_AUTO_INSTALL_CLAUDE;
      Object.assign(env, settings);
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "skill",
          "create",
          "--character",
          "colleague",
          "--slug",
          slug,
          "--name",
          "Eulalie",
          "--meta",
          metaPath,
          "--work",
          workPath,
          "--persona",
          personaPath,
          "--skills-dir",
          baseDir,
          ...extraArgs,
        ],
        { cwd: projectRoot, encoding: "utf8", env },
      );
      assert.equal(result.status, 0, result.stderr);
      return join(home, ".claude", "skills", `colleague-${slug}`, "SKILL.md");
    };

    assert.equal(existsSync(createWithEnv("default-off", {})), false);
    assert.equal(existsSync(createWithEnv("legacy-on", { DOT_SKILL_AUTO_INSTALL_CLAUDE: "1" })), true);
    assert.equal(existsSync(createWithEnv("legacy-off", { DOT_SKILL_AUTO_INSTALL_CLAUDE: "0" })), false);
    assert.equal(
      existsSync(
        createWithEnv("new-wins-off", {
          DISTILLY_AUTO_INSTALL_CLAUDE: "0",
          DOT_SKILL_AUTO_INSTALL_CLAUDE: "1",
        }),
      ),
      false,
    );
    assert.equal(
      existsSync(
        createWithEnv("new-wins-on", {
          DISTILLY_AUTO_INSTALL_CLAUDE: "1",
          DOT_SKILL_AUTO_INSTALL_CLAUDE: "0",
        }),
      ),
      true,
    );
    assert.equal(
      existsSync(createWithEnv("explicit-off", { DISTILLY_AUTO_INSTALL_CLAUDE: "1" }, "--no-install-claude-skill")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create with only --name normalises the slug and rejects an unsafe explicit slug", () => {
  const root = tempDir();
  try {
    const created = runCmd(["skill", "create", "--name", "Zadie Smith", "--skills-dir", "skills/colleague"], {
      cwd: root,
    });
    assert.equal(created.status, 0, created.stderr);
    const generated = join(root, "skills", "colleague", "zadie-smith", "SKILL.md");
    assert.match(readFileSync(generated, "utf8"), /name: colleague-zadie-smith/);

    const unsafe = runCmd(["skill", "create", "--slug", "../escape", "--skills-dir", "skills/colleague"], {
      cwd: root,
    });
    assert.notEqual(unsafe.status, 0);
    assert.equal(existsSync(join(root, "skills", "escape")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update accepts a safe legacy slug with spaces", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    const create = runCmd(
      ["skill", "create", "--slug", "legacy", "--name", "Zadie Smith", "--skills-dir", baseDir],
      { cwd: root },
    );
    assert.equal(create.status, 0, create.stderr);
    const legacyDir = join(baseDir, "Zadie Smith");
    renameSync(join(baseDir, "legacy"), legacyDir);
    const workPatch = join(root, "work-patch.md");
    writeFileSync(workPatch, "## Update\n\nLegacy directory remains addressable.\n", "utf8");

    const update = runCmd(
      ["skill", "update", "--slug", "Zadie Smith", "--skills-dir", baseDir, "--work-patch", workPatch],
      { cwd: root },
    );

    assert.equal(update.status, 0, update.stderr);
    assert.match(update.stdout, /Updated skill to v2:/);
    assert.match(update.stdout, /Zadie Smith/);
    assert.match(readFileSync(join(legacyDir, "work.md"), "utf8"), /Legacy directory remains addressable/);
    const savedMeta = JSON.parse(readFileSync(join(legacyDir, "meta.json"), "utf8"));
    assert.equal(savedMeta.artifacts.combined_command, "colleague-zadie-smith");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the version manager rejects slug and version traversal", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    const victimVersions = join(root, "skills", "victim", "versions");
    for (let index = 0; index < 11; index += 1) mkdirSync(join(victimVersions, `v${index}`), { recursive: true });

    const traversal = runCmd(["skill", "version", "cleanup", "--slug", "../victim", "--skills-dir", baseDir], {
      cwd: root,
    });
    assert.notEqual(traversal.status, 0);
    // The refused traversal must not have touched the other skill. The old form of
    // this assertion pointed at `<root>/skills/skills/victim/versions` (one `skills/`
    // too many) and called `readFileSync` on a directory, so it could never pass.
    assert.equal(readdirSync(victimVersions).length, 11, "the refused traversal must leave the other skill alone");

    const create = runCmd(["skill", "create", "--slug", "safe", "--name", "Safe", "--skills-dir", baseDir], {
      cwd: root,
    });
    assert.equal(create.status, 0, create.stderr);
    const rollbackTraversal = runCmd(
      ["skill", "version", "rollback", "--slug", "safe", "--version", "../victim", "--skills-dir", baseDir],
      { cwd: root },
    );
    assert.notEqual(rollbackTraversal.status, 0);
    assert.ok(existsSync(join(baseDir, "safe", "SKILL.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each character family survives the full CLI lifecycle", () => {
  const fixtures = {
    colleague: { name: "Eulalie", slug: "eulalie", baseDir: "skills/colleague" },
    relationship: { name: "Mireille", slug: "mireille", baseDir: "skills/relationship" },
    celebrity: { name: "Zadie Smith", slug: "zadie-smith", baseDir: "skills/celebrity" },
  };

  const root = tempDir();
  try {
    for (const [character, fixture] of Object.entries(fixtures)) {
      const baseDir = join(root, fixture.baseDir);
      mkdirSync(baseDir, { recursive: true });
      const metaPath = writeJson(join(root, `${fixture.slug}_meta.json`), {
        character,
        display_name: fixture.name,
        classification: { language: "en" },
        profile: { role: "Builder" },
        tags: { personality: ["precise", "skeptical"] },
        knowledge_sources: ["manual-notes"],
      });
      const workPath = join(root, `${fixture.slug}_work.md`);
      const personaPath = join(root, `${fixture.slug}_persona.md`);
      const workPatchPath = join(root, `${fixture.slug}_work_patch.md`);
      const correctionPath = join(root, `${fixture.slug}_correction.json`);

      writeFileSync(
        workPath,
        [
          "## mental models",
          "- First-principles reasoning",
          "- Skeptical framing",
          "- Long-horizon tradeoffs",
          "",
          "## limitations",
          "- Avoids operational detail",
          "",
          "Sources:",
          "https://example.com/articles/long-form-profile",
          "https://example.com/interviews/episode-42",
        ].join("\n") + "\n",
        "utf8",
      );
      writeFileSync(
        personaPath,
        [
          "## expression DNA",
          "- Sentence rhythm is clipped.",
          "- Uses metaphor when disagreeing.",
          "",
          "## honest boundaries",
          "- States what they do not know.",
          "",
          "## contradictions",
          "- Alternates between certainty and doubt.",
        ].join("\n") + "\n",
        "utf8",
      );
      writeFileSync(workPatchPath, "## new evidence\n- Adds a later example.\n", "utf8");
      writeJson(correctionPath, {
        scene: "disagreement",
        wrong: "flatten disagreement into politeness",
        correct: "surface the disagreement and justify it directly",
      });

      const create = runCmd(
        [
          "skill",
          "create",
          "--character",
          character,
          "--slug",
          fixture.slug,
          "--name",
          fixture.name,
          "--meta",
          metaPath,
          "--work",
          workPath,
          "--persona",
          personaPath,
          "--skills-dir",
          baseDir,
        ],
        { cwd: root },
      );
      assert.equal(create.status, 0, create.stderr);
      assert.match(create.stdout, /Created skill:/);

      const skillDir = join(baseDir, fixture.slug);
      assert.ok(existsSync(join(skillDir, "SKILL.md")));
      assert.ok(existsSync(join(skillDir, "manifest.json")));

      const listResult = runCmd(["skill", "list", "--character", character, "--skills-dir", baseDir], { cwd: root });
      assert.match(listResult.stdout, new RegExp(fixture.slug));
      assert.match(listResult.stdout, new RegExp(`Character: ${character}`));

      const update = runCmd(
        [
          "skill",
          "update",
          "--character",
          character,
          "--slug",
          fixture.slug,
          "--work-patch",
          workPatchPath,
          "--correction-json",
          correctionPath,
          "--skills-dir",
          baseDir,
        ],
        { cwd: root },
      );
      assert.equal(update.status, 0, update.stderr);
      assert.match(update.stdout, /Updated skill to v2/);

      const versions = runCmd(
        ["skill", "version", "list", "--character", character, "--slug", fixture.slug, "--skills-dir", baseDir],
        { cwd: root },
      );
      assert.match(versions.stdout, /v1/);

      const rollbackResult = runCmd(
        [
          "skill",
          "version",
          "rollback",
          "--character",
          character,
          "--slug",
          fixture.slug,
          "--version",
          "v1",
          "--skills-dir",
          baseDir,
        ],
        { cwd: root },
      );
      assert.equal(rollbackResult.status, 0, rollbackResult.stderr);
      assert.match(rollbackResult.stdout, /rolled back to v1/);

      const savedMeta = JSON.parse(readFileSync(join(skillDir, "meta.json"), "utf8"));
      assert.equal(savedMeta.character, character);
      assert.ok(savedMeta.version.startsWith("v1"));

      const combinedSkill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
      assert.match(combinedSkill, /## PART A: Work/);
      assert.match(combinedSkill, /## PART B: Persona/);

      if (character === "celebrity") {
        // The research toolchain (srt_to_transcript / merge_research /
        // quality_check) still ships as Python; the directory layout is what
        // this branch owns, so assert that instead.
        assert.ok(existsSync(join(skillDir, "knowledge", "subtitles")));
        assert.ok(existsSync(join(skillDir, "knowledge", "transcripts")));
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI installs a generated skill into the supported host paths", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "celebrity");
    mkdirSync(baseDir, { recursive: true });

    const metaPath = writeJson(join(root, "zhou_qimo_meta.json"), {
      character: "celebrity",
      display_name: "周奇墨",
      classification: { language: "zh-CN" },
    });
    const workPath = join(root, "zhou_qimo_work.md");
    const personaPath = join(root, "zhou_qimo_persona.md");
    writeFileSync(workPath, "Work body\n", "utf8");
    writeFileSync(personaPath, "Persona body\n", "utf8");

    const claudeSkillsDir = join(root, ".claude", "skills");
    const claudeCommandsDir = join(root, ".claude", "commands");
    const openclawSkillsDir = join(root, ".openclaw", "workspace", "skills");
    const codexSkillsDir = join(root, ".agents", "skills");

    const create = runCmd(
      [
        "skill",
        "create",
        "--character",
        "celebrity",
        "--slug",
        "zhou-qimo",
        "--name",
        "周奇墨",
        "--meta",
        metaPath,
        "--work",
        workPath,
        "--persona",
        personaPath,
        "--skills-dir",
        baseDir,
        "--install-claude-skill",
        "--install-claude-command-shim",
        "--claude-skills-dir",
        claudeSkillsDir,
        "--claude-commands-dir",
        claudeCommandsDir,
        "--install-openclaw-skill",
        "--openclaw-skills-dir",
        openclawSkillsDir,
        "--install-codex-skill",
        "--codex-skills-dir",
        codexSkillsDir,
      ],
      { cwd: root },
    );

    assert.equal(create.status, 0, create.stderr);
    assert.match(create.stdout, /Claude trigger: \/celebrity-zhou-qimo/);
    assert.match(create.stdout, /OpenClaw trigger: \/celebrity-zhou-qimo/);
    assert.match(create.stdout, /Codex skill name: celebrity-zhou-qimo/);
    assert.ok(existsSync(join(claudeSkillsDir, "celebrity-zhou-qimo", "SKILL.md")));
    assert.ok(existsSync(join(claudeCommandsDir, "celebrity-zhou-qimo.md")));
    assert.ok(existsSync(join(openclawSkillsDir, "celebrity-zhou-qimo", "SKILL.md")));
    assert.ok(existsSync(join(codexSkillsDir, "celebrity-zhou-qimo", "SKILL.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
