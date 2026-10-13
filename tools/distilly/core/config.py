"""Collector config files under ~/.distilly, with the pre-rename location as a fallback."""

from __future__ import annotations

import json
from pathlib import Path


def config_paths(platform: str) -> tuple[Path, Path]:
    """Return the current and legacy config file paths for a collector platform."""
    filename = f"{platform}_config.json"
    return Path.home() / ".distilly" / filename, Path.home() / ".colleague-skill" / filename


def load_config(path: Path, legacy_path: Path) -> dict:
    """Read the raw config, falling back to the legacy file; {} when neither exists.

    Credentials may come entirely from environment variables or the keychain,
    so a missing file is not an error.
    """
    config_path = path if path.exists() else legacy_path
    if not config_path.exists():
        return {}
    return json.loads(config_path.read_text(encoding="utf-8"))


def save_config(path: Path, config: dict) -> None:
    """Write the config to the current location, readable by the owner only."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    path.chmod(0o600)
