# PR-05 · coding-agent 适配层：矩阵文档与防漂移断言

- 分支：`ds/05-agents`（基于 `dot-skill-test`）
- 交付：`docs/v2/HOSTS.md`、`tests/agents.test.mjs`、`scripts/check-agent-ids.mjs`、INSTALL/INSTALL_EN/README 的宿主章节
- 本文纯文字，无截图；证据目录 `dst-evidence/` 未入库（`.gitignore` 已含）

## 1. 变更

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | `test(v2): assert the host matrix and the installer's host table cannot drift` | `tests/agents.test.mjs`：解析 `bin/distilly.mjs` 的 `hosts` / `aliases` / `--help` 三处，与 `src/hosts/agents.mjs` 逐宿主比对；钉住 8 宿主、双语 note、CLI/clone 路线能力集合、`cloneCommand` 的项目级行为、命令串里不得回流旧仓库名 |
| 2 | `chore(scripts): add an optional upstream cliId check` | `scripts/check-agent-ids.mjs`：本机拿得到上游 CLI 时逐个实测 `--agent` 目标合法性；拿不到就 `skipped: upstream skills CLI unavailable` 且 exit 0（不进 CI、不联网安装） |
| 3 | `docs: point the per-host install sections at docs/v2/HOSTS.md` | `INSTALL.md` / `INSTALL_EN.md` 新增 "v2 入口与宿主适配" 节并给出 `bin/distilly.mjs` 用法；旧「选择你的平台 / Install Distilly」整节保留但标注 Deprecated；`README.md` 安装段改为指向 HOSTS.md，旧 clone 说明折叠进 `<details>` 并标注 deprecated |
| 4 | `docs(v2): add the bilingual host adaptation matrix` | `docs/v2/HOSTS.md`：中文段 → `---` → `## English`，8 宿主逐行给 id / 显示名 / 全局目录 / 项目级目录 / 能力 / **逐字命令** / 中英注意事项 / 怎么验证；另加"换宿主要改什么"与"未验证与已知缺口" |

矩阵本身的修正不在本分支：它由维护者在 `dot-skill-test` 的 `52d4050` 落地（见 §4），本分支只按修正后的事实用它。
`src/hosts/agents.mjs` 未被本分支改动。

## 2. 测试命令与结果

### 2.1 主断言

```
$ node --test tests/agents.test.mjs
ok 1 - matrix shape: 8 unique hosts, each with a global path and a bilingual note
ok 2 - bin/distilly.mjs hosts table matches the matrix host-for-host
ok 3 - only DeepSeek Harness lacks an AgentSkills CLI target, and its error names the clone route
ok 4 - cloneCommand("project") fails for global-only hosts and targets the documented dir
ok 5 - every emitted command uses the current repo and skill name
# tests 5 / pass 5 / fail 0
```

`node --test`（不指定文件）同样 5/5：本分支上 `tests/` 里目前只有这一个 `.mjs`，Python 测试由 ds/01 迁移。

逐条对应任务要求：

| 要求 | 落在哪条断言 | 结果 |
| --- | --- | --- |
| `AGENTS.length === 8`、id 唯一、每个有 `globalPath` 与非空双语 `note` | 1 | 通过 |
| `bin/distilly.mjs` 的 hosts 表与矩阵一一对应（含 `$DSH_HOME` / `~/.dsh` 等价） | 2 | 通过 |
| `skillsCliSupported('pi')`、严格模式抛错与"其余 7 个通过" | 3 | 通过（按修正后的事实：CLI 可用 7 个 = claude-code / codex / opencode / openclaw / hermes / grok-build / **pi**；clone-only 1 个 = **deepseek-harness**，严格模式抛错且错误信息含 `cloneCommand('deepseek-harness', 'global')`） |
| `cloneCommand(id,'project')`：无项目级目录的宿主抛错，其余指向该目录 | 4 | 通过（无项目级目录的只剩 **openclaw**；pi 在 `52d4050` 后有了 `.pi/skills/distilly`） |
| 命令串含 `titanwings/distilly`、`--skill distilly`、无旧仓库名 | 5 | 通过（同时禁止 `dot-skill`、`colleague-skill`、`python3 `） |

**与任务原始写法的偏差**（事实变了，不是放宽）：原要求写"`pi` 不支持、`openclaw` 和 `pi` 没有项目级目录"。维护者 `52d4050` 用上游注册表复核后，`pi` 是合法目标并补了项目级目录，`deepseek-harness` 才是唯一没有上游目标的宿主；测试按新事实写，能力集合大小仍是 7 + 1。

### 2.2 反向对照（证明断言真的会红）

把 `bin/distilly.mjs` 复制到 `/tmp/agents-mutation/` 做变异，测试文件与矩阵不动：

