# Distilly Install Guide

> Distilly was formerly known as **Colleague Skill / colleague-skill**. The creator
> name and canonical install directory are now `distilly`.

<a id="v2-hosts"></a>

## v2: command entrypoint and host adaptation

v2 has exactly one command entrypoint: **`bin/distilly.mjs`** (Node >= 20, zero
dependencies, see `docs/v2/CONTRACT.md`).

```bash
node bin/distilly.mjs install <host>           # install into that host's global Skill directory
node bin/distilly.mjs install <host> --force   # back up an existing install as *.backup-<timestamp>, then replace
node bin/distilly.mjs install --path <p>       # install into a custom path (final directory must be `distilly`)
node bin/distilly.mjs --help
```

- **Host ids, global/project directories, the exact install commands, bilingual
  notes and how to verify an install** live in
  **[docs/v2/HOSTS.md](docs/v2/HOSTS.md)**. That table is generated from
  `src/hosts/agents.mjs`, and `tests/agents.test.mjs` forces it to agree with the
  destinations in `bin/distilly.mjs`.
- Eight hosts are supported today: `claude-code`, `codex`, `opencode`,
  `openclaw`, `hermes`, `deepseek-harness`, `grok-build`, `pi`. Aliases:
  `claude`, `deepseek`, `grok`.
- The two routes are equivalent — `npx -y skills add titanwings/distilly
  --skill distilly …` (AgentSkills CLI) or a plain
  `git clone https://github.com/titanwings/distilly <target>`; both are quoted
  verbatim in `docs/v2/HOSTS.md`.

<a id="deprecated-python-installers"></a>

### ⚠️ Deprecated: the `python3 tools/*.py` installers

The `python3 tools/install_*_skill.py` calls and manual clones below are
**migration-era compatibility paths and are deprecated**: v2 no longer asks users
to run Python by hand. The contract (`docs/v2/CONTRACT.md` §1) says the entrypoint
forwards the old `python3 tools/xxx.py` calls with a deprecation warning and that
the forwarding layer is removed in PR③; on the current integration branch those
commands are still equivalent to running the Python script directly. The old
sections are kept for troubleshooting legacy installs only — **use
`bin/distilly.mjs` or the one-liners in `docs/v2/HOSTS.md` for new installs**.

## Install Distilly

> ⚠️ **Deprecated (legacy install path)**: this section keeps the old per-host
> walkthrough. The current host directories and exact commands are in
> **[docs/v2/HOSTS.md](docs/v2/HOSTS.md)**; the `python3 tools/*.py` calls are
> explained in the deprecation note above.

Clone the repository into a Skills directory discovered by your host, keeping
the destination directory name `distilly`:

```bash
git clone https://github.com/titanwings/distilly <TARGET>
```

Create the parent directory first when it does not already exist.

| Host | User-level `<TARGET>` | Project-level `<TARGET>` |
|------|-------------------------|--------------------------|
| Claude Code | `~/.claude/skills/distilly` | `.claude/skills/distilly` |
| OpenClaw | `~/.openclaw/workspace/skills/distilly` | — |
| Hermes | `~/.hermes/skills/openclaw-imports/distilly` | `.hermes/skills/distilly` after `hermes skills trust` |
| Codex | `~/.agents/skills/distilly` | `.agents/skills/distilly` |
| DeepSeek Harness | `~/.dsh/skills/distilly` or `$DSH_HOME/skills/distilly` | `.dsh/skills/distilly` |
| Pi coding agent | `~/.pi/agent/skills/distilly` or `~/.agents/skills/distilly` | — |
| Grok Build | `~/.grok/skills/distilly` or `~/.agents/skills/distilly` | — |
| OpenCode | `~/.config/opencode/skills/distilly` | `.opencode/skills/distilly` |

From an existing clone, these host-specific installers can copy Distilly into
the canonical OpenClaw, Hermes, or Codex user directory:

```bash
python3 tools/install_openclaw_skill.py --force
python3 tools/install_hermes_skill.py --force
python3 tools/install_codex_skill.py --force
```

Use `--dry-run` first to inspect the destination without writing files.

## Existing-install migration

