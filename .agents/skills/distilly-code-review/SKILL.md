---
name: distilly-code-review
description: Use when reviewing a pull request or an outgoing product diff on the distilly branch.
---

# Reviewing a distilly PR

**This skill is guidance, not a complete checklist.** The contract is [docs/process/code-review.md](../../../docs/process/code-review.md). Verify and fetch the PR's live base and exact head, then `git diff --stat origin/dot-skill...HEAD` (or the verified base) before reading the diff and the owning [design chapter](../../../docs/design/README.md). Re-establish the base after a retarget or merge. A short review with one substantiated blocker is better than a list of nits.

## Walk

1. Confirm base and head. Read the PR body for claimed design sections and Agent Notes.
2. Open [docs/process/code-review.md](../../../docs/process/code-review.md) and apply every blocking requirement, including the distilly-specific list.
3. Read the chapter that owns the change in [docs/design/v1/](../../../docs/design/README.md). Do not review product behavior against `architecture.md` alone.
4. For async, credentials, adapters, or queues, apply [defensive-patterns.md](../../../docs/process/defensive-patterns.md).
5. For tests, apply [docs/testing.md](../../../docs/testing.md). Confirm the author ran the [narrowest checks](../../../docs/development.md).
6. Semantically review every new prose passage. Format gates do not do this.
7. Report with defect, path, impact, and evidence. Separate blockers from suggestions. Omit issues a green gate already caught.

## Red flags — stop and re-read the design

- "The compressed architecture is enough"
- "I'll note the work.md split as a follow-up"
- "ingest and commit can be one helper for now"
- "A style nit list with no blocker"
- "CI is green so the prose is fine"

Those mean the review has not happened yet.
