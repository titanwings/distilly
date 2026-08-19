"""Behavior of the Agent Note format gate."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.verify_agent_notes import verify


VALID_IMPLEMENTED = """# Agent Note: Example shipped rule

Status: implemented

## Problem

Need a record.

## Decision

We ship the rule.

## Alternatives considered

- **Do nothing** — rejected: no record.

## Consequences

Agents can find the decision.
"""


class VerifyAgentNotesTests(unittest.TestCase):
    def _tree(self, rel: str, body: str) -> Path:
        root = Path(tempfile.mkdtemp())
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return root

    def test_accepts_valid_implemented_note(self) -> None:
        root = self._tree(
            ".agents/notes/implemented/process/2026-08-19-example.md",
            VALID_IMPLEMENTED,
        )
        self.assertEqual(verify(root), [])

    def test_rejects_proposal_heading_on_implemented_note(self) -> None:
        body = VALID_IMPLEMENTED.replace("## Decision", "## Proposal")
        root = self._tree(
            ".agents/notes/implemented/process/2026-08-19-example.md",
            body,
        )
        errors = verify(root)
        self.assertTrue(any("banned" in e or "missing" in e for e in errors), errors)

    def test_rejects_unknown_class_folder(self) -> None:
        root = self._tree(
            ".agents/notes/proposed/misc/2026-08-19-example.md",
            VALID_IMPLEMENTED.replace("implemented", "proposed"),
        )
        errors = verify(root)
        self.assertTrue(any("unknown class" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
