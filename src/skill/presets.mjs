/**
 * Character preset registry for the Distilly engine.
 *
 * Node port of `tools/skill_presets.py`. The engine itself is a meta-skill:
 * character presets define which prompt family and rendering defaults apply to
 * a distillation target. Pure data plus small normalizers — no I/O except the
 * `existsSync` probes used to keep legacy storage roots readable.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export const COMMON_KNOWLEDGE_DIRS = ["docs", "messages", "emails"];

export const DEFAULT_RESEARCH_PROFILE = "budget-friendly";

export const CHARACTER_PRESETS = {
  colleague: {
    character: "colleague",
    display_name: "Colleague",
    identity_label: "Colleague",
    gallery_category: "Colleague",
    source_domain: "work",
    relationship_to_user: "coworker",
    is_real_person: true,
    is_public_figure: false,
    is_fictional: false,
    command_aliases: ["/create-colleague", "/create-skill"],
    knowledge_dirs: COMMON_KNOWLEDGE_DIRS,
    storage_root: "skills/colleague",
    prompt_bundle: {
      preset: "distilly.colleague.v1",
      intake: "prompts/intake.md",
      work_analyzer: "prompts/work_analyzer.md",
      persona_analyzer: "prompts/persona_analyzer.md",
      work_builder: "prompts/work_builder.md",
      persona_builder: "prompts/persona_builder.md",
      merger: "prompts/merger.md",
      correction_handler: "prompts/correction_handler.md",
    },
    legacy_storage_root: "colleagues",
    skill_name_prefix: "colleague",
    legacy_type: "colleague",
  },
  relationship: {
    character: "relationship",
    display_name: "Relationship",
    identity_label: "Relationship",
    gallery_category: "Relationship",
    source_domain: "personal",
    relationship_to_user: "relationship",
    is_real_person: true,
    is_public_figure: false,
    is_fictional: false,
    command_aliases: ["/create-ex", "/create-skill"],
    knowledge_dirs: COMMON_KNOWLEDGE_DIRS,
    storage_root: "skills/relationship",
    prompt_bundle: {
      preset: "distilly.relationship.v1",
      intake: "prompts/relationship/intake.md",
      work_analyzer: "prompts/work_analyzer.md",
      persona_analyzer: "prompts/relationship/persona_analyzer.md",
      work_builder: "prompts/work_builder.md",
      persona_builder: "prompts/relationship/persona_builder.md",
      merger: "prompts/relationship/merger.md",
      correction_handler: "prompts/correction_handler.md",
    },
    legacy_storage_root: "skills/relationship",
    skill_name_prefix: "relationship",
    legacy_type: "relationship",
  },
  celebrity: {
    character: "celebrity",
    display_name: "Celebrity",
    identity_label: "Celebrity",
    gallery_category: "Celebrity",
    source_domain: "public",
    relationship_to_user: "public_figure",
    is_real_person: true,
    is_public_figure: true,
    is_fictional: false,
    command_aliases: ["/create-icon", "/create-skill"],
    knowledge_dirs: [
      ...COMMON_KNOWLEDGE_DIRS,
      "research/raw",
      "research/merged",
      "research/reviews",
      "transcripts",
      "subtitles",
    ],
    storage_root: "skills/celebrity",
    prompt_bundle: {
      preset: "distilly.celebrity.v1",
      intake: "prompts/celebrity/intake.md",
      research: "prompts/celebrity/research.md",
      work_analyzer: "prompts/work_analyzer.md",
      persona_analyzer: "prompts/celebrity/persona_analyzer.md",
      work_builder: "prompts/work_builder.md",
      persona_builder: "prompts/celebrity/persona_builder.md",
      merger: "prompts/celebrity/merger.md",
      correction_handler: "prompts/correction_handler.md",
    },
    default_research_profile: DEFAULT_RESEARCH_PROFILE,
    research_profiles: {
      "budget-friendly": {
        name: "budget-friendly",
        display_name: "Budget Friendly",
        description:
          "Lean public-source distillation with compact review and lightweight validation.",
        prompt_bundle: {
          research: "prompts/celebrity/research.md",
          persona_analyzer: "prompts/celebrity/persona_analyzer.md",
          persona_builder: "prompts/celebrity/persona_builder.md",
        },
        references: [],
        merge_strategy: "compact",
        quality_profile: "budget-friendly",
        min_raw_notes: 3,
        min_grounded_urls: 2,
        min_primary_markers: 0,
      },
      "budget-unfriendly": {
        name: "budget-unfriendly",
        display_name: "Budget Unfriendly",
        description:
          "Deep six-track research with evidence grading, synthesis review, and stricter validation.",
        prompt_bundle: {
          research: "prompts/celebrity/budget_unfriendly/research.md",
          audit: "prompts/celebrity/budget_unfriendly/audit.md",
          synthesis: "prompts/celebrity/budget_unfriendly/synthesis.md",
          validation: "prompts/celebrity/budget_unfriendly/validation.md",
          persona_analyzer: "prompts/celebrity/budget_unfriendly/persona_analyzer.md",
          persona_builder: "prompts/celebrity/budget_unfriendly/persona_builder.md",
        },
        references: [
          "references/celebrity_budget_unfriendly_framework.md",
          "references/celebrity_budget_unfriendly_template.md",
        ],
        merge_strategy: "deep",
        quality_profile: "budget-unfriendly",
        min_raw_notes: 6,
        min_grounded_urls: 8,
        min_primary_markers: 3,
        min_source_metadata_blocks: 6,
        min_contradiction_bullets: 6,
        min_inference_bullets: 6,
        required_review_files: ["research_audit.md", "synthesis.md", "validation.md"],
      },
    },
    research_tools: {
      public_x_posts: "tools/research/xquik_public_posts.py",
      subtitle_downloader: "tools/research/download_subtitles.sh",
      subtitle_cleaner: "tools/research/srt_to_transcript.py",
      research_merger: "tools/research/merge_research.py",
      quality_check: "tools/research/quality_check.py",
    },
    legacy_storage_root: "skills/celebrity",
    skill_name_prefix: "celebrity",
    legacy_type: "celebrity",
  },
};

export const CHARACTER_ALIASES = {
  ex: "relationship",
  self: "relationship",
  yourself: "relationship",
  icon: "celebrity",
  character: "celebrity",
  "fictional-character": "celebrity",
  nuwa: "celebrity",
};

/** Normalize a character family and fall back to colleague. */
export function normalizeCharacter(character) {
  if (character === undefined || character === null || character === "") return "colleague";
  const normalized = String(character).trim().toLowerCase();
  const aliased = Object.hasOwn(CHARACTER_ALIASES, normalized)
    ? CHARACTER_ALIASES[normalized]
    : normalized;
  return Object.hasOwn(CHARACTER_PRESETS, aliased) ? aliased : "colleague";
}

