"""Kept at this path for existing imports; see distilly.core.hosts."""

import sys

from distilly.core import hosts as _impl

sys.modules[__name__] = _impl
