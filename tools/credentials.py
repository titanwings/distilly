"""Kept at this path for existing imports; see distilly.core.credentials."""

import sys

from distilly.core import credentials as _impl

sys.modules[__name__] = _impl
