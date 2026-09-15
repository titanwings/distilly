/**
 * Schema migrations for generated Skill directories.
 *
 * v4 adds the v2 evidence layout — `knowledge/raw`, `knowledge/text`,
 * `knowledge/index.json`, `evidence/derived`, `evidence/renders`, `views` — to
 * directories created by the v3 engine. It never rewrites a body: the six
 * primary artifacts and every markdown file keep their bytes, and the only edits
 * are the `schema_version` fields plus the directories and an empty ledger.
 *
 * Migration is idempotent by construction (a directory that already reports v4 is
 * returned untouched), so running it twice is a no-op the second time.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SCHEMA_VERSION, jsonDumps } from "./schema.mjs";
import { KnowledgeStore } from "../knowledge/store.mjs";
import { emptyLedger, saveLedger } from "../knowledge/ledger.mjs";

export const TARGET_SCHEMA_VERSION = SCHEMA_VERSION;

/** Directories v4 guarantees; the ledger is seeded separately. */
export const V4_DIRECTORIES = [
  "knowledge/raw",
  "knowledge/text",
  "evidence/derived",
  "evidence/renders",
  "views",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** `schema_version` as reported by meta.json, then manifest.json, else "3". */
export function readSchemaVersion(skillDir) {
  for (const file of ["meta.json", "manifest.json"]) {
    const path = join(skillDir, file);
    if (!existsSync(path)) continue;
    try {
      const value = readJson(path).schema_version;
      if (typeof value === "string" && value.length > 0) return value;
    } catch {
      /* a malformed artifact is reported by `doctor`, not by the migration */
    }
  }
  return "3";
}

/** Rewrite only `schema_version`, preserving key order and the write format. */
function bumpArtifactVersion(path, version, actions, dryRun, relative) {
  if (!existsSync(path)) return;
  const value = readJson(path);
  if (value.schema_version === version) return;
  value.schema_version = version;
  if (!dryRun) writeFileSync(path, jsonDumps(value), "utf8");
  actions.push(`bumped schema_version in ${relative}`);
}

/**
 * Migrate one Skill directory to the current schema.
 * @returns {{skillDir: string, from: string, to: string, actions: string[], changed: boolean}}
 */
export function migrateSkillDir(skillDir, { dryRun = false } = {}) {
  const from = readSchemaVersion(skillDir);
  const actions = [];
  if (from === TARGET_SCHEMA_VERSION) {
    return { skillDir, from, to: from, actions, changed: false };
  }

  for (const relative of V4_DIRECTORIES) {
    const target = join(skillDir, relative);
    if (existsSync(target)) continue;
    if (!dryRun) mkdirSync(target, { recursive: true });
    actions.push(`created ${relative}`);
  }

  const store = new KnowledgeStore(skillDir, { dryRun });
  if (!existsSync(store.ledgerPath)) {
    if (!dryRun) saveLedger(store, emptyLedger());
    actions.push("seeded knowledge/index.json");
  }

  bumpArtifactVersion(join(skillDir, "meta.json"), TARGET_SCHEMA_VERSION, actions, dryRun, "meta.json");
  bumpArtifactVersion(join(skillDir, "manifest.json"), TARGET_SCHEMA_VERSION, actions, dryRun, "manifest.json");

  return { skillDir, from, to: TARGET_SCHEMA_VERSION, actions, changed: actions.length > 0 };
}

/** Every `skills/<family>/<slug>` directory under `baseDir` (depth ≤ 2). */
export function findSkillDirs(baseDir) {
  const found = [];
  const familyRoot = join(baseDir, "skills");
  const root = existsSync(familyRoot) ? familyRoot : baseDir;
  for (const family of safeReaddir(root)) {
    const familyPath = join(root, family);
    for (const slug of safeReaddir(familyPath)) {
      const candidate = join(familyPath, slug);
      if (existsSync(join(candidate, "meta.json")) || existsSync(join(candidate, "manifest.json"))) {
        found.push(candidate);
      }
    }
  }
  return found.sort();
}

function safeReaddir(dir) {
  try {
    return require("node:fs")
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
