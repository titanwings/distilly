# Testing

Commands live in root [AGENTS.md](../AGENTS.md). This file is what a green run must mean.

## Tiers we have

- **Unit** (`python3 -m unittest discover -s tests -p 'test_*.py'`): stdlib unittest next to the behavior it pins. Prefer errors, skip paths, on-disk layout, and contract regressions.
- **Compile** (`python3 -m compileall -q tools scripts`): syntax only.
- **Agent Note format** (`python3 scripts/verify_agent_notes.py`): path, header, required sections. Not a design review.
- **CI** on `dot-skill` and `distilly` runs the three above. It is the exhaustive lane. Locally run only what the diff can break.

We do not have, and do not pretend to have: per-file 100% coverage, keyless snapshot transcripts, or real-API e2e. When a model-visible projection ships (`prompt()`, `SKILL.md`, host instructions), add a keyless fixture that diffs the rendered text.

## Rules

- Tests describe behavior, not correctness theater. Change obsolete behavior with its tests.
- Mock only the expensive or non-deterministic edge (network, clock, LLM). Keep the store, hasher, and renderer real.
- Assert the world: files under a temporary root, version pointers, claim lines, refusal errors. Do not trust an agent's own summary.
- Do not hit live APIs in CI.
- A test of an installer or CLI boots that entry, not an internal helper that skips argument parsing.
- Distill objectivity: same material-set hash skips; a second distill of the same set must keep structured claim fields stable once that path exists.
