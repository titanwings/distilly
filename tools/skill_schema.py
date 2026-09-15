#!/usr/bin/env python3
"""
Helpers for the shared Distilly engine schema and generated artifact metadata.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from skill_presets import (
    get_character_preset,
    get_research_profile_preset,
    normalize_character,
    normalize_research_profile,
)


SCHEMA_VERSION = "3"
PORTABLE_SLUG_MAX_LENGTH = 40
PRIMARY_ARTIFACTS = (
    "SKILL.md",
    "work.md",
    "persona.md",
    "work_skill.md",
    "persona_skill.md",
    "manifest.json",
)
ARTIFACT_NAME_FILES = {
    "combined_name": "SKILL.md",
    "work_name": "work_skill.md",
    "persona_name": "persona_skill.md",
}
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)
FRONTMATTER_NAME_RE = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)
WINDOWS_RESERVED_NAME_RE = re.compile(
    r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)",
    re.IGNORECASE,
)


def now_iso() -> str:
    """Return the current UTC time in ISO format."""
    return datetime.now(timezone.utc).isoformat()


def flatten_legacy_tags(meta: dict) -> list[str]:
    """Extract gallery tags from the legacy tags structure."""
    tags = meta.get("classification", {}).get("tags")
    if isinstance(tags, list) and tags:
        return tags

    legacy_tags = meta.get("tags", {})
    if isinstance(legacy_tags, list):
        return [item for item in legacy_tags if isinstance(item, str) and item]

    results: list[str] = []
    for key in ("personality", "culture"):
        value = legacy_tags.get(key, [])
        if isinstance(value, list):
            results.extend(item for item in value if isinstance(item, str) and item)
    return results


def resolve_character(meta: dict, explicit_character: str | None = None) -> str:
    """Resolve the active character family from new or legacy fields."""
    return normalize_character(
        explicit_character
        or meta.get("character")
        or meta.get("type")
        or meta.get("generation", {}).get("character")
    )


def resolve_research_profile(
    meta: dict,
    character: str,
    explicit_research_profile: str | None = None,
) -> str:
    """Resolve the active research profile for the selected character family."""
    return normalize_research_profile(
        character,
        explicit_research_profile
        or meta.get("research_profile")
        or meta.get("generation", {}).get("research_profile")
        or meta.get("engine", {}).get("research_profile"),
    )


def build_identity_string(meta: dict) -> str:
    """Build a human-readable identity string from metadata."""
    preset = get_character_preset(meta.get("character"))
    profile = meta.get("profile", {})

    if isinstance(profile, str):
        return profile.strip() or preset["identity_label"]
    if not isinstance(profile, dict):
        return preset["identity_label"]

    parts = []
    for key in ("company", "level", "role", "occupation", "identity", "specialty", "known_for"):
        value = profile.get(key, "")
        if value:
            parts.append(value)

    identity = " ".join(parts) if parts else preset["identity_label"]

    mbti = profile.get("mbti", "")
    if mbti:
        identity += f", MBTI {mbti}"

    return identity


def normalize_command_slug(value: str) -> str:
    """Convert current or legacy text into a deterministic portable command slug."""
    ascii_value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    if not slug:
        digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]
        slug = f"person-{digest}"
    return slug[:PORTABLE_SLUG_MAX_LENGTH].rstrip("-")


def validate_path_segment(value: str, label: str = "path segment") -> str:
    """Accept one safe current or legacy filesystem segment."""
    if (
        not value
        or value in {".", ".."}
        or len(value) > 255
        or value.endswith((".", " "))
        or WINDOWS_RESERVED_NAME_RE.match(value)
        or any(
            character in '/\\:<>"|?*'
            or ord(character) < 32
            or ord(character) == 127
            for character in value
        )
    ):
        raise ValueError(f"{label} must be one safe path segment")
    return value


def resolve_contained_child(
    base_dir: Path,
    segment: str,
    label: str = "path segment",
) -> Path:
    """Resolve a safe direct child and reject symlink escapes from its base."""
    child = base_dir / validate_path_segment(segment, label)
    child_root = child.resolve()
    base_root = base_dir.resolve()
    if child_root == base_root:
        raise ValueError(f"{label} must resolve to a direct child")
    try:
        child_root.relative_to(base_root)
    except ValueError as error:
        raise ValueError(f"{label} resolves outside its base directory") from error
    return child


def read_existing_artifact_names(skill_dir: Path) -> dict[str, str]:
    """Read generated frontmatter names that predate artifacts metadata."""
    names = {}
    for key, filename in ARTIFACT_NAME_FILES.items():
        artifact_path = skill_dir / filename
        if not artifact_path.exists():
            continue
        frontmatter = FRONTMATTER_RE.match(artifact_path.read_text(encoding="utf-8"))
        if not frontmatter:
            continue
        name = FRONTMATTER_NAME_RE.search(frontmatter.group(1))
        if name:
            names[key] = name.group(1).strip()
    return names


def build_artifact_names(meta: dict) -> dict:
    """Generate artifact names from the selected character preset."""
    slug = meta["slug"]
    command_slug = normalize_command_slug(slug)
    command_base = f"{meta['character']}-{command_slug}"
    return {
        "combined_skill": "SKILL.md",
        "work_skill": "work_skill.md",
        "persona_skill": "persona_skill.md",
        "work_doc": "work.md",
        "persona_doc": "persona.md",
        "manifest": "manifest.json",
        "combined_name": command_base,
        "work_name": f"{command_base}-work",
        "persona_name": f"{command_base}-persona",
        "combined_command": command_base,
        "work_command": f"{command_base}-work",
        "persona_command": f"{command_base}-persona",
    }


def sync_legacy_fields(meta: dict) -> dict:
    """Mirror new schema fields back to the legacy top-level structure."""
    lifecycle = meta.setdefault("lifecycle", {})
    generation = meta.setdefault("generation", {})

    meta["name"] = meta.get("name") or meta.get("display_name") or meta.get("slug", "")
    meta["display_name"] = meta.get("display_name") or meta["name"]

    meta["created_at"] = lifecycle.get("created_at", meta.get("created_at", now_iso()))
    meta["updated_at"] = lifecycle.get("updated_at", meta.get("updated_at", meta["created_at"]))
    meta["version"] = lifecycle.get("version", meta.get("version", "v1"))
    meta["corrections_count"] = generation.get(
        "corrections_count",
        meta.get("corrections_count", 0),
    )

    meta["type"] = meta.get("type") or meta.get("character") or "colleague"
    generation.setdefault("character", meta["character"])
    generation.setdefault("preset", meta["preset"])

    lifecycle["created_at"] = meta["created_at"]
    lifecycle["updated_at"] = meta["updated_at"]
    lifecycle["version"] = meta["version"]
    generation["corrections_count"] = meta["corrections_count"]
    return meta


def enrich_skill_meta(meta: dict, slug: str, character: str | None = None) -> dict:
    """Upgrade legacy metadata to the Distilly engine schema."""
    result = deepcopy(meta)
    resolved_character = resolve_character(result, character)
    preset = get_character_preset(resolved_character)
    resolved_research_profile = resolve_research_profile(result, resolved_character)
    research_profile = get_research_profile_preset(resolved_character, resolved_research_profile)

    lifecycle = result.setdefault("lifecycle", {})
    generation = result.setdefault("generation", {})
    classification = result.setdefault("classification", {})
    source_context = result.setdefault("source_context", {})
    engine = result.setdefault("engine", {})

    result["schema_version"] = SCHEMA_VERSION
    result["slug"] = slug
    result["kind"] = result.get("kind") or "meta-skill"
    result["character"] = resolved_character
    result["research_profile"] = resolved_research_profile
    result.setdefault("subtype", None)
    result["preset"] = result.get("preset") or generation.get("preset") or preset["prompt_bundle"]["preset"]

    display_name = result.get("display_name") or result.get("name") or slug
    result["display_name"] = display_name
    result["name"] = result.get("name") or display_name
    result["id"] = result.get("id") or f"{result['kind']}.{resolved_character}.{slug}"

    created_at = result.get("created_at") or lifecycle.get("created_at") or now_iso()
    updated_at = result.get("updated_at") or lifecycle.get("updated_at") or created_at
    version = result.get("version") or lifecycle.get("version") or "v1"
    corrections_count = result.get("corrections_count", generation.get("corrections_count", 0))

    source_context.setdefault("domain", preset["source_domain"])
    source_context.setdefault("relationship_to_user", preset["relationship_to_user"])
    source_context.setdefault("is_real_person", preset["is_real_person"])
    source_context.setdefault("is_public_figure", preset["is_public_figure"])
    source_context.setdefault("is_fictional", preset["is_fictional"])

    classification.setdefault("gallery_category", preset["gallery_category"])
    classification.setdefault("tags", flatten_legacy_tags(result))
    classification.setdefault("language", "en")

    canonical_artifacts = build_artifact_names(result)
    result["artifacts"] = {
        **canonical_artifacts,
        **result.get("artifacts", {}),
        "combined_command": canonical_artifacts["combined_command"],
        "work_command": canonical_artifacts["work_command"],
        "persona_command": canonical_artifacts["persona_command"],
    }

    engine.setdefault("name", "distilly")
    engine.setdefault("kind", "meta-skill")
    engine.setdefault("character", resolved_character)
    engine.setdefault("research_profile", resolved_research_profile)
    engine.setdefault("preset", result["preset"])
    engine.setdefault("prompt_bundle", preset["prompt_bundle"])
    engine.setdefault("research_profile_bundle", research_profile.get("prompt_bundle", {}))
    engine.setdefault("research_profile_references", research_profile.get("references", []))
    engine.setdefault("merge_strategy", research_profile.get("merge_strategy", "compact"))
    engine.setdefault("quality_profile", research_profile.get("quality_profile", "budget-friendly"))
    engine.setdefault("knowledge_dirs", preset.get("knowledge_dirs", []))
    engine.setdefault("storage_root", preset.get("storage_root", preset["legacy_storage_root"]))
    if preset.get("research_tools"):
        engine.setdefault("research_tools", preset["research_tools"])

    generation.setdefault("engine", "distilly")
    generation.setdefault("character", resolved_character)
    generation.setdefault("research_profile", resolved_research_profile)
    generation.setdefault("preset", result["preset"])
    generation.setdefault("prompt_bundle", preset["prompt_bundle"])
    generation.setdefault("research_profile_bundle", research_profile.get("prompt_bundle", {}))
    generation.setdefault("research_profile_references", research_profile.get("references", []))
    generation.setdefault("merge_strategy", research_profile.get("merge_strategy", "compact"))
    generation.setdefault("quality_profile", research_profile.get("quality_profile", "budget-friendly"))
    generation.setdefault("knowledge_dirs", preset.get("knowledge_dirs", []))
    generation.setdefault("storage_root", preset.get("storage_root", preset["legacy_storage_root"]))
    if preset.get("research_tools"):
        generation.setdefault("research_tools", preset["research_tools"])
    generation.setdefault("created_from", result.get("knowledge_sources", []))
    generation["corrections_count"] = corrections_count

    lifecycle.setdefault("status", "active")
    lifecycle["created_at"] = created_at
    lifecycle["updated_at"] = updated_at
    lifecycle["version"] = version

    result["compat"] = {
        "legacy_command": preset["command_aliases"][0],
        "legacy_storage_root": preset["legacy_storage_root"],
        "legacy_type": preset["legacy_type"],
        **result.get("compat", {}),
    }
    result["type"] = result.get("type") or preset["legacy_type"]

    if not result.get("summary"):
        identity = build_identity_string(result)
        result["summary"] = f"{display_name}, {identity}" if identity else display_name

    return sync_legacy_fields(result)


def enrich_existing_skill_meta(
    meta: dict,
    skill_dir: Path,
    character: str | None = None,
) -> dict:
    """Enrich stored metadata while preserving names from legacy artifacts."""
    prepared = deepcopy(meta)
    artifact_meta = prepared.get("artifacts")
    artifacts = dict(artifact_meta) if isinstance(artifact_meta, dict) else {}
    for key, name in read_existing_artifact_names(skill_dir).items():
        artifacts.setdefault(key, name)
    if artifacts:
        prepared["artifacts"] = artifacts
    return enrich_skill_meta(prepared, skill_dir.name, character)


def build_manifest(meta: dict) -> dict:
    """Build a manifest consumable by install and gallery flows."""
    artifacts = meta["artifacts"]
    return {
        "manifest_version": "1",
        "id": meta["id"],
        "kind": meta["kind"],
        "character": meta["character"],
        "research_profile": meta.get("research_profile", "standard"),
        "preset": meta["preset"],
        "display_name": meta["display_name"],
        "entrypoints": {
            "default": artifacts["combined_skill"],
            "work": artifacts["work_skill"],
            "persona": artifacts["persona_skill"],
        },
        "artifacts": [
            artifacts["combined_skill"],
            artifacts["work_doc"],
            artifacts["persona_doc"],
            "meta.json",
            artifacts["manifest"],
        ],
        "capabilities": ["persona", "work"],
        "engine": meta["engine"],
        "toolchain": {
            "prompt_bundle": meta["engine"].get("prompt_bundle", {}),
            "research_profile": meta["engine"].get("research_profile", "standard"),
            "research_profile_bundle": meta["engine"].get("research_profile_bundle", {}),
            "research_profile_references": meta["engine"].get("research_profile_references", []),
            "merge_strategy": meta["engine"].get("merge_strategy", "compact"),
            "quality_profile": meta["engine"].get("quality_profile", "budget-friendly"),
            "research_tools": meta["engine"].get("research_tools", {}),
            "knowledge_dirs": meta["engine"].get("knowledge_dirs", []),
        },
        "install": {
            "compatible_runtimes": [
                "claude-code",
                "openclaw",
                "hermes",
                "codex",
                "deepseek-harness",
                "grok-build",
                "pi",
                "opencode",
            ],
            "min_schema_version": SCHEMA_VERSION,
            "installers": {
                "claude-code": "tools/install_claude_generated_skill.py",
                "openclaw": "tools/install_openclaw_generated_skill.py",
                "codex": "tools/install_codex_generated_skill.py",
            },
            "slash_commands": {
                "default": artifacts["combined_command"],
                "work": artifacts["work_command"],
                "persona": artifacts["persona_command"],
            },
        },
    }

