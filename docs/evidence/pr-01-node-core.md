# PR-01 · Node 单栈基座：入口 CLI + Skill 内核 + 安装器 + 拼音 + 测试移植

- 分支：`ds/01-node-core`（12 个提交，已本地合并进 `dot-skill-test`）
- 依赖：无。这一条是并行工作的基座：契约、命令注册表、验收脚本都由它落下来
- 交付：38 个文件 / +11 050 行

## 1. 变更

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | `c383fca` | `src/skill/writer.mjs` + `src/skill/slug.mjs`：Python `skill_writer.py` 的 Node 移植，含拼音 slug |
| 2 | `3337c39` | `src/skill/versions.mjs`：版本归档（list / backup / rollback / cleanup），归档时间戳按 UTC 固定 |
| 3 | `579b159` | 归档列表确定性：同一天两次 `version list` 输出一致 |
| 4 | `f94675d` | `scripts/parity.mjs`：与迁移前 Python 的**逐字节 parity** 证据（按 rev 跑，不进日常门禁） |
| 5 | `441ceaf` | `src/commands/skill.mjs`：`skill create\|update\|list\|version` 接进注册表 |
| 6 | `9ebfa6e` | `src/install/hosts.mjs`：8 个宿主安装器合并成一个模块（路径矩阵单一出处） |
| 7 | `3436730` | 安装器测试移植到 `node --test`（claude / codex / openclaw / hermes） |
| 8 | `43c837e` | 已注册命令的 `--help` 打印双语两段 |
| 9 | `f6dcf87` | `listCommands()` 暴露命令名（供 doctor / prompt-lint / 审计共用） |
| 10 | `f97bc0c` | `install` / `uninstall` / `doctor` / `legacy` 适配器（旧 `python3 tools/*.py` 调用转发 + deprecation 警告） |
| 11 | `28b0c32` | `assets/pinyin.json`：从 Unihan 生成，去掉 `pypinyin` 运行时依赖 |
| 12 | `1da31aa` | 其余 Python 测试套件移植为 `node --test` |

新增文件（节选）：`src/commands/{index,skill,install,doctor,legacy}.mjs`、`src/cli/{args,receipt}.mjs`、
`src/skill/{writer,presets,schema,slug,versions}.mjs`、`src/install/hosts.mjs`、`src/hosts/agents.mjs`、
`assets/pinyin.json`、`scripts/{generate-pinyin,parity,acceptance}.mjs`、`docs/v2/{CONTRACT,ACCEPTANCE,STATUS}.md`、
`tests/{dispatcher,commands,cli-lifecycle,skill-writer,pinyin-slug,install-*}.test.mjs`、
公开语料夹具 `tests/fixtures/public-corpus/synthetic-interview/**`。

## 2. 验收（当前树，可复算）

```bash
node --test tests/dispatcher.test.mjs tests/commands.test.mjs tests/cli-lifecycle.test.mjs \
            tests/skill-writer.test.mjs tests/pinyin-slug.test.mjs tests/install-*.test.mjs
# 33 个测试文件、330 个 test() 块：node --test tests/*.test.mjs → 340 pass / 0 fail
node bin/distilly.mjs --help          # 22 个命令名，全部有中英两段
node bin/distilly.mjs doctor          # 宿主矩阵 8 个宿主，逐个报告是否已安装
node scripts/parity.mjs <pre-migration-rev>   # 历史 parity 证据（需要旧 rev）
```

要点：**零运行时依赖**（`package.json` 无 dependencies）；入口唯一（`bin/distilly.mjs`）；
`--json` 在任何命令上只输出一个对象（`tests/dispatcher.test.mjs` 断言）；
命令注册表是唯一注册点，两段式命令名优先（`skill create` 赢过 `skill`）。

## 3. 回滚

- 逐提交可 revert；`src/commands/legacy.mjs` 单独 revert 会让旧 `tools/*.py` 调用直接报未知命令。
- `assets/pinyin.json` 是生成物：`node scripts/generate-pinyin.mjs` 可重现（`--check` 防漂移）。

## 4. 已知缺口

- `scripts/parity.mjs` 需要一份迁移前的 rev 才能跑：parity 是历史证据，不是日常门禁。
- 这一条只交付 skill/install/doctor 内核；`harvest` / `parse-*` / `view` / `collect` 由 #02/#03/#07 交付。
