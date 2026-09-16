# dot-skill v2 · 当前状态

> 这份文件是**这一支的权威状态说明**：现在能做什么、怎么验、哪些还没做到。
> 最后更新：2026-09-15（集成分支 `dot-skill-test`）。
> 契约 `docs/v2/CONTRACT.md` · 验收 `docs/v2/ACCEPTANCE.md` · 渲染 `docs/v2/RENDER.md` ·
> 提示词 `docs/v2/PROMPTS.md` · 宿主矩阵 `docs/v2/HOSTS.md` · 迁移 `docs/v2/MIGRATION.md`。
> 各功能的交付说明与前后对比在 `docs/evidence/pr-NN-*.md`。

## 1. 这是什么

把原材料（聊天导出、邮件、字幕、文档、归档、需要 key 的渠道）蒸馏成一个**可调用的人物
Skill**，外加一份**每条结论都能回指到原文**的画像页。

| 交付物 | 路径 | 说明 |
| --- | --- | --- |
| 人物 Skill | `skills/<family>/<slug>/SKILL.md`（+ `work.md` `persona.md` `work_skill.md` `persona_skill.md` `manifest.json` `meta.json`） | 可装进宿主直接运行；Part A 工作能力 + Part B 人物性格（Layer 0–5） |
| 画像页 | `views/<slug>.html` + `evidence/renders/receipt.json` | 单文件、离线、双主题；每条结论带 `[k00NN]` 锚点 |

三个 family：`colleague` / `relationship` / `celebrity`。
八个宿主：`claude-code` `codex` `opencode` `openclaw` `hermes` `deepseek-harness` `grok-build` `pi`。

**护城河不是"像不像"，是"凭什么这么说"**：每条结论可回指到原文的字节区间，派生可复跑
（同一输入两次字节相同），产物被机械门禁压住。

## 2. 主线：五步

`Collect → Derive → Read → Distill → Render`（细则见 `SKILL.md`）

| 步骤 | 产物 | 机械保证 |
| --- | --- | --- |
| 1 Collect | `knowledge/raw/**`、`knowledge/text/*.md`、`knowledge/index.json` | 回执 + 幂等 + 账本 sha256 |
| 1.5 语料体检 | 无新文件，`doctor` 回执里的 `shape[]` | **前置门槛**：`distilly doctor --require-shape`；`verdict=FAIL` 时必须停下并给出理由 |
| 2 Derive | `evidence/derived/*.json`（7 个维度） | 两次运行字节相同 + 派生锚点全部可回指 |
| 3 Read | 无新文件，产出"读了什么"的复述 | **靠提示词约束，无机械门禁**（已知缺口 7.2） |
| 4 Distill | `work.md`、`persona.md` → `distilly skill create` | **产物已进验收**：产物齐 / Layer 0–5 齐 / 悬空锚点=0 |
| 5 Render | `views/<slug>.view.json`、`views/<slug>.html`、`evidence/renders/receipt.json` | view check + 两次渲染字节相同 + 单文件无外链 + CSP + visual-check 8 项 |

## 3. 怎么跑

```bash
# 零依赖：Node >= 20，无运行时 npm 依赖
node bin/distilly.mjs <子命令>            # 唯一入口（该文件也带可执行位）

# 宿主里（以 DeepSeek Harness 为例）
node bin/distilly.mjs install deepseek-harness      # → $DSH_HOME/skills/distilly
# DSH 会 watch 技能目录，装完即被发现（实测同一会话内生效）；
# Skill 正文写明 CLI 的确切调用形式：node "{distilly_skill_root}/bin/distilly.mjs" <子命令>
```

**路径约定（一条规则）**：`--base-dir <工作区>` = 工作区根（下面有 `skills/`），
**每一条命令**一致；`--skills-dir <dir>`（`skill *`）与 `--dir <人物目录>`（`retrospect`）
用于直接指名更细的一层；`view` 另接受同义别名 `--root`。同时给 `--base-dir` 与
`--skills-dir` 会报错，不会猜。