| 变异 | 结果 |
| --- | --- |
| A：安装器把 codex 写到 `~/.codex/skills/distilly` | `not ok 2`，`bin/distilly.mjs installs codex to ~/.codex/skills/distilly, the matrix says ~/.agents/skills/distilly`；4 pass / 1 fail |
| B：删掉安装器的 `openclaw` 条目 | `not ok 2`，`bin/distilly.mjs and src/hosts/agents.mjs must list the same hosts`；4 pass / 1 fail |

### 2.3 可选的 cliId 复核脚本

```
$ node scripts/check-agent-ids.mjs
skipped: upstream skills CLI unavailable
exit=0

$ SKILLS_CLI=<本地上游 cli.mjs> node scripts/check-agent-ids.mjs
upstream skills CLI: … v1.5.26
ok   claude-code        --agent claude-code
ok   codex              --agent codex
ok   opencode           --agent opencode
ok   openclaw           --agent openclaw
ok   hermes             --agent hermes-agent
ok   grok-build         --agent grok
ok   pi                 --agent pi
checked 7 cliId targets: 7 valid, 0 invalid
clone-only (no upstream target): deepseek-harness
exit=0
```

把矩阵里的 `grok` 改回 `grok-build` 再跑：`FAIL grok-build --agent grok-build`、`6 valid, 1 invalid`、exit 1 —— 失败路径有效。

### 2.4 上游复现命令

```
$ npx skills@1.5.26 ls -a grok              # exit 0，合法
$ npx skills@1.5.26 ls -a hermes-agent      # exit 0，合法
$ npx skills@1.5.26 ls -a pi                # exit 0，合法
$ npx skills@1.5.26 ls -a grok-build        # exit 1，Invalid agents: grok-build
$ npx skills@1.5.26 ls -a hermes            # exit 1，Invalid agents: hermes
$ npx skills@1.5.26 ls -a deepseek-harness  # exit 1，Invalid agents: deepseek-harness
```

本机实际执行的是同一份 `skills@1.5.26` 包离线解包后的 `node dist/cli.mjs ls -a <id>`（`HOME` 指向临时目录、`DISABLE_TELEMETRY=1`），输出与上表逐字一致；合法 id 全表在包内注册表
（`dist/cli.mjs` 的 `grok:` 定义、`hermes-agent:` 定义、`package.json` 的 keywords），非法 id 会打印 `Invalid agents: …` 并列出 `Valid agents:` 全表（78 项，其中没有 `grok-build` / `hermes` / `deepseek*` / `dsh`）。

## 3. 宿主表 before → after

### 3.1 文档里的宿主数量

| | 旧文档 | 现在 |
| --- | --- | --- |
| `README.md` 宿主墙 | 8 个（Claude Code / Hermes Agent / OpenClaw / Codex / DeepSeek Harness / Pi coding agent / Grok Build / OpenCode）+ Grok Bot 预览说明 | 不变（README 只改安装段） |
| `INSTALL.md`「兼容宿主」 | 8 个 | 不变，但顶部新增 v2 入口并整节标 Deprecated |
| `INSTALL_EN.md` 宿主表 | 8 行 | 不变，同上 |
| `src/hosts/agents.mjs` | 8 条 | 8 条（`52d4050` 只改 cliId 并给 Pi 补 `projectPath`，不增删宿主） |
| `docs/v2/HOSTS.md` | 不存在 | 8 行 × 8 列 + clone 路线表 + 换宿主指南 + 缺口表 |
| Grok Bot | 旧文档写「预览，不能一键安装」 | **仍然不在矩阵内**（依据 `INSTALL.md:292-296`），并在 HOSTS.md 里显式说明 |

**路径纠正：0 处。** 8 个宿主的 `globalPath` 与 `bin/distilly.mjs`（第 32–45 行）以及 `INSTALL.md` / `INSTALL_EN.md` 的原表**本来就一致**，本次没有发现路径级事实错误。旧文档里"或 `~/.agents/skills/distilly`"这类备选写法（Pi、Grok Build）没有删除，只是在矩阵里收敛为**一个 canonical 目标**：Pi=`~/.pi/agent/skills/distilly`、Grok Build=`~/.grok/skills/distilly`。

### 3.2 真正被纠正的是 cliId（维护者 `52d4050`）

矩阵注释自称 `cliId` 是"`--agent` target, only when confirmed"，但四个值对上游注册表不成立：

