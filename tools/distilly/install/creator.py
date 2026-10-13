"""Install the Distilly package payload into a host's local skill directory."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from distilly import SKILL_ROOT
from distilly.core.hosts import HOSTS, skills_dir


IGNORE_NAMES = shutil.ignore_patterns(".git", "__pycache__", ".DS_Store", "*.pyc")


def default_destination(host: str, home: Path | None = None) -> Path:
    """Return the default Distilly install directory for a supported host."""
    return skills_dir(host, home) / "distilly"


def payload_entries(source: Path) -> list[str]:
    """Return the files a Distilly install ships: package.json "files" minus the npm CLI.

    An installed copy has no package.json because it already is the payload, so it is copied whole.
    """
    package_json = source / "package.json"
    if not package_json.exists():
        return sorted(path.name for path in source.iterdir() if not IGNORE_NAMES(str(source), [path.name]))
    files = json.loads(package_json.read_text(encoding="utf-8"))["files"]
    return [entry.rstrip("/") for entry in files if entry.rstrip("/") != "bin"]


def install_skill(source: Path, destination: Path, force: bool = False, dry_run: bool = False) -> Path:
    """Copy the package payload into a host's local skill directory."""
    if not (source / "SKILL.md").exists():
        raise FileNotFoundError(f"source does not look like a skill repo: {source}")

    source_root = source.resolve()
    destination_root = destination.resolve()
    if source_root == destination_root:
        return destination
    if source_root in destination_root.parents or destination_root in source_root.parents:
        raise ValueError("source and destination must not overlap")

    if dry_run:
        return destination

    entries = payload_entries(source)
    missing = [entry for entry in entries if not (source / entry).exists()]
    if missing:
        raise FileNotFoundError(f"package payload is missing: {', '.join(missing)}")

    if destination.exists():
        if not force:
            raise FileExistsError(f"destination already exists: {destination}")
        shutil.rmtree(destination)

    destination.mkdir(parents=True)
    for entry in entries:
        path = source / entry
        if path.is_dir():
            shutil.copytree(path, destination / entry, ignore=IGNORE_NAMES)
        else:
            shutil.copy2(path, destination / entry)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Install Distilly into a host's local skill directory")
    parser.add_argument("--host", required=True, choices=sorted(HOSTS))
    parser.add_argument(
        "--source",
        default=str(SKILL_ROOT),
        help="Source skill repo root",
    )
    parser.add_argument("--dest", help="Override the destination skill directory")
    parser.add_argument("--force", action="store_true", help="Overwrite the destination if needed")
    parser.add_argument("--dry-run", action="store_true", help="Print the install target without copying")
    args = parser.parse_args()

    destination = Path(args.dest).expanduser() if args.dest else default_destination(args.host)
    destination = install_skill(
        Path(args.source).expanduser(),
        destination,
        force=args.force,
        dry_run=args.dry_run,
    )
    print(destination)
