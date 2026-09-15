/**
 * Skill artifact writer.
 *
 * Node port of `tools/skill_writer.py`: writes the six primary artifacts plus
 * `meta.json` for the Distilly engine while preserving backward compatibility
 * with the original colleague-centric layout. Output bytes are identical to the
 * Python original — see `scripts/parity.mjs`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  getCharacterPreset,
  resolveExistingStorageRoot,
  resolveStorageRoot,
} from "./presets.mjs";
import {
  PRIMARY_ARTIFACTS,
  buildIdentityString,
  buildManifest,
  enrichExistingSkillMeta,
  enrichSkillMeta,
  jsonDumps,
  normalizeCommandSlug,
  nowIso,
  resolveContainedChild,
  syncLegacyFields,
  validatePathSegment,
} from "./schema.mjs";
import { pinyinSyllables } from "./slug.mjs";

export const SKILL_MD_TEMPLATE_EN = __TEMPLATE_EN__;

export const SKILL_MD_TEMPLATE_ZH = __TEMPLATE_ZH__;

export const MAX_SLUG_LENGTH = 40;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Require a safe kebab-case slug before using it in paths or skill names. */
export function validateSlug(slug) {
  if (String(slug).length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(String(slug))) {
    throw new Error(
      `slug must be 1-${MAX_SLUG_LENGTH} lowercase letters/digits in kebab-case`,
    );
  }
  return slug;
}

/**
 * Convert a human-readable name into a stable slug.
 *
 * Uses the Unihan-derived pinyin table (`src/skill/slug.mjs`); when the table
 * is missing or a character is uncovered it throws `SlugResolutionError` and
 * asks for an explicit `--slug` instead of emitting a junk slug.
 */
export function slugify(name, options = {}) {
  const candidate = pinyinSyllables(name, options).join("-");
  return normalizeCommandSlug(candidate);
}

/** Return the preferred language code for rendered artifacts. */
export function languageCode(meta) {
  const classification = meta?.classification ?? {};
  return String(meta?.language || classification.language || "en").toLowerCase();
}

/** Return whether artifact chrome should be rendered in Chinese. */
export function prefersChinese(meta) {
  return languageCode(meta).startsWith("zh");
}

/** Render the combined SKILL.md file from normalized metadata. */
export function renderCombinedSkill(meta, workContent, personaContent) {
  const artifacts = meta.artifacts;
  const identity = buildIdentityString(meta);
  const description =
    meta.summary || (identity ? `${meta.display_name}, ${identity}` : meta.display_name);
  const template = prefersChinese(meta) ? SKILL_MD_TEMPLATE_ZH : SKILL_MD_TEMPLATE_EN;

  const values = {
    combined_name: artifacts.combined_name,
    description,
    display_name: meta.display_name,
    identity,
    work_content: workContent,
    persona_content: personaContent,
  };
  return template.replace(
    /\{(combined_name|description|display_name|identity|work_content|persona_content)\}/g,
    (_, key) => values[key],
  );
}

const PERSONA_HANDOFF_PATTERNS = [
  /如果被问到职责范围外的问题，以该同事的方式回应（参见 Persona 部分）。\s*/g,
  /If (?:you are )?asked (?:a question )?outside (?:your|the) (?:recorded )?responsibilities[^.\n]*Persona[^.\n]*\.\s*/gi,
];

export const WORK_ONLY_FALLBACK_ZH = __FALLBACK_ZH__;

export const WORK_ONLY_FALLBACK_EN = __FALLBACK_EN__;

/** Copy Work text for the Work-only skill, without a Persona handoff. */
export function workOnlyContent(workContent, { chinese }) {
  let text = workContent;
  for (const pattern of PERSONA_HANDOFF_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, "");
  }
  text = text.replace(/\s+$/, "");
  const fallback = chinese ? WORK_ONLY_FALLBACK_ZH : WORK_ONLY_FALLBACK_EN;
  if (!text.includes(fallback)) {
    text = text ? `${text}\n\n${fallback}` : fallback;
  }
  return text;
}

/** Render the work-only skill artifact. */
export function renderWorkSkill(meta, workContent) {
  const artifacts = meta.artifacts;
  const chinese = prefersChinese(meta);
  const description = chinese
    ? `${meta.display_name} 的工作能力（仅 Work，无 Persona）`
    : `${meta.display_name} work capability only (without persona)`;
  const body = workOnlyContent(workContent, { chinese });
  return `---\nname: ${artifacts.work_name}\ndescription: ${description}\nuser-invocable: true\n---\n\n${body}\n`;
}

/** Render the persona-only skill artifact. */
export function renderPersonaSkill(meta, personaContent) {
  const artifacts = meta.artifacts;
  const description = prefersChinese(meta)
    ? `${meta.display_name} 的人物性格（仅 Persona，无工作能力）`
    : `${meta.display_name} persona only (without work capability)`;
  return `---\nname: ${artifacts.persona_name}\ndescription: ${description}\nuser-invocable: true\n---\n\n${personaContent}\n`;
}

