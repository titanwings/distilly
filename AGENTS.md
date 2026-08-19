# AGENTS.md

This branch (`distilly`) is the product path: objective distillation of people into a versioned profile layer, loaded into agents through a thin SDK. Skill files are a distribution face, not the product home.

## Standing orders

- Before changing product code or `docs/`, read [docs/architecture.md](docs/architecture.md) and the owning subtree `AGENTS.md` if one exists.
- Every non-trivial change adds or updates an [Agent Note](.agents/notes/README.md) in the same PR. Mechanical or local-only edits are exempt.
- Document current state, not change history. Put rationale in Agent Notes; put procedures in [docs/cookbook/](docs/cookbook/).
- Markdown and jsonl under the user's `~/.distilly/` (planned) are the fact layer. Indexes are disposable. Do not invent a second source of truth.
- Distillation is objective: extract structure from material. Unchanged material-set hash skips a run. Drift is a defect. User corrections are missing facts and land in `corrections/`.
- Default is zero API key. The host model distills via `pending` → `commit`. A configured LLM key is the only path to background distill. No required embedding or multimodal key.
- The public client is `Distilly` + `Person`. Seven capability groups are internal modules, not thirty methods on one class.
- Temporary personas go into that sub-run's instructions via `get` / `prompt`. Never write a temporary persona into global `AGENTS.md`, `CLAUDE.md`, or `agent.md`.
- First-version recall injects the full profile text. Do not silently truncate. If it does not fit, fail visibly.
- Collection adapters (`SourceAdapter`) and host injectors (`HostInjector`) are different seams. First version may ship injectors without built-in Feishu collectors.
- Graph v1 is relations only. Adding a subject is O(1); attaching relations is O(k). Do not rebuild the full graph on every commit.
- Misconfiguration fails loud. Registrations are explicit. Opaque ids stay branded once the SDK lands.
- Tests describe behavior, not correctness theater. Prefer a focused unittest over a repository-wide suite unless the change is repository-wide.
- Files end with exactly one trailing newline.

## Where facts live

| Home | Job |
|---|---|
| This file | Standing orders for every session |
| [docs/AGENTS.md](docs/AGENTS.md) | Documentation tiers and writing rules |
| [docs/architecture.md](docs/architecture.md) | Current product map |
| [docs/development.md](docs/development.md) | Daily workflow and local checks |
| [.agents/notes/](.agents/notes/README.md) | Why, alternatives, verification |
| [.agents/skills/](.agents/skills/) | Repeatable workflows, not contracts |
| Package or tool README | Local contract for that tree |

## Checks

```sh
python3 scripts/verify_agent_notes.py
python3 -m compileall -q tools scripts
python3 -m unittest discover -s tests -p 'test_*.py'
```

Run the narrowest set that can fail for the change. CI on `dot-skill` and `distilly` owns the rest.

Edit this file, not `CLAUDE.md` (`CLAUDE.md` is a symlink).
