"""Locate the local Chrome profile that browser-based collectors reuse for login state."""

from __future__ import annotations

import os
import platform
from pathlib import Path


def default_chrome_profile() -> str:
    """Return the default Chrome profile path for this operating system."""
    system = platform.system()
    if system == "Darwin":
        return str(Path.home() / "Library/Application Support/Google/Chrome/Default")
    if system == "Windows":
        return str(Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/User Data/Default")
    return str(Path.home() / ".config/google-chrome/Default")
