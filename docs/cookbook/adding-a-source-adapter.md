# Cookbook: add a source adapter

Use this when material should come from a named platform. Host-agent browsing that already produced text should call `ingest` instead.

## 1. Pick a mode

- `direct_api` — official API, implement `DirectAdapter.collect`
- `direct_browser` — logged-in local browser, same class
- `agent_delegated` — emit `AgentPlan`, implement `DelegatedAdapter.accept`

Do not subclass `SourceAdapter` directly.

## 2. Implement the type

Constructor must do no network and no credential I/O. Declare `adapter_id`, `capabilities`, and `config_fields`. Names ending in `_token`, `_secret`, or `_key` are secrets.

Raise only adapter errors (`AdapterAuthError`, `AdapterScopeError`, `AdapterUnavailable`, `AdapterRateLimited`, `AdapterTransient`). Do not write files. The framework hashes, dedupes, and records lineage.

`Material.content` must be text. Images go to raw storage until parsed.

## 3. Register

Built-in: `register(MyAdapter())` from the adapters package. Third-party: entry point group `distilly.adapters`.

## 4. Verify

```sh
python3 -m unittest discover -s tests -p 'test_*adapter*.py'
python3 scripts/verify_agent_notes.py
```

Ship an Agent Note in the same PR if this is a new source or a contract change. Rationale belongs in the note, not in this cookbook.
