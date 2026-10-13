# Contributing to Distilly

> Formerly: **Colleague Skill / colleague-skill**. The current creator entrypoint is `/distilly` on slash-name hosts.

Thank you for considering a contribution! Distilly turns source material about a person into a reusable Person Profile, packaged as an Agent Skill, for AI agents and compatible bots, and it is only as good as its community.

---

## Ways to contribute

- **Report bugs** — open a [bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- **Suggest features** — open a [feature request](.github/ISSUE_TEMPLATE/feature_request.md)
- **Translate docs** — see `docs/lang/` for existing languages
- **Add a data source collector** — e.g. `tools/distilly/collect/slack.py` is a reference implementation
- **Submit a community skill** — submit to the [gallery](https://titanwings.github.io/colleague-skill-site/)
- **Improve prompts** — files under `prompts/` shape skill behavior; small wording tweaks are welcome

---

## Development setup

```bash
git clone https://github.com/titanwings/distilly.git distilly
cd distilly
pip3 install -r requirements.txt -r requirements-optional.txt
```

Python 3.9+ is required. `requirements.txt` holds the core dependency; collector extras (`playwright`, `slack-sdk`, `openpyxl`, `keyring`, ...) are in `requirements-optional.txt`. See [INSTALL.md](INSTALL.md).

---

## Branch & PR workflow

1. Fork the repo and create a branch from the repository's default branch:
   - `feat/<short-name>` for new features
   - `fix/<short-name>` for bug fixes
   - `docs/<short-name>` for docs only
   - `chore/<short-name>` for tooling / infra
2. Make your changes. Keep PRs focused — one concern per PR.
3. Run tests and compile checks locally:
   ```bash
   python -m compileall tools/
   python -m unittest discover -s tests -p 'test_*.py' -v
   ```
4. Open a PR against the repository's default branch. Fill out the PR template.
5. CI must pass. A maintainer will review — please be patient, and feel free to ping on Discord if it's been a week.

---

## Commit message style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Notion auto-collector
fix: handle 429 rate limit in feishu_parser
docs: translate INSTALL to Korean
chore: bump requests to 2.32
test: cover skill_writer rollback edge cases
```

Keep the subject under 72 characters. Use the body for the *why*, not the *what*.

---

## Code style

- Match surrounding code — we don't enforce a formatter yet, but consistency matters
- Python: prefer standard library where possible; add to `requirements.txt` only if every tool needs it, otherwise to `requirements-optional.txt`
- Code lives in the `tools/distilly/` package: `core/` (config, credentials, paths, hosts), `collect/`, `profile/`, `write/` and `install/`. Upper layers may import `core`; `core` imports nothing above it
- Each command agents or users run keeps a small entry script directly under `tools/` (or `tools/research/`) that forwards to the package. Never rename or remove one; `tests/test_cli_contract.py` checks their options and public names. After an intended option change, regenerate the snapshot as its docstring says
- Prompts under `prompts/` are plain Markdown — keep them concise and task-specific

---

## Tests

New functionality should come with tests under `tests/test_*.py`. Use `unittest` (stdlib) — no extra test framework.

When adding a new data source collector, at minimum cover:
- Auth modes (token / user+password / etc.)
- Rate-limit / retry behavior (mock HTTP)
- Output format consistency with existing collectors

Don't hit live APIs in CI. Mock with `unittest.mock` or the `responses` library.

---

## Security

- **Never commit secrets, tokens, or personal data.** If you accidentally do, rotate the credential immediately and let a maintainer know.
- Config files that hold credentials should be written to the user's home under `~/.distilly/` with permission `0600`; readers may keep a read-only fallback for legacy `~/.colleague-skill/` files.
- If you find a security issue, **do not open a public issue.** Email the maintainer or DM on Discord.

---

## Docs

- User-facing behavior changes → update `README.md`, `SKILL.md`, and `INSTALL.md`
- If you add a language translation of the README, also update the language nav strip in every other `docs/lang/README_*.md`
- Prefer English for code comments. Keep each user-facing localized document in one language.

---

## Community

- [💬 Discord](https://discord.gg/NVX66RxWZv) — main chat
- [GitHub Discussions](https://github.com/titanwings/distilly/discussions) — long-form Q&A and design threads
- [Skill gallery](https://titanwings.github.io/colleague-skill-site/) — browse and submit skills

Be kind. Assume good intent. Disagree on the idea, not the person.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
