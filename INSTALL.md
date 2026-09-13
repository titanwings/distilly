# Install Distilly Developer Preview

This document describes the current TypeScript Plugin preview on the `distilly-plugin` branch. The separate Legacy Skill compatibility path is documented below for hosts that do not yet have a verified Plugin binding.

## Requirements

These requirements apply to the native Plugin paths. Legacy Skill mode below does not require Codex, Node, or pnpm; its full older workflow requires an ordinary local Skill host with filesystem/Bash/Python capabilities.

- Node.js `22.19+` or `24`;
- pnpm `10.32+`; and
- a locally installed supported host whose version matches the release evidence: Codex CLI `0.146.0`, OpenClaw `2026.3.24`, or Hermes `v0.9.0`.

An unknown host version fails closed instead of installing an unverified integration.

## Source checkout

```bash
git clone --branch distilly-plugin https://github.com/titanwings/distilly.git
cd distilly
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

## Install for Codex

Run the built lifecycle command from the checkout:

```bash
node packages/cli/lib/bin.js setup --host codex
node packages/cli/lib/bin.js doctor --host codex
```

Restart Codex after setup. The command installs a self-contained runtime under `~/.distilly/`, registers the Plugin through the host's normal lifecycle, and starts the absolute launcher only from the verified installation tree. It does not copy private source material into the Plugin.

To install an approved Person Profile as a persistent Skill:

```bash
node packages/cli/lib/bin.js install subject_<32 lowercase hex characters> --host codex
```

Replace the subject id with the exact value returned by Distilly. Profile installation writes only the self-contained Profile and its digest manifest.

## Recover a briefing that exceeds the host limit

If `distilly_pending` returns `briefing_too_large`, the research is still stored and pending. Raising the model context setting does not change a verified MCP transport limit. For a complete briefing within the engine's limits, use the explicit local file workflow from a checkout containing this command:

```bash
node packages/cli/lib/bin.js recover job_<32 lowercase hex characters> --output /absolute/path/to/new-recovery-directory
```

Use the exact job ID from `distilly_pending` with `action: "list"`. Run the command with the same home directory as the installed Plugin so it opens the same `~/.distilly` store. The output directory must be new, with an existing parent. It will contain private research; choose a local location you intend to use for that data.

Keep the command running. It writes the complete `briefing.json`, `commit-tool-schema.json`, and `README.txt`, then waits for a response. Read the entire briefing, its instructions, evidence rules, and baseline before preparing a patch. The patch schema is the `patch` property of `commit-tool-schema.json`; the command supplies all commit identity fields itself.

Write a temporary JSON file with exactly `briefingSha256` (the digest in `README.txt`) and `patch` (your DistillPatch object). Rename the finished file to `response.json` in that directory. The command checks the digest and submits the patch through the same session and lease. It does not call a model or generate a patch. An empty patch is a deliberate decision to consume the briefing without adding or changing claims; do not use one merely to clear the error.

The default wait is 20 minutes. `--timeout-seconds` accepts 1 through 1500 seconds, below the 30-minute lease lifetime. Timeout, Ctrl+C, SIGTERM, malformed responses, and validation errors attempt to release the lease and leave research available for another attempt. A force-killed process leaves its lease to expire. Another session's active lease is never taken over. Retry with a new directory and a fresh briefing; an older response will not match the new digest.

A successful submission writes `submission.json` and `result.json`. The result can be current or suspended for review; a suspended result still needs the normal review workflow. If the command says the commit succeeded but its result file could not be written, use the printed version and request IDs to inspect the result. Do not resubmit blindly. An unknown commit outcome requires the same inspection before retrying.

This path transfers a complete briefing through local files, with a maximum of 4 MiB and 999 material references. It does not raise a host's verified MCP limit or establish that a model can read that much context. Responses are limited to 256 KiB on disk; the existing 64 KiB canonical patch limit still applies. There is no truncation, automatic splitting, or deletion of stored research. Briefings above the engine limits still fail explicitly. Recovery directories are not removed automatically.

### 超出宿主限制后的本地恢复

出现 `briefing_too_large` 时，调研资料仍保存在库中并等待处理。调整模型上下文不会改变已验证的 MCP 传输限制。可在包含此命令的源码构建目录中运行上面的 `recover` 命令；job ID 从 `distilly_pending` 的 `action: "list"` 结果取得。命令必须使用与 Plugin 相同的 home，才能访问同一个 `~/.distilly`。输出目录必须尚不存在，且父目录已存在；其中包含私人资料，请选择适合保存这些资料的本地位置。

保持命令运行，完整阅读 `briefing.json`、证据规则和已有基线，再按 `commit-tool-schema.json` 的 `patch` 字段定义准备结果。先写临时 JSON 文件，只包含 `README.txt` 中的 `briefingSha256` 和你的 `patch`，完成后再将其重命名为 `response.json`。命令会校验摘要，并通过同一会话和租约提交。它不调用模型，也不自动生成结果。空 patch 表示明确决定处理完本次资料但不增改任何 claim，请勿仅为消除报错而提交空 patch。

默认等待 20 分钟，`--timeout-seconds` 可设置为 1 至 1500 秒。超时、Ctrl+C、SIGTERM、响应格式错误或校验失败时，命令会尝试释放租约，供后续重试；强制杀死进程则需要等待租约过期。命令不会接管其他会话的有效租约。重试须使用新目录和新 briefing，旧响应无法通过摘要校验。

成功提交后会保留 `submission.json` 与 `result.json`；结果若为 suspended，仍需正常审核。若提示提交成功但回执写入失败，请用输出中的版本 ID 和请求 ID 查询结果，不要直接重复提交。提交结果不明确时也应先核实。

本地文件路径支持最多 4 MiB 的完整 briefing 和 999 个资料引用，不代表宿主 MCP 限制已提高，也不保证模型具备相应上下文容量。响应文件最多 256 KiB，原有 canonical patch 的 64 KiB 上限继续生效。不会裁剪、自动拆分或删除已存资料；超出引擎上限仍会明确失败。恢复目录不会自动清理。

## Remove the host integration

```bash
node packages/cli/lib/bin.js uninstall --host codex
```

This removes Distilly's verified host Plugin and runtime projection. It keeps `~/.distilly/` person data, source materials, profiles, and separately installed person Skills. A modified or foreign installation is left untouched and reported for manual review.

## OpenClaw and Hermes compatibility bindings

The Preview includes local lifecycle bindings for two additional hosts:

- **OpenClaw:** installs a Claude-compatible bundle at `~/.openclaw/extensions/distilly` with an owned `.mcp.json`. Verify discovery with `openclaw plugins inspect distilly --json`.
- **Hermes:** installs the canonical Skill at `~/.hermes/skills/distilly`, a managed wrapper at `~/.distilly/bin/distilly-hermes`, and the `distilly` MCP entry in `~/.hermes/config.yaml`. The optional `resources` and `prompts` surfaces are disabled; verify five tools with `hermes mcp test distilly`.

The CLI accepts `setup --host openclaw` and `setup --host hermes` when their installed versions match the recorded real-host transport fixtures: OpenClaw `2026.3.24` has a 65,536-byte net budget and Hermes `v0.9.0` has a 49,752-byte net budget. These measurements use a deterministic synthetic fixture server through the real host executable, `openai-codex/gpt-5.4`, and MCP transport in an isolated clean session; they prove the recorded briefing/tool-result path, not the complete packaged lifecycle. Unknown versions or changed release/tool tuples return `host_unsupported` before writing files. Setup never falls back to `dot-skill` automatically.

## Run the packaged preview

To assemble a distributable local directory instead of running from the checkout:

```bash
pnpm run package:preview:codex
./artifacts/distilly-0.1.0-preview.1-codex/distilly setup --host codex
./artifacts/distilly-0.1.0-preview.1-codex/distilly doctor --host codex
```

The artifact is local preview output; it is not an npm package or a tagged release.

## Verify the five-tool surface

After restarting Codex, confirm that the installed Plugin exposes exactly:

`distilly_get`, `distilly_ingest`, `distilly_pending`, `distilly_commit`, and `distilly_correct`.

The binding performs host preflight before starting MCP. If capacity evidence, the host version, or the release digest does not match, setup stops without writing an unverified integration.

## Legacy Skill compatibility for hosts without a verified Plugin binding

On a host without a verified Plugin binding, explicitly install the maintained `dot-skill` branch as a Legacy Skill instead of running Plugin setup:

```bash
git clone --single-branch --branch dot-skill --depth 1 \
  https://github.com/titanwings/distilly.git \
  <target-directory>
