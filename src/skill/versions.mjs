/**
 * Skill version manager.
 *
 * Node port of `tools/version_manager.py`: archives and restores generated
 * artifacts while keeping the legacy colleague storage layout readable.
 * Messages match the Python original byte for byte (verified by
 * `scripts/parity.mjs`).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeCharacter, resolveExistingStorageRoot } from "./presets.mjs";
import {
  PRIMARY_ARTIFACTS,
  enrichExistingSkillMeta,
  jsonDumps,
  nowIso,
  resolveContainedChild,
  syncLegacyFields,
  validatePathSegment,
} from "./schema.mjs";

export const MAX_VERSIONS = 10;

/** Resolve the storage root for the selected character family. */
export function resolveBaseDir(baseDirArg, character) {
  return resolveExistingStorageRoot(character, null, baseDirArg);
}

/** Resolve the versions directory without following a symlink outside the skill. */
export function resolveVersionsDir(skillDir) {
  return resolveContainedChild(skillDir, "versions", "versions directory");
}

/** `YYYY-MM-DD HH:MM` in UTC, matching `datetime.fromtimestamp(mtime, tz=utc).strftime`. */
function formatArchivedAt(mtimeMs) {
  const iso = new Date(mtimeMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** List all archived versions for a skill directory. */
export function listVersions(skillDir) {
  let versionsDir;
  try {
    versionsDir = resolveVersionsDir(skillDir);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return [];
  }
  if (!existsSync(versionsDir)) return [];

  const versions = [];
  for (const entry of readdirSync(versionsDir).sort()) {
    const versionDir = join(versionsDir, entry);
    if (!statSync(versionDir).isDirectory()) continue;

    const archivedAt = formatArchivedAt(statSync(versionDir).mtimeMs);
    const files = readdirSync(versionDir).filter((name) => statSync(join(versionDir, name)).isFile());
    versions.push({
      version: entry,
      archived_at: archivedAt,
      files,
      path: versionDir,
    });
  }

  return versions;
}

/** Copy the current generated artifacts into a backup directory. */
export function backupArtifacts(skillDir, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  for (const filename of PRIMARY_ARTIFACTS) {
    const source = join(skillDir, filename);
    if (existsSync(source)) copyFileSync(source, join(backupDir, filename));
  }
}

/** Restore a previously archived version. */
export function rollback(skillDir, targetVersion) {
  let versionsDir;
  let versionDir;
  try {
    versionsDir = resolveVersionsDir(skillDir);
    versionDir = resolveContainedChild(versionsDir, targetVersion, "version");
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return false;
  }
  if (!existsSync(versionDir)) {
    process.stderr.write(`error: version does not exist: ${targetVersion}\n`);
    return false;
  }

  const metaPath = join(skillDir, "meta.json");
  if (!existsSync(metaPath)) {
    process.stderr.write("error: meta.json is required for rollback\n");
    return false;
  }

  const meta = enrichExistingSkillMeta(JSON.parse(readFileSyncText(metaPath)), skillDir);
  const currentVersion = meta.version ?? "v?";
  let backupDir;
  try {
    backupDir = resolveContainedChild(
      versionsDir,
      `${validatePathSegment(String(currentVersion), "current version")}_before_rollback`,
      "rollback backup version",
    );
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return false;
  }
  backupArtifacts(skillDir, backupDir);

  const restoredFiles = [];
  for (const filename of PRIMARY_ARTIFACTS) {
    const source = join(versionDir, filename);
    if (existsSync(source)) {
      copyFileSync(source, join(skillDir, filename));
      restoredFiles.push(filename);
    }
  }

  meta.lifecycle.version = `${targetVersion}_restored`;
  meta.lifecycle.updated_at = nowIso();
  meta.rollback_from = currentVersion;
  writeFileSync(metaPath, jsonDumps(syncLegacyFields(meta)), "utf8");

  process.stdout.write(`rolled back to ${targetVersion}: ${restoredFiles.join(", ")}\n`);
  return true;
}

/** Archive the current generated artifacts under versions/<version>/. */
export function backupCurrentVersion(skillDir) {
  const metaPath = join(skillDir, "meta.json");
  if (!existsSync(metaPath)) {
    process.stderr.write("error: meta.json is required to determine the current version\n");
    return false;
  }

  const meta = enrichExistingSkillMeta(JSON.parse(readFileSyncText(metaPath)), skillDir);
  const currentVersion = meta.version ?? "v1";
  let backupDir;
  try {
    const versionsDir = resolveVersionsDir(skillDir);
    backupDir = resolveContainedChild(
      versionsDir,
      validatePathSegment(String(currentVersion), "current version"),
      "current version",
    );
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return false;
  }
  backupArtifacts(skillDir, backupDir);
  process.stdout.write(`archived version ${currentVersion}\n`);
  return true;
}

/** Remove archived versions beyond the retention limit. */
export function cleanupOldVersions(skillDir, maxVersions = MAX_VERSIONS) {
  let versionsDir;
  try {
    versionsDir = resolveVersionsDir(skillDir);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return false;
  }
  if (!existsSync(versionsDir)) return true;

  const versionDirs = readdirSync(versionsDir)
    .map((entry) => join(versionsDir, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
  const toDelete = versionDirs.length > maxVersions ? versionDirs.slice(0, versionDirs.length - maxVersions) : [];

  for (const oldDir of toDelete) {
    rmSync(oldDir, { recursive: true, force: true });
    process.stdout.write(`deleted old version: ${oldDir.split("/").pop()}\n`);
  }
  return true;
}

function readFileSyncText(path) {
  // Local import indirection keeps the module's import list flat.
  return require_readFileSync(path);
}

import { readFileSync as require_readFileSync } from "node:fs";

export { normalizeCharacter, resolveExistingStorageRoot };
