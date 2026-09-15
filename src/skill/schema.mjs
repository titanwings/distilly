/**
 * Shared Distilly engine schema and generated artifact metadata.
 *
 * Node port of `tools/skill_schema.py`. Everything here is byte-compatible with
 * the Python original:
 *   - `jsonDumps()` == `json.dumps(value, ensure_ascii=False, indent=2)` (no trailing newline),
 *   - key insertion order follows the Python dict operations line by line,
 *   - `nowIso()` uses Python's `datetime.now(timezone.utc).isoformat()` layout
 *     (`…+00:00`, microsecond precision).
 *
 * Byte equality is verified by `scripts/parity.mjs`; see
 * `docs/evidence/pr-01-node-core.md`.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  getCharacterPreset,
  getResearchProfilePreset,
  normalizeCharacter,
  normalizeResearchProfile,
} from "./presets.mjs";

export const SCHEMA_VERSION = "3";
export const PORTABLE_SLUG_MAX_LENGTH = 40;
export const PRIMARY_ARTIFACTS = [
  "SKILL.md",
  "work.md",
  "persona.md",
  "work_skill.md",
  "persona_skill.md",
  "manifest.json",
];
export const ARTIFACT_NAME_FILES = {
  combined_name: "SKILL.md",
  work_name: "work_skill.md",
  persona_name: "persona_skill.md",
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FRONTMATTER_NAME_RE = /^name:\s*(.+?)\s*$/m;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** `json.dumps(value, ensure_ascii=False, indent=2)` — separators and layout match Python. */
export function jsonDumps(value) {
  return JSON.stringify(value, null, 2);
}