## 4. 怎么验（当前实测数字）

```bash
npm test                                   # CI 的同一条命令
node scripts/acceptance.mjs --corpus tests/fixtures/public-corpus/synthetic-interview --person lin-gong
node scripts/acceptance.mjs --corpus tests/fixtures/public-corpus/us-house-floor-2009-07-29 --person us-house
DISTILLY_PLAYWRIGHT_ROOT=<含 node_modules 的目录> node scripts/audit-objective.mjs
node scripts/check_release.mjs && node scripts/prompt-lint.mjs && node scripts/generate-template.mjs --check
```

| 门禁 | 结果 |
| --- | --- |
| `npm test` | 391 / 391（Node 20 与 22 各一遍） |
| `scripts/acceptance.mjs` | **18 / 18**，两份公开语料各一遍 |
| `scripts/audit-objective.mjs` | 15 / 15 条满足（本地要求工作树干净且已推送） |
| `scripts/check_release.mjs` | 7 / 7 |
| `scripts/prompt-lint.mjs` | 0 finding / 26 文件 |
| `scripts/generate-template.mjs --check` | 无漂移 |
| GitHub Actions | Node 20 / Node 22 / Acceptance 三个 job 全绿 |

> 2026-09-15 补上的两道门禁：**语料体检**（`doctor --require-shape`：单元数、可归属比例、
> 最活跃者占比，FAIL 必给理由——它拦住的正是"拿议会记录蒸出会议室的画像"那类错误）与
> **引用判定**（`doctor` 现在把生成物里的引用一并计入，悬空引用 → `ok:false`、exit 1）。

验收 18 项里最后 6 项是**交付物与语料门禁**（判据在 `scripts/skill-artifacts.mjs`，纯字符串入参、
可单测、带反例）：产物齐 / PART A·B·运行规则在 / Layer 0–5 齐且 Layer 0 有规则 /
锚点悬空=0 / doctor 报回指率。

## 5. 语料形状（决定成败的一条）

产品要的是**一个人的一手产出**：本人著作、演讲与访谈字幕、本人社媒。
会议记录与多人群聊是**混合流水**，必须先有说话人归属才能切出一个人——解析层现在能做到
（WebVTT voice / `Name:` 前缀 / 全角冒号 `说话人 1：` / 句中换人），但归属率取决于源本身：
真实 C-SPAN 字幕 47 分钟里只有 84 处说话人标签，解析层取到 82 条，覆盖率约 6%。

**结论：选对语料比优化解析器重要一个数量级。** 产品现在会在 Step 1.5 拦住错误形状
（`distilly doctor --require-shape`），上面这份 C-SPAN 语料的实测判决是
`FAIL units=2744 speakers=18 attributed=175（3%）`，理由写明"先补这个人自己的一手产出"。

## 6. 分支与 PR 清单

| 对象 | 数量 | 状态 |
| --- | --- | --- |
| 本地 `ds/NN-*` 分支 | 23 | 每条都有 `docs/evidence/pr-NN-*.md`（审计第 11 行按分支全量检查） |
| 子功能 PR `#166`–`#184` | 19 | **堆叠**（base 是上一条 `ds/*` 分支）；见下方三组状态 |
| 集成分支 PR `#185` | 1 | 目标 `dot-skill`；CI 绿 |
| 集成分支 | `dot-skill-test` | 本文件描述的对象 |

子功能 PR 的三组状态（2026-09-15 首次真正跑 CI 之后）：

