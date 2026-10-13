"""Kept at this path for existing imports; see distilly.profile.schema."""

import sys

from distilly.profile import schema as _impl

sys.modules[__name__] = _impl
