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
| 2 Derive | `evidence/derived/*.json`（7 个维度） | 两次运行字节相同 + 派生锚点全部可回指 |
| 3 Read | 无新文件，产出"读了什么"的复述 | **靠提示词约束，无机械门禁**（已知缺口 7.3） |
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
| `scripts/acceptance.mjs` | **17 / 17**，两份公开语料各一遍 |
| `scripts/audit-objective.mjs` | 15 / 15 条满足（本地要求工作树干净且已推送） |
| `scripts/check_release.mjs` | 7 / 7 |
| `scripts/prompt-lint.mjs` | 0 finding / 26 文件 |
| `scripts/generate-template.mjs --check` | 无漂移 |
| GitHub Actions | Node 20 / Node 22 / Acceptance 三个 job 全绿 |

验收 17 项里最后 5 项是**交付物门禁**（判据在 `scripts/skill-artifacts.mjs`，纯字符串入参、
可单测、带反例）：产物齐 / PART A·B·运行规则在 / Layer 0–5 齐且 Layer 0 有规则 /
锚点悬空=0 / doctor 报回指率。

## 5. 语料形状（决定成败的一条）

产品要的是**一个人的一手产出**：本人著作、演讲与访谈字幕、本人社媒。
会议记录与多人群聊是**混合流水**，必须先有说话人归属才能切出一个人——解析层现在能做到
（WebVTT voice / `Name:` 前缀 / 全角冒号 `说话人 1：` / 句中换人），但归属率取决于源本身：
真实 C-SPAN 字幕 47 分钟里只有 84 处说话人标签，解析层取到 82 条，覆盖率约 6%。

**结论：选对语料比优化解析器重要一个数量级。**

## 6. 分支与 PR 清单

| 对象 | 数量 | 状态 |
| --- | --- | --- |
| 本地 `ds/NN-*` 分支 | 23 | 每条都有 `docs/evidence/pr-NN-*.md`（审计第 11 行按分支全量检查） |
| 子功能 PR `#166`–`#184` | 19 | **堆叠**（base 是上一条 `ds/*` 分支）；2026-09-15 首次真正跑 CI，19/19 红，原因见 7.5 |
| 集成分支 PR `#185` | 1 | 目标 `dot-skill`；CI 绿 |
| 集成分支 | `dot-skill-test` | 本文件描述的对象 |

原始 7 项任务（`ds/01`–`ds/07`）的交付与验证方式见各自的 `docs/evidence/pr-NN-*.md`。

## 7. 已知缺口（没做到的部分，按严重度）

1. **效果数字不可用**。盲测跑过（`docs/evidence/pr-10-blind-test-runs.md`）：run 2
   evidence 命中率 0.563 / control 0.500，**四臂 0 编造**；但只有 10 条 cue / 10 条断言，
   差异与裁判方差同量级、两臂都没到 0.70。**既不能声称有效，也不能否认有效**，
   需要在"一个人的一手产出"形状的语料上重跑。
2. **没有前置语料体检**。没有任何一步回答"这份材料够不够蒸馏一个人、缺什么、形状对不对"。
   我用一份议会记录跑通了全流程、产出"会议室的画像"，产品本该在 30 秒内拦住我。
3. **Step 3（Read）没有机械门禁**，全靠提示词自觉；Step 1 / 2 / 4 / 5 有判据。
4. **`doctor` 只报不拦**：算出 cited/total 却返回 `ok: true`，没有阈值判定。
5. **19 个 `ds/*` PR 的树与它们自带的测试不自洽**：8 条（`ds/12` 起）只差集成分支上
   已修的 4 类问题；11 条（`ds/01`–`ds/11`）有 30–79 个失败，是快照本身不完整
   （例：`ds/01` 只有 20 个测试文件，集成分支有 86 个）。
6. **19 个 PR 的 base 结构与流程要求不符**：要求是"PR 到 `dot-skill-test`"，实际是堆叠到
   上一条 `ds/*` 分支（`ds/01` 的 base 甚至是 `pre-v2-baseline`）。CI 触发名单已扩到
   `ds/**` 并推到各分支，所以现在跑得起来；base 结构未改。
7. **`docs/PRD.md` 与 `docs/SKILL_TYPE_ABSTRACTION_DESIGN*.md` 描述的是 v1（Python）形状**
   （`colleagues/{slug}`、`tools/*.py`），未随 v2 重写；两份文件顶部已加说明指向 v2。
8. **`README.md` 的主体讲的是另一条产品线**（Plugin Developer Preview / MCP / Panel），
   与本分支的 Skill + CLI 实现不是一回事；顶部已加说明并分区。
