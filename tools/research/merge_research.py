#!/usr/bin/env python3
"""Kept at this path for SKILL.md, prompts and existing commands; see distilly.profile.research_merge."""

import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from distilly.profile import research_merge as _impl  # noqa: E402

if __name__ == "__main__":
    _impl.main()
else:
    sys.modules[__name__] = _impl
