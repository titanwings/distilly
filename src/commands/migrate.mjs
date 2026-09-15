/**
 * `distilly skill migrate` — bring v3 Skill directories up to the current schema.
 *
 * Idempotent and non-destructive: it creates the v4 layout and seeds an empty
 * ledger, and edits nothing except the `schema_version` fields. `--dry-run`
 * reports exactly what would change without writing.
 */

import { relative } from "node:path";

import { register } from "./index.mjs";
import { findSkillDirs, migrateSkillDir, readSchemaVersion, TARGET_SCHEMA_VERSION } from "../skill/migrate.mjs";

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly skill migrate [--base-dir <dir>] [--dry-run] [--json]",
    "",
    "把 v3 目录补成当前 schema（v4）：建 knowledge/raw、knowledge/text、evidence/derived、",
    "evidence/renders、views，并写一个空账本；**不改任何正文**，只改 schema_version 字段。",
    "跑两次是幂等的：第二次不会写任何文件。",
  ].join("\n"),
  en: [
    "Usage:",
    "  distilly skill migrate [--base-dir <dir>] [--dry-run] [--json]",
    "",
    "Brings v3 directories up to the current schema: creates knowledge/raw, knowledge/text,",
    "evidence/derived, evidence/renders and views, seeds an empty ledger, and touches nothing",
    "but the schema_version fields. Running it twice writes nothing the second time.",
  ].join("\n"),
};

function parseMigrateArgs(argv) {
  const options = { baseDir: process.cwd(), dryRun: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--base-dir") {
      const value = argv[index + 1];
      if (!value) return { error: "--base-dir requires a value" };
      options.baseDir = value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
  }
  return { options };
}

register("skill migrate", {
  summary: "把 v3 目录迁移到当前 schema / migrate Skill directories",
  usage: "distilly skill migrate [--base-dir <dir>] [--dry-run] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const parsed = parseMigrateArgs(argv);
    if (parsed.error) {
      return {
        receipt: {
          command: "skill migrate",
          person: null,
          ok: false,
          inputs: [],
          outputs: [],
          anchors: { total: 0, cited: 0 },
          warnings: [],
          unavailable: [],
          error: { code: "skill-migrate/usage", message: parsed.error, remedy: "distilly skill migrate --help" },
        },
        exitCode: 2,
      };
    }
    const { options } = parsed;
    const dirs = findSkillDirs(options.baseDir);
    const skills = dirs.map((dir) => {
      const result = migrateSkillDir(dir, { dryRun: options.dryRun });
      return {
        path: relative(process.cwd(), dir) || ".",
        from: result.from,
        to: result.to,
        changed: result.changed,
        actions: result.actions,
      };
    });
    const changed = skills.filter((skill) => skill.changed);
    const receipt = {
      command: "skill migrate",
      person: null,
      ok: true,
      target_schema_version: TARGET_SCHEMA_VERSION,
      dry_run: options.dryRun,
      skills,
      inputs: [],
      outputs: [],
      anchors: { total: 0, cited: 0 },
      warnings: dirs.length === 0 ? [`no Skill directory found under ${options.baseDir}`] : [],
      unavailable: [],
    };
    if (!json) {
      reporter.line(
        `skill migrate${options.dryRun ? " (dry run)" : ""}: ${changed.length}/${skills.length} director(ies) ${options.dryRun ? "would change" : "changed"}`,
      );
      for (const skill of changed) {
        reporter.line(`  ${skill.path}: ${skill.from} → ${skill.to}`);
        for (const action of skill.actions) reporter.line(`    · ${action}`);
      }
    }
    return { receipt, exitCode: 0 };
  },
});

export const __internal = { readSchemaVersion };