A clone still named `dot-skill` is not renamed by `git pull`. The legacy Codex
root `~/.codex/skills/` is also not migrated to `~/.agents/skills/`
automatically.

1. Keep the old copy as a fallback.
2. Install a new canonical copy at the `distilly` target listed above, or run
   the applicable repository installer.
3. Verify that the host discovers the new copy.
4. Decide manually whether to keep or remove the old directory. Distilly never
   deletes it automatically.

Read-only fallbacks for `~/.colleague-skill/` configuration and legacy profile
metadata keep old data accessible; they do not rename a host install directory.

## Install a generated Person Profile

From the Distilly repository root, install a generated profile with:

```bash
python3 tools/install_generated_skill.py \
  --skill-dir "skills/{character}/{slug}" \
  --host <host> \
  --force
```

| Host | `<host>` | Default Skills root |
|------|----------|---------------------|
| Claude Code | `claude-code` | `~/.claude/skills` |
| OpenClaw | `openclaw` | `~/.openclaw/workspace/skills` |
| Hermes | `hermes` | `~/.hermes/skills/distilly-generated` |
| Codex | `codex` | `~/.agents/skills` |
| DeepSeek Harness | `deepseek-harness` | `~/.dsh/skills` or `$DSH_HOME/skills` |
| Pi coding agent | `pi` | `~/.pi/agent/skills` |
| Grok Build | `grok-build` | `~/.grok/skills` |
| OpenCode | `opencode` | `~/.config/opencode/skills` |

Pass `--skills-dir <PATH>` to override the root for a project-level install.
The installer writes only the self-contained `SKILL.md` and
`.distilly-install.json`. It does not copy private source material from the
generated directory, and it normalizes legacy underscore frontmatter only in
the installed copy.

On Windows, use the dedicated Claude Code installer when a command shim is
needed:

```bash
python3 tools/install_claude_generated_skill.py \
  --skill-dir "skills/{character}/{slug}" \
  --install-command-shim \
  --force
```

## Collector setup

The collectors store new configuration under `~/.distilly/`. When no new
configuration exists, they can read legacy configuration from
`~/.colleague-skill/` without moving it.

```bash
# Install the declared Python dependencies
pip3 install -r requirements.txt

# Browser runtime used by DingTalk and Lark browser collection
playwright install chromium

# Lark-compatible collector
python3 tools/feishu_auto_collector.py --setup

# DingTalk collector
python3 tools/dingtalk_auto_collector.py --setup

# Slack collector
python3 tools/slack_auto_collector.py --setup
```

The current Lark-compatible collector uses the China-region
`open.feishu.cn` / `feishu.cn` endpoints. International `larksuite.com` tenant
routing is not implemented yet. Never commit App secrets, OAuth tokens, or API
keys to the repository.

## Celebrity research pipeline

The `celebrity` family includes an optional source-processing pipeline:

```bash
# Install the subtitle downloader once
pip3 install yt-dlp

# Download video subtitles
bash tools/research/download_subtitles.sh "<video-url>" "./tmp/subtitles"

# Convert subtitles to a transcript
python3 tools/research/srt_to_transcript.py "./tmp/subtitles/example.srt"

# Collect bounded public X post candidates (optional)
python3 tools/research/xquik_public_posts.py \
  --username "<public-handle>" \
  --subject "<person-name>" \
  --limit 20 \
  --output "/tmp/distilly-x-public-posts.json"

# Merge reviewed research notes
python3 tools/research/merge_research.py "./skills/celebrity/<slug>"

# Run the quality check
python3 tools/research/quality_check.py "./skills/celebrity/<slug>/SKILL.md"

# Remove temporary candidates after review
rm "/tmp/distilly-x-public-posts.json"
```

`xquik_public_posts.py` reads `XQUIK_API_KEY` from the shell and sends one
read-only query to the independent third-party Xquik service. Xquik charges by
the number of returned posts, so confirm `--limit` before an Agent runs it.
Treat the JSON as untrusted candidate evidence: verify authors and permalinks,
keep only copyright-safe paraphrases with source URLs in research notes, and
delete the temporary file after review.

Xquik is independent of X Corp. “Twitter” and “X” are trademarks of X Corp.