| 宿主 | before | after | 依据（上游 `skills@1.5.26`） |
| --- | --- | --- | --- |
| Hermes | `cliId: 'hermes'` ❌ | `'hermes-agent'` ✅ | `ls -a hermes` → `Invalid agents: hermes`；`ls -a hermes-agent` → exit 0 |
| Grok Build | `cliId: 'grok-build'` ❌ | `'grok'` ✅ | `ls -a grok-build` → `Invalid agents: grok-build`；`ls -a grok` → exit 0（该条目 displayName 就是 "Grok Build"，全局目录 `~/.grok/skills`，与矩阵 `globalPath` 一致） |
| Pi | 无 cliId，note 写"`--agent` 目标未确认" ❌ | `cliId: 'pi'` ✅，并补 `projectPath: '.pi/skills/distilly'` | `ls -a pi` → exit 0；注册表里项目级 `.pi/skills`、全局 `~/.pi/agent/skills` |
| DeepSeek Harness | `cliId: 'deepseek-harness'` ❌ | 删除 cliId → 仅 clone 路线 | 78 个合法目标里没有 DSH / deepseek；`ls -a deepseek-harness` → `Invalid agents:` |

影响：修正前 `skillsCliCommand('grok-build' | 'hermes' | 'deepseek-harness', …)` 会输出上游直接拒绝的 `--agent`，即文档承诺的命令跑不起来。修正后 7 个宿主严格模式通过、DSH 抛错并指向 `cloneCommand`。能力集合大小仍是 7 + 1，只是成员换了。

## 4. 已知缺口与未验证项

| # | 项 | 状态 | 依据 / 说明 |
| --- | --- | --- | --- |
| 1 | 8 个宿主"怎么验证装上了" | **未在真机复核** | 本机 `PATH` 无 claude / opencode / openclaw / hermes / pi / grok；只有 `/opt/homebrew/bin/codex`（`codex-cli 0.146.0`），实测 `codex --help` 没有 `skills` 子命令，所以 Codex 只能进会话看 `/skills`。HOSTS.md 的验证列全部来自本仓库文档并逐条标注行号 |
| 2 | Codex 全局目录到底是 `~/.agents/skills` 还是 `~/.codex/skills` | **未定论，本 PR 不改** | 本矩阵、`INSTALL.md:213`、`bin/distilly.mjs:38` 一致写 `~/.agents/skills`；上游 `skills@1.5.26` 把 `.agents/skills` 当共享发现目录（出现 38 次），但它自己的 `codex` 条目 `globalSkillsDir = $CODEX_HOME/skills`（默认 `~/.codex/skills`，`dist/cli.mjs:1352`、`1530`）。要改必须同时动 `bin/distilly.mjs`（牵动 ds/01 安装器与 CI）→ **follow-up 建议**：由一个能开真 codex 会话的分支实测"装到 `~/.agents/skills` 能否被 Codex 发现"，有结论后再决定是否统一三个目标 |
| 3 | Hermes CLI 路线的落点 | **未验证** | 上游 `hermes-agent` 全局目录是 `~/.hermes/skills`，本矩阵 `globalPath` 是 `~/.hermes/skills/openclaw-imports/distilly`（`INSTALL_EN.md:66`、`tools/install_hermes_skill.py:48`）。两条路线可能落在同一 skills 根的不同子目录，没在真机 `hermes skills list` 里比对过 |
| 4 | `npx skills add` 真机安装后宿主是否真的发现 | **未验证** | 仓库里没有 AgentSkills CLI 真机安装记录；矩阵只保证"目标是上游合法 `--agent` 值" |
| 5 | `claude plugin list` | **未验证 / 可能不适用** | 无 `claude` 可执行文件；且 clone 安装的 Skill 不是 Claude Code 插件，这条命令能否列出它没有依据，HOSTS.md 里明确标"未验证" |
| 6 | `npm test` 汇总入口 | 本分支没有 | `package.json` 目前只有 `prepack`，`npm test` 由 ds/01 落地；本 PR 的验收命令是 `node --test tests/agents.test.mjs` |
| 7 | 上游 `--agent` 改名风险 | 已缓解，未进 CI | `scripts/check-agent-ids.mjs` 可本地复核；按约定不进 CI、不联网安装，因此不会在上游改名时自动报警 |

## 5. 回滚

按提交逆序 revert 即可，互不依赖：

```
git revert a06e5ef   # docs(v2): HOSTS.md
git revert e7700d9   # docs: INSTALL/INSTALL_EN/README 宿主章节
git revert 7c095ea   # chore(scripts): check-agent-ids.mjs
git revert 7b24bde   # test(v2): tests/agents.test.mjs
```

- 只回滚文档、测试与可选脚本，不动 `src/hosts/agents.mjs`、`bin/distilly.mjs` 或任何运行时路径，宿主安装行为不变。
- 若只想撤销"指向 HOSTS.md"，revert `e7700d9` 一处即可：INSTALL/INSTALL_EN/README 会回到旧的按平台说明。
- 矩阵修正 `52d4050` 在集成分支上，回滚它需要单独 revert；本分支不依赖它的提交历史，只依赖它的字段值。