/** Write all generated artifacts for a skill version. */
export function writeArtifacts(skillDir, meta, workContent, personaContent) {
  const artifacts = meta.artifacts;
  const manifest = buildManifest(meta);

  writeFileSync(join(skillDir, artifacts.work_doc), workContent, "utf8");
  writeFileSync(join(skillDir, artifacts.persona_doc), personaContent, "utf8");
  writeFileSync(
    join(skillDir, artifacts.combined_skill),
    renderCombinedSkill(meta, workContent, personaContent),
    "utf8",
  );
  writeFileSync(join(skillDir, artifacts.work_skill), renderWorkSkill(meta, workContent), "utf8");
  writeFileSync(
    join(skillDir, artifacts.persona_skill),
    renderPersonaSkill(meta, personaContent),
    "utf8",
  );
  writeFileSync(join(skillDir, artifacts.manifest), jsonDumps(manifest), "utf8");
  writeFileSync(join(skillDir, "meta.json"), jsonDumps(syncLegacyFields(meta)), "utf8");
}

/** Create a new skill directory with normalized metadata. */
export function createSkill(baseDir, slug, meta, workContent, personaContent) {
  const safeSlug = validateSlug(slug);
  const normalizedMeta = enrichSkillMeta(meta, safeSlug, meta?.character ?? null);
  const preset = getCharacterPreset(normalizedMeta.character);
  const skillDir = join(baseDir, safeSlug);
  mkdirSync(skillDir, { recursive: true });

  mkdirSync(join(skillDir, "versions"), { recursive: true });
  for (const relativePath of preset.knowledge_dirs ?? ["docs", "messages", "emails"]) {
    mkdirSync(join(skillDir, "knowledge", relativePath), { recursive: true });
  }

  normalizedMeta.lifecycle.created_at = normalizedMeta.created_at ?? nowIso();
  normalizedMeta.lifecycle.updated_at = normalizedMeta.lifecycle.created_at;
  normalizedMeta.lifecycle.version = "v1";
  normalizedMeta.generation.corrections_count = normalizedMeta.corrections_count ?? 0;
  syncLegacyFields(normalizedMeta);

  writeArtifacts(skillDir, normalizedMeta, workContent, personaContent);
  return skillDir;
}

/** Copy the current artifact set into versions/<versionName>/. */
export function backupCurrentArtifacts(skillDir, versionName) {
  const versionsDir = resolveContainedChild(skillDir, "versions", "versions directory");
  const versionDir = resolveContainedChild(
    versionsDir,
    validatePathSegment(String(versionName), "version"),
    "version",
  );
  mkdirSync(versionDir, { recursive: true });

  for (const filename of PRIMARY_ARTIFACTS) {
    const source = join(skillDir, filename);
    if (existsSync(source)) copyFileSync(source, join(versionDir, filename));
  }
}

function sectionMatches(text) {
  const pattern = /^##\s+.+$/gm;
  const matches = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({ start: match.index, heading: match[0] });
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return matches;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace matching level-2 markdown sections, otherwise append the patch. */
export function mergeMarkdownPatch(existingContent, patchContent) {
  const matches = sectionMatches(patchContent);
  if (matches.length === 0) {
    return existingContent + (existingContent ? "\n\n" : "") + patchContent;
  }

  let merged = existingContent;
  let replacedAny = false;

  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index].heading;
    const start = matches[index].start;
    const end = index + 1 < matches.length ? matches[index + 1].start : patchContent.length;
    const patchSection = patchContent.slice(start, end).trim();

    const sectionMatch = new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m").exec(merged);
    if (!sectionMatch) {
      merged = `${merged.replace(/\s+$/, "")}\n\n${patchSection}`;
      continue;
    }

    replacedAny = true;
    const sectionStart = sectionMatch.index;
    const afterHeading = sectionMatch.index + sectionMatch[0].length;
    const nextSection = /^##\s+.+$/m.exec(merged.slice(afterHeading));
    const sectionEnd = nextSection ? afterHeading + nextSection.index : merged.length;
    merged = `${merged.slice(0, sectionStart).replace(/\s+$/, "")}\n\n${patchSection}\n\n${merged
      .slice(sectionEnd)
      .replace(/^\s+/, "")}`;
  }

  if (replacedAny) return `${merged.trim()}\n`;
  return merged;
}

/** Python's `dict.get(key, default)`: an explicit null is a value, not a miss. */
function getField(object, key, fallback) {
  if (!object || typeof object !== "object" || !Object.hasOwn(object, key)) return fallback;
  return object[key];
}

