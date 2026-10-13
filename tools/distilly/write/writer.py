"""
Skill artifact writer.

This module writes work/persona artifacts for the Distilly engine while
preserving backward compatibility with the original colleague-centric layout.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Optional

from distilly.core.hosts import generated_skills_dir
from distilly.install import claude, generated
from distilly.profile.presets import (
    get_character_preset,
    normalize_character,
    normalize_skill_character,
    normalize_research_profile,
    resolve_existing_storage_root,
    resolve_storage_root,
)
from distilly.profile.schema import (
    PRIMARY_ARTIFACTS,
    build_identity_string,
    build_manifest,
    enrich_existing_skill_meta,
    enrich_skill_meta,
    normalize_command_slug,
    now_iso,
    resolve_contained_child,
    sync_legacy_fields,
    validate_path_segment,
)

# Rendering and patching moved to their own modules; names stay importable from
# here for callers of tools/skill_writer.py.
from distilly.write.patch import (  # noqa: F401
    SECTION_HEADING_RE,
    apply_correction,
    merge_markdown_patch,
    normalize_corrections,
)
from distilly.write.render import (  # noqa: F401
    SKILL_MD_TEMPLATE_EN,
    SKILL_MD_TEMPLATE_ZH,
    WORK_ONLY_FALLBACK_EN,
    WORK_ONLY_FALLBACK_ZH,
    _PERSONA_HANDOFF_PATTERNS,
    language_code,
    prefers_chinese,
    render_combined_skill,
    render_persona_skill,
    render_work_skill,
    work_only_content,
)


MAX_SLUG_LENGTH = 40
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def validate_slug(slug: str) -> str:
    """Require a safe kebab-case slug before using it in paths or skill names."""
    if len(slug) > MAX_SLUG_LENGTH or not SLUG_PATTERN.fullmatch(slug):
        raise ValueError(
            f"slug must be 1-{MAX_SLUG_LENGTH} lowercase letters/digits in kebab-case"
        )
    return slug


def slugify(name: str) -> str:
    """
    Convert a human-readable name into a stable slug.

    It uses pypinyin when available, then falls back to ASCII filtering.
    """
    try:
        from pypinyin import lazy_pinyin

        candidate = "-".join(lazy_pinyin(name))
    except ImportError:
        candidate = name

    return normalize_command_slug(candidate)


def write_artifacts(skill_dir: Path, meta: dict, work_content: str, persona_content: str) -> None:
    """Write all generated artifacts for a skill version."""
    artifacts = meta["artifacts"]
    manifest = build_manifest(meta)

    (skill_dir / artifacts["work_doc"]).write_text(work_content, encoding="utf-8")
    (skill_dir / artifacts["persona_doc"]).write_text(persona_content, encoding="utf-8")
    (skill_dir / artifacts["combined_skill"]).write_text(
        render_combined_skill(meta, work_content, persona_content),
        encoding="utf-8",
    )
    (skill_dir / artifacts["work_skill"]).write_text(
        render_work_skill(meta, work_content),
        encoding="utf-8",
    )
    (skill_dir / artifacts["persona_skill"]).write_text(
        render_persona_skill(meta, persona_content),
        encoding="utf-8",
    )
    (skill_dir / artifacts["manifest"]).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (skill_dir / "meta.json").write_text(
        json.dumps(sync_legacy_fields(meta), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def create_skill(
    base_dir: Path,
    slug: str,
    meta: dict,
    work_content: str,
    persona_content: str,
) -> Path:
    """Create a new skill directory with normalized metadata."""
    slug = validate_slug(slug)
    normalized_meta = enrich_skill_meta(meta, slug, meta.get("character"))
    preset = get_character_preset(normalized_meta["character"])
    skill_dir = base_dir / slug
    skill_dir.mkdir(parents=True, exist_ok=True)

    (skill_dir / "versions").mkdir(exist_ok=True)
    for relative_path in preset.get("knowledge_dirs", ("docs", "messages", "emails")):
        (skill_dir / "knowledge" / relative_path).mkdir(parents=True, exist_ok=True)

    normalized_meta["lifecycle"]["created_at"] = normalized_meta.get("created_at", now_iso())
    normalized_meta["lifecycle"]["updated_at"] = normalized_meta["lifecycle"]["created_at"]
    normalized_meta["lifecycle"]["version"] = "v1"
    normalized_meta["generation"]["corrections_count"] = normalized_meta.get("corrections_count", 0)
    sync_legacy_fields(normalized_meta)

    write_artifacts(skill_dir, normalized_meta, work_content, persona_content)
    return skill_dir


def backup_current_artifacts(skill_dir: Path, version_name: str) -> None:
    """Copy the current artifact set into versions/<version_name>/."""
    versions_dir = resolve_contained_child(skill_dir, "versions", "versions directory")
    version_dir = resolve_contained_child(
        versions_dir,
        validate_path_segment(str(version_name), "version"),
        "version",
    )
    version_dir.mkdir(parents=True, exist_ok=True)

    for filename in PRIMARY_ARTIFACTS:
        src = skill_dir / filename
        if src.exists():
            shutil.copy2(src, version_dir / filename)


def update_skill(
    skill_dir: Path,
    work_patch: Optional[str] = None,
    persona_patch: Optional[str] = None,
    correction: Optional[dict | list[dict]] = None,
) -> str:
    """Update an existing skill, archive the previous version, and regenerate artifacts."""
    meta_path = skill_dir / "meta.json"
    meta = enrich_existing_skill_meta(
        json.loads(meta_path.read_text(encoding="utf-8")),
        skill_dir,
    )

    current_version = meta.get("version", "v1")
    try:
        version_num = int(current_version.lstrip("v").split("_")[0]) + 1
    except ValueError:
        version_num = 2
    new_version = f"v{version_num}"

    backup_current_artifacts(skill_dir, current_version)

    artifacts = meta["artifacts"]
    work_path = skill_dir / artifacts["work_doc"]
    persona_path = skill_dir / artifacts["persona_doc"]
    work_content = work_path.read_text(encoding="utf-8") if work_path.exists() else ""
    persona_content = persona_path.read_text(encoding="utf-8") if persona_path.exists() else ""

    if work_patch:
        work_content = merge_markdown_patch(work_content, work_patch)

    if persona_patch:
        persona_content = merge_markdown_patch(persona_content, persona_patch)
    elif correction:
        corrections = normalize_corrections(correction)
        for item in corrections:
            persona_content = apply_correction(persona_content, item)
        if corrections:
            meta["generation"]["corrections_count"] = meta.get("corrections_count", 0) + len(corrections)

    meta["lifecycle"]["version"] = new_version
    meta["lifecycle"]["updated_at"] = now_iso()
    sync_legacy_fields(meta)

    write_artifacts(skill_dir, meta, work_content, persona_content)
    return new_version


def list_skills(base_dir: Path) -> list[dict]:
    """List skills from a storage root regardless of their type."""
    skills = []
    if not base_dir.exists():
        return skills

    for skill_dir in sorted(base_dir.iterdir()):
        if not skill_dir.is_dir():
            continue

        meta_path = skill_dir / "meta.json"
        if not meta_path.exists():
            continue

        try:
            meta = enrich_existing_skill_meta(
                json.loads(meta_path.read_text(encoding="utf-8")),
                skill_dir,
            )
        except Exception:
            continue

        skills.append({
            "slug": meta.get("slug", skill_dir.name),
            "kind": meta.get("kind", "meta-skill"),
            "character": meta.get("character", "colleague"),
            "research_profile": meta.get("research_profile", "standard"),
            "name": meta.get("display_name", skill_dir.name),
            "identity": build_identity_string(meta),
            "version": meta.get("version", "v1"),
            "updated_at": meta.get("updated_at", ""),
            "corrections_count": meta.get("corrections_count", 0),
        })

    return skills


def resolve_base_dir(base_dir_arg: str | None, character: str) -> Path:
    """Resolve the storage root for a character family while keeping compatibility."""
    return resolve_storage_root(character, base_dir_arg)


# Hosts other than Claude Code that create/update can install into, each with an
# --install-<host>-skill flag and a --<host>-skills-dir override.
EXTRA_GENERATED_HOSTS = (
    ("openclaw", "OpenClaw", "trigger: /{command_name}"),
    ("codex", "Codex", "skill name: {command_name}"),
)


def install_generated_hosts(
    skill_dir: Path,
    args: argparse.Namespace,
    install_claude_skill: bool,
) -> list[str]:
    """Install a generated skill into the selected host discovery directories."""
    output_lines: list[str] = []

    if install_claude_skill:
        install_result = claude.install_generated_skill(
            skill_dir,
            Path(args.claude_skills_dir).expanduser()
            if args.claude_skills_dir
            else claude.default_claude_skills_dir(),
            commands_dir=(
                Path(args.claude_commands_dir).expanduser()
                if args.claude_commands_dir
                else claude.default_claude_commands_dir()
            ),
            force=True,
            install_command_shim=(
                args.install_claude_command_shim or claude.should_install_command_shim()
            ),
        )
        output_lines.append(f"  Claude skill: {install_result['skill_dir']}")
        output_lines.append(f"  Claude trigger: /{install_result['command_name']}")
        if install_result["command_shim_installed"] and install_result["command_path"] is not None:
            output_lines.append(f"  Claude command shim: {install_result['command_path']}")

    for host, label, name_line in EXTRA_GENERATED_HOSTS:
        if not getattr(args, f"install_{host}_skill"):
            continue
        override = getattr(args, f"{host}_skills_dir")
        install_result = generated.install_generated_skill(
            skill_dir,
            Path(override).expanduser() if override else generated_skills_dir(host),
            force=True,
            host=host,
        )
        output_lines.append(f"  {label} skill: {install_result['skill_dir']}")
        output_lines.append(f"  {label} {name_line.format(**install_result)}")

    return output_lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Distilly artifact writer")
    parser.add_argument("--action", required=True, choices=["create", "update", "list"])
    parser.add_argument("--slug", help="Skill slug used for the output directory")
    parser.add_argument("--name", help="Display name for the skill")
    parser.add_argument("--character", default="colleague", help="Character family preset")
    parser.add_argument(
        "--research-profile",
        help="Celebrity research profile (for example: budget-friendly or budget-unfriendly)",
    )
    parser.add_argument("--type", help="Deprecated compatibility alias for --character")
    parser.add_argument("--meta", help="Path to the metadata JSON file")
    parser.add_argument("--work", help="Path to the work.md content file")
    parser.add_argument("--persona", help="Path to the persona.md content file")
    parser.add_argument("--work-patch", help="Path to a work.md patch file")
    parser.add_argument("--persona-patch", help="Path to a persona.md patch file")
    parser.add_argument("--correction-json", help="Path to a correction JSON file")
    parser.add_argument("--base-dir", help="Skill storage root")
    parser.add_argument(
        "--install-claude-skill",
        action="store_true",
        help="Explicitly install the generated combined skill into Claude Code after create/update",
    )
    parser.add_argument(
        "--no-install-claude-skill",
        action="store_true",
        help="Skip Claude Code installation after create/update",
    )
    parser.add_argument(
        "--install-claude-command-shim",
        action="store_true",
        help="Also install a slash-command markdown shim for Windows compatibility",
    )
    parser.add_argument("--claude-skills-dir", help="Override the Claude Code skills directory")
    parser.add_argument("--claude-commands-dir", help="Override the Claude Code commands directory")
    parser.add_argument(
        "--install-openclaw-skill",
        action="store_true",
        help="Install the generated combined skill into OpenClaw after create/update",
    )
    parser.add_argument("--openclaw-skills-dir", help="Override the OpenClaw skills directory")
    parser.add_argument(
        "--install-codex-skill",
        action="store_true",
        help="Install the generated combined skill into Codex after create/update",
    )
    parser.add_argument("--codex-skills-dir", help="Override the Codex skills directory")

    args = parser.parse_args()
    requested_character = normalize_character(args.character or args.type)
    auto_install_setting = os.environ.get("DISTILLY_AUTO_INSTALL_CLAUDE")
    if auto_install_setting is None:
        auto_install_setting = os.environ.get("DOT_SKILL_AUTO_INSTALL_CLAUDE")
    auto_install_default = (
        auto_install_setting is not None and auto_install_setting != "0"
    )
    install_claude_skill = (
        args.install_claude_skill or auto_install_default
    ) and not args.no_install_claude_skill

    if requested_character == "owner":
        print(
            "error: the owner profile is not a role-play Skill; "
            "use tools/owner_profile.py save/link instead",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.action == "list":
        base_dir = resolve_existing_storage_root(requested_character, base_dir_arg=args.base_dir)
        skills = list_skills(base_dir)
        if not skills:
            preset = get_character_preset(requested_character)
            print(f"No {preset['character']} skills found")
        else:
            print(f"Found {len(skills)} skills:\n")
            for skill in skills:
                updated = skill["updated_at"][:10] if skill["updated_at"] else "unknown"
                print(f"  [{skill['slug']}]  {skill['name']} — {skill['identity']}")
                print(
                    f"    Kind: {skill['kind']}  Character: {skill['character']}  "
                    f"Research Profile: {skill['research_profile']}  "
                    f"Version: {skill['version']}  "
                    f"Corrections: {skill['corrections_count']}  Updated: {updated}"
                )
                print()
        return

    if not args.slug and not args.name:
        print("error: create requires --slug or --name", file=sys.stderr)
        sys.exit(1)

    meta: dict = {}
    if args.meta:
        meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    if args.name:
        meta["name"] = args.name
        meta["display_name"] = args.name
    meta["character"] = normalize_skill_character(
        meta.get("character", meta.get("type", requested_character))
    )
    meta["research_profile"] = normalize_research_profile(
        meta["character"],
        args.research_profile or meta.get("research_profile"),
    )
    meta["type"] = meta.get("type") or meta["character"]

    if args.action == "create":
        base_dir = resolve_base_dir(args.base_dir, requested_character)
        try:
            slug = validate_slug(args.slug) if args.slug else slugify(
                meta.get("display_name", meta.get("name", "person"))
            )
        except ValueError as error:
            parser.error(str(error))
        work_content = Path(args.work).read_text(encoding="utf-8") if args.work else ""
        persona_content = Path(args.persona).read_text(encoding="utf-8") if args.persona else ""

        skill_dir = create_skill(base_dir, slug, meta, work_content, persona_content)
        print(f"Created skill: {skill_dir}")
        print("  Kind: meta-skill")
        print(f"  Character: {meta['character']}")
        print(f"  Research Profile: {meta['research_profile']}")
        print(f"  Preset: {meta.get('preset', 'auto')}")
        install_lines = install_generated_hosts(skill_dir, args, install_claude_skill)
        if install_lines:
            for line in install_lines:
                print(line)
        else:
            print("  Host installs: skipped")
        return

    try:
        slug = validate_path_segment(args.slug or "", "existing slug")
    except ValueError as error:
        parser.error(str(error))
    base_dir = resolve_existing_storage_root(requested_character, slug=slug, base_dir_arg=args.base_dir)
    try:
        skill_dir = resolve_contained_child(base_dir, slug, "skill slug")
    except ValueError:
        parser.error("skill directory resolves outside the selected base directory")
    if not skill_dir.exists():
        print(f"error: skill directory not found: {skill_dir}", file=sys.stderr)
        sys.exit(1)

    work_patch = Path(args.work_patch).read_text(encoding="utf-8") if args.work_patch else None
    persona_patch = (
        Path(args.persona_patch).read_text(encoding="utf-8")
        if args.persona_patch
        else None
    )
    correction = (
        json.loads(Path(args.correction_json).read_text(encoding="utf-8"))
        if args.correction_json
        else None
    )

    new_version = update_skill(skill_dir, work_patch, persona_patch, correction)
    print(f"Updated skill to {new_version}: {skill_dir}")
    install_lines = install_generated_hosts(skill_dir, args, install_claude_skill)
    if install_lines:
        for line in install_lines:
            print(line)
