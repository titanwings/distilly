"""Host locations that are not skill directories (those live in hosts.json)."""

from __future__ import annotations

import os
from pathlib import Path


def openclaw_workspace(home: Path) -> Path:
    """Resolve the OpenClaw workspace the same way OpenClaw does."""
    override = os.environ.get("OPENCLAW_WORKSPACE_DIR")
    if override:
        return Path(override).expanduser()
    profile = os.environ.get("OPENCLAW_PROFILE")
    if profile and profile != "default":
        return home / f".openclaw-{profile}" / "workspace"
    return home / ".openclaw" / "workspace"
