# Agent Note: distilly product, SDK, profile, and host injection

Status: proposed

## Problem

`dot-skill` distills people into Claude-oriented skill files, but the product we want is a personal-memory engine: many subjects (including self), objective distill, version lineage, user corrections, a thin Agent SDK, and host-specific injection. The current `work.md` + `persona.md` split cannot hold family, public figures, or fictional characters without forking templates. Five runtime methods are not a product contract, and thirty flat methods are not an SDK.

## Proposal

Ship distilly as an independent product path on this repository (later a rename). Full contract: [docs/design/system-v1.md](../../../../docs/design/system-v1.md). Live-tree map: [docs/architecture.md](../../../../docs/architecture.md).

Locked product rules (do not re-open in implementation PRs without a new note):

- Subjects include colleagues, relations, celebrities, fictional characters, and `self` on one model. `self` is a normal id.
- Distill is objective. Material-set hash unchanged → skip. Output drift is a bug. Corrections are facts in `corrections/`, immediately versioned, and reused. Lower overall confidence suspends the new version (`promote` / `reject`).
- Default zero API key. Host `pending` + `commit`. Optional LLM key for daemon distill. No required multimodal or embedding key. Unparsed media is not distill input.
- Markdown / jsonl are facts. SQLite, if added, is a disposable index and queue.
- Client: `Distilly` + `Person`. Capability groups stay internal. MCP exposes `get`, `ingest`, `pending`, `commit`, `correct` only.
- Two adapter kinds: `SourceAdapter` (collection; v1 main path is host `ingest`) and `HostInjector` (v1 required).
- Three load paths: `prompt`/`get` (this spawn, full text), `install` (host skills), `export` (one identity file). Temporary personas never write global instruction files.
- Profile = closed core + open domains + evidenced claims. Domain packs replace colleague/celebrity as types. Default create kind is `person`.
- Graph v1 is relations only. Insert node O(1), attach relations O(k), no O(n²) rebuild. Pending mentions are not auto-linked.
- Bot is a binding that pins one subject and version. It must not invent its own persona files.
- ChatCut package layout may be copied; hosted MCP and OAuth must not. Acceptance: distill a public figure and `get` without login.

Target home disk and package layout are in design chapters [07](../../../../docs/design/v1/07-home-tree.md) and [06](../../../../docs/design/v1/06-source-tree.md). Existing `PRIMARY_ARTIFACTS` migrate into core and domains; do not keep work/persona as the top split.

## Alternatives considered

- **Remain a Claude skill only** — rejected: bots, Codex, LangGraph, and a marketplace cannot share a skill directory as the source of truth.
- **EverOS-style required four API keys** — rejected: the default path must run on the host model the user already pays for.
- **Episode / vector memory (Mem0, Graphiti)** — rejected for v1: the user edits portraits in Markdown; persona size fits a full inject.
- **Flat seven-group Client** — rejected: DSH and Mem0 keep a small object. Groups remain modules.
- **Global AGENTS.md as the load mechanism for ten temporary agents** — rejected: one process-wide file cannot isolate personas and pollutes the repo.
- **Salience truncation in v1** — rejected: first version injects the full profile; adapters may fail closed if the host truncates.
- **Personality affinity edges in v1** — rejected: relations are evidenced; similarity is a later derived index.
- **Calling the evidenced edge a "statement edge"** — rejected by product language. The user-facing name is relation (`Relation`).

## Acceptance criteria

- A host agent can `ingest` text or files, `pending`, `commit`, `get` / `prompt`, and `correct` without an LLM key.
- `prompt()` text can be placed in a Claude Task or Codex child instructions without writing repository instruction files.
- Confidence drop on `commit` does not replace `current` until `promote`.
- A new `SourceAdapter` can register without changing `Person` methods.
- Relation `link` + `neighbors` work without scanning the whole graph on commit.
- Governance checks in the [governance note](../../implemented/process/2026-08-19-agent-governance.md) stay green.

## Risks

- The live tree still emits work/persona artifacts. Implementation must migrate or dual-write briefly; standing docs already forbid extending that split.
- Full-profile inject will hit context limits; v1 fails visibly rather than inventing a silent trimmer.
- Collection adapters will rot on host UIs. That rot stays in delegated plans or community packages, not in `Person`.
- Renaming the GitHub repository and telemetry env vars is still open and will touch every install doc.
