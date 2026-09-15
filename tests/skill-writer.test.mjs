/**
 * Port of `tests/test_skill_writer.py` (SkillWriterTest, VersionManagerTest and
 * PromptPresetTest), asserting the same behaviour against `src/skill/*`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WORK_ONLY_FALLBACK_EN,
  WORK_ONLY_FALLBACK_ZH,
  createSkill,
  listSkills,
  slugify,
  updateSkill,
} from "../src/skill/writer.mjs";
import { SCHEMA_VERSION } from "../src/skill/schema.mjs";
import { PLANNED, listCommands } from "../src/commands/index.mjs";
import { backupCurrentVersion, rollback } from "../src/skill/versions.mjs";
import { getCharacterPreset, getResearchProfilePreset, resolveExistingStorageRoot } from "../src/skill/presets.mjs";
import { validatePathSegment } from "../src/skill/schema.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-writer-"));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("slugify produces portable kebab-case", () => {
  assert.equal(slugify("Zadie Smith"), "zadie-smith");
  assert.equal(slugify("Élodie"), "elodie");
  assert.equal(slugify("A/B"), "a-b");
});

test("createSkill rejects an unsafe slug before writing", () => {
  const root = tempDir();
  try {
    assert.throws(
      () => createSkill(join(root, "skills", "colleague"), "../escape", { name: "Unsafe" }, "Work body", "Persona body"),
      /kebab-case/,
    );
    assert.equal(existsSync(join(root, "skills", "escape")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy path segments are Windows safe", () => {
  assert.equal(validatePathSegment("Zadie Smith"), "Zadie Smith");
  assert.equal(validatePathSegment("Élodie"), "Élodie");
  for (const value of ["C:", "foo:bar", "CON", "nul.txt", "trailing.", "trailing "]) {
    assert.throws(() => validatePathSegment(value), /safe path segment/, value);
  }
});

test("create colleague uses portable names and adds the engine schema", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    const meta = {
      name: "Eulalie",
      profile: { company: "ByteDance", level: "L2-1", role: "Backend Engineer", mbti: "INTJ" },
      tags: { personality: ["direct", "data-driven"], culture: ["byte-dance-style"] },
    };

    const skillDir = createSkill(baseDir, "zhangsan", meta, "Work body", "Persona body");

    const savedMeta = readJson(join(skillDir, "meta.json"));
    const manifest = readJson(join(skillDir, "manifest.json"));
    const combinedSkill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const workSkill = readFileSync(join(skillDir, "work_skill.md"), "utf8");
    const personaSkill = readFileSync(join(skillDir, "persona_skill.md"), "utf8");

    assert.equal(savedMeta.schema_version, SCHEMA_VERSION, "the engine stamps its current schema version");
    assert.equal(savedMeta.kind, "meta-skill");
    assert.equal(savedMeta.character, "colleague");
    assert.equal(savedMeta.preset, "distilly.colleague.v1");
    assert.equal(savedMeta.engine.name, "distilly");
    assert.equal(savedMeta.generation.engine, "distilly");
    assert.equal(savedMeta.type, "colleague");
    assert.equal(savedMeta.id, "meta-skill.colleague.zhangsan");
    assert.equal(savedMeta.artifacts.combined_name, "colleague-zhangsan");
    assert.equal(savedMeta.artifacts.combined_command, "colleague-zhangsan");
    assert.equal(savedMeta.compat.legacy_command, "/create-colleague");
    assert.equal(manifest.kind, "meta-skill");
    assert.equal(manifest.character, "colleague");
    assert.equal(manifest.preset, "distilly.colleague.v1");
    assert.equal(manifest.install.slash_commands.default, "colleague-zhangsan");
    assert.deepEqual(manifest.install.compatible_runtimes, [
      "claude-code",
      "openclaw",
      "hermes",
      "codex",
      "deepseek-harness",
      "grok-build",
      "pi",
      "opencode",
    ]);
    assert.equal(manifest.install.installers.openclaw, "tools/install_openclaw_generated_skill.py");
    assert.equal(manifest.install.installers.codex, "tools/install_codex_generated_skill.py");
    assert.match(combinedSkill, /name: colleague-zhangsan/);
    assert.match(combinedSkill, /## PART A: Work/);
    assert.match(workSkill, /name: colleague-zhangsan-work/);
    assert.match(workSkill, /work capability only/);
    assert.match(personaSkill, /name: colleague-zhangsan-persona/);
    assert.match(personaSkill, /persona only/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create relationship uses the character preset metadata", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "relationship");
    const skillDir = createSkill(baseDir, "mireille", { character: "relationship", name: "Mireille", profile: { role: "Designer" } }, "Work body", "Persona body");

    const savedMeta = readJson(join(skillDir, "meta.json"));
    const manifest = readJson(join(skillDir, "manifest.json"));
    const combinedSkill = readFileSync(join(skillDir, "SKILL.md"), "utf8");

    assert.equal(savedMeta.kind, "meta-skill");
    assert.equal(savedMeta.character, "relationship");
    assert.equal(savedMeta.preset, "distilly.relationship.v1");
    assert.equal(savedMeta.type, "relationship");
    assert.equal(savedMeta.classification.gallery_category, "Relationship");
    assert.equal(savedMeta.compat.legacy_storage_root, "skills/relationship");
    assert.equal(manifest.id, "meta-skill.relationship.mireille");
    assert.equal(manifest.character, "relationship");
    assert.equal(savedMeta.artifacts.combined_command, "relationship-mireille");
    assert.match(combinedSkill, /name: relationship-mireille/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create renders Chinese chrome when the language is zh-CN", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "relationship");
    const skillDir = createSkill(
      baseDir,
      "mireille",
      { character: "relationship", name: "Mireille", classification: { language: "zh-CN" } },
      "Work body",
      "Persona body",
    );

    assert.match(readFileSync(join(skillDir, "SKILL.md"), "utf8"), /## PART A：工作能力/);
    assert.match(readFileSync(join(skillDir, "SKILL.md"), "utf8"), /运行规则/);
    assert.match(readFileSync(join(skillDir, "work_skill.md"), "utf8"), /仅 Work，无 Persona/);
    assert.match(readFileSync(join(skillDir, "persona_skill.md"), "utf8"), /仅 Persona，无工作能力/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the work-only skill replaces the persona handoff", () => {
  const zhHandoff = "如果被问到职责范围外的问题，以该同事的方式回应（参见 Persona 部分）。";
  const enHandoff =
    "If you are asked a question outside your recorded responsibilities, respond in this colleague's style (see the Persona section).";
  const zhWorkContent = `## 工作能力使用说明\n\n当用户要求你完成以下任务时，严格按照上述规范执行。\n\n${zhHandoff}\n`;
  const enWorkContent = `## Scope rule\n\nIf asked outside your recorded responsibilities:\n- State the evidence gap\n\n## Persona naming note\n\nKeep this documentation sentence.\n\n${enHandoff}\n`;

  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    const shared = { company: "ByteDance", level: "L2-1", role: "Backend Engineer" };

    const zhDir = createSkill(join(baseDir, "zh"), "zhangsan", { name: "Eulalie", language: "zh-CN", profile: shared }, zhWorkContent, "Persona body");
    const enDir = createSkill(join(baseDir, "en"), "zhangsan", { name: "Eulalie", language: "en", profile: shared }, enWorkContent, "Persona body");

    const zhStoredWork = readFileSync(join(zhDir, "work.md"), "utf8");
    const zhCombined = readFileSync(join(zhDir, "SKILL.md"), "utf8");
    const enStoredWork = readFileSync(join(enDir, "work.md"), "utf8");
    const enCombined = readFileSync(join(enDir, "SKILL.md"), "utf8");
    const zhWorkSkill = readFileSync(join(zhDir, "work_skill.md"), "utf8");
    const enWorkSkill = readFileSync(join(enDir, "work_skill.md"), "utf8");

    assert.match(zhStoredWork, new RegExp(zhHandoff));
    assert.match(zhCombined, new RegExp(zhHandoff));
    // Literal containment, not `new RegExp(enHandoff)`: the sentence contains
    // parentheses, so the regex treated "(see the Persona section)" as a capture
    // group and could never match the text it was written to look for.
    assert.ok(enStoredWork.includes(enHandoff), `work.md must keep the handoff verbatim:\n${enStoredWork}`);
    assert.ok(enCombined.includes(enHandoff), `SKILL.md must keep the handoff verbatim:\n${enCombined}`);
    assert.equal(zhWorkSkill.includes(zhHandoff), false);
    assert.equal(enWorkSkill.includes(enHandoff), false);
    assert.match(enWorkSkill, /If asked outside your recorded responsibilities:/);
    assert.match(enWorkSkill, /## Persona naming note/);
    assert.match(enWorkSkill, /Keep this documentation sentence\./);
    assert.ok(zhWorkSkill.includes(WORK_ONLY_FALLBACK_ZH));
    assert.ok(enWorkSkill.includes(WORK_ONLY_FALLBACK_EN));
    assert.match(zhWorkSkill, /不要臆造缺失信息/);
    assert.equal(zhWorkSkill.includes("不要推断"), false);
    assert.match(enWorkSkill, /Do not fabricate missing information/);
    assert.equal(enWorkSkill.includes("Do not infer"), false);
    assert.equal(zhCombined.includes(WORK_ONLY_FALLBACK_ZH), false);
    assert.equal(enCombined.includes(WORK_ONLY_FALLBACK_EN), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create celebrity adds research dirs and the toolchain", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "celebrity");
    const skillDir = createSkill(
      baseDir,
      "zadie-smith",
      {
        character: "celebrity",
        name: "Zadie Smith",
        profile: { identity: "Novelist", known_for: "Essay and criticism" },
        tags: ["literature", "essay", "public-intellectual"],
        knowledge_sources: ["interview", "essay"],
      },
      "Work body",
      "Persona body",
    );

    const savedMeta = readJson(join(skillDir, "meta.json"));
    const manifest = readJson(join(skillDir, "manifest.json"));

    assert.equal(savedMeta.character, "celebrity");
    assert.equal(savedMeta.preset, "distilly.celebrity.v1");
    assert.equal(savedMeta.research_profile, "budget-friendly");
    assert.ok("research_tools" in savedMeta.engine);
    assert.equal(savedMeta.engine.research_profile, "budget-friendly");
    assert.ok("research_tools" in manifest.toolchain);
    assert.equal(manifest.research_profile, "budget-friendly");
    assert.deepEqual(savedMeta.classification.tags, ["literature", "essay", "public-intellectual"]);
    assert.match(savedMeta.summary, /Novelist/);
    assert.match(savedMeta.summary, /Essay and criticism/);
    assert.ok(existsSync(join(skillDir, "knowledge", "research", "raw")));
    assert.ok(existsSync(join(skillDir, "knowledge", "research", "merged")));
    assert.ok(existsSync(join(skillDir, "knowledge", "transcripts")));
    assert.ok(existsSync(join(skillDir, "knowledge", "subtitles")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create celebrity budget-unfriendly embeds the profile config", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "celebrity");
    const skillDir = createSkill(
      baseDir,
      "xu-zhisheng",
      { character: "celebrity", research_profile: "budget-unfriendly", name: "Xu Zhisheng", classification: { language: "zh-CN" } },
      "Work body",
      "Persona body",
    );

    const savedMeta = readJson(join(skillDir, "meta.json"));
    const manifest = readJson(join(skillDir, "manifest.json"));

    assert.equal(savedMeta.research_profile, "budget-unfriendly");
    assert.equal(savedMeta.engine.quality_profile, "budget-unfriendly");
    assert.ok(Object.values(savedMeta.engine.research_profile_bundle).includes("prompts/celebrity/budget_unfriendly/research.md"));
    assert.ok(Object.values(savedMeta.engine.research_profile_bundle).includes("prompts/celebrity/budget_unfriendly/audit.md"));
    assert.ok(savedMeta.engine.research_profile_references.includes("references/celebrity_budget_unfriendly_framework.md"));
    assert.equal(manifest.research_profile, "budget-unfriendly");
    assert.equal(manifest.toolchain.quality_profile, "budget-unfriendly");
    assert.equal(manifest.toolchain.merge_strategy, "deep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create celebrity accepts a string profile from runtime meta", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "celebrity");
    const skillDir = createSkill(
      baseDir,
      "xu-zhisheng",
      {
        character: "celebrity",
        name: "徐志胜",
        display_name: "徐志胜",
        classification: { language: "zh-CN" },
        profile: "中国脱口秀演员，以自嘲式观察喜剧著称。",
      },
      "Work body",
      "Persona body",
    );

    const savedMeta = readJson(join(skillDir, "meta.json"));
    assert.equal(savedMeta.profile, "中国脱口秀演员，以自嘲式观察喜剧著称。");
    assert.match(savedMeta.summary, /中国脱口秀演员/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing dot-skill metadata keeps the legacy engine identifiers", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    const skillDir = createSkill(
      baseDir,
      "legacy",
      {
        name: "Legacy",
        preset: "dot.colleague.v1",
        engine: { name: "dot-skill" },
        generation: { engine: "dot-skill" },
        artifacts: {
          combined_name: "colleague_legacy",
          work_name: "colleague_legacy_work",
          persona_name: "colleague_legacy_persona",
        },
      },
      "Work body",
      "Persona body",
    );

    const savedMeta = readJson(join(skillDir, "meta.json"));
    assert.equal(savedMeta.preset, "dot.colleague.v1");
    assert.equal(savedMeta.engine.name, "dot-skill");
    assert.equal(savedMeta.generation.engine, "dot-skill");
    assert.equal(savedMeta.artifacts.combined_name, "colleague_legacy");
    assert.match(readFileSync(join(skillDir, "SKILL.md"), "utf8"), /name: colleague_legacy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update preserves names from legacy meta without artifacts", () => {
  const root = tempDir();
  try {
    const skillDir = join(root, "skills", "colleague", "legacy_person");
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(join(skillDir, "versions"));
    writeFileSync(join(skillDir, "meta.json"), JSON.stringify({ name: "Legacy Person", type: "colleague", version: "v1" }), "utf8");
    writeFileSync(join(skillDir, "work.md"), "Legacy work\n", "utf8");
    writeFileSync(join(skillDir, "persona.md"), "Legacy persona\n", "utf8");
    const legacyNames = {
      "SKILL.md": "colleague_legacy_person",
      "work_skill.md": "colleague_legacy_person_work",
      "persona_skill.md": "colleague_legacy_person_persona",
    };
    for (const [filename, name] of Object.entries(legacyNames)) {
      writeFileSync(join(skillDir, filename), `---\nname: ${name}\ndescription: Legacy\n---\n\nLegacy body\n`, "utf8");
    }

    updateSkill(skillDir, "Updated work");

    for (const [filename, name] of Object.entries(legacyNames)) {
      assert.match(readFileSync(join(skillDir, filename), "utf8"), new RegExp(`name: ${name}`));
    }
    assert.equal(readJson(join(skillDir, "meta.json")).artifacts.combined_command, "colleague-legacy-person");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update rejects traversal in the stored version before backing up", () => {
  const root = tempDir();
  try {
    const skillDir = createSkill(join(root, "skills", "colleague"), "unsafe-version", { name: "Unsafe Version" }, "Work body", "Persona body");
    const metaPath = join(skillDir, "meta.json");
    const meta = readJson(metaPath);
    meta.version = "../../../../escape";
    meta.lifecycle.version = "../../../../escape";
    writeFileSync(metaPath, JSON.stringify(meta), "utf8");

    assert.throws(() => updateSkill(skillDir, "Should not be written"), /safe path segment/);
    assert.equal(existsSync(join(root, "escape")), false);
    assert.equal(readFileSync(join(skillDir, "work.md"), "utf8").includes("Should not be written"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update regenerates the manifest and archives the artifacts", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    const skillDir = createSkill(baseDir, "zhangsan", { name: "Eulalie" }, "Initial work", "Initial persona");

    const newVersion = updateSkill(skillDir, "More work", null, { scene: "challenged", wrong: "apologize", correct: "ask for evidence" });

    const savedMeta = readJson(join(skillDir, "meta.json"));
    const manifest = readJson(join(skillDir, "manifest.json"));
    const personaDoc = readFileSync(join(skillDir, "persona.md"), "utf8");

    assert.equal(newVersion, "v2");
    assert.equal(savedMeta.version, "v2");
    assert.equal(savedMeta.corrections_count, 1);
    assert.ok(existsSync(join(skillDir, "versions", "v1", "manifest.json")));
    assert.equal(manifest.entrypoints.default, "SKILL.md");
    assert.match(personaDoc, /apologize/);
    assert.match(personaDoc, /ask for evidence/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update accepts multiple persona corrections in one payload", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "celebrity");
    const skillDir = createSkill(
      baseDir,
      "zhou-qimo",
      { character: "celebrity", name: "周奇墨", classification: { language: "zh-CN" } },
      "Initial work",
      "Initial persona",
    );

    const newVersion = updateSkill(skillDir, null, null, {
      persona_corrections: [
        { scene: "铺陈处境时", wrong: "一上来就下判断", correct: "先把处境讲得很普通，再轻轻点一下" },
        { scene: "表达立场时", wrong: "写成明显自嘲型", correct: "和观众一起承认大家都在局里" },
      ],
    });

    const savedMeta = readJson(join(skillDir, "meta.json"));
    const personaDoc = readFileSync(join(skillDir, "persona.md"), "utf8");

    assert.equal(newVersion, "v2");
    assert.equal(savedMeta.corrections_count, 2);
    assert.match(personaDoc, /一上来就下判断/);
    assert.match(personaDoc, /写成明显自嘲型/);
    assert.equal(personaDoc.split("## Correction Log").length - 1, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update replaces existing markdown sections instead of appending duplicates", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "celebrity");
    const skillDir = createSkill(
      baseDir,
      "zhou-qimo",
      { character: "celebrity", name: "周奇墨", classification: { language: "zh-CN" } },
      ["# Work", "", "## 表达规范", "", "- 原始表述", "", "## 输出风格", "", "- 原始结构"].join("\n"),
      ["# Persona", "", "## Layer 2: Expression DNA", "", "旧内容", "", "## Layer 3: Mental Models", "", "保持不变"].join("\n"),
    );

    updateSkill(
      skillDir,
      ["## 表达规范", "", "- 新的节奏控制", "", "## 输出风格", "", "- 新的结构模板"].join("\n"),
      ["## Layer 2: Expression DNA", "", "新内容"].join("\n"),
      null,
    );

    const workDoc = readFileSync(join(skillDir, "work.md"), "utf8");
    const personaDoc = readFileSync(join(skillDir, "persona.md"), "utf8");

    assert.equal(workDoc.split("## 表达规范").length - 1, 1);
    assert.equal(workDoc.split("## 输出风格").length - 1, 1);
    assert.match(workDoc, /新的节奏控制/);
    assert.equal(workDoc.includes("原始表述"), false);
    assert.equal(personaDoc.split("## Layer 2: Expression DNA").length - 1, 1);
    assert.match(personaDoc, /新内容/);
    assert.equal(personaDoc.includes("旧内容"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup and rollback include the manifest", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    const skillDir = createSkill(baseDir, "zhangsan", { name: "Eulalie" }, "v1 work", "v1 persona");

    backupCurrentVersion(skillDir);
    updateSkill(skillDir, "v2 work");

    const success = rollback(skillDir, "v1");
    const restoredWork = readFileSync(join(skillDir, "work.md"), "utf8");

    assert.equal(success, true);
    assert.match(restoredWork, /v1 work/);
    assert.ok(existsSync(join(skillDir, "versions", "v1", "manifest.json")));
    assert.equal(rollback(skillDir, "../v1"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the version manager still resolves the legacy colleagues root", () => {
  const root = tempDir();
  const cwd = process.cwd();
  try {
    process.chdir(root);
    createSkill("colleagues", "zhangsan", { name: "Eulalie" }, "v1 work", "v1 persona");
    assert.equal(resolveExistingStorageRoot("colleague", "zhangsan"), "colleagues");
    assert.deepEqual(listSkills("colleagues").map((skill) => skill.slug), ["zhangsan"]);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("character prompt bundles exist", () => {
  for (const character of ["colleague", "relationship", "celebrity"]) {
    const preset = getCharacterPreset(character);
    for (const promptPath of Object.values(preset.prompt_bundle)) {
      if (typeof promptPath !== "string" || !promptPath.startsWith("prompts/")) continue;
      assert.ok(existsSync(join(projectRoot, promptPath)), `missing prompt file for ${character}: ${promptPath}`);
    }
    // v2: research tools are CLI commands; anything that is still a path must
    // exist, and every command must be registered (or at least planned).
    const knownCommands = new Set([...listCommands(), ...Object.keys(PLANNED)]);
    for (const [tool, value] of Object.entries(preset.research_tools ?? {})) {
      if (typeof value !== "string") continue;
      if (!value.startsWith("distilly ")) {
        assert.ok(existsSync(join(projectRoot, value)), `missing research tool for ${character}: ${value}`);
        continue;
      }
      const [first, second] = value.slice("distilly ".length).split(" ");
      const resolved = knownCommands.has(`${first} ${second}`) ? `${first} ${second}` : first;
      assert.ok(
        knownCommands.has(resolved),
        `${character}.research_tools.${tool} names an unregistered command: ${value}`,
      );
    }
    for (const profileName of Object.keys(preset.research_profiles ?? {})) {
      const profile = getResearchProfilePreset(character, profileName);
      for (const promptPath of Object.values(profile.prompt_bundle ?? {})) {
        if (typeof promptPath !== "string" || !promptPath.startsWith("prompts/")) continue;
        assert.ok(existsSync(join(projectRoot, promptPath)), `missing profile prompt for ${character}/${profileName}: ${promptPath}`);
      }
      for (const referencePath of profile.references ?? []) {
        assert.ok(existsSync(join(projectRoot, referencePath)), `missing profile reference for ${character}/${profileName}: ${referencePath}`);
      }
    }
  }

  const friendlyPrompt = readFileSync(join(projectRoot, "prompts", "celebrity", "research.md"), "utf8");
  assert.match(friendlyPrompt, /01_core_profile\.md/);
  assert.match(friendlyPrompt, /03_expression_and_reception\.md/);
  assert.match(friendlyPrompt.toLowerCase(), /do not collapse the whole pass into one monolithic note/);
  assert.match(friendlyPrompt, /actual inspected pages/);
  assert.match(friendlyPrompt, /tools\/research\/xquik_public_posts\.py/);
  assert.match(friendlyPrompt.split(/\s+/).join(" "), /untrusted candidate evidence/);

  const strictPrompt = readFileSync(join(projectRoot, "prompts", "celebrity", "budget_unfriendly", "research.md"), "utf8");
  assert.match(strictPrompt, /01_writings\.md/);
  assert.match(strictPrompt, /06_timeline\.md/);
  assert.match(strictPrompt, /at least 8 grounded source URLs/);
  assert.match(strictPrompt, /Do not replace these six files with one merged scratchpad/);
  assert.match(strictPrompt, /actual inspected pages/);
  assert.match(strictPrompt, /tools\/research\/xquik_public_posts\.py/);
  assert.match(strictPrompt.split(/\s+/).join(" "), /untrusted candidate evidence/);
});

test("a renamed skill directory stays addressable through renameSync", () => {
  const root = tempDir();
  try {
    const baseDir = join(root, "skills", "colleague");
    createSkill(baseDir, "legacy", { name: "Zadie Smith" }, "Work body", "Persona body");
    renameSync(join(baseDir, "legacy"), join(baseDir, "Zadie Smith"));
    const skills = listSkills(baseDir);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].slug, "Zadie Smith");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
