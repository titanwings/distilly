# Development

## Clone and branch

```sh
git clone https://github.com/titanwings/colleague-skill.git
cd colleague-skill
git checkout distilly   # product path; default published branch remains dot-skill
python3 -m pip install -r requirements.txt
```

Python 3.9+ is required.

## Daily checks

Match the check to the change. Do not default to the full suite.

| Surface | Command |
|---|---|
| Agent Notes or standing docs | `python3 scripts/verify_agent_notes.py` |
| Python tools | `python3 -m compileall -q tools scripts` and the owning `tests/test_*.py` |
| Behavior of a collector or writer | the unittest that would fail if that behavior regressed |

Before push, follow [.agents/skills/distilly-pre-push-checks/SKILL.md](../.agents/skills/distilly-pre-push-checks/SKILL.md).

CI on `dot-skill` and `distilly` runs compile, unittest, and the Agent Note gate. The historical workflow that watched only `main` never ran against the default branch.

## Docs-first

1. Search `.agents/notes/` for an owner. Update it instead of writing a second note.
2. Unbuilt product work starts in `proposed/`.
3. A shipped decision moves to `implemented/` in the same PR as the code, present tense.
4. Standing docs state what is true now. History stays in the note or the PR.

## Layout for new work

Prefer `src/distilly/` (client), `src/distilly_engine/`, `src/distilly_adapters/`, and `src/distilly_bindings/` when those packages appear. Until they exist, new shared types go next to `tools/` only if they are used by current scripts; otherwise wait for the package cut rather than inventing a third tree.
