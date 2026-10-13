"""Distilly's Python implementation.

The scripts directly under tools/ are the stable command-line entry points that
SKILL.md, prompts and the install guides call. They forward to this package.
"""

from pathlib import Path

# tools/ holds the entry-point scripts and hosts.json; its parent is the skill root
# (the repository, or an installed copy under a host's skills directory).
TOOLS_DIR = Path(__file__).resolve().parent.parent
SKILL_ROOT = TOOLS_DIR.parent
