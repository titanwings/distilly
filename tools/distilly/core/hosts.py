"""Host install paths, loaded from hosts.json (shared with bin/distilly.mjs)."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from pathlib import Path

from distilly import TOOLS_DIR


HOSTS_FILE = TOOLS_DIR / "hosts.json"
HOSTS: dict[str, dict] = json.loads(HOSTS_FILE.read_text(encoding="utf-8"))["hosts"]


def _resolve(
    host: str,
    key: str,
    home: Path | None,
    environ: Mapping[str, str] | None,
) -> Path:
    try:
        spec = HOSTS[host]
    except KeyError as error:
        raise ValueError(f"unsupported host: {host}") from error
    parts = spec.get(key) or spec["skills_dir"]
    environment = os.environ if environ is None else environ
    home_env = spec.get("home_env")
    if home_env and environment.get(home_env):
        return Path(environment[home_env]).expanduser().joinpath(*parts[1:])
    return (home or Path.home()).joinpath(*parts)


def skills_dir(
    host: str,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> Path:
    """Return the host's skill root where Distilly itself is installed."""
    return _resolve(host, "skills_dir", home, environ)


def generated_skills_dir(
    host: str,
    home: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> Path:
    """Return the host's skill root for generated person skills."""
    return _resolve(host, "generated_skills_dir", home, environ)
