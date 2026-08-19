# Agent Note: Agent standing orders and repository governance

Status: implemented

## Problem

This repository is about to be developed as a product (distilly) primarily by coding agents. Prose conventions in CONTRIBUTING.md did not load into every session, did not record rejected alternatives, and CI watched `main` while the default branch was `dot-skill`, so the published tree had no running gate. Without a small, mechanical governance layer, agents will re-litigate design, grow standing docs without a home, and treat the skill directory as the product root.

## Decision

The `distilly` branch carries a DeepSeek-Harness-shaped governance layer, cut down to what this repo can enforce today.

- Root [AGENTS.md](../../../../AGENTS.md) holds standing product and process orders. `CLAUDE.md` is a symlink to that file.
- [docs/AGENTS.md](../../../../docs/AGENTS.md) defines documentation tiers and one-home-per-fact placement.
- [docs/architecture.md](../../../../docs/architecture.md) is the live-tree map. The product contract is [docs/design/system-v1.md](../../../../docs/design/system-v1.md). Cookbooks hold steps. Agent Notes hold rationale.
- Agent Notes live under `.agents/notes/{lifecycle}/{class}/` with a header and section skeleton checked by [scripts/verify_agent_notes.py](../../../../scripts/verify_agent_notes.py).
- Skills under `.agents/skills/` describe workflows (doc placement, pre-push evidence, PR review). Contracts stay in docs so an agent that skips a skill still sees the rule.
- CI on `dot-skill` and `distilly` (and `main` for leftover forks) runs compile, unittest, and the note gate. Local contributors run the narrowest matching commands; they do not owe a full-matrix rehearsal.

This is docs-first in the narrow sense: a non-trivial change has a note in the same PR; unbuilt work may land as `proposed/` before code; implemented notes stay present-tense with the code.

## Alternatives considered

- **Keep CONTRIBUTING.md as the only process doc** — rejected: agents do not reliably load it, and it cannot record alternatives or fail CI.
- **Copy the full DeepSeek Harness gate set** (bilingual pairing, word budgets, type-equiv, 100% per-file coverage) — rejected: this tree is still a Python skill plus scripts. Extra gates would fail on content we are not ready to own and would train `--no-verify`.
- **Put the standard only in SKILL.md** — rejected: an agent editing docs without invoking the skill would miss the contract. Same split as DSH: contract in docs, workflow in skills.
- **Leave CI on `main` only** — rejected: the default branch is `dot-skill`. A gate that never runs is not a gate.

## Consequences

- Agents opening this branch get standing orders without a human pasting a checklist.
- Product decisions that are not yet code live in `proposed/` and can be reviewed before implementation.
- Note format mistakes fail `python3 scripts/verify_agent_notes.py` and the CI job on this branch.
- Contributors still use unittest and compileall for tool behavior; governance does not replace those tests.
