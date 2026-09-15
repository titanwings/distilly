# 宿主适配：装到哪个宿主、哪个目录、怎么验

> **v2 的唯一入口是 `bin/distilly.mjs`。** 安装用 `node bin/distilly.mjs install <host>`（或下面的
> AgentSkills CLI / clone 一行命令）；**不要再手动执行 `python3 tools/*.py`** —— 那些安装器只在
> 迁移期兼容，已标注 deprecated（见 [INSTALL.md](../../INSTALL.md#deprecated-python-installers)）。
>
> 本文只描述**已确认**的事实。任何没有依据的路径或命令都标"未验证"，并汇总在
> §4 与 `docs/evidence/pr-05-agents.md`。

---

## 0. 事实来源与防漂移

| 位置 | 角色 |
| --- | --- |
| `src/hosts/agents.mjs` | **唯一事实来源**：`AGENTS` / `listAgents()` / `getAgent()` / `skillsCliSupported()` / `skillsCliCommand()` / `cloneCommand()`。本文所有命令都是这些函数的**逐字产物** |
| `bin/distilly.mjs`（`hosts` 表） | 安装器**真正写入**的绝对路径。与矩阵是两份手写清单 |
| `tests/agents.test.mjs` | 强制上面两份清单逐宿主一致（含 `$DSH_HOME` / `~/.dsh` 等价），并断言命令里不出现旧仓库名 |
| 本文档 | 人类可读的渲染结果；**不要**在这里发明新路径 |

两条安装路线：

1. **AgentSkills CLI** —— `npx -y skills add titanwings/distilly --skill distilly --agent <id> …`
2. **直接 clone** —— 克隆到宿主扫描的目录；上游没有 `--agent` 目标时这是唯一路线

`cliId` 与我们的宿主 id **不一定同名**：上游注册表里 Grok Build 是 `grok`、Hermes 是 `hermes-agent`。
矩阵里的每个 `cliId` 都已对上游 `skills@1.5.26` 注册表核对过，复核脚本：`node scripts/check-agent-ids.mjs`。

## 1. 宿主矩阵（8 个）

`能力`：`full` = 宿主能读文件、能跑 shell 命令，完整的 `collect → derive → read → distill → render` 流程都适用。
当前 8 个宿主全部是 `full`（没有降级项）。

| id | 显示名 | 全局安装目录 | 项目级目录 | 能力 | 确切安装命令（逐字） | 注意事项 | 怎么验证装上了 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | `~/.claude/skills/distilly` | `.claude/skills/distilly` | full | 全局：`npx -y skills add titanwings/distilly --skill distilly --agent claude-code --global --copy --yes`<br>项目：`npx -y skills add titanwings/distilly --skill distilly --agent claude-code` | 安装后会被自动发现，可直接说"把这段聊天蒸馏成 Skill"。（依据：`agents.mjs` 的 note；调用语法 `INSTALL.md:46`） | 目录下存在 `SKILL.md`；在 Claude Code 里输入 `/distilly`（`INSTALL.md:46`）。`claude plugin list` **未验证**：本机没有 `claude` 可执行文件，且 clone 安装不是插件 |
| `codex` | Codex CLI | `~/.agents/skills/distilly` | `.agents/skills/distilly` | full | 全局：`npx -y skills add titanwings/distilly --skill distilly --agent codex --global --copy --yes`<br>项目：`npx -y skills add titanwings/distilly --skill distilly --agent codex` | Codex 扫描 `~/.agents/skills`；旧版 `~/.codex/skills` 需手动迁移。`~/.codex/skills` 是**旧路径 / 项目级候选**，本矩阵不写它（`INSTALL.md:177`） | 用 `$distilly` 显式调用，或在会话里用 `/skills` 选择（`INSTALL.md:65`、`INSTALL.md:177`）。`codex-cli 0.146.0` 没有 `skills` 子命令（实测 `codex --help`），所以只能进会话看 |
| `opencode` | opencode | `~/.config/opencode/skills/distilly` | `.opencode/skills/distilly` | full | 全局：`npx -y skills add titanwings/distilly --skill distilly --agent opencode --global --copy --yes`<br>项目：`npx -y skills add titanwings/distilly --skill distilly --agent opencode` | 同时兼容 `~/.agents/skills` 与项目级 `.opencode/skills` | 目录存在 `SKILL.md`；由原生 Skill 工具按需加载，**没有独立 slash 命令**（`INSTALL.md:69`），所以没有可引用的列举命令 —— **未验证** |
| `openclaw` | OpenClaw | `~/.openclaw/workspace/skills/distilly` | 用户自定义，未确认 | full | 全局：`npx -y skills add titanwings/distilly --skill distilly --agent openclaw --global --copy --yes` | Skill 目录即工作区子目录，装完重开 session 生效；项目级目录由用户在 OpenClaw 内自定义，本文档不猜路径（因此没有项目级命令） | 重开 session 后用 `/distilly`；当前 channel 未注册 native slash 时用 `/skill distilly`（`INSTALL.md:64`、`INSTALL.md:134`） |
| `hermes` | Hermes | `~/.hermes/skills/openclaw-imports/distilly` | `.hermes/skills/distilly` | full | 全局：`npx -y skills add titanwings/distilly --skill distilly --agent hermes-agent --global --copy --yes`<br>项目：`npx -y skills add titanwings/distilly --skill distilly --agent hermes-agent` | 默认装在 Hermes 的 `openclaw-imports` 目录；项目级安装需先在该目录运行 `hermes skills trust`。注意 `cliId` 是 `hermes-agent` 而不是 `hermes` | `hermes skills list \| rg distilly`（`INSTALL.md:144`）；会话里用 `/distilly`。⚠️ CLI 路线由上游决定落点，可能不是 `openclaw-imports` 子目录 —— 见 §4 |
| `deepseek-harness` | DeepSeek Harness | `$DSH_HOME/skills/distilly`（未设置 `DSH_HOME` 时等价于 `~/.dsh/skills/distilly`） | `.dsh/skills/distilly` | full | clone（唯一路线）：`git clone https://github.com/titanwings/distilly $DSH_HOME/skills/distilly`<br>项目：`git clone https://github.com/titanwings/distilly .dsh/skills/distilly` | 社区集成，非官方 DeepSeek 产品。**上游 AgentSkills CLI 没有 DSH 目标**，所以本工具不输出 `--agent` 命令（`skillsCliCommand(..., {requireVerified:true})` 会抛错并指向 clone 路线） | 目录存在 `SKILL.md`；输入 `/distilly`，或直接要求 Agent 启动 Distilly（`INSTALL.md:195`） |
| `grok-build` | Grok Build | `~/.grok/skills/distilly` | `.grok/skills/distilly` | full | 全局：`npx -y skills add titanwings/distilly --skill distilly --agent grok --global --copy --yes`<br>项目：`npx -y skills add titanwings/distilly --skill distilly --agent grok` | 与 `~/.agents/skills` 共用发现目录。注意 `cliId` 是 `grok` 而不是 `grok-build` | 目录存在 `SKILL.md`；显式调用 `/distilly`（`INSTALL.md:233`）。Grok Bot（预览）**不在**本矩阵内：官方文档没有本地 `SKILL.md` 导入说明（`INSTALL.md:256-260`） |
| `pi` | Pi | `~/.pi/agent/skills/distilly` | `.pi/skills/distilly` | full | 全局：`npx -y skills add titanwings/distilly --skill distilly --agent pi --global --copy --yes`<br>项目：`npx -y skills add titanwings/distilly --skill distilly --agent pi` | 上游 AgentSkills CLI 的合法目标（项目级 `.pi/skills`、全局 `~/.pi/agent/skills`） | 目录存在 `SKILL.md`；显式命令是 `/skill:distilly`，**不是** `/distilly`（`INSTALL.md:215`） |

**通用检查**：任何宿主装完都可以先看文件在不在 —— `ls <全局安装目录>/SKILL.md`。
上表的"怎么验证"来自本仓库文档，**没有一台真机复核**（本机 `PATH` 里没有 claude / opencode / openclaw /
hermes / pi / grok，只有 `/opt/homebrew/bin/codex` 的 `codex-cli 0.146.0`）；逐条状态见 §4。

## 2. clone 路线（备用，逐字）

AgentSkills CLI 拿不到、或不想用 `npx` 时，直接用矩阵的 `cloneCommand()` 产物：

| id | 全局 | 项目级 |
| --- | --- | --- |
| `claude-code` | `git clone https://github.com/titanwings/distilly ~/.claude/skills/distilly` | `git clone https://github.com/titanwings/distilly .claude/skills/distilly` |
| `codex` | `git clone https://github.com/titanwings/distilly ~/.agents/skills/distilly` | `git clone https://github.com/titanwings/distilly .agents/skills/distilly` |
| `opencode` | `git clone https://github.com/titanwings/distilly ~/.config/opencode/skills/distilly` | `git clone https://github.com/titanwings/distilly .opencode/skills/distilly` |
| `openclaw` | `git clone https://github.com/titanwings/distilly ~/.openclaw/workspace/skills/distilly` | 无（`cloneCommand('openclaw','project')` 抛错） |
| `hermes` | `git clone https://github.com/titanwings/distilly ~/.hermes/skills/openclaw-imports/distilly` | `git clone https://github.com/titanwings/distilly .hermes/skills/distilly` |
| `deepseek-harness` | `git clone https://github.com/titanwings/distilly $DSH_HOME/skills/distilly` | `git clone https://github.com/titanwings/distilly .dsh/skills/distilly` |
| `grok-build` | `git clone https://github.com/titanwings/distilly ~/.grok/skills/distilly` | `git clone https://github.com/titanwings/distilly .grok/skills/distilly` |
| `pi` | `git clone https://github.com/titanwings/distilly ~/.pi/agent/skills/distilly` | `git clone https://github.com/titanwings/distilly .pi/skills/distilly` |

> clone 出来的目录名必须保持 `distilly`：`bin/distilly.mjs install --path <p>` 会拒绝不以 `distilly` 结尾的路径
> （`bin/distilly.mjs:105`）。

## 3. 换宿主要改什么

`src/hosts/agents.mjs` 是唯一事实来源；新增一个宿主 = 改这一个文件 + 补三处下游副本。顺序如下：

1. **`src/hosts/agents.mjs`** —— 往 `AGENTS` 里加一条，字段：
   - `id`（必填）：宿主 id，也是 `install <host>` 的参数；
   - `label`（必填）：显示名；
   - `globalPath`（必填）：宿主扫描的全局目录，**必须以 `/distilly` 结尾**；
   - `projectPath`（可选）：**只有宿主文档确实定义了项目级目录才写**；没有就不写，`cloneCommand(id,'project')` 会拒绝；
   - `capability`（必填）：`full` 或 `prompt-only`（后者要说明为什么降级）；
   - `note`（必填）：`{zh, en}` 两段都非空；
   - `cliId`（可选）：**只有上游 AgentSkills CLI 注册表里真有这个目标才写**，并且值可能与 `id` 不同
     （`grok-build` → `grok`、`hermes` → `hermes-agent`）。写法：`npx skills ls -a <id>`，或本地
     `node scripts/check-agent-ids.mjs`。
2. **`bin/distilly.mjs`** —— 三处：`hosts` 表（`() => join(homedir(), …)` 绝对路径）、`Hosts:` 帮助文本、
   需要的话再加 `aliases`。**测试会强制这三处与矩阵一致**，漏一处就红。
3. **`tools/install_generated_skill.py`** —— `HOST_DEFAULT_PARTS`（生成的**人物 Skill** 装到哪；与创建器
   Skill 的目录是两回事：Hermes 用 `distilly-generated`，其余同一 skills 根）。
4. **文档** —— `INSTALL.md` / `INSTALL_EN.md` 的迁移表与生成 Skill 表、`README.md` 的安装段，以及本文件。
5. **验收** —— `node --test tests/agents.test.mjs`；可选 `node scripts/check-agent-ids.mjs`（要本机有上游 CLI，
   没有就打印 `skipped: upstream skills CLI unavailable` 并 exit 0）。

## 4. 未验证与已知缺口

| 项 | 状态 | 依据 |
| --- | --- | --- |
| 8 个宿主"怎么验证装上了"的命令 | **未在真机复核** | 本机 `PATH` 无 claude / opencode / openclaw / hermes / pi / grok；`codex` 只有 `--help` 可用（`codex-cli 0.146.0`，无 `skills` 子命令）。映射来自 `INSTALL.md` |
| Codex 全局目录 `~/.agents/skills` | **已由上游注册表复核，成立** | 上游 `skills@1.5.26` 注册表里 `.agents/skills` 是共享发现目录（38 次），`.codex/skills` 只作为旧路径/项目级候选出现（2 次）。与 `INSTALL.md:177`、`bin/distilly.mjs:38` 一致，**不要**改这三个目标 |
| Hermes 的 CLI 路线落点 | **未验证** | `hermes-agent` 的全局目录在上游注册表里是 `~/.hermes/skills`，而本矩阵的 `globalPath` 是 `~/.hermes/skills/openclaw-imports/distilly`（`INSTALL_EN.md:66`、`tools/install_hermes_skill.py:48` 的默认值）。两条路线可能落在同一 skills 根的不同子目录 |
| `npx skills add` 在宿主里的实际发现结果 | **未验证** | 本仓库没有记录过 AgentSkills CLI 真机安装的证据；矩阵只保证"目标是上游合法 `--agent` 值" |
| Grok Bot | **不支持** | 官方文档没有本地 `SKILL.md` 导入说明（`INSTALL.md:256-260`），故意不进矩阵 |

---

## English

> **`bin/distilly.mjs` is the v2 entrypoint.** Install with
> `node bin/distilly.mjs install <host>`, or with one of the one-liners below.
> Do **not** run `python3 tools/*.py` by hand any more — those installers are
> migration-era compatibility only and are marked deprecated
> (see [INSTALL_EN.md](../../INSTALL_EN.md#deprecated-python-installers)).
>
> Everything here is sourced; anything unconfirmed is labelled "unverified" and
> collected in §4 and `docs/evidence/pr-05-agents.md`.

### Source of truth

| Location | Role |
| --- | --- |
| `src/hosts/agents.mjs` | **Single source of truth**: `AGENTS`, `listAgents()`, `getAgent()`, `skillsCliSupported()`, `skillsCliCommand()`, `cloneCommand()`. Every command below is a verbatim product of those functions |
| `bin/distilly.mjs` (`hosts` map) | The absolute paths the installer writes to. A second hand-written copy |
| `tests/agents.test.mjs` | Forces the two copies to agree host-for-host (including `$DSH_HOME` / `~/.dsh` equivalence) and forbids stale repository names in any command |
| This file | The human-readable rendering — never invent a path here |

`cliId` is the upstream `--agent` value and does not always equal our host id:
upstream calls Grok Build `grok` and Hermes `hermes-agent`. Every `cliId` was
checked against the `skills@1.5.26` registry; re-check locally with
`node scripts/check-agent-ids.mjs`.

### The matrix (8 hosts)

`capability: full` means the host can read files and run shell commands, so the
whole `collect → derive → read → distill → render` workflow applies. All eight
hosts are `full` today; nothing is degraded.

| id | Display name | Global directory | Project directory | Capability | Exact install command (verbatim) | Notes | How to verify it is installed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | `~/.claude/skills/distilly` | `.claude/skills/distilly` | full | global: `npx -y skills add titanwings/distilly --skill distilly --agent claude-code --global --copy --yes`<br>project: `npx -y skills add titanwings/distilly --skill distilly --agent claude-code` | Discovered automatically once installed; just ask it to distill a conversation (`INSTALL.md:46`) | `SKILL.md` exists in the directory; type `/distilly` in Claude Code (`INSTALL.md:46`). `claude plugin list` is **unverified** — no `claude` executable on this machine, and a clone install is not a plugin |
| `codex` | Codex CLI | `~/.agents/skills/distilly` | `.agents/skills/distilly` | full | global: `npx -y skills add titanwings/distilly --skill distilly --agent codex --global --copy --yes`<br>project: `npx -y skills add titanwings/distilly --skill distilly --agent codex` | Codex scans `~/.agents/skills`; `~/.codex/skills` is the legacy / project-level candidate and is deliberately not used here (`INSTALL.md:177`) | `$distilly`, or pick it from `/skills` in a session (`INSTALL.md:65`, `INSTALL.md:177`). `codex-cli 0.146.0` has no `skills` subcommand (checked with `codex --help`), so this has to be done inside a session |
| `opencode` | opencode | `~/.config/opencode/skills/distilly` | `.opencode/skills/distilly` | full | global: `npx -y skills add titanwings/distilly --skill distilly --agent opencode --global --copy --yes`<br>project: `npx -y skills add titanwings/distilly --skill distilly --agent opencode` | Also reads `~/.agents/skills` and the project-local `.opencode/skills` | `SKILL.md` exists; loaded on demand by the native Skill tool with **no dedicated slash command** (`INSTALL.md:69`), so there is no list command to quote — **unverified** |
| `openclaw` | OpenClaw | `~/.openclaw/workspace/skills/distilly` | user-defined, unconfirmed | full | global: `npx -y skills add titanwings/distilly --skill distilly --agent openclaw --global --copy --yes` | The Skill directory lives inside the workspace; reopen the session after install. Project-local paths are user-defined in OpenClaw, so none is claimed here (hence no project command) | Reopen the session and use `/distilly`, or `/skill distilly` when native slash commands are not registered (`INSTALL.md:64`, `INSTALL.md:134`) |
| `hermes` | Hermes | `~/.hermes/skills/openclaw-imports/distilly` | `.hermes/skills/distilly` | full | global: `npx -y skills add titanwings/distilly --skill distilly --agent hermes-agent --global --copy --yes`<br>project: `npx -y skills add titanwings/distilly --skill distilly --agent hermes-agent` | Installs into Hermes' `openclaw-imports` directory; project-local installs need `hermes skills trust` there first. Note the `cliId` is `hermes-agent`, not `hermes` | `hermes skills list \| rg distilly` (`INSTALL.md:144`); `/distilly` in a session. ⚠️ the CLI route's destination is decided upstream and may not be the `openclaw-imports` subdirectory — see §4 |
| `deepseek-harness` | DeepSeek Harness | `$DSH_HOME/skills/distilly` (same as `~/.dsh/skills/distilly` when `DSH_HOME` is unset) | `.dsh/skills/distilly` | full | clone (the only route): `git clone https://github.com/titanwings/distilly $DSH_HOME/skills/distilly`<br>project: `git clone https://github.com/titanwings/distilly .dsh/skills/distilly` | Community integration, not an official DeepSeek product. **The upstream AgentSkills CLI has no DSH target**, so no `--agent` command is emitted (`skillsCliCommand(..., {requireVerified:true})` throws and points at the clone route) | `SKILL.md` exists; type `/distilly`, or ask the Agent to start Distilly (`INSTALL.md:195`) |
| `grok-build` | Grok Build | `~/.grok/skills/distilly` | `.grok/skills/distilly` | full | global: `npx -y skills add titanwings/distilly --skill distilly --agent grok --global --copy --yes`<br>project: `npx -y skills add titanwings/distilly --skill distilly --agent grok` | Shares the `~/.agents/skills` discovery directory. Note the `cliId` is `grok`, not `grok-build` | `SKILL.md` exists; invoke `/distilly` (`INSTALL.md:233`). Grok Bot (preview) is **not** in this matrix: its docs describe no local `SKILL.md` import (`INSTALL.md:256-260`) |
| `pi` | Pi | `~/.pi/agent/skills/distilly` | `.pi/skills/distilly` | full | global: `npx -y skills add titanwings/distilly --skill distilly --agent pi --global --copy --yes`<br>project: `npx -y skills add titanwings/distilly --skill distilly --agent pi` | A valid upstream AgentSkills target (project `.pi/skills`, global `~/.pi/agent/skills`) | `SKILL.md` exists; the explicit command is `/skill:distilly`, **not** `/distilly` (`INSTALL.md:215`) |

**Common check:** whatever the host, start with `ls <global directory>/SKILL.md`.
The verification commands above come from this repository's own docs and were
**not replayed on a real host** (this machine has no claude / opencode /
openclaw / hermes / pi / grok on `PATH`; only `/opt/homebrew/bin/codex`,
`codex-cli 0.146.0`). See §4 for the per-row status.

### Clone route (fallback, verbatim)

| id | Global | Project |
| --- | --- | --- |
| `claude-code` | `git clone https://github.com/titanwings/distilly ~/.claude/skills/distilly` | `git clone https://github.com/titanwings/distilly .claude/skills/distilly` |
| `codex` | `git clone https://github.com/titanwings/distilly ~/.agents/skills/distilly` | `git clone https://github.com/titanwings/distilly .agents/skills/distilly` |
| `opencode` | `git clone https://github.com/titanwings/distilly ~/.config/opencode/skills/distilly` | `git clone https://github.com/titanwings/distilly .opencode/skills/distilly` |
| `openclaw` | `git clone https://github.com/titanwings/distilly ~/.openclaw/workspace/skills/distilly` | none (`cloneCommand('openclaw','project')` throws) |
| `hermes` | `git clone https://github.com/titanwings/distilly ~/.hermes/skills/openclaw-imports/distilly` | `git clone https://github.com/titanwings/distilly .hermes/skills/distilly` |
| `deepseek-harness` | `git clone https://github.com/titanwings/distilly $DSH_HOME/skills/distilly` | `git clone https://github.com/titanwings/distilly .dsh/skills/distilly` |
| `grok-build` | `git clone https://github.com/titanwings/distilly ~/.grok/skills/distilly` | `git clone https://github.com/titanwings/distilly .grok/skills/distilly` |
| `pi` | `git clone https://github.com/titanwings/distilly ~/.pi/agent/skills/distilly` | `git clone https://github.com/titanwings/distilly .pi/skills/distilly` |

> The cloned directory must stay named `distilly`: `bin/distilly.mjs install --path <p>`
> rejects any path that does not end in `distilly` (`bin/distilly.mjs:105`).

### Adding a host

`src/hosts/agents.mjs` is the single source of truth. Adding a host means one
entry there plus three downstream copies:

1. **`src/hosts/agents.mjs`** — append to `AGENTS`: `id` (also the
   `install <host>` argument), `label`, `globalPath` (must end in `/distilly`),
   optional `projectPath` (**only** when the host documents one; otherwise
   `cloneCommand(id,'project')` must refuse), `capability`
   (`full`, or `prompt-only` with a written reason), a non-empty bilingual
   `note`, and `cliId` **only** when the upstream AgentSkills CLI registry really
   has that target (`npx skills ls -a <id>`, or `node scripts/check-agent-ids.mjs`).
2. **`bin/distilly.mjs`** — three places: the `hosts` map, the `Hosts:` help
   text, and optionally `aliases`. The test enforces all three.
3. **`tools/install_generated_skill.py`** — `HOST_DEFAULT_PARTS` (where generated
   **person** Skills go; note Hermes uses `distilly-generated`, not the creator's
   directory).
4. **Docs** — the migration and generated-Skill tables in `INSTALL.md` /
   `INSTALL_EN.md`, the install section of `README.md`, and this file.

Acceptance: `node --test tests/agents.test.mjs`.

### Unverified and known gaps

| Item | Status | Basis |
| --- | --- | --- |
| Every "how to verify it is installed" command | **not replayed on a real host** | No claude / opencode / openclaw / hermes / pi / grok on this machine's `PATH`; only `codex` (`codex-cli 0.146.0`, and it has no `skills` subcommand). The commands map to `INSTALL.md` |
| Codex global directory `~/.agents/skills` | **kept as documented; upstream says otherwise, not settled on a real host** | The matrix, `INSTALL.md:213` and `bin/distilly.mjs:38` all say `~/.agents/skills`, and upstream `skills@1.5.26` treats `.agents/skills` as a shared discovery directory (38 occurrences). But upstream's own `codex` entry sets `globalSkillsDir` to `$CODEX_HOME/skills` (default `~/.codex/skills`; `dist/cli.mjs:1352`, `1530`), and `.codex/skills` otherwise appears only in candidate-search lists (2 occurrences). The two claims are not equivalent; changing it would also require `bin/distilly.mjs` (and therefore ds/01's installer), so this PR records it as a follow-up instead |
| Hermes CLI route destination | **unverified** | Upstream puts `hermes-agent`'s global directory at `~/.hermes/skills`, while this matrix's `globalPath` is `~/.hermes/skills/openclaw-imports/distilly` (`INSTALL_EN.md:66`, the default in `tools/install_hermes_skill.py:48`). The two routes may land in different subdirectories of the same skills root |
| What `npx skills add` actually makes a host discover | **unverified** | The repository records no real-host AgentSkills CLI install; the matrix only guarantees that each target is a valid upstream `--agent` value |
| Grok Bot | **not supported** | Its docs describe no local `SKILL.md` import (`INSTALL.md:292-296`), so it is deliberately absent from the matrix |