| 组 | 分支 | CI | 说明 |
| --- | --- | --- | --- |
| **A. 可评审** | `ds/13` `ds/15` `ds/16` `ds/17` `ds/18` `ds/19` `ds/20` `ds/21`（8 条） | **全绿**（Node 20 / Node 22 / Acceptance） | 已并入集成分支上的 3 个修复提交（Node 20 的 `npm test`、审计推送行、测试读真实 home / 大小写断言） |
| **B. 一条结构性红** | `ds/12-note`（1 条） | 4 红 2 绿 | 补了同样 3 个修复后仍剩 1 条：该分支的 `check_release` 要求 `docs/v2/IDENTITY.md`，而那是 `ds/15` 才交付的文件 —— 重建快照混了时代 |
| **C. 快照不自洽** | `ds/01`–`ds/11`（10 条） | 30–79 红 | 分支的树与它自带的测试对不上（例：`ds/01` 只有 20 个测试文件，集成分支有 86 个），**不作为合并入口**；功能已包含在 `dot-skill-test` 与后续分支里 |

原始 7 项任务（`ds/01`–`ds/07`）的交付与验证方式见各自的 `docs/evidence/pr-NN-*.md`。

## 7. 已知缺口（没做到的部分，按严重度）

1. **效果数字不可用 —— 装置已就绪，只差一个"不是蒸馏者的"裁判**。
   上一次真实结果（`docs/evidence/pr-10-blind-test-runs.md`）：run 2 evidence 命中率 0.563 /
   control 0.500，**四臂 0 编造**；只有 10 条 cue / 10 条断言，差异与裁判方差同量级。
   2026-09-15 已在**右形状语料**（synthetic-interview，76 单元）上重跑机械部分并交付一个盲测包：
   A/B 按时间码切好（28 / 10 条）、实验组页面已定稿（私有模式校验：A 段 24 条原句 **0 条**
   出现在页面里，25 个锚点）、对照组裸 prompt 画像已写、裁判题与评分模板齐备。
   **剩下的两步必须由另一个模型或人来完成**：裁判（写 10 行「特征 | 预测」）与核对者（唯一读 B 的角色）。
   本机只注册了一个模型（`deepseek-official/deepseek-flash`），同一模型既蒸馏又裁判的数字没有意义。
   包的位置与确切命令见随包 `README.md`（`/tmp/dst-evidence/blind-2026-09-15/`，本地证据不入库）。
2. **Step 3（Read）没有机械门禁**，全靠提示词自觉；Step 1 / 1.5 / 2 / 4 / 5 有判据。
3. **10 个 `ds/*` PR 的树与它们自带的测试不自洽**（`ds/01`–`ds/11`）：CI 30–79 红，
   是快照本身不完整（例：`ds/01` 只有 20 个测试文件，集成分支有 86 个）。
   其中 9 条已并入集成分支的修复、8 条 CI 转绿、`ds/12` 剩 1 条结构性失败（见第 6 节的分组表）；
   剩下这 10 条**不打算修**——它们是重建时的不完整快照，功能已包含在集成分支里。
4. **19 个 PR 的 base 结构与流程要求不符**：要求是"PR 到 `dot-skill-test`"，实际是堆叠到
   上一条 `ds/*` 分支（`ds/01` 的 base 甚至是 `pre-v2-baseline`）。CI 触发名单已扩到
   `ds/**` 并推到各分支，所以现在跑得起来；base 结构未改。
5. **`docs/PRD.md` 与 `docs/SKILL_TYPE_ABSTRACTION_DESIGN*.md` 描述的是 v1（Python）形状**
   （`colleagues/{slug}`、`tools/*.py`），未随 v2 重写；两份文件顶部已加说明指向 v2。
6. **`docs/evidence/pr-NN-*.md` 是各功能当时的历史证据**：其中 `pr-21` 与 `pr-13` 的结论
   已被后续工作推翻，两份文件末尾都补了更正章节；其余文件的数字仍然成立。
7. **`README.md` 已分区**：本分支（Skill + CLI）在前，`distilly-plugin` 那条 Plugin 线
   明确划到「另一条产品线」标题下并注明不在本分支运行。