/** Append a normalized correction entry to persona content. */
export function applyCorrection(personaContent, correction) {
  const scene = getField(correction, "scene", "general");
  const correctionLine = `\n- [${scene}] should not ${correction.wrong}; should ${correction.correct}`;
  const target = "## Correction Log";
  const legacyTarget = "## Correction 记录";

  if (personaContent.includes(target)) {
    const insertPosition = personaContent.indexOf(target) + target.length;
    let rest = personaContent.slice(insertPosition);
    const placeholder = "\n\n(No entries yet)";
    if (rest.startsWith(placeholder)) rest = rest.slice(placeholder.length);
    return personaContent.slice(0, insertPosition) + correctionLine + rest;
  }
  if (personaContent.includes(legacyTarget)) {
    const insertPosition = personaContent.indexOf(legacyTarget) + legacyTarget.length;
    let rest = personaContent.slice(insertPosition);
    const legacyPlaceholder = "\n\n（暂无记录）";
    if (rest.startsWith(legacyPlaceholder)) rest = rest.slice(legacyPlaceholder.length);
    return personaContent.slice(0, insertPosition) + correctionLine + rest;
  }
  return `${personaContent}\n\n## Correction Log\n${correctionLine}\n`;
}

/** Normalize a correction payload into a flat list of correction entries. */
export function normalizeCorrections(correction) {
  if (!correction) return [];

  if (Array.isArray(correction)) {
    return correction.filter((item) => item && typeof item === "object" && !Array.isArray(item));
  }

  if (typeof correction === "object") {
    if ("wrong" in correction && "correct" in correction) return [correction];
    for (const key of ["persona_corrections", "corrections"]) {
      const value = correction[key];
      if (Array.isArray(value)) {
        return value.filter(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            "wrong" in item &&
            "correct" in item,
        );
      }
    }
  }

  return [];
}

/**
 * Update an existing skill, archive the previous version, and regenerate artifacts.
 * @returns {string} the new version label
 */
export function updateSkill(skillDir, workPatch = null, personaPatch = null, correction = null) {
  const metaPath = join(skillDir, "meta.json");
  const meta = enrichExistingSkillMeta(
    JSON.parse(readFileSync(metaPath, "utf8")),
    skillDir,
  );

  const currentVersion = meta.version ?? "v1";
  let versionNumber;
  try {
    const head = String(currentVersion).replace(/^v+/, "").split("_")[0];
    if (!/^[+-]?\d+$/.test(head)) throw new Error("not a number");
    versionNumber = Number.parseInt(head, 10) + 1;
  } catch {
    versionNumber = 2;
  }
  const newVersion = `v${versionNumber}`;

  backupCurrentArtifacts(skillDir, currentVersion);

  const artifacts = meta.artifacts;
  const workPath = join(skillDir, artifacts.work_doc);
  const personaPath = join(skillDir, artifacts.persona_doc);
  let workContent = existsSync(workPath) ? readFileSync(workPath, "utf8") : "";
  let personaContent = existsSync(personaPath) ? readFileSync(personaPath, "utf8") : "";

  if (workPatch) workContent = mergeMarkdownPatch(workContent, workPatch);

  if (personaPatch) {
    personaContent = mergeMarkdownPatch(personaContent, personaPatch);
  } else if (correction) {
    const corrections = normalizeCorrections(correction);
    for (const item of corrections) personaContent = applyCorrection(personaContent, item);
    if (corrections.length > 0) {
      meta.generation.corrections_count = (meta.corrections_count ?? 0) + corrections.length;
    }
  }

  meta.lifecycle.version = newVersion;
  meta.lifecycle.updated_at = nowIso();
  syncLegacyFields(meta);

  writeArtifacts(skillDir, meta, workContent, personaContent);
  return newVersion;
}

/** List skills from a storage root regardless of their type. */
export function listSkills(baseDir) {
  const skills = [];
  if (!existsSync(baseDir)) return skills;

  const entries = readdirSync(baseDir).sort();
  for (const entry of entries) {
    const skillDir = join(baseDir, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const metaPath = join(skillDir, "meta.json");
    if (!existsSync(metaPath)) continue;

    let meta;
    try {
      meta = enrichExistingSkillMeta(JSON.parse(readFileSync(metaPath, "utf8")), skillDir);
    } catch {
      continue;
    }

    skills.push({
      slug: meta.slug ?? entry,
      kind: meta.kind ?? "meta-skill",
      character: meta.character ?? "colleague",
      research_profile: meta.research_profile ?? "standard",
      name: meta.display_name ?? entry,
      identity: buildIdentityString(meta),
      version: meta.version ?? "v1",
      updated_at: meta.updated_at ?? "",
      corrections_count: meta.corrections_count ?? 0,
    });
  }

  return skills;
}

/** Resolve the storage root for a character family while keeping compatibility. */
export function resolveBaseDir(baseDirArg, character) {
  return resolveStorageRoot(character, baseDirArg);
}

export { resolveExistingStorageRoot };