/** Return the preset for the given character family. */
export function getCharacterPreset(character) {
  return CHARACTER_PRESETS[normalizeCharacter(character)];
}

/** Normalize a research profile for the selected character family. */
export function normalizeResearchProfile(character, researchProfile) {
  const preset = getCharacterPreset(character);
  const profiles = preset.research_profiles ?? {};
  if (Object.keys(profiles).length === 0) return "standard";
  if (!researchProfile) {
    return preset.default_research_profile ?? DEFAULT_RESEARCH_PROFILE;
  }
  const normalized = String(researchProfile).trim().toLowerCase().replaceAll("_", "-");
  return Object.hasOwn(profiles, normalized)
    ? normalized
    : preset.default_research_profile ?? DEFAULT_RESEARCH_PROFILE;
}

/** Return the research-profile preset for the given character family. */
export function getResearchProfilePreset(character, researchProfile = null) {
  const preset = getCharacterPreset(character);
  const profiles = preset.research_profiles ?? {};
  if (Object.keys(profiles).length === 0) {
    return {
      name: "standard",
      display_name: "Standard",
      description: "Default profile for non-celebrity families.",
      prompt_bundle: {},
      references: [],
      merge_strategy: "compact",
      quality_profile: "budget-friendly",
      min_raw_notes: 0,
      min_grounded_urls: 0,
      min_primary_markers: 0,
    };
  }
  return profiles[normalizeResearchProfile(character, researchProfile)];
}

/** Compatibility shim for older callers that still pass a skill type. */
export function normalizeSkillType(skillType) {
  return normalizeCharacter(skillType);
}

/** Compatibility shim for older callers that still request skill presets. */
export function getSkillPreset(skillType) {
  return getCharacterPreset(skillType);
}

/** Return the canonical storage root for a character family. */
export function canonicalStorageRoot(character) {
  const preset = getCharacterPreset(character);
  return preset.storage_root || preset.legacy_storage_root;
}

/** Return the legacy storage root when it differs from the canonical one. */
export function legacyStorageRoot(character) {
  const preset = getCharacterPreset(character);
  const legacy = preset.legacy_storage_root;
  const canonical = canonicalStorageRoot(character);
  if (legacy && legacy !== canonical) return legacy;
  return null;
}

/** ${HOME} expansion, matching Python's `Path.expanduser()`. */
export function expandUser(inputPath, home) {
  const homeDir = home ?? process.env.HOME ?? "";
  if (inputPath === "~") return homeDir;
  if (inputPath.startsWith("~/")) return join(homeDir, inputPath.slice(2));
  return inputPath;
}

/** Resolve the canonical write target for a character family. */
export function resolveStorageRoot(character, baseDirArg = null) {
  if (baseDirArg) return expandUser(baseDirArg);
  return canonicalStorageRoot(character);
}

/** Resolve an existing storage root while keeping legacy paths readable. */
export function resolveExistingStorageRoot(character, slug = null, baseDirArg = null) {
  if (baseDirArg) return expandUser(baseDirArg);

  const canonical = canonicalStorageRoot(character);
  const legacy = legacyStorageRoot(character);

  if (slug) {
    if (existsSync(join(canonical, slug))) return canonical;
    if (legacy && existsSync(join(legacy, slug))) return legacy;
  }

  if (existsSync(canonical)) return canonical;
  if (legacy && existsSync(legacy)) return legacy;
  return canonical;
}
