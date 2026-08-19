# Defensive patterns

Python-sized bug classes for this repository. Not a port of the DSH TypeScript lifecycle catalog.

## Credentials

- Never commit tokens, cookies, or personal dumps.
- Adapter secret field names end in `_token`, `_secret`, or `_key`. The framework stores them; adapters do not print them.
- Config that holds secrets goes under the user home (planned `~/.distilly/adapters.toml`) with mode `0600`.
- Interactive telemetry may ask once. Non-interactive runs refuse and do not write a preference file.

## Adapters and I/O

- `SourceAdapter` constructors do no network and no credential I/O.
- Adapters do not write the fact layer. Yield `Material`; the engine hashes, dedupes, and records lineage.
- `DirectAdapter.collect` is a generator: yield partial success before raising.
- Parse failure on delegated artifacts is `AdapterUnavailable` and not retryable.

## Subprocess and teardown

- Own every process, temp directory, and open database you start. Close on success, failure, and timeout.
- An empty `except` names what it swallows and why nothing else can reach it. Keep the `try` to one statement.
- Queue claim uses `WHERE status='pending'` and treats `rowcount==0` as lost to another worker. Finish uses `WHERE status='processing'`.

## Publication

- Do not publish a profile version until `commit` accepts the draft. A host briefing is not a version.
- Confidence drop writes `vN-awaiting`. It does not move `current`.
- Graph neighbors use a partial index. Do not scan `relations.jsonl` on the hot path.
