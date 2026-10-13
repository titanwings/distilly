"""Compare generated skills and command output against a recorded run.

Runs skill_writer.py, version_manager.py and the generated-skill installers
through create, update, correction, rollback, list and host installs, in a
throwaway HOME and working directory, and compares every file they write and
everything they print with tests/fixtures/generated_output.json. Timestamps
and temp paths are normalized.

After an intended change to generated output, regenerate the recording with:

    DISTILLY_UPDATE_GENERATED_OUTPUT=1 python -m unittest tests.test_generated_output_golden
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _paths import TOOLS_DIR


RECORDING = Path(__file__).resolve().parent / "fixtures" / "generated_output.json"
TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\+00:00|Z)?"
    r"|\d{8}T\d{6}Z|v\d+_\d{8}_\d{6}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}"
)


def record_run() -> dict:
    with tempfile.TemporaryDirectory() as home_dir, tempfile.TemporaryDirectory() as work_dir:
        home, work = Path(home_dir), Path(work_dir)
        env = {
            **os.environ,
            "HOME": str(home),
            "DISTILLY_AUTO_INSTALL_CLAUDE": "0",
            "PYTHONDONTWRITEBYTECODE": "1",
        }

        def normalize(text: str) -> str:
            return TIMESTAMP.sub("<TS>", text.replace(str(home), "~").replace(str(work), "WORK"))

        log = []

        def run(script: str, *args: str) -> None:
            result = subprocess.run(
                [sys.executable, str(TOOLS_DIR / script), *args],
                env=env,
                cwd=work,
                text=True,
                capture_output=True,
            )
            log.append({
                "command": normalize(" ".join([script, *args])),
                "exit": result.returncode,
                "stdout": normalize(result.stdout),
                "stderr_last_line": normalize(result.stderr).strip().splitlines()[-1:],
            })

        (work / "work.md").write_text(
            "## Scope\nOwns billing.\n\n"
            "If asked about something outside your responsibilities, hand off to Persona.\n",
            encoding="utf-8",
        )
        (work / "persona.md").write_text(
            "## Layer 0\nNever lie.\n\n## Correction Log\n\n(No entries yet)\n", encoding="utf-8"
        )
        (work / "meta_zh.json").write_text(
            json.dumps(
                {"name": "张三", "language": "zh", "profile": {"company": "ACME", "role": "工程师"}},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (work / "meta_en.json").write_text(
            json.dumps({"name": "Ada Lovelace", "language": "en", "summary": "mathematician"}),
            encoding="utf-8",
        )
        (work / "patch.md").write_text(
            "## Scope\nOwns billing and payments.\n\n## New\nExtra.\n", encoding="utf-8"
        )
        (work / "corr.json").write_text(
            json.dumps({"corrections": [{"scene": "review", "wrong": "be vague", "correct": "be specific"}]}),
            encoding="utf-8",
        )

        writer, versions = "skill_writer.py", "version_manager.py"
        run(writer, "--action", "create", "--slug", "zhang-san", "--meta", "meta_zh.json",
            "--work", "work.md", "--persona", "persona.md",
            "--install-claude-skill", "--install-openclaw-skill", "--install-codex-skill")
        run(writer, "--action", "create", "--name", "Ada Lovelace", "--character", "celebrity",
            "--meta", "meta_en.json", "--work", "work.md", "--persona", "persona.md",
            "--install-codex-skill", "--codex-skills-dir", str(home / "cx"),
            "--install-claude-command-shim", "--install-claude-skill")
        run(writer, "--action", "create", "--name", "Grace Hopper", "--work", "work.md", "--persona", "persona.md")
        run(writer, "--action", "update", "--slug", "zhang-san", "--work-patch", "patch.md",
            "--install-openclaw-skill", "--openclaw-skills-dir", str(home / "oc"))
        run(writer, "--action", "update", "--slug", "zhang-san", "--correction-json", "corr.json")
        run(writer, "--action", "update", "--slug", "ada-lovelace", "--character", "celebrity",
            "--persona-patch", "patch.md")
        run(writer, "--action", "list")
        run(writer, "--action", "list", "--character", "celebrity")
        run(versions, "--action", "list", "--slug", "zhang-san")
        run(versions, "--action", "rollback", "--slug", "zhang-san", "--version", "v1")
        run(versions, "--action", "list", "--slug", "zhang-san")
        for host in ("claude-code", "hermes", "pi", "opencode"):
            run("install_generated_skill.py", "--skill-dir", str(work / "skills" / "colleague" / "zhang-san"),
                "--host", host)
        run("install_generated_skill.py", "--skill-dir", "missing", "--host", "pi")
        run("install_claude_generated_skill.py", "--skill-dir",
            str(work / "skills" / "celebrity" / "ada-lovelace"), "--force")
        run(writer, "--action", "create", "--slug", "Bad Slug", "--work", "work.md")
        run(writer, "--action", "create", "--character", "owner", "--slug", "me")

        files = {}
        for root, tag in ((home, "~"), (work, "WORK")):
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    files[f"{tag}/{path.relative_to(root).as_posix()}"] = normalize(
                        path.read_text(encoding="utf-8")
                    )
        return {"commands": log, "files": files}


@unittest.skipIf(sys.platform == "win32", "Claude command shims differ on Windows")
class GeneratedOutputGoldenTest(unittest.TestCase):
    maxDiff = None

    def test_generated_output_matches_recording(self) -> None:
        actual = record_run()
        if os.environ.get("DISTILLY_UPDATE_GENERATED_OUTPUT") == "1":
            RECORDING.parent.mkdir(parents=True, exist_ok=True)
            RECORDING.write_text(json.dumps(actual, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        expected = json.loads(RECORDING.read_text(encoding="utf-8"))
        self.assertEqual(sorted(actual["files"]), sorted(expected["files"]))
        for name, content in expected["files"].items():
            with self.subTest(file=name):
                self.assertEqual(actual["files"][name], content)
        self.assertEqual(actual["commands"], expected["commands"])


if __name__ == "__main__":
    unittest.main()
