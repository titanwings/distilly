---
name: distilly-pre-push-checks
description: Use before pushing or opening a PR on the distilly branch to run the smallest checks that can fail for the outgoing diff.
---

# distilly pre-push checks

Inspect the branch and the diff against the live base (`dot-skill` unless the PR says otherwise).

```sh
git status --short --branch
git diff --stat origin/dot-skill...HEAD
```

Then run only what the diff can break:

| If the diff touches | Run |
|---|---|
| `.agents/notes/` or standing `AGENTS.md` / `docs/` | `python3 scripts/verify_agent_notes.py` |
| `tools/` or `scripts/` | `python3 -m compileall -q tools scripts` and the owning unittest file |
| Tests only | that test file |
| Product behavior or a PR to merge | [distilly-code-review](../distilly-code-review/SKILL.md) |

Do not run the full unittest suite by default. CI on `distilly` / `dot-skill` owns the matrix.

Never skip hooks unless the user explicitly asks. Do not force-push `dot-skill` or `main`.
