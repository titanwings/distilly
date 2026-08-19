# AGENTS.md — Documentation standard

Use [distilly-doc-standards](../.agents/skills/distilly-doc-standards/SKILL.md) for placement workflow. Rationale lives in the [governance Agent Note](../.agents/notes/implemented/process/2026-08-19-agent-governance.md).

## Structure

A document owns full detail about its own subject. Direct children are summarized by purpose and high-level behavior, then linked. Classify each human-facing doc as a tutorial (ordered path to an outcome) or a reference (lookup, no teaching sequence).

Agent Notes sit outside this structural contract. They have their own [format](../.agents/notes/README.md).

## One home per fact

| Tier | Job | Does not belong there |
|---|---|---|
| Root `AGENTS.md` | Standing orders, one to three lines each | Stories, worked examples, procedures |
| This file | Doc rules for `docs/` | Repo-wide coding conventions already in the root file |
| [architecture.md](architecture.md) | Product map, seams, data flow | Decision rationale, cookbook steps, per-tool walkthroughs |
| [development.md](development.md) | Setup and which checks to run | Runtime design |
| [cookbook/](cookbook/) | Numbered how-tos with verify steps | Why we chose the design |
| Agent Notes | Why, alternatives, verification | Current API catalogs |
| Tool / package README | Local contract | Restating architecture.md |

## Writing rules

- Document current state. Avoid "previously / now / no longer" in standing docs.
- One physical line per paragraph. Use editor soft wrap.
- Link repository files with relative Markdown paths. `scripts/verify_agent_notes.py` does not replace a later link linter; still write checkable links.
- Comments and JSDoc state contracts (behavior, failure, ownership), not reasoning transcripts.
- Non-trivial changes ship an Agent Note in the same PR.

## Length

Keep root `AGENTS.md` and this file short enough to load in every session. If a standing doc grows, relocate before adding. Do not raise a ceiling by deleting required contracts.
