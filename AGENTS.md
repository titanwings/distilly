# AGENTS.md

This branch (`distilly`) is the product path: objective distillation of people into a versioned profile layer, loaded into agents through a thin SDK. Skill files are a distribution face, not the product home.

## Standing orders

- Before product code, read [docs/design/README.md](docs/design/README.md) and the chapter that owns the change. [docs/design/system-v1.md](docs/design/system-v1.md) is the full contract. [docs/architecture.md](docs/architecture.md) is only the live-tree map.
- Every non-trivial change adds or updates an [Agent Note](.agents/notes/README.md) in the same PR. Mechanical or local-only edits are exempt.
- Document current state in standing docs. Put rationale in Agent Notes; put procedures in [docs/cookbook/](docs/cookbook/).
- Markdown and jsonl under `~/.distilly/` are the fact layer. Indexes are disposable.
- Distillation is objective. Unchanged material-set hash skips. Drift is a defect. Corrections land in `corrections/`.
- Default is zero API key: `pending` then `commit`. No required embedding or multimodal key.
- Public client is `Distilly` + `Person`. Seven capability groups stay internal.
- Temporary personas go into that sub-run via `get` / `prompt`. Never write them into global `AGENTS.md`, `CLAUDE.md`, or `agent.md`.
- First-version recall injects the full profile. If it does not fit, fail visibly.
- `SourceAdapter` and `HostInjector` are different seams. Graph v1 is relations only; commit is not O(n²).
- When reviewing a PR or an outgoing product diff, follow [docs/process/code-review.md](docs/process/code-review.md) and [distilly-code-review](.agents/skills/distilly-code-review/SKILL.md).
- Tests describe behavior. Run the narrowest check the diff can break.
- Files end with exactly one trailing newline.

## Where facts live

| Home | Job |
|---|---|
| This file | Standing orders for every session |
| [docs/README.md](docs/README.md) | Folder map |
| [docs/design/](docs/design/README.md) | Product contract |
| [docs/architecture.md](docs/architecture.md) | Live tree |
| [docs/process/](docs/process/README.md) | Review contract |
| [docs/testing.md](docs/testing.md) | What green tests mean |
| [docs/development.md](docs/development.md) | Daily checks |
| [.agents/notes/](.agents/notes/README.md) | Why, alternatives, verification |
| [.agents/skills/](.agents/skills/) | Repeatable workflows, not contracts |

## Checks

```sh
python3 scripts/verify_agent_notes.py
python3 -m compileall -q tools scripts
python3 -m unittest discover -s tests -p 'test_*.py'
```

Run the narrowest set that can fail for the change. CI on `dot-skill` and `distilly` owns the rest.

Edit this file, not `CLAUDE.md` (`CLAUDE.md` is a symlink).
