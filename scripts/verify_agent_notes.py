#!/usr/bin/env python3
"""Enforce Agent Note path, header, and section rules.

See .agents/notes/README.md. Exit non-zero on the first full report of violations
so CI can fail the distilly / dot-skill job.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTES = ROOT / ".agents" / "notes"

LIFECYCLES = ("proposed", "implemented", "rejected")
CLASSES = (
    "feature",
    "bug-fix",
    "simplification",
    "architecture",
    "process",
    "testing",
)
SKIP_NAMES = {"README.md", "AGENTS.md", "CLAUDE.md"}
FILENAME = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$")
STATUS = {
    "proposed": re.compile(r"^Status: proposed$"),
    "implemented": re.compile(r"^Status: implemented$"),
    "rejected": re.compile(r"^Status: rejected — .+$"),
}
REQUIRED = {
    "proposed": (
        "## Proposal",
        "## Alternatives considered",
        "## Acceptance criteria",
        "## Risks",
    ),
    "implemented": ("## Decision", "## Alternatives considered", "## Consequences"),
    "rejected": ("## Proposal", "## Alternatives considered"),
}
BANNED_IMPLEMENTED = re.compile(
    r"^## (?:Proposal\b|Plan\b|Migration plan\b|Acceptance criteria\b)",
    re.IGNORECASE,
)


def _prose_lines(text: str) -> list[str]:
    lines: list[str] = []
    in_fence = False
    for line in text.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if not in_fence:
            lines.append(line)
    return lines


def _check_note(path: Path, lifecycle: str, root: Path) -> list[str]:
    errors: list[str] = []
    rel = path.relative_to(root).as_posix()
    if not FILENAME.match(path.name):
        errors.append(f"{rel}: filename must be yyyy-mm-dd-topic-title.md")
        return errors

    raw = path.read_text(encoding="utf-8")
    if not raw.endswith("\n") or raw.endswith("\n\n"):
        # allow exactly one trailing newline: file ends with \n but not \n\n
        if not raw.endswith("\n"):
            errors.append(f"{rel}: file must end with a newline")
        elif raw.endswith("\n\n"):
            errors.append(f"{rel}: file must end with exactly one newline")

    lines = raw.splitlines()
    if not lines or not re.match(r"^# Agent Note: \S", lines[0]):
        errors.append(f"{rel}: line 1 must be `# Agent Note: <title>`")
    if len(lines) < 4 or lines[1] != "":
        errors.append(f"{rel}: line 2 must be blank")
    status_re = STATUS[lifecycle]
    if len(lines) < 3 or not status_re.match(lines[2]):
        errors.append(f"{rel}: line 3 must match {lifecycle} Status grammar")
    if len(lines) < 4 or lines[3] != "":
        errors.append(f"{rel}: line 4 must be blank")

    prose = _prose_lines(raw)
    extra_status = [ln for ln in prose if ln.startswith("Status:") and ln != (lines[2] if len(lines) > 2 else "")]
    if extra_status:
        errors.append(f"{rel}: only one Status: line is allowed")

    headings = [ln.rstrip() for ln in prose if ln.startswith("## ")]
    if not headings or headings[0] != "## Problem":
        errors.append(f"{rel}: first section must be ## Problem")
    for required in REQUIRED[lifecycle]:
        if required not in headings:
            errors.append(f"{rel}: missing `{required}`")
    if lifecycle == "implemented":
        for heading in headings:
            if BANNED_IMPLEMENTED.match(heading):
                errors.append(f"{rel}: `{heading}` is banned on implemented notes")
    return errors


def verify(root: Path = ROOT) -> list[str]:
    notes_root = root / ".agents" / "notes"
    errors: list[str] = []
    if not notes_root.is_dir():
        return [".agents/notes is missing"]

    for lifecycle in LIFECYCLES:
        life_dir = notes_root / lifecycle
        if not life_dir.is_dir():
            continue
        for class_dir in sorted(p for p in life_dir.iterdir() if p.is_dir()):
            if class_dir.name not in CLASSES:
                errors.append(
                    f"{class_dir.relative_to(root).as_posix()}: unknown class "
                    f"(want {', '.join(CLASSES)})"
                )
                continue
            for path in sorted(class_dir.glob("*.md")):
                if path.name in SKIP_NAMES or path.name.endswith(".zh.md"):
                    continue
                errors.extend(_check_note(path, lifecycle, root))
    return errors


def main() -> int:
    errors = verify()
    if errors:
        sys.stderr.write("\n".join(errors) + "\n")
        return 1
    sys.stdout.write("agent notes: ok\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