export function sha256Hex(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/**
 * Current UTC time in Python's `datetime.now(timezone.utc).isoformat()` format.
 * `DISTILLY_PARITY_NOW` freezes it so `scripts/parity.mjs` can compare bytes
 * against the pinned Python implementation; it is unset in normal use.
 */
export function nowIso() {
  const frozen = process.env.DISTILLY_PARITY_NOW;
  if (frozen) return frozen;
  return `${new Date().toISOString().slice(0, 23)}000+00:00`;
}

/** Python's `dict.get(key, default)` — an explicit `null` is a value, not a miss. */
function pyGet(object, key, fallback) {
  if (!isObject(object) || !Object.hasOwn(object, key)) return fallback;
  return object[key];
}

/** Python's `dict.setdefault(key, value)` — an existing key wins, even when null. */
function pySetDefault(object, key, value) {
  if (!Object.hasOwn(object, key)) object[key] = value;
  return object[key];
}

/** Python truthiness for the values that appear in metadata. */
function pyTruthy(value) {
  if (value === undefined || value === null || value === false) return false;
  if (value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python's `Path.name` for the shapes this code sees. */
function pathName(inputPath) {
  const text = String(inputPath);
  if (text === "." || text === "./") return "";
  return basename(text);
}

/** Python's `Path.resolve()` (strict=False): realpath the existing prefix. */
export function resolveRealPath(inputPath) {
  let current = resolve(inputPath);
  const missing = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return missing.length > 0 ? join(real, ...missing.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return missing.length > 0 ? join(current, ...missing.reverse()) : current;
      }
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** Extract gallery tags from the legacy tags structure. */
export function flattenLegacyTags(meta) {
  const classification = pyGet(meta, "classification", {});
  const tags = pyGet(classification, "tags", undefined);
  if (Array.isArray(tags) && tags.length > 0) return tags;

  const legacyTags = pyGet(meta, "tags", {});
  if (Array.isArray(legacyTags)) {
    return legacyTags.filter((item) => typeof item === "string" && item);
  }

  const results = [];
  for (const key of ["personality", "culture"]) {
    const value = pyGet(legacyTags, key, []);
    if (Array.isArray(value)) {
      results.push(...value.filter((item) => typeof item === "string" && item));
    }
  }
  return results;
}

/** Resolve the active character family from new or legacy fields. */
export function resolveCharacter(meta, explicitCharacter = null) {
  const generation = pyGet(meta, "generation", {});
  return normalizeCharacter(
    explicitCharacter ||
      pyGet(meta, "character", undefined) ||
      pyGet(meta, "type", undefined) ||
      pyGet(generation, "character", undefined),
  );
}

/** Resolve the active research profile for the selected character family. */
export function resolveResearchProfile(meta, character, explicitResearchProfile = null) {
  const generation = pyGet(meta, "generation", {});
  const engine = pyGet(meta, "engine", {});
  return normalizeResearchProfile(
    character,
    explicitResearchProfile ||
      pyGet(meta, "research_profile", undefined) ||
      pyGet(generation, "research_profile", undefined) ||
      pyGet(engine, "research_profile", undefined),
  );
}

/** Build a human-readable identity string from metadata. */
export function buildIdentityString(meta) {
  const preset = getCharacterPreset(pyGet(meta, "character", undefined));
  const profile = pyGet(meta, "profile", {});

  if (typeof profile === "string") return profile.trim() || preset.identity_label;
  if (!isObject(profile)) return preset.identity_label;

  const parts = [];
  for (const key of ["company", "level", "role", "occupation", "identity", "specialty", "known_for"]) {
    const value = pyGet(profile, key, "");
    if (pyTruthy(value)) parts.push(String(value));
  }

  let identity = parts.length > 0 ? parts.join(" ") : preset.identity_label;

  const mbti = pyGet(profile, "mbti", "");
  if (pyTruthy(mbti)) identity += `, MBTI ${mbti}`;

  return identity;
}

/** Convert current or legacy text into a deterministic portable command slug. */
export function normalizeCommandSlug(value) {
  const asciiValue = String(value)
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase();
  let slug = asciiValue.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) {
    const digest = sha256Hex(String(value)).slice(0, 8);
    slug = `person-${digest}`;
  }
  return slug.slice(0, PORTABLE_SLUG_MAX_LENGTH).replace(/-+$/, "");
}

/** Accept one safe current or legacy filesystem segment. */
export function validatePathSegment(value, label = "path segment") {
  const text = typeof value === "string" ? value : "";
  const codePoints = [...text].length;
  const unsafeCharacter = [...text].some((character) => {
    const code = character.codePointAt(0);
    return '/\\:<>"|?*'.includes(character) || code < 32 || code === 127;
  });
  if (
    text === "" ||
    text === "." ||
    text === ".." ||
    codePoints > 255 ||
    text.endsWith(".") ||
    text.endsWith(" ") ||
    WINDOWS_RESERVED_NAME_RE.test(text) ||
    unsafeCharacter
  ) {
    throw new Error(`${label} must be one safe path segment`);
  }
  return text;
}

/** Resolve a safe direct child and reject symlink escapes from its base. */
export function resolveContainedChild(baseDir, segment, label = "path segment") {
  const child = join(baseDir, validatePathSegment(segment, label));
  const childRoot = resolveRealPath(child);
  const baseRoot = resolveRealPath(baseDir);
  if (childRoot === baseRoot) {
    throw new Error(`${label} must resolve to a direct child`);
  }
  const relative = childRoot.startsWith(baseRoot.endsWith("/") ? baseRoot : `${baseRoot}/`);
  if (!relative && childRoot !== baseRoot) {
    throw new Error(`${label} resolves outside its base directory`);
  }
  return child;
}

/** Read generated frontmatter names that predate artifacts metadata. */
export function readExistingArtifactNames(skillDir) {
  const names = {};
  for (const [key, filename] of Object.entries(ARTIFACT_NAME_FILES)) {
    const artifactPath = join(skillDir, filename);
    if (!existsSync(artifactPath)) continue;
    const frontmatter = FRONTMATTER_RE.exec(readFileSync(artifactPath, "utf8"));
    if (!frontmatter) continue;
    const name = FRONTMATTER_NAME_RE.exec(frontmatter[1]);
    if (name) names[key] = name[1].trim();
  }
  return names;
}

/** Generate artifact names from the selected character preset. */
export function buildArtifactNames(meta) {
  const slug = meta.slug;
  const commandSlug = normalizeCommandSlug(slug);
  const commandBase = `${meta.character}-${commandSlug}`;
  return {
    combined_skill: "SKILL.md",
    work_skill: "work_skill.md",
    persona_skill: "persona_skill.md",
    work_doc: "work.md",
    persona_doc: "persona.md",
    manifest: "manifest.json",
    combined_name: commandBase,
    work_name: `${commandBase}-work`,
    persona_name: `${commandBase}-persona`,
    combined_command: commandBase,
    work_command: `${commandBase}-work`,
    persona_command: `${commandBase}-persona`,
  };
}

/** Mirror new schema fields back to the legacy top-level structure. */
export function syncLegacyFields(meta) {
  const lifecycle = pySetDefault(meta, "lifecycle", {});
  const generation = pySetDefault(meta, "generation", {});

  meta.name = pyTruthy(pyGet(meta, "name", undefined))
    ? meta.name
    : pyTruthy(pyGet(meta, "display_name", undefined))
      ? meta.display_name
      : pyGet(meta, "slug", "");
  meta.display_name = pyTruthy(pyGet(meta, "display_name", undefined))
    ? meta.display_name
    : meta.name;

  meta.created_at = pyGet(lifecycle, "created_at", pyGet(meta, "created_at", nowIso()));
  meta.updated_at = pyGet(lifecycle, "updated_at", pyGet(meta, "updated_at", meta.created_at));
  meta.version = pyGet(lifecycle, "version", pyGet(meta, "version", "v1"));
  meta.corrections_count = pyGet(
    generation,
    "corrections_count",
    pyGet(meta, "corrections_count", 0),
  );

  meta.type = pyTruthy(pyGet(meta, "type", undefined))
    ? meta.type
    : pyTruthy(pyGet(meta, "character", undefined))
      ? meta.character
      : "colleague";
  pySetDefault(generation, "character", meta.character);
  pySetDefault(generation, "preset", meta.preset);

  lifecycle.created_at = meta.created_at;
  lifecycle.updated_at = meta.updated_at;
  lifecycle.version = meta.version;
  generation.corrections_count = meta.corrections_count;
  return meta;
}

/** Upgrade legacy metadata to the Distilly engine schema. */
export function enrichSkillMeta(meta, slug, character = null) {
  const result = structuredClone(meta);
  const resolvedCharacter = resolveCharacter(result, character);
  const preset = getCharacterPreset(resolvedCharacter);
  const resolvedResearchProfile = resolveResearchProfile(result, resolvedCharacter);
  const researchProfile = getResearchProfilePreset(resolvedCharacter, resolvedResearchProfile);

  const lifecycle = pySetDefault(result, "lifecycle", {});
  const generation = pySetDefault(result, "generation", {});
  const classification = pySetDefault(result, "classification", {});
  const sourceContext = pySetDefault(result, "source_context", {});
  const engine = pySetDefault(result, "engine", {});

  result.schema_version = SCHEMA_VERSION;
  result.slug = slug;
  result.kind = pyTruthy(pyGet(result, "kind", undefined)) ? result.kind : "meta-skill";
  result.character = resolvedCharacter;
  result.research_profile = resolvedResearchProfile;
  pySetDefault(result, "subtype", null);
  result.preset = pyTruthy(pyGet(result, "preset", undefined))
    ? result.preset
    : pyTruthy(pyGet(generation, "preset", undefined))
      ? generation.preset
      : preset.prompt_bundle.preset;

  const displayName = pyTruthy(pyGet(result, "display_name", undefined))
    ? result.display_name
    : pyTruthy(pyGet(result, "name", undefined))
      ? result.name
      : slug;
  result.display_name = displayName;
  result.name = pyTruthy(pyGet(result, "name", undefined)) ? result.name : displayName;
  result.id = pyTruthy(pyGet(result, "id", undefined))
    ? result.id
    : `${result.kind}.${resolvedCharacter}.${slug}`;

  const createdAt =
    pyGet(result, "created_at", undefined) || pyGet(lifecycle, "created_at", undefined) || nowIso();
  const updatedAt =
    pyGet(result, "updated_at", undefined) || pyGet(lifecycle, "updated_at", undefined) || createdAt;
  const version = pyGet(result, "version", undefined) || pyGet(lifecycle, "version", undefined) || "v1";
  const correctionsCount = pyGet(
    result,
    "corrections_count",
    pyGet(generation, "corrections_count", 0),
  );

  pySetDefault(sourceContext, "domain", preset.source_domain);
  pySetDefault(sourceContext, "relationship_to_user", preset.relationship_to_user);
  pySetDefault(sourceContext, "is_real_person", preset.is_real_person);
  pySetDefault(sourceContext, "is_public_figure", preset.is_public_figure);
  pySetDefault(sourceContext, "is_fictional", preset.is_fictional);

  pySetDefault(classification, "gallery_category", preset.gallery_category);
  pySetDefault(classification, "tags", flattenLegacyTags(result));
  pySetDefault(classification, "language", "en");

  const canonicalArtifacts = buildArtifactNames(result);
  result.artifacts = {
    ...canonicalArtifacts,
    ...pyGet(result, "artifacts", {}),
    combined_command: canonicalArtifacts.combined_command,
    work_command: canonicalArtifacts.work_command,
    persona_command: canonicalArtifacts.persona_command,
  };

  pySetDefault(engine, "name", "distilly");
  pySetDefault(engine, "kind", "meta-skill");
  pySetDefault(engine, "character", resolvedCharacter);
  pySetDefault(engine, "research_profile", resolvedResearchProfile);
  pySetDefault(engine, "preset", result.preset);
  pySetDefault(engine, "prompt_bundle", preset.prompt_bundle);
  pySetDefault(engine, "research_profile_bundle", researchProfile.prompt_bundle ?? {});
  pySetDefault(engine, "research_profile_references", researchProfile.references ?? []);
  pySetDefault(engine, "merge_strategy", researchProfile.merge_strategy ?? "compact");
  pySetDefault(engine, "quality_profile", researchProfile.quality_profile ?? "budget-friendly");
  pySetDefault(engine, "knowledge_dirs", preset.knowledge_dirs ?? []);
  pySetDefault(engine, "storage_root", preset.storage_root ?? preset.legacy_storage_root);
  if (pyTruthy(preset.research_tools)) {
    pySetDefault(engine, "research_tools", preset.research_tools);
  }

  pySetDefault(generation, "engine", "distilly");
  pySetDefault(generation, "character", resolvedCharacter);
  pySetDefault(generation, "research_profile", resolvedResearchProfile);
  pySetDefault(generation, "preset", result.preset);
  pySetDefault(generation, "prompt_bundle", preset.prompt_bundle);
  pySetDefault(generation, "research_profile_bundle", researchProfile.prompt_bundle ?? {});
  pySetDefault(generation, "research_profile_references", researchProfile.references ?? []);
  pySetDefault(generation, "merge_strategy", researchProfile.merge_strategy ?? "compact");
  pySetDefault(generation, "quality_profile", researchProfile.quality_profile ?? "budget-friendly");
  pySetDefault(generation, "knowledge_dirs", preset.knowledge_dirs ?? []);
  pySetDefault(generation, "storage_root", preset.storage_root ?? preset.legacy_storage_root);
  if (pyTruthy(preset.research_tools)) {
    pySetDefault(generation, "research_tools", preset.research_tools);
  }
  pySetDefault(generation, "created_from", pyGet(result, "knowledge_sources", []));
  generation.corrections_count = correctionsCount;

  pySetDefault(lifecycle, "status", "active");
  lifecycle.created_at = createdAt;
  lifecycle.updated_at = updatedAt;
  lifecycle.version = version;

  result.compat = {
    legacy_command: preset.command_aliases[0],
    legacy_storage_root: preset.legacy_storage_root,
    legacy_type: preset.legacy_type,
    ...pyGet(result, "compat", {}),
  };
  result.type = pyTruthy(pyGet(result, "type", undefined)) ? result.type : preset.legacy_type;

  if (!pyTruthy(pyGet(result, "summary", undefined))) {
    const identity = buildIdentityString(result);
    result.summary = identity ? `${displayName}, ${identity}` : displayName;
  }

  return syncLegacyFields(result);
}

/** Enrich stored metadata while preserving names from legacy artifacts. */
export function enrichExistingSkillMeta(meta, skillDir, character = null) {
  const prepared = structuredClone(meta);
  const artifactMeta = pyGet(prepared, "artifacts", undefined);
  const artifacts = isObject(artifactMeta) ? { ...artifactMeta } : {};
  for (const [key, name] of Object.entries(readExistingArtifactNames(skillDir))) {
    pySetDefault(artifacts, key, name);
  }
  if (Object.keys(artifacts).length > 0) prepared.artifacts = artifacts;
  return enrichSkillMeta(prepared, pathName(skillDir), character);
}

/** Build a manifest consumable by install and gallery flows. */
export function buildManifest(meta) {
  const artifacts = meta.artifacts;
  const engine = meta.engine;
  return {
    manifest_version: "1",
    id: meta.id,
    kind: meta.kind,
    character: meta.character,
    research_profile: pyGet(meta, "research_profile", "standard"),
    preset: meta.preset,
    display_name: meta.display_name,
    entrypoints: {
      default: artifacts.combined_skill,
      work: artifacts.work_skill,
      persona: artifacts.persona_skill,
    },
    artifacts: [
      artifacts.combined_skill,
      artifacts.work_doc,
      artifacts.persona_doc,
      "meta.json",
      artifacts.manifest,
    ],
    capabilities: ["persona", "work"],
    engine,
    toolchain: {
      prompt_bundle: pyGet(engine, "prompt_bundle", {}),
      research_profile: pyGet(engine, "research_profile", "standard"),
      research_profile_bundle: pyGet(engine, "research_profile_bundle", {}),
      research_profile_references: pyGet(engine, "research_profile_references", []),
      merge_strategy: pyGet(engine, "merge_strategy", "compact"),
      quality_profile: pyGet(engine, "quality_profile", "budget-friendly"),
      research_tools: pyGet(engine, "research_tools", {}),
      knowledge_dirs: pyGet(engine, "knowledge_dirs", []),
    },
    install: {
      compatible_runtimes: [
        "claude-code",
        "openclaw",
        "hermes",
        "codex",
        "deepseek-harness",
        "grok-build",
        "pi",
        "opencode",
      ],
      min_schema_version: SCHEMA_VERSION,
      installers: {
        "claude-code": "tools/install_claude_generated_skill.py",
        openclaw: "tools/install_openclaw_generated_skill.py",
        codex: "tools/install_codex_generated_skill.py",
      },
      slash_commands: {
        default: artifacts.combined_command,
        work: artifacts.work_command,
        persona: artifacts.persona_command,
      },
    },
  };
}

export { isAbsolute };
