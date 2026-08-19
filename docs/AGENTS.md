# AGENTS.md — Documentation standard

Use [distilly-doc-standards](../.agents/skills/distilly-doc-standards/SKILL.md) for placement workflow. Rationale lives in the [governance Agent Note](../.agents/notes/implemented/process/2026-08-19-agent-governance.md) and the [design-corpus note](../.agents/notes/implemented/process/2026-08-19-design-corpus-and-code-review.md).

## Structure

A document owns full detail about its own subject. Direct children are summarized by purpose and high-level behavior, then linked. Classify each human-facing standing doc as a tutorial (ordered path to an outcome) or a reference (lookup, no teaching sequence).

The [design corpus](design/system-v1.md) is the product contract. It is allowed to stay long. Do not compress it back into architecture.md.

Agent Notes sit outside this structural contract. They have their own [format](../.agents/notes/README.md).

## One home per fact

| Tier | Job | Does not belong there |
|---|---|---|
| Root `AGENTS.md` | Standing orders, one to three lines each | Stories, SDK signatures, host pitfalls |
| This file | Doc rules for `docs/` | Repo-wide coding conventions already in the root file |
| [docs/README.md](README.md) | Folder map | Spec text |
| [architecture.md](architecture.md) | Live tree: what the published code does *now* | Locked design, SDK signatures, rejected alternatives |
| [design/system-v1.md](design/system-v1.md) | Full product contract (conversation reconstruction) | Live-tree status, cookbook steps |
| [design/v1/](design/v1/) | Same contract, one section per file | A second wording of the parent |
| [development.md](development.md) | Setup and which checks to run | Runtime design |
| [testing.md](testing.md) | What a green test must prove | Product verbs |
| [cookbook/](cookbook/) | Numbered how-tos with verify steps | Why we chose the design |
| [process/code-review.md](process/code-review.md) | Review contract | How to invoke the skill |
| Agent Notes | Why, alternatives, verification | Current API catalogs |
| Tool / package README | Local contract | Restating the design corpus |

## Writing rules

- Standing docs (`architecture.md`, cookbooks, root AGENTS) document current state. Avoid "previously / now / no longer" there.
- The design corpus may keep conversation density, including what was rejected. Do not rewrite it into a slogan.
- If a chapter under `design/v1/` and `system-v1.md` disagree, edit the parent first.
- One physical line per paragraph in standing docs. Use editor soft wrap.
- Link repository files with relative Markdown paths.
- Comments and JSDoc state contracts (behavior, failure, ownership), not reasoning transcripts.
- Non-trivial changes ship an Agent Note in the same PR.

## Length

Keep root `AGENTS.md` and this file short enough to load in every session. The design corpus has no standing word budget. Do not shorten it to fit a session.
