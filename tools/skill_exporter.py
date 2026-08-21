#!/usr/bin/env python3
"""
Skill export / import tool for the dot-skill engine.

Packages a generated skill into a portable .skill.tar.gz archive and
installs a packaged skill into a local skills directory.  Supports
privacy controls so users can share skills without leaking raw chat
logs or personal identifiers.

Actions
-------
export     Package a skill into a .skill.tar.gz
import     Install a .skill.tar.gz into the local skills tree
inspect    Show the contents of a .skill.tar.gz without installing
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from skill_presets import (
    get_character_preset,
    normalize_character,
    resolve_existing_storage_root,
    resolve_storage_root,
)
from skill_schema import PRIMARY_ARTIFACTS, enrich_skill_meta, now_iso


PACKAGE_FORMAT_VERSION = "1"
PACKAGE_EXT = ".skill.tar.gz"

# Fields scrubbed from meta.json when --strip-personal is active.
PII_FIELDS = [
    "profile.real_name",
    "profile.email",
    "profile.phone",
    "profile.wechat",
    "profile.company_id",
    "knowledge_sources",
]


def _resolve_skill_dir(
    character: str,
    slug: str,
    base_dir: str | None = None,
) -> Path:
    """Return the on-disk skill directory for *character* / *slug*."""
    root = resolve_existing_storage_root(character, slug, base_dir_arg=base_dir)
    return root / slug


def _load_meta(skill_dir: Path) -> dict:
    """Read and lightly normalise meta.json from *skill_dir*."""
    meta_path = skill_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"meta.json not found in {skill_dir}")
    return json.loads(meta_path.read_text(encoding="utf-8"))


def _scrub_meta(meta: dict) -> dict:
    """Return a deep copy of *meta* with PII fields redacted."""
    import copy

    scrubbed = copy.deepcopy(meta)

    for dotted in PII_FIELDS:
        parts = dotted.split(".")
        container = scrubbed
        for i, key in enumerate(parts):
            if i == len(parts) - 1:
                if key in container:
                    container[key] = "[redacted]"
            else:
                container = container.get(key, {})
                if not isinstance(container, dict):
                    break

    scrubbed.setdefault("lifecycle", {})["exported_at"] = now_iso()
    return scrubbed


def _build_package_meta(skill_dir: Path, meta: dict) -> dict:
    """Build the top-level package.json metadata for an export."""
    return {
        "package_format": PACKAGE_FORMAT_VERSION,
        "exported_at": now_iso(),
        "schema_version": meta.get("schema_version", "3"),
        "dot_skill_version": "1.0.0",
        "character": meta.get("character", "colleague"),
        "slug": meta.get("slug", skill_dir.name),
        "display_name": meta.get("display_name", skill_dir.name),
        "preset": meta.get("preset", ""),
        "research_profile": meta.get("research_profile", "standard"),
        "source_character": meta.get("character", "colleague"),
    }


def export_skill(
    character: str,
    slug: str,
    output: str,
    *,
    base_dir: str | None = None,
    include_knowledge: bool = False,
    strip_personal: bool = True,
    include_versions: bool = False,
) -> Path:
    """Package *character/slug* into a .skill.tar.gz at *output*."""
    character = normalize_character(character)
    skill_dir = _resolve_skill_dir(character, slug, base_dir)
    if not skill_dir.exists():
        raise FileNotFoundError(f"Skill directory not found: {skill_dir}")

    meta = _load_meta(skill_dir)
    enriched = enrich_skill_meta(meta, slug, character)
    package_meta = _build_package_meta(skill_dir, enriched)

    output_path = Path(output).expanduser().resolve()
    if output_path.is_dir():
        output_path = output_path / f"{slug}{PACKAGE_EXT}"
    if output_path.suffix == ".gz" and output_path.stem.endswith(".skill.tar"):
        pass
    elif output_path.suffix == ".tar":
        output_path = output_path.with_suffix(PACKAGE_EXT)
    else:
        output_path = output_path.with_suffix(PACKAGE_EXT)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    export_meta = _scrub_meta(enriched) if strip_personal else enriched

    with tarfile.open(output_path, "w:gz") as tar:
        # -- package.json -------------------------------------------------
        pkg_json = json.dumps(package_meta, indent=2, ensure_ascii=False)
        pkg_info = tarfile.TarInfo(name="package.json")
        pkg_info.size = len(pkg_json.encode("utf-8"))
        tar.addfile(pkg_info, _bytesio(pkg_json))

        # -- meta.json -----------------------------------------------------
        meta_json = json.dumps(export_meta, indent=2, ensure_ascii=False)
        meta_info = tarfile.TarInfo(name="skill/meta.json")
        meta_info.size = len(meta_json.encode("utf-8"))
        tar.addfile(meta_info, _bytesio(meta_json))

        # -- primary artifacts --------------------------------------------
        for artifact_name in PRIMARY_ARTIFACTS:
            artifact_path = skill_dir / artifact_name
            if artifact_path.exists():
                tar.add(artifact_path, arcname=f"skill/{artifact_name}")

        # -- knowledge ----------------------------------------------------
        knowledge_dir = skill_dir / "knowledge"
        if include_knowledge and knowledge_dir.exists():
            _add_dir_filtered(tar, knowledge_dir, "skill/knowledge")

        # -- versions -----------------------------------------------------
        versions_dir = skill_dir / "versions"
        if include_versions and versions_dir.exists():
            _add_dir_filtered(tar, versions_dir, "skill/versions")

        # -- manifest.json (re-built if missing) --------------------------
        manifest_path = skill_dir / "manifest.json"
        if not manifest_path.exists():
            from skill_schema import build_manifest

            manifest_body = json.dumps(
                build_manifest(enriched), indent=2, ensure_ascii=False
            )
            m_info = tarfile.TarInfo(name="skill/manifest.json")
            m_info.size = len(manifest_body.encode("utf-8"))
            tar.addfile(m_info, _bytesio(manifest_body))

    return output_path


def import_skill(
    package_path: str,
    *,
    base_dir: str | None = None,
    force: bool = False,
    install_host: str | None = None,
) -> Path:
    """Install a .skill.tar.gz into the local skills tree."""
    package = Path(package_path).expanduser().resolve()
    if not package.exists():
        raise FileNotFoundError(f"Package not found: {package}")

    _validate_package_extension(package)

    with tarfile.open(package, "r:gz") as tar:
        pkg_meta = _read_package_meta(tar)
        meta = _read_skill_meta(tar)
        _validate_package_compat(pkg_meta)

        character = normalize_character(
            pkg_meta.get("character") or meta.get("character")
        )
        slug = pkg_meta.get("slug") or meta.get("slug", "")
        if not slug:
            raise ValueError("Package is missing a slug — cannot determine target directory")

        target_root = resolve_storage_root(character, base_dir)
        target_dir = target_root / slug

        if target_dir.exists() and not force:
            raise FileExistsError(
                f"Skill already exists at {target_dir}. Use --force to overwrite."
            )

        if target_dir.exists():
            shutil.rmtree(target_dir)

        target_dir.mkdir(parents=True, exist_ok=True)

        _extract_skill_members(tar, target_dir)

        _write_install_metadata(target_dir, pkg_meta)

        if install_host:
            _install_to_host(target_dir, meta, install_host)

    return target_dir


def inspect_package(package_path: str) -> dict:
    """Return a structured summary of a .skill.tar.gz without installing."""
    package = Path(package_path).expanduser().resolve()
    if not package.exists():
        raise FileNotFoundError(f"Package not found: {package}")
    _validate_package_extension(package)

    with tarfile.open(package, "r:gz") as tar:
        pkg_meta = _read_package_meta(tar)
        members = sorted(m.name for m in tar.getmembers())

        try:
            meta = _read_skill_meta(tar)
        except (KeyError, json.JSONDecodeError):
            meta = {}

    has_knowledge = any("knowledge/" in m for m in members)
    has_versions = any("versions/" in m for m in members)

    return {
        "package_format": pkg_meta.get("package_format"),
        "exported_at": pkg_meta.get("exported_at"),
        "character": pkg_meta.get("character") or meta.get("character"),
        "slug": pkg_meta.get("slug") or meta.get("slug"),
        "display_name": pkg_meta.get("display_name") or meta.get("display_name"),
        "preset": pkg_meta.get("preset") or meta.get("preset"),
        "research_profile": pkg_meta.get("research_profile") or meta.get("research_profile"),
        "schema_version": pkg_meta.get("schema_version") or meta.get("schema_version"),
        "artifacts": [m for m in members if m.startswith("skill/")],
        "has_knowledge": has_knowledge,
        "has_versions": has_versions,
        "size_bytes": package.stat().st_size,
        "summary": meta.get("summary", ""),
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_PKG_EXT_RE = re.compile(r"\.skill\.tar(\.gz)?$", re.IGNORECASE)


def _validate_package_extension(path: Path) -> None:
    if not _PKG_EXT_RE.search(path.name):
        raise ValueError(
            f"Expected a .skill.tar.gz file, got: {path.name}"
        )


def _bytesio(content: str):
    """Return a BytesIO wrapping *content* encoded as UTF-8."""
    from io import BytesIO

    return BytesIO(content.encode("utf-8"))


def _read_package_meta(tar: tarfile.TarFile) -> dict:
    """Extract and parse package.json from *tar*."""
    member = tar.getmember("package.json")
    f = tar.extractfile(member)
    if f is None:
        raise ValueError("package.json is empty in archive")
    return json.loads(f.read().decode("utf-8"))


def _read_skill_meta(tar: tarfile.TarFile) -> dict:
    """Extract and parse skill/meta.json from *tar*."""
    member = tar.getmember("skill/meta.json")
    f = tar.extractfile(member)
    if f is None:
        raise KeyError("skill/meta.json missing in archive")
    return json.loads(f.read().decode("utf-8"))


def _validate_package_compat(pkg_meta: dict) -> None:
    fmt = pkg_meta.get("package_format")
    if fmt != PACKAGE_FORMAT_VERSION:
        raise ValueError(
            f"Unsupported package format {fmt!r}. "
            f"This tool supports format {PACKAGE_FORMAT_VERSION}."
        )


def _extract_skill_members(tar: tarfile.TarFile, target_dir: Path) -> None:
    """Extract skill/ members into *target_dir*, stripping the prefix."""
    for member in tar.getmembers():
        if not member.name.startswith("skill/"):
            continue
        rel = member.name[len("skill/"):]
        if not rel:
            continue
        member.name = rel
        tar.extract(member, target_dir, filter="data")


def _write_install_metadata(target_dir: Path, pkg_meta: dict) -> None:
    """Write .dot-skill-install.json into *target_dir*."""
    install_meta = {
        "installed_at": now_iso(),
        "source_package_format": pkg_meta.get("package_format"),
        "source_exported_at": pkg_meta.get("exported_at"),
    }
    (target_dir / ".dot-skill-install.json").write_text(
        json.dumps(install_meta, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _install_to_host(skill_dir: Path, meta: dict, host: str) -> None:
    """Delegate to the host-specific installer."""
    host = host.strip().lower()
    if host in ("claude", "claude-code"):
        from install_claude_generated_skill import install_claude_generated_skill

        install_claude_generated_skill(skill_dir, meta, force=True)
    elif host == "openclaw":
        from install_openclaw_generated_skill import install_openclaw_generated_skill

        install_openclaw_generated_skill(skill_dir, meta, force=True)
    elif host == "codex":
        from install_codex_generated_skill import install_codex_generated_skill

        install_codex_generated_skill(skill_dir, meta, force=True)
    else:
        print(f"Warning: unknown host {host!r} — skipping host install", file=sys.stderr)


def _add_dir_filtered(
    tar: tarfile.TarFile,
    src: Path,
    arc_prefix: str,
) -> None:
    """Add *src* directory to *tar* under *arc_prefix*, skipping hidden files."""
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fname in files:
            if fname.startswith("."):
                continue
            full = Path(root) / fname
            arcname = f"{arc_prefix}/{full.relative_to(src)}"
            tar.add(full, arcname=arcname)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Package and share dot-skill generated skills."
    )
    sub = parser.add_subparsers(dest="action", required=True)

    # -- export -----------------------------------------------------------
    exp = sub.add_parser("export", help="Package a skill into a .skill.tar.gz")
    exp.add_argument("--character", required=True, help="Character family (colleague|relationship|celebrity)")
    exp.add_argument("--slug", required=True, help="Skill slug")
    exp.add_argument("--output", default=".", help="Output path or directory (default: .)")
    exp.add_argument("--base-dir", default=None, help="Storage root override")
    exp.add_argument(
        "--include-knowledge",
        action="store_true",
        default=False,
        help="Include raw knowledge/ materials (excluded by default for privacy)",
    )
    exp.add_argument(
        "--no-strip-personal",
        action="store_true",
        default=False,
        help="Keep personal identifiers in meta.json (redacted by default)",
    )
    exp.add_argument(
        "--include-versions",
        action="store_true",
        default=False,
        help="Include version history (excluded by default)",
    )

    # -- import -----------------------------------------------------------
    imp = sub.add_parser("import", help="Install a .skill.tar.gz")
    imp.add_argument("package", help="Path to .skill.tar.gz file")
    imp.add_argument("--base-dir", default=None, help="Storage root override")
    imp.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Overwrite existing skill directory",
    )
    imp.add_argument(
        "--install-host",
        default=None,
        choices=["claude", "openclaw", "codex"],
        help="Also install into a host runtime",
    )

    # -- inspect ----------------------------------------------------------
    ins = sub.add_parser("inspect", help="Show package contents without installing")
    ins.add_argument("package", help="Path to .skill.tar.gz file")

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    try:
        if args.action == "export":
            out = export_skill(
                character=args.character,
                slug=args.slug,
                output=args.output,
                base_dir=args.base_dir,
                include_knowledge=args.include_knowledge,
                strip_personal=not args.no_strip_personal,
                include_versions=args.include_versions,
            )
            print(f"Exported: {out}")

        elif args.action == "import":
            target = import_skill(
                package_path=args.package,
                base_dir=args.base_dir,
                force=args.force,
                install_host=args.install_host,
            )
            print(f"Imported: {target}")

        elif args.action == "inspect":
            info = inspect_package(args.package)
            print(json.dumps(info, indent=2, ensure_ascii=False))

    except (FileNotFoundError, FileExistsError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
