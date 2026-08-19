# Architecture

This file is the **live-tree map**. The published code on `distilly` still writes colleague-family artifacts (`work.md`, `persona.md`, `SKILL.md`). New work must land on the design in [design/system-v1.md](design/system-v1.md), not on that split.

Do not implement from this page alone. Load [design/README.md](design/README.md) and the chapter that owns the change.

## What exists now

- `tools/` and `prompts/` distill and install Claude-oriented skills.
- Tests under `tests/` cover that skill writer, installers, and research helpers.
- CI on `dot-skill` and `distilly` compiles `tools`/`scripts`, runs unittest, and checks Agent Note format.
- `src/distilly/` and `~/.distilly/` are specified, not shipped.

## What must be built

The contract is the uncut design. Entry points:

| If you are changing | Read |
|---|---|
| Product origin, who we remember, five faces | [design/v1/01-intent.md](design/v1/01-intent.md) |
| A locked rule or an open item | [design/v1/04-locked-and-open.md](design/v1/04-locked-and-open.md) |
| Layers, queues, executor split | [design/v1/05-architecture.md](design/v1/05-architecture.md) |
| Package cut | [design/v1/06-source-tree.md](design/v1/06-source-tree.md) |
| On-disk home | [design/v1/07-home-tree.md](design/v1/07-home-tree.md) |
| `Distilly` / `Person` / types / MCP | [design/v1/09-sdk-spec.md](design/v1/09-sdk-spec.md) |
| Collection | [design/v1/10-source-adapters.md](design/v1/10-source-adapters.md) |
| Injection, three load paths, seven pitfalls | [design/v1/11-host-injection.md](design/v1/11-host-injection.md) |
| Profile core / domain / claim | [design/v1/15-profile-layer.md](design/v1/15-profile-layer.md) |
| Relations | [design/v1/16-relations.md](design/v1/16-relations.md) |
| First-slice acceptance | [design/v1/20-success-path.md](design/v1/20-success-path.md) |
| Order of work | [design/v1/21-landing-order.md](design/v1/21-landing-order.md) |

## Live data flow (today)

```
materials → tools/ + prompts/ → work.md + persona.md + SKILL.md → host skills/
```

## Target data flow (design)

```
bindings     Claude / Codex / LangGraph / Hermes / Telegram
             Recall = get / prompt     Capture = ingest | accept_collect
                  │
client       Distilly + Person
                  │
engine       collect → Material → queue → distill → version → project
             relations, corrections, promote / reject
                  │
store        ~/.distilly/   Markdown / jsonl are facts
             .index/        disposable
```

Signatures, field lists, and host pitfalls stay in the design chapters. This page only orients.
