"""Freeze the command-line and import surface of every script under tools/.

SKILL.md, prompts/flows and the install guides tell agents and users to run
`python3 tools/<script>.py ...`, and tests import those scripts as modules.
This test records, for each script, the options its --help lists and the
public names it exposes. It fails when an option changes or a public name
disappears. It runs the scripts
both from the repository and from a freshly installed copy.

After an intended change to a script's options or public names, regenerate
the snapshot with:

    DISTILLY_UPDATE_CLI_CONTRACT=1 python -m unittest tests.test_cli_contract
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _paths import REPO_ROOT, TOOLS_DIR


SNAPSHOT_PATH = Path(__file__).resolve().parent / "fixtures" / "cli_contract.json"
DOC_SOURCES = ["SKILL.md", "INSTALL.md", "INSTALL_EN.md", "prompts"]
OPTIONAL_IMPORTS = {"slack_auto_collector": "slack_sdk"}

# Prints the public names a module exposes: functions and classes defined in
# tools/, plus module-level UPPER_CASE constants.
API_PROBE = r"""
import inspect, json, sys
sys.path.insert(0, sys.argv[1])
module = __import__(sys.argv[2], fromlist=["_"])
tools_dir = sys.argv[1]
names = []
for name, value in vars(module).items():
    if name.startswith("_"):
        continue
    if inspect.isfunction(value) or inspect.isclass(value):
        source = inspect.getsourcefile(value) or ""
        if source.startswith(tools_dir):
            names.append(name)
    elif name.isupper() and not inspect.ismodule(value):
        names.append(name)
print(json.dumps(sorted(names)))
"""


def script_paths() -> list[str]:
    """Every runnable Python script under tools/, as a repo-relative path."""
    paths = []
    for path in sorted(TOOLS_DIR.rglob("*.py")):
        if "__pycache__" in path.parts or "distilly" in path.relative_to(TOOLS_DIR).parts:
            continue
        if 'if __name__ == "__main__"' in path.read_text(encoding="utf-8"):
            paths.append(path.relative_to(REPO_ROOT).as_posix())
    return paths


def documented_paths() -> set[str]:
    """Every tools/ path the skill entry points and install guides mention."""
    found: set[str] = set()
    for source in DOC_SOURCES:
        root = REPO_ROOT / source
        files = sorted(root.rglob("*.md")) if root.is_dir() else [root]
        for path in files:
            found.update(re.findall(r"tools/[A-Za-z0-9_/]+\.(?:py|sh)", path.read_text(encoding="utf-8")))
    return found


def module_name(script: str) -> str:
    return script[len("tools/"):-len(".py")].replace("/", ".")


def available(script: str) -> bool:
    dependency = OPTIONAL_IMPORTS.get(module_name(script))
    return dependency is None or importlib.util.find_spec(dependency) is not None


def help_options(root: Path, script: str, *args: str) -> list[str]:
    result = subprocess.run(
        [sys.executable, str(root / script), *args, "--help"],
        cwd=tempfile.gettempdir(),
        text=True,
        capture_output=True,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if result.returncode != 0:
        raise AssertionError(f"{script} {' '.join(args)} --help failed:\n{result.stderr}")
    return sorted(set(re.findall(r"(?<![\w-])--[a-z][a-z0-9-]*", result.stdout)))


def subcommands(root: Path, script: str) -> list[str]:
    result = subprocess.run(
        [sys.executable, str(root / script), "--help"], text=True, capture_output=True
    )
    # A {a,b} group is a subcommand list unless it is the metavar of the option before it.
    usage = result.stdout.split("\n\n", 1)[0].split()
    for previous, token in zip(usage, usage[1:]):
        match = re.fullmatch(r"\{([a-z0-9_,-]+)\}", token)
        if match and (not previous.lstrip("[").startswith("-") or previous.endswith("]")):
            return match.group(1).split(",")
    return []


def describe_cli(root: Path, script: str) -> dict:
    entry: dict = {"options": help_options(root, script)}
    subs = subcommands(root, script)
    if subs:
        entry["subcommands"] = {name: help_options(root, script, name) for name in subs}
    return entry


def describe_api(root: Path, script: str) -> list[str]:
    result = subprocess.run(
        [sys.executable, "-c", API_PROBE, str(root / "tools"), module_name(script)],
        cwd=tempfile.gettempdir(),
        text=True,
        capture_output=True,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if result.returncode != 0:
        raise AssertionError(f"importing {module_name(script)} failed:\n{result.stderr}")
    return json.loads(result.stdout)


def build_snapshot(root: Path) -> dict:
    snapshot = {}
    for script in script_paths():
        if not available(script):
            continue
        snapshot[script] = {"cli": describe_cli(root, script), "api": describe_api(root, script)}
    return snapshot


class CliContractTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls) -> None:
        if os.environ.get("DISTILLY_UPDATE_CLI_CONTRACT") == "1":
            missing = [script for script in script_paths() if not available(script)]
            if missing:
                raise RuntimeError(f"install optional dependencies before updating: {missing}")
            SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
            SNAPSHOT_PATH.write_text(
                json.dumps(build_snapshot(REPO_ROOT), indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        cls.snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))

    def assert_matches_snapshot(self, root: Path) -> None:
        for script, expected in self.snapshot.items():
            with self.subTest(script=script):
                if not available(script):
                    self.skipTest(f"optional dependency for {script} is not installed")
                self.assertTrue((root / script).is_file(), f"{script} is missing")
                self.assertEqual(describe_cli(root, script), expected["cli"])
                # New public names are fine; removing or renaming one breaks importers.
                missing = sorted(set(expected["api"]) - set(describe_api(root, script)))
                self.assertEqual(missing, [], f"{script} no longer exposes these names")

    def test_every_script_is_in_the_snapshot(self) -> None:
        self.assertEqual(sorted(self.snapshot), script_paths())

    def test_documented_tool_paths_exist(self) -> None:
        for path in sorted(documented_paths()):
            with self.subTest(path=path):
                self.assertTrue((REPO_ROOT / path).is_file(), f"{path} is documented but missing")

    def test_repository_scripts_match_snapshot(self) -> None:
        self.assert_matches_snapshot(REPO_ROOT)

    def test_installed_copy_scripts_match_snapshot(self) -> None:
        from install_distilly import install_skill

        with tempfile.TemporaryDirectory() as tmp:
            installed = install_skill(REPO_ROOT, Path(tmp) / "distilly")
            for path in sorted(documented_paths()):
                with self.subTest(path=path):
                    self.assertTrue((installed / path).is_file(), f"{path} is not installed")
            self.assert_matches_snapshot(installed)


if __name__ == "__main__":
    unittest.main()
