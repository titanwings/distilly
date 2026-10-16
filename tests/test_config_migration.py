from __future__ import annotations

import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import _paths  # noqa: F401  (puts tools/ on sys.path)
import dingtalk_auto_collector
import feishu_auto_collector
import feishu_mcp_client


COLLECTOR_MODULES = (
    dingtalk_auto_collector,
    feishu_auto_collector,
    feishu_mcp_client,
)


class ConfigMigrationTest(unittest.TestCase):
    def test_collectors_read_legacy_config_and_save_new_config_privately(self) -> None:
        for module in COLLECTOR_MODULES:
            with self.subTest(module=module.__name__), tempfile.TemporaryDirectory() as tmp_dir:
                root = Path(tmp_dir)
                current = root / ".distilly" / "config.json"
                legacy = root / ".colleague-skill" / "config.json"
                legacy.parent.mkdir(parents=True)
                legacy.write_text(json.dumps({"source": "legacy"}), encoding="utf-8")

                with (
                    patch.object(module, "CONFIG_PATH", current),
                    patch.object(module, "LEGACY_CONFIG_PATH", legacy),
                ):
                    self.assertEqual(module.load_config(), {"source": "legacy"})
                    module.save_config({"source": "distilly"})

                self.assertEqual(
                    json.loads(current.read_text(encoding="utf-8")),
                    {"source": "distilly"},
                )
                self.assertEqual(stat.S_IMODE(current.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(current.parent.stat().st_mode), 0o700)


if __name__ == "__main__":
    unittest.main()
