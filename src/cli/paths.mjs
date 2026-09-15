/**
 * Where a Skill family lives on disk.
 *
 * Two spellings of `--base-dir` grew apart: `harvest` / `parse-*` treat it as the
 * directory that *contains* `skills/`, while `skill create` treats it as the
 * storage root itself (`skills/colleague`). Both are reasonable, and neither is
 * written down, so the same value silently means different places — a trap for
 * users and for the coding agents that script this CLI.
 *
 * `resolveSkillsRoot` accepts both: the canonical `<base>/skills/<family>` wins
 * whenever it exists (or `skills/` does), the storage-root reading is kept
 * working for compatibility, and the caller gets a warning to surface when the
 * legacy reading was used.
 */

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * @param {{baseDir: string, family: string}} input
 * @returns {{root: string, mode: "skills-root"|"storage-root", warning: string|null}}
 */
export function resolveSkillsRoot({ baseDir, family }) {
  const base = resolve(baseDir);
  const canonical = join(base, "skills", family);
  if (existsSync(canonical)) return { root: canonical, mode: "skills-root", warning: null };
  if (basename(base) === family) return { root: base, mode: "storage-root", warning: null };
  if (existsSync(join(base, "skills"))) return { root: canonical, mode: "skills-root", warning: null };
  return {
    root: base,
    mode: "storage-root",
    warning:
      `--base-dir ${baseDir} has no skills/ directory, so it was read as the storage root itself (${base}). ` +
      `The canonical spelling is --base-dir <dir-containing-skills>, i.e. ${join(base, "..", "..")} for this layout.`,
  };
}
