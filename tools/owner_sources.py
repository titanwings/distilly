#!/usr/bin/env python3
"""Kept at this path for SKILL.md, prompts and existing commands; see distilly.collect.owner_sources."""

import sys

from distilly.collect import owner_sources as _impl

if __name__ == "__main__":
    _impl.main()
else:
    sys.modules[__name__] = _impl
