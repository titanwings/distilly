# Agent Notes

An Agent Note records a decision that code and standing docs cannot carry: the why, what we gave up, and how to verify it.

## Path

`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`

Lifecycle:

- `proposed/` — not built, or only partly built. Future tense is allowed.
- `implemented/` — shipped. Present tense. Keep paths and names current in the same change that moves them.
- `rejected/` — declined. Keep only while the reason still prevents a real mistake.

Class (closed set): `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`.

Architecture is about shipped source. Process is tooling and workflow around the source.

There is no `INDEX.md`. Browse the folders.

## When to write one

Every non-trivial change adds or updates at least one note in the same PR. Non-trivial means behavior, architecture, a shared contract, process, testing strategy, or an on-disk / wire / config format.

Update the note that already owns the decision. A new decision gets a new note and a cross-link. Do not rewrite an implemented note into the opposite conclusion.

Search the tree for supersession before adding a note.

## File format

Lines 1–4:

```markdown
# Agent Note: <title>

Status: proposed
```

`Status:` must match the folder: `proposed`, `implemented`, or `rejected — <one-line reason>`.

Then `## Problem` first.

### proposed/

`## Problem` `## Proposal` `## Alternatives considered` `## Acceptance criteria` `## Risks`

### implemented/

`## Problem` `## Decision` `## Alternatives considered` `## Consequences`

Banned headings: `## Proposal`, `## Plan`, `## Migration plan`, `## Acceptance criteria`.

### rejected/

Keeps proposal-era sections. The verdict is the `Status:` line.

`## Alternatives considered` is required. Each real alternative and why it lost.

`python3 scripts/verify_agent_notes.py` enforces this. English-only notes are enough on this branch; a later pairing gate may require `.zh.md`.
