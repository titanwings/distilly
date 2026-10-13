"""Kept at this path for existing imports; see distilly.profile.presets."""

import sys

from distilly.profile import presets as _impl

sys.modules[__name__] = _impl
