from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _paths  # noqa: F401  (puts tools/ on sys.path)
from distilly.core import chrome, config, paths


class ConfigFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.current = self.tmp / ".distilly" / "x_config.json"
        self.legacy = self.tmp / ".colleague-skill" / "x_config.json"

    def test_config_paths_keep_current_and_legacy_names(self) -> None:
        with mock.patch.object(Path, "home", return_value=self.tmp):
            self.assertEqual(config.config_paths("x"), (self.current, self.legacy))

    def test_missing_files_give_empty_config(self) -> None:
        self.assertEqual(config.load_config(self.current, self.legacy), {})

    def test_legacy_file_is_read_until_current_exists(self) -> None:
        self.legacy.parent.mkdir(parents=True)
        self.legacy.write_text(json.dumps({"from": "legacy"}), encoding="utf-8")
        self.assertEqual(config.load_config(self.current, self.legacy), {"from": "legacy"})

        config.save_config(self.current, {"from": "current", "name": "飞书"})
        self.assertEqual(config.load_config(self.current, self.legacy), {"from": "current", "name": "飞书"})

    def test_saved_config_is_owner_only(self) -> None:
        config.save_config(self.current, {"a": 1})
        self.assertEqual(stat.S_IMODE(self.current.stat().st_mode), 0o600)


class PathsTest(unittest.TestCase):
    def test_openclaw_workspace_follows_openclaw_overrides(self) -> None:
        home = Path("/home/someone")
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(paths.openclaw_workspace(home), home / ".openclaw" / "workspace")
        with mock.patch.dict(os.environ, {"OPENCLAW_PROFILE": "work"}, clear=True):
            self.assertEqual(paths.openclaw_workspace(home), home / ".openclaw-work" / "workspace")
        with mock.patch.dict(os.environ, {"OPENCLAW_WORKSPACE_DIR": "/ws"}, clear=True):
            self.assertEqual(paths.openclaw_workspace(home), Path("/ws"))

    def test_chrome_profile_per_platform(self) -> None:
        with mock.patch.object(Path, "home", return_value=Path("/h")):
            with mock.patch("platform.system", return_value="Darwin"):
                self.assertEqual(
                    chrome.default_chrome_profile(), "/h/Library/Application Support/Google/Chrome/Default"
                )
            with mock.patch("platform.system", return_value="Linux"):
                self.assertEqual(chrome.default_chrome_profile(), "/h/.config/google-chrome/Default")


if __name__ == "__main__":
    unittest.main()