git -C <target-directory> rev-parse HEAD
```

Create its parent first, then use a new, empty target whose final directory is `distilly`:

| Host | Legacy Skill target |
| --- | --- |
| Claude Code | `~/.claude/skills/distilly` |
| OpenClaw | `~/.openclaw/workspace/skills/distilly` |
| Hermes | `~/.hermes/skills/openclaw-imports/distilly` |
| DeepSeek Harness (DSH) | `~/.dsh/skills/distilly` or `$DSH_HOME/skills/distilly` |
| Pi agent | `~/.pi/agent/skills/distilly` |
| Grok Build | `~/.grok/skills/distilly` |
| OpenCode | `~/.config/opencode/skills/distilly` |
| Grok Bot | No verified local repository import; migrate the workflow manually into a saved/private Skill |

Restart or rescan the host, verify that it discovers exactly one `distilly`, and keep the reported Git commit with any bug report. If another copy is already active in the same discovery scope, leave both copies untouched until you choose manually which one to disable or remove. This route is best-effort until each host receives a native, tested Plugin binding.

Legacy Skill mode is a separate file-based product line. It does not provide the Preview's SQLite authority, exact five MCP tools, Panel lifecycle, setup/doctor guarantees, or automatic migration. The CLI reports this guide for an unsupported non-Codex host request but never installs the Legacy Skill. Any Plugin setup or preflight failure remains fail-closed and never changes modes automatically.

For now, use local files or pasted text in Legacy Skill mode. Do not enable its older provider collectors while the Plugin uses the same home directory: those collectors can write credential configuration into the same `~/.distilly/` namespace, have not passed the Plugin security review, and must not be treated as interoperable with Plugin data. Never install from a working copy that contains private `knowledge/` or generated `skills/`; clone a clean copy directly into the target above.

## Local materials

The Preview's zero-configuration intake accepts explicit TXT, Markdown, JSON, and SRT/VTT files, pasted text, and user-selected public URLs. It does not crawl adjacent paths or silently read chat history. PDF, email containers, provider exports, and hosted source adapters are planned follow-up work.

For the product flow and community host work, see the [root README](README.md), [roadmap](ROADMAP.md), and [updates](UPDATES.md).
