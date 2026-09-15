/**
 * `distilly skill ...` — create / update / list / archive generated Skills.
 *
 * This module owns the argument surface and the *user-visible* behaviour; the
 * work lives in `src/skill/*`, the direct port of `tools/skill_presets.py`,
 * `tools/skill_schema.py`, `tools/skill_writer.py` and `tools/version_manager.py`.
 *
 * Human output is byte-identical to the Python CLI (verified by
 * `scripts/parity.mjs`, phase B); `--json` answers with the CONTRACT §3 receipt
 * instead, so machine output never has to parse prose.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { register } from "./index.mjs";
import { CliError, createReceipt, describeFile, displayPath } from "../cli/receipt.mjs";
import { parseArgs } from "../cli/args.mjs";
import { getCharacterPreset, normalizeCharacter, normalizeResearchProfile, resolveExistingStorageRoot } from "../skill/presets.mjs";
import { resolveContainedChild, validatePathSegment } from "../skill/schema.mjs";
import {
  createSkill,
  installGeneratedHosts,
  listSkills,
  resolveBaseDir,
  slugify,
  updateSkill,
  validateSlug,
} from "../skill/writer.mjs";
import { SlugResolutionError } from "../skill/slug.mjs";
import {
  backupCurrentVersion,
  cleanupOldVersions,
  listVersions,
  rollback,
  MAX_VERSIONS,
} from "../skill/versions.mjs";

export function skillHelp(binary = "distilly") {
  const zh = [
    "用法：",
    `  ${binary} skill create  --character <colleague|relationship|celebrity> [--slug <slug>|--name <name>]`,
    "                        [--meta <meta.json>] [--work <work.md>] [--persona <persona.md>]",
    "                        [--base-dir <dir>] [--research-profile <name>]",
    "                        [--install-claude-skill] [--install-openclaw-skill] [--install-codex-skill]",
    `  ${binary} skill update  --slug <slug> [--character <family>] [--base-dir <dir>]`,
    "                        [--work-patch <file>] [--persona-patch <file>] [--correction-json <file>]",
    `  ${binary} skill list    [--character <family>] [--base-dir <dir>]`,
    `  ${binary} skill version <list|backup|rollback|cleanup> --slug <slug> [--version <vN>]`,
    "",
    "说明：",
    "  create 写出 SKILL.md / work.md / persona.md / work_skill.md / persona_skill.md / manifest.json / meta.json。",
    "  不带 --slug 时用 --name 生成拼音 slug（Unihan 表）；表缺失或字符未覆盖时明确失败并要求 --slug。",
    "  update 先把当前产物归档到 versions/<当前版本>/，版本号 +1。",
    "  version 管理归档：list / backup / rollback / cleanup（默认保留最近 10 个）。",
  ].join("\n");
  const en = [
    "Usage:",
    `  ${binary} skill create  --character <colleague|relationship|celebrity> [--slug <slug>|--name <name>]`,
    "                        [--meta <meta.json>] [--work <work.md>] [--persona <persona.md>]",
    "                        [--base-dir <dir>] [--research-profile <name>]",
    "                        [--install-claude-skill] [--install-openclaw-skill] [--install-codex-skill]",
    `  ${binary} skill update  --slug <slug> [--character <family>] [--base-dir <dir>]`,
    "                        [--work-patch <file>] [--persona-patch <file>] [--correction-json <file>]",
    `  ${binary} skill list    [--character <family>] [--base-dir <dir>]`,
    `  ${binary} skill version <list|backup|rollback|cleanup> --slug <slug> [--version <vN>]`,
    "",
    "Notes:",
    "  create writes SKILL.md / work.md / persona.md / work_skill.md / persona_skill.md / manifest.json / meta.json.",
    "  Without --slug the slug is derived from --name through the Unihan pinyin table; a missing table or an uncovered character fails loudly and asks for --slug.",
    "  update archives the current artifacts under versions/<current>/ first, then bumps the version.",
    "  version manages the archive: list / backup / rollback / cleanup (keeps the newest 10 by default).",
  ].join("\n");
  return { zh, en };
}

const INSTALL_OPTIONS = {
  "install-claude-skill": { type: "boolean" },
  "no-install-claude-skill": { type: "boolean" },
  "install-claude-command-shim": { type: "boolean" },
  "claude-skills-dir": { type: "string", value: "dir" },
  "claude-commands-dir": { type: "string", value: "dir" },
  "install-openclaw-skill": { type: "boolean" },
  "openclaw-skills-dir": { type: "string", value: "dir" },
  "install-codex-skill": { type: "boolean" },
  "codex-skills-dir": { type: "string", value: "dir" },
};

const SELECT_OPTIONS = {
  character: { type: "string", alias: "c", value: "family" },
  type: { type: "string", value: "family" },
  "base-dir": { type: "string", value: "dir" },
};

const CREATE_OPTIONS = {
  ...SELECT_OPTIONS,
  ...INSTALL_OPTIONS,
  slug: { type: "string", value: "slug" },
  name: { type: "string", value: "name" },
  meta: { type: "string", value: "file" },
  work: { type: "string", value: "file" },
  persona: { type: "string", value: "file" },
  "research-profile": { type: "string", value: "name" },
};

const UPDATE_OPTIONS = {
  ...SELECT_OPTIONS,
  ...INSTALL_OPTIONS,
  slug: { type: "string", value: "slug" },
  "work-patch": { type: "string", value: "file" },
  "persona-patch": { type: "string", value: "file" },
  "correction-json": { type: "string", value: "file" },
};

const VERSION_OPTIONS = {
  ...SELECT_OPTIONS,
  slug: { type: "string", value: "slug" },
  version: { type: "string", value: "vN" },
  "max-versions": { type: "string", value: "N" },
};

function readTextFlag(value, label) {
  try {
    return readFileSync(value, "utf8");
  } catch (error) {
    throw new CliError(`cannot read ${label}: ${value}`, {
      code: "missing-input",
      remedy: error.message,
    });
  }
}

function metaInputs(paths) {
  return paths.filter(Boolean).map((path) => describeFile(path)).filter(Boolean);
}

function artifactOutputs(skillDir) {
  const names = [
    "SKILL.md",
    "work.md",
    "persona.md",
    "work_skill.md",
    "persona_skill.md",
    "manifest.json",
    "meta.json",
  ];
  return names
    .map((name) => describeFile(join(skillDir, name)))
    .filter(Boolean);
}

function resolveSkillDir(baseDir, slug, label = "skill slug") {
  let skillDir;
  try {
    skillDir = resolveContainedChild(baseDir, slug, label);
  } catch (error) {
    throw new CliError(error.message, {
      code: "unsafe-path",
      remedy: "pass a single safe directory name (no separators, no '..').",
    });
  }
  if (!existsSync(skillDir)) {
    throw new CliError(`skill directory not found: ${skillDir}`, {
      code: "missing-skill",
      remedy: "run `distilly skill list` to see the skills in this storage root.",
    });
  }
  return skillDir;
}

const createCommand = {
  summary: "创建 Skill / Create a Skill",
  usage: "distilly skill create [options]",
  options: CREATE_OPTIONS,
  ...skillHelp(),
  run({ argv, json, reporter }) {
    const { flags } = parseArgs(argv, CREATE_OPTIONS);
    const requestedCharacter = normalizeCharacter(flags.character || flags.type);

    const autoInstallSetting =
      process.env.DISTILLY_AUTO_INSTALL_CLAUDE ?? process.env.DOT_SKILL_AUTO_INSTALL_CLAUDE;
    const autoInstallDefault = autoInstallSetting !== undefined && autoInstallSetting !== "0";
    const installClaudeSkill =
      (flags["install-claude-skill"] || autoInstallDefault) && !flags["no-install-claude-skill"];

    const meta = flags.meta ? JSON.parse(readTextFlag(flags.meta, "meta JSON")) : {};
    if (flags.name) {
      meta.name = flags.name;
      meta.display_name = flags.name;
    }
    meta.character = normalizeCharacter(meta.character ?? meta.type ?? requestedCharacter);
    meta.research_profile = normalizeResearchProfile(
      meta.character,
      flags["research-profile"] || meta.research_profile,
    );
    meta.type = meta.type || meta.character;

    const baseDir = resolveBaseDir(flags["base-dir"], requestedCharacter);
    let slug;
    try {
      slug = flags.slug
        ? validateSlug(flags.slug)
        : slugify(meta.display_name ?? meta.name ?? "person");
    } catch (error) {
      if (error instanceof SlugResolutionError) {
        throw new CliError(error.message, { code: error.code, remedy: error.remedy });
      }
      throw new CliError(error.message, {
        code: "invalid-slug",
        remedy: "pass --slug <kebab-case> (1-40 lowercase letters/digits).",
      });
    }

    const workContent = flags.work ? readTextFlag(flags.work, "work.md") : "";
    const personaContent = flags.persona ? readTextFlag(flags.persona, "persona.md") : "";

    const skillDir = createSkill(baseDir, slug, meta, workContent, personaContent);

    reporter.line(`Created skill: ${displayPath(skillDir)}`);
    reporter.line("  Kind: meta-skill");
    reporter.line(`  Character: ${meta.character}`);
    reporter.line(`  Research Profile: ${meta.research_profile}`);
    reporter.line(`  Preset: ${meta.preset ?? "auto"}`);

    const installLines = installGeneratedHosts(
      skillDir,
      {
        claudeSkillsDir: flags["claude-skills-dir"],
        claudeCommandsDir: flags["claude-commands-dir"],
        installClaudeCommandShim: flags["install-claude-command-shim"],
        openclawSkillsDir: flags["openclaw-skills-dir"],
        installOpenclawSkill: flags["install-openclaw-skill"],
        codexSkillsDir: flags["codex-skills-dir"],
        installCodexSkill: flags["install-codex-skill"],
      },
      installClaudeSkill,
    );
    if (installLines.length > 0) for (const line of installLines) reporter.line(line);
    else reporter.line("  Host installs: skipped");

    const outputs = artifactOutputs(skillDir);
    const warnings = [];
    if (!json && flags.slug === undefined && slug) {
      warnings.push(`slug derived from --name: ${slug}`);
    }
    return {
      receipt: createReceipt("skill create", {
        person: slug,
        inputs: metaInputs([flags.meta, flags.work, flags.persona]),
        outputs,
        warnings,
      }),
    };
  },
};

const updateCommand = {
  summary: "更新 Skill / Update a Skill",
  usage: "distilly skill update [options]",
  options: UPDATE_OPTIONS,
  ...skillHelp(),
  run({ argv, reporter }) {
    const { flags } = parseArgs(argv, UPDATE_OPTIONS);
    const requestedCharacter = normalizeCharacter(flags.character || flags.type);

    let slug;
    try {
      slug = validatePathSegment(flags.slug ?? "", "existing slug");
    } catch (error) {
      throw new CliError(error.message, {
        code: "unsafe-slug",
        remedy: "pass --slug <name-of-existing-skill-directory>.",
      });
    }

    const baseDir = resolveExistingStorageRoot(requestedCharacter, slug, flags["base-dir"]);
    const skillDir = resolveSkillDir(baseDir, slug);

    const workPatch = flags["work-patch"] ? readTextFlag(flags["work-patch"], "work patch") : null;
    const personaPatch = flags["persona-patch"]
      ? readTextFlag(flags["persona-patch"], "persona patch")
      : null;
    const correction = flags["correction-json"]
      ? JSON.parse(readTextFlag(flags["correction-json"], "correction JSON"))
      : null;

    const newVersion = updateSkill(skillDir, workPatch, personaPatch, correction);
    reporter.line(`Updated skill to ${newVersion}: ${displayPath(skillDir)}`);

    const autoInstallSetting =
      process.env.DISTILLY_AUTO_INSTALL_CLAUDE ?? process.env.DOT_SKILL_AUTO_INSTALL_CLAUDE;
    const autoInstallDefault = autoInstallSetting !== undefined && autoInstallSetting !== "0";
    const installClaudeSkill =
      (flags["install-claude-skill"] || autoInstallDefault) && !flags["no-install-claude-skill"];
    const installLines = installGeneratedHosts(
      skillDir,
      {
        claudeSkillsDir: flags["claude-skills-dir"],
        claudeCommandsDir: flags["claude-commands-dir"],
        installClaudeCommandShim: flags["install-claude-command-shim"],
        openclawSkillsDir: flags["openclaw-skills-dir"],
        installOpenclawSkill: flags["install-openclaw-skill"],
        codexSkillsDir: flags["codex-skills-dir"],
        installCodexSkill: flags["install-codex-skill"],
      },
      installClaudeSkill,
    );
    for (const line of installLines) reporter.line(line);

    return {
      receipt: createReceipt("skill update", {
        person: slug,
        inputs: metaInputs([
          flags["work-patch"],
          flags["persona-patch"],
          flags["correction-json"],
          join(skillDir, "meta.json"),
        ]),
        outputs: artifactOutputs(skillDir),
        warnings: [],
      }),
    };
  },
};

const listCommand = {
  summary: "列出已有 Skill / List generated Skills",
  usage: "distilly skill list [options]",
  options: SELECT_OPTIONS,
  ...skillHelp(),
  run({ argv, reporter }) {
    const { flags } = parseArgs(argv, SELECT_OPTIONS);
    const requestedCharacter = normalizeCharacter(flags.character || flags.type);
    const baseDir = resolveExistingStorageRoot(requestedCharacter, null, flags["base-dir"]);
    const skills = listSkills(baseDir);

    if (skills.length === 0) {
      const preset = getCharacterPreset(requestedCharacter);
      reporter.line(`No ${preset.character} skills found`);
    } else {
      reporter.line(`Found ${skills.length} skills:`);
      reporter.line("");
      for (const skill of skills) {
        const updated = skill.updated_at ? skill.updated_at.slice(0, 10) : "unknown";
        reporter.line(`  [${skill.slug}]  ${skill.name} — ${skill.identity}`);
        reporter.line(
          `    Kind: ${skill.kind}  Character: ${skill.character}  ` +
            `Research Profile: ${skill.research_profile}  ` +
            `Version: ${skill.version}  ` +
            `Corrections: ${skill.corrections_count}  Updated: ${updated}`,
        );
        reporter.line("");
      }
    }

    const outputs = skills
      .map((skill) => describeFile(join(baseDir, skill.slug, "SKILL.md")))
      .filter(Boolean);
    return {
      receipt: createReceipt("skill list", {
        outputs,
        warnings: skills.length === 0 ? [`no skills found in ${baseDir}`] : [],
      }),
    };
  },
};

const versionCommand = {
  summary: "版本归档 / Archive, roll back and prune Skill versions",
  usage: "distilly skill version <list|backup|rollback|cleanup> [options]",
  options: VERSION_OPTIONS,
  ...skillHelp(),
  run({ argv, reporter }) {
    const { flags, positionals } = parseArgs(argv, VERSION_OPTIONS);
    const action = positionals[0] ?? "list";
    if (!["list", "backup", "rollback", "cleanup"].includes(action)) {
      throw new CliError(`unknown skill version action: ${action}`, {
        code: "usage",
        remedy: "choose one of: list, backup, rollback, cleanup.",
      });
    }

    const requestedCharacter = normalizeCharacter(flags.character || flags.type);
    let slug;
    try {
      slug = validatePathSegment(flags.slug ?? "", "skill slug");
    } catch (error) {
      throw new CliError(error.message, {
        code: "unsafe-slug",
        remedy: "pass --slug <name-of-existing-skill-directory>.",
      });
    }
    const baseDir = resolveExistingStorageRoot(requestedCharacter, slug, flags["base-dir"]);
    const skillDir = resolveSkillDir(baseDir, slug);

    let outputs = [];
    if (action === "list") {
      const versions = listVersions(skillDir);
      if (versions.length === 0) {
        reporter.line(`no archived versions for ${slug}`);
      } else {
        reporter.line(`archived versions for ${slug}:`);
        reporter.line("");
        for (const version of versions) {
          reporter.line(
            `  ${version.version}  archived: ${version.archived_at}  files: ${version.files.join(", ")}`,
          );
        }
      }
      outputs = versions
        .map((version) => describeFile(join(version.path, "SKILL.md")))
        .filter(Boolean);
    } else if (action === "backup") {
      if (!backupCurrentVersion(skillDir)) {
        throw new CliError(`could not archive the current version of ${slug}`, {
          code: "archive-failed",
          remedy: "make sure meta.json exists in the skill directory.",
        });
      }
      outputs = artifactOutputs(skillDir);
    } else if (action === "rollback") {
      if (!flags.version) {
        throw new CliError("rollback requires --version", {
          code: "usage",
          remedy: "run `distilly skill version list --slug <slug>` and pass --version <vN>.",
        });
      }
      if (!rollback(skillDir, flags.version)) {
        throw new CliError(`rollback to ${flags.version} failed`, {
          code: "rollback-failed",
          remedy: `check the archive list for ${slug}.`,
        });
      }
      outputs = artifactOutputs(skillDir);
    } else {
      const maxVersions = flags["max-versions"] ? Number.parseInt(flags["max-versions"], 10) : MAX_VERSIONS;
      if (!cleanupOldVersions(skillDir, maxVersions)) {
        throw new CliError(`cleanup failed for ${slug}`, { code: "cleanup-failed" });
      }
      reporter.line("cleanup complete");
      outputs = [];
    }

    return {
      receipt: createReceipt("skill version", {
        person: slug,
        inputs: [describeFile(join(skillDir, "meta.json"))].filter(Boolean),
        outputs,
        warnings: [],
      }),
    };
  },
};

export function registerSkillCommands() {
  register("skill", {
    summary: "Skill 子命令入口 / Skill subcommand entry",
    usage: "distilly skill <create|update|list|version> [options]",
    ...skillHelp(),
    run({ argv, reporter }) {
      if (argv.length === 0) {
        reporter.line(skillHelp().zh);
        return { receipt: createReceipt("skill", { warnings: [] }) };
      }
      throw new CliError(`unknown skill subcommand: ${argv[0]}`, {
        code: "usage",
        remedy: "choose one of: create, update, list, version.",
      });
    },
  });
  register("skill create", createCommand);
  register("skill update", updateCommand);
  register("skill list", listCommand);
  register("skill version", versionCommand);
}

registerSkillCommands();

export { homedir, statSync };
