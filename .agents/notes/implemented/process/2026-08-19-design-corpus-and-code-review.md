# Agent Note: Design corpus in-tree and DSH-shaped code review

Status: implemented

## Problem

The first governance PR compressed the product conversation into an 80-line architecture map. An agent that only loaded standing docs could not reconstruct locked mechanisms (SDK signatures, seven host pitfalls, profile facets, landing order). Review had a Note gate and no DSH-shaped review contract, so a green CI could ship a design violation.

## Decision

The uncut v1.1 design is in [docs/design/system-v1.md](../../../../docs/design/system-v1.md). The same sections are split under [docs/design/v1/](../../../../docs/design/v1/) for topic loading. The parent file wins if they drift.

`docs/` is now graded by job: `design/` (contract), `architecture.md` (live tree), `cookbook/` (steps), `process/` (review), `testing.md` (what green means).

Review copies the DSH `dsh-code-review` shape: contract in [docs/process/code-review.md](../../../../docs/process/code-review.md), walk in [distilly-code-review](../../../skills/distilly-code-review/SKILL.md). Blockers include semantic prose review, docs matching code, design-corpus match, required evidence, and the distilly-specific list (no work/persona split, no ingest+commit merge, no global persona files, no silent trim, no O(n²) commit). We did not copy Cordis disposal, invariant companions, type-equiv, bilingual pairing, or 100% coverage.

## Alternatives considered

- **Keep architecture.md as the only spec** — rejected: the user required the full conversation, and the compressed map already dropped §9–§16.
- **Design as one file with no chapter split** — rejected: agents implementing one seam need to load that section. The parent remains canonical.
- **Port dsh-code-review verbatim** — rejected: this tree has no Cordis, no subsystems catalog, and no `change-scope`. A verbatim skill would demand evidence we cannot produce and train reviewers to skip it.
- **Put review rules only in the skill** — rejected: same DSH alternative. An agent that skips the skill must still see the contract.

## Consequences

- Product sessions start at `docs/design/README.md`, not at architecture.md.
- Changing a locked item without a new note is a review blocker.
- PR review has a named walk. Format-green is not a design review.
