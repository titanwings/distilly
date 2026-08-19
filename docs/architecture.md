# Architecture

This branch is the distilly product path on top of the published `dot-skill` tree. The live engine still writes colleague-family artifacts (`work.md`, `persona.md`, `SKILL.md`). The design below is the contract new work must land on; do not extend the work/persona split.

## What the product is

distilly distills existing facts into a versioned, correctable profile of a person (including `self`) and loads that profile into coding agents and bots through a thin SDK. A Claude or Codex skill is a projection, not the source of truth.

It lines up with EverOS's profile line (one portrait, rewritten as material arrives), not episode chat logs. Differences: many subjects, lineage, user corrections, shareable versions, default zero API key.

## Layers

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

Four callers share one engine: model MCP (few tools), host plugin (how to distill and inject), panel or marketplace (list, versions, graph), bot (one pinned Person). Do not fatten `Person` to serve the panel.

## Distill executors

| | Default (no key) | Explicit LLM key |
|---|---|---|
| Ingest, dedupe, boundary, queue | engine | engine |
| Distill | host model via `pending` then `commit` | daemon calls LLM, same `commit` |
| Multimodal parse | host vision or local OCR | optional multimodal key; never required |

Unparsed pixels stay in `knowledge/raw/` and do not enter distill input.

## Profile layer

A person is a closed core, open domains, and evidenced claims. Top-level `work.md` + `persona.md` is the old colleague split and is not the target layout.

Core files (empty is legal): `identity`, `voice`, `psyche`, `relations`, `boundaries`, `texture`, plus optional `timeline`. Reality comes from voice examples and texture, not job-title templates.

Domains appear only when material supports them: `vocation` (how they get things done — not a coworker HR file), `craft`, `intimacy`, `kinship`, `public`. `colleague` and `celebrity` are default domain packs. The default create kind is `person`.

Claims use an open dotted `facet`, `evidence`, `confidence` (support from material), and `salience` (written, not used to trim in v1). Distill writes claims first, then renders Markdown.

`SKILL.md` is a projection for host discovery. `prompt()` returns the same neutral Markdown without writing a skill directory.

## Relations

Nodes are subjects. Edges are relations (`link` / `invalidate`), append-only, with `valid_to` on error. Unresolved names become pending mentions. v1 does not compute personality affinity. Spaces keep corpora apart (founders vs anime).

## Client surface

```
d = Distilly(root="~/.distilly")
p = d.person("wang-xing")
p.ingest(...) / p.ingest_files(...)
p.get() / p.prompt()
p.correct(...)
p.install("claude-code")
p.link(...) / p.neighbors()
d.pending(); d.commit(...)
```

Internal modules still split as subjects, collection, distill, versions, install, marketplace, relations. Marketplace, rollback, and promote can wait; `commit` already refuses to auto-replace when confidence drops.

Three load paths: `prompt()` / `get()` for this spawn; `install(host)` for long-lived skill discovery; `export(host)` for one-to-one identity files (`SOUL.md`). Do not mix them.

## Existing tree

`tools/` and `prompts/` are the current distill-and-install scripts. New collection code implements `SourceAdapter` rather than another standalone `*_auto_collector.py` unless it is a thin wrapper. New host wiring implements `HostInjector`. Do not keep growing this repository as a file that only lives under `~/.claude/skills/`.

## Extension points

- Collection: `SourceAdapter` / `DirectAdapter` / `DelegatedAdapter`, entry point group `distilly.adapters`.
- Injection: `HostInjector` for Claude Task, Codex instructions, SDK dynamic instructions.
- Product verbs stay on `Distilly` and `Person`. Adapters do not appear on the root export.
