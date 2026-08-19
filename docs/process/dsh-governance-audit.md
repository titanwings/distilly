# DeepSeek Harness 仓库治理层审计
> 副本。原为 DSH 仓审计；入 distilly 供对照。现行治理合同是根 AGENTS.md 与 docs/process/code-review.md。

> 目的：搞清楚 DeepSeek 团队怎样让 **Agent 实际参与** 这个仓库的设计、开发、评审和文档维护。
> 范围：只审计治理层——`.agents/`、各级 `AGENTS.md`、开发 Skill、Agent Notes、PR/CI 门禁、真实库存。不审计 runtime / agent-loop。
> 日期：2026-08-19
> 证据以本工作区 `test-titanwings` 为准。

---

## 术语

| 术语 | 在这个仓库里是什么 |
|---|---|
| **Standing order** | 根 `AGENTS.md` 里每条 1–3 行的常设命令。每个会话都该带着。 |
| **文档先行** | 非平凡变更先有（或同 PR 带）Agent Note / 规格；`implemented/` 写的是**已经落地的现在时**，不是事后日记。大功能先停在 `proposed/`，代码还没写。 |
| **一事实一归属** | 每个事实只住一个 tier，别处只链过去。 |
| **Agent Note** | Agent 写的决策记录：为什么、放弃了什么、怎么验证。路径编码状态和种类。 |
| **Skill** | 可复用工作流。合同在 docs，流程在 skill。Skill 不承载产品契约。 |
| **Gate** | 退出码非零的检查。值得守的不变量就要写成命令。 |
| **doc-sync** | 文档/目录/JSDoc/Note 格式的叶子门禁集合，`pnpm run doc-sync`。 |

---

## 0. 一句话

这个仓库**默认开发者是 coding agent**，不是「人写代码、agent 当补全」。因此治理的核心不是再写一份给人看的 CONTRIBUTING，而是：

1. 把 agent 每次会话必须知道的规则压进 **分层 AGENTS.md**（短、可链）。
2. 把「为什么这样」压进 **Agent Notes**（先 proposed，后 implemented）。
3. 把「怎么做这一类活」压进 **Skill**（工作流，不是合同）。
4. 把所有能机器查的承诺写成 **gate**，CI 跑全套；本地 hook 只拦便宜缺陷。
5. 人只做 gate 做不到的事：语义评审、设计是否该做、Agent Note 有没有说真话。

质量门禁那篇写得最直白（`.agents/notes/implemented/process/2026-06-11-quality-gates.md`）：

> This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and "a lot of work" is not a cost argument when agents do the labor.

文档先行在这里的意思不是「先写一篇博客再开工」，而是：**决策有家、现状有家、流程有家；代码是实现，不能当唯一记忆。**

---

## 1. Agent 怎么被拉进仓库（加载路径）

```
每个会话
    │
    ├─ 根 AGENTS.md / CLAUDE.md（symlink → AGENTS.md）
    │     常设命令 + 仓库地图 + 约定。短，链到家。
    │
    ├─ 你正在改的子树 AGENTS.md
    │     packages/  docs/  examples/  .agents/notes/  scripts/  .github/  vendor/  website/
    │     只写这个子树多出来的规则，不重复根文件。
    │
    ├─ 任务触发 Skill（.agents/skills/dsh-*）
    │     评审、写文档、归档 Note、push 前选检查、找简化……
    │
    └─ 改 packages/ 之前先读 docs/architecture.md
          类型细节去 subsystems/，理由去 Agent Note。
```

`CLAUDE.md` 在根和 `packages/` 都是指向 `AGENTS.md` 的 symlink。一套命令，Claude / Cursor 都能吃到。编辑真文件，不要改 symlink。

根文件的预算纪律（`docs/AGENTS.md`）：standing order 每条 1–3 行，故事和步骤不准住在根上。超了 `verify-doc-budgets` 红。

这就是「agent 参与设计」的第一刀：agent 打开仓库时，**已经带着同一套宪法**，不是每个会话重新发明规范。

---

## 2. 文档分层：文档先行的真正形状

`docs/AGENTS.md` 把人类可读文档分成固定 tier。**每个事实一个家，别处链接。**

| Tier | 工作 | 不准放什么 |
|---|---|---|
| 根 `AGENTS.md` | 每会话都要的规则 | 故事、例子、情景步骤 |
| 子树 `AGENTS.md` | 只属于这棵树的命令 | 根上已经有的规则 |
| `docs/architecture.md` | 组合、loop、缝、扩展点 | 类型定义、包细节、决策理由、实现状态标注 |
| `docs/subsystems/` | 类型、语义、生成的 Cordis API | 行为叙事 |
| **Agent Notes** | 为什么、放弃了什么、要验证什么 | 迁徙计划（implemented 里禁止）、验收清单、should 腔 |
| `docs/postmortem/` | **唯一允许战争故事的地方** | — |
| `docs/cookbook/` | 带编号验证步骤的 how-to | 设计理由（链 Note） |
| `docs/user/` | 产品用户指南 | 生成表、贡献者流程 |
| 包 README | 配置、语义、限制、扩展点、Model Experience | 复述 JSDoc / 生成目录 |
| `docs/development.md` | 日常开发与 CI 摘要 | 和 `package.json` 会漂的检查清单 |
| 生成目录 | 从源码重生，门禁保鲜 | 手改英文生成区 |
| `.agents/skills/` | 可复用工作流 | 产品/运行时契约 |

放置口诀（同一文件）：

> bugs → postmortems；rationale → Agent Notes；procedures → cookbooks；types → subsystems；package contracts → READMEs；standing orders → 根 AGENTS.md 并链理由。

**文档先行**在操作上拆成三拍：

1. **大改先 proposed Note。** `proposed/` 里现在还躺着未实现的 Task Surface、mutation testing、typed event schemas……规格可以先合并讨论，代码后写。例如 `.agents/notes/proposed/feature/2026-08-04-task-surface.md` 已经写到 JSON 模型和验收，仓库里可以还没有对应实现。
2. **落地同 PR 改成 implemented。** `## Proposal` 改写成现在时 `## Decision`，路径/符号跟着代码改。禁止在 implemented 里留 `## Acceptance criteria`（门禁直接拒）。
3. **常驻文档只写当前状态。** 禁止「以前/现在/不再」。历史进 commit、PR、Note、postmortem。

Cookbook 把「先有合同再有包」写进步骤：新建包的清单第一步就要求 `README.md`（配置、限制、Model Experience），不是写完代码再补两句。`packages/AGENTS.md` 规定：行为变了，README 和 JSDoc **同一 commit** 更新。

---

## 3. Agent Notes：设计记忆，不是博客

### 3.1 库存（本工作区实测）

| 生命周期 | 约数 | 含义 |
|---|---|---|
| `proposed/` | 25 | 尚未建或只建了一部分，给人/agent 评审规格 |
| `implemented/` | 492 | 已落地，且必须跟代码同步 |
| `rejected/` | 11 | 否决理由还防得住「再提一次」才留 |
| `archived/` | 141 | 封存，永不改，不当现行权威 |
| 合计（不含中文镜像） | ~669 | 中英成对 + sidecar 哈希 |

路径：`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`

Class 闭集（`scripts/agent-note-tree.ts`，加一种要改门禁）：`feature` `bug-fix` `simplification` `architecture` `process` `testing`。

故意没有 `refactor`：和 simplification 重叠。

### 3.2 什么时候必须写

非平凡变更：**同一 PR** 至少新增或更新一篇。非平凡 = 改行为、架构、跨文件契约、流程/工具、测试策略、磁盘/线/配置格式，或以后维护者可能重开的决策。

机械/局部编辑才豁免。已有 Note 拥有该决策 → 更新它，不要另起一篇重复。改决策 → 新 Note 交叉链接，禁止把旧文件改写成相反结论。完全被取代才能按合并规则删。

新 Note 必须先做 **supersession check**（`.agents/notes/AGENTS.md`）：搜活动树，该归档的用 `dsh-archive-agent-notes` 在同一 PR 封存。

### 3.3 格式（机器查）

头四行锁死（`scripts/verify-agent-note-format.ts`）：

```
# Agent Note: <title>

Status: proposed | implemented | rejected — <一行理由>
```

| 生命周期 | 必有章节 | 禁章 |
|---|---|---|
| proposed | Problem, Proposal, Alternatives considered, Acceptance criteria, Risks | — |
| implemented | Problem, Decision, Alternatives considered, Consequences | Proposal / Plan / Migration plan / Acceptance criteria |
| rejected | Problem, Proposal, Alternatives；Verdict 在 Status 行 | — |

**Alternatives considered 强制。** 没有「打败了什么」的决策会再被拿出来吵。2026-07-05 前的旧文可用祖父注释豁免，不可新写豁免。

`implemented/` 只改**事实 realization**（路径、符号、默认值），不改决策本身。代码搬家，Note 同一 diff 改路径。

中文是 `.zh.md` 镜像，结构一节对一节；`# Agent Note:` 和 `Status:` 保持英文。格式门禁跳过中文，配对门禁查一致性。

归档：整组英/中/sidecar 一起搬到 `archived/{class}/`，加 `Archived: YYYY-MM-DD`，之后冻结。`verify-archived-agent-notes` 查闭集、三件套、sidecar 哈希、只追加的冻结清单。

没有总 INDEX.md。理由在 `implemented/process/2026-07-19-remove-generated-agent-note-index.md`：活动树本身就是目录，生成索引会漂。

### 3.4 一篇「文档先行」长什么样

`implemented/process/2026-07-04-doc-tiers-and-budgets.md`：

- **Problem**：standing docs 重复、复述事故、包地图过期；光靠写作指导拦不住。
- **Decision**：树决定范围；一事实一归属；窄预算门禁；**合同在 docs，工作流在 skill**。
- **Alternatives**：只靠 skill/评审、给所有文档加顶、每个入口各写教程、标准塞进 SKILL.md —— 逐条写为什么输。
- **Consequences**：往预算文档加字必须腾地方，否则 CI 红。

这就是文档先行：先把「文档怎么分层」做成可执行决策，再让所有后续 PR 被这套门禁管着。

---

## 4. 开发 Skill：工作流，不是第二部宪法

`.agents/skills/` 现有（产品相关）：

| Skill | 何时用 | 合同在哪 |
|---|---|---|
| `dsh-doc-standards` | 写/搬/审/审计文档 | `docs/AGENTS.md` |
| `dsh-prose-standard` | 一切散文：MD、JSDoc、prompt、报错文案 | 覆盖清单在 skill，放置在 doc-standards |
| `dsh-trim-cot-leakage` | 删推理逐字稿（previously、测试走读、评审编排） | slop checklist |
| `dsh-archive-agent-notes` | 归档/恢复/supersession | notes README |
| `dsh-code-review` | 审 PR | AGENTS + defensive-patterns + testing |
| `dsh-pre-push-checks` | push / stack sync 后 | 只跑 diff 能砸到的检查 |
| `dsh-find-simplifications` | 找可删的面 | 先读 architecture 和 Note |
| `dsh-translate-docs` | **仅用户显式调用** | `docs/i18n/` |
| `dsh-doc-site-sync` | 网站映射 | website 配置 |
| `dsh-merging-stacked-prs` | 栈合并 | process Note |

分层原则（doc-tiers Note 否决过「标准塞进 SKILL.md」）：

- Skill 里写**怎么走流程**（先测预算、再 grep 重复、再跑 doc-sync）。
- 规则正文住在 docs，这样「改文档但不调 skill 的 agent」仍然看得到。
- Skill 自称 **guidance, not a script / not a checklist**。判断在人/agent，门禁抓结构。

评审 Skill 把人要做的事写死：新散文必须语义审；docs 和代码同 diff；implemented Note 必须等于已上船现实；blocker 用证据，gate 已经绿的问题不要再报。

Push Skill：不要默认全套。`change-scope --base <已核实的 base>` 看范围，只跑会被这次 diff 打破的测试。CI 拥有穷尽矩阵。`gh stack sync` 是例外：先推后验，未验完不准合。

---

## 5. 门禁：承诺变成退出码

哲学：`AGENTS.md` 里每条能机器查的承诺，都要有一条非零退出的命令。

### 5.1 本地 hook（快、窄）

`lefthook.yml`：

- **pre-commit**：暂存 Oxlint 可修即修；空白；vendor manifest；翻译配对（暂存的 i18n）；归档 Note 冻结检查。
- **pre-push**：只跑增量 `typecheck`。
- 不跑：测试、snapshot、doc-sync、build、hygiene。

理由（`2026-07-22-fast-local-git-hooks.md`）：agent 已经跑过自己那份证据；hook 再跑全套只会重复、放大无关 flake。便宜缺陷本地死，穷尽交给 CI。

### 5.2 `doc-sync`（文档治理的核）

`pnpm run doc-sync` → `scripts/run-gates.ts doc-sync`，叶子包括：

- 生成目录保鲜：cordis / tool / config / persistence / graphs / scoped-events
- `verify-export-jsdoc`：导出有 JSDoc
- `verify-md-wrap`：一段一行
- `verify-md-links`：相对路径，死链和死锚点
- `verify-doc-refs`：TS 注释里的 `docs/*.md` 引用
- Agent Note：classification、format、archived 冻结
- `verify-type-equiv`：文档里粘的类型和源码一致
- `verify-skill-invocation-metadata`
- 翻译 pairing + translation prompt
- `verify-doc-budgets`
- 站点投影 + VitePress build
- 包 README limitations / model experience

CI 上静态车道：`pnpm run check:ci:static`（`run-gates.ts ci-static`），PR 的 `node 24 / static` job。文档站工作流也会跑 `pnpm run doc-sync`。

预算数字（standing docs）：根 AGENTS ≤ 1600；architecture ≤ 1800；子树 AGENTS ≤ 600（packages ≤ 650，docs/AGENTS ≤ 1250）；packages/README ≤ 600。超了先搬再压，最后才涨天花板，PR 里说明。

### 5.3 代码侧（对照，知道治理有多「机械」）

同一套「能查就查」还管：严格 TS、Oxlint、jscpd、`packages/*/*/src` **逐文件 100% 覆盖**、knip、publint、workspace constraints、包 invariant 伴随测试。这些不是文档层，但同一哲学：agent 换人，约定还在。

### 5.4 PR / Issue 政策

- 模板（`.github/pull_request_template.md`）：非 Draft 人类 PR 至少引用一个本仓库 Issue；`Fixes #` vs `Related to #`。
- `issue-policy.yml` 跑 `.github/issue-management/policy.mjs`：Issue 类型、优先级、PR `kind/*` 标签闭集。
- 根 AGENTS：一个 PR 一个 `kind/*`，所有实质性 `area/*`，以及 GitHub 原生 Issue Type。

人审的是「该不该做、Note 是否诚实、散文有没有漏契约」。格式、链接、预算、Note 骨架，agent 过不了 CI 就过不了。

---

## 6. 一次真实变更在治理层怎么走

```
1. 读根 AGENTS + 子树 AGENTS + architecture（若动 packages/）
2. 搜活动 Agent Notes：已有决策就更新，不要另起
3. 非平凡：
     未开工 → proposed/ 写 Problem/Proposal/Alternatives/Acceptance/Risks
     已决定要做 → 直接 implemented/，现在时
4. 代码 + 包 README + JSDoc +（类型则）subsystems 同一次变更
5. 触发的 Skill：写文档用 doc-standards；审 PR 用 code-review
6. 本地：只跑这次 diff 会砸到的测试；文档变更跑 doc-sync
7. hook：lint / 空白 / typecheck
8. PR：关联 Issue，kind/area 标签
9. CI static：doc-sync 全集 + 其它静态门
10. 评审：散文语义、Note 是否等于代码、lifecycle/安全
11. 落地后 Note 保持现在时；不再指导未来工作 → 归档三件套
```

「文档先行」卡在第 3 步：没有 Note 的非平凡 PR，规范上不合法。proposed 可以先合进讨论，代码后跟。implemented 和代码必须同一 PR，避免「文档说已经这样、仓库还没有」。

---

## 7. 优点（为什么这套能让 agent 干活而不是添乱）

**1. 上下文可加载。** 分层 AGENTS + 预算，强迫规则短。agent 不会在 2 万字 CONTRIBUTING 里淹死，也不会每会话重发明「测试怎么写」。

**2. 决策可反对、可防重开。** Alternatives 强制。rejected 留下「为什么不做」。归档冻结，避免把历史当现行 API。这比「commit message 里有过一句」能扛 agent 换人。

**3. 合同和工作流拆开。** 改文档的 agent 即使没调 skill，仍能读到 `docs/AGENTS.md`。Skill  magically 膨胀成第二部宪法，被他们明确否决过。

**4. 机器比嘱咐可靠。** 质量门禁 Note 的原话。链接、Note 骨架、预算、类型粘贴、JSDoc、生成目录——这些 agent 最容易漂，也最适合 exit code。

**5. 现在时文档。** 禁止 previously/now。agent 最爱写「我们把 A 改成了 B」。那种散文两周后就是谎。现状在 docs，故事在 Note/postmortem。

**6. 本地快、CI 全。** Agent 被要求选最小证据，不被强迫每次 `check:all`。否则治理自己会把吞吐杀死，然后大家开始 `--no-verify`。

**7. 人只审人该审的。** 格式绿了不代表散文对。code-review skill 把「新散文必须语义审」写成 blocker。人和 agent 分工清楚。

**8. 规模已经被自己的规模证明。** 六百多篇 Note 还活着，是因为有分类门禁、格式门禁、归档冻结、禁止总索引、预算把 standing docs 按住。没有门禁的「我们也写 ADR」通常三个月后腐烂。

---

## 8. 坑（学的时候别照抄出事故）

- **预算很粗。** 他们自己承认 word count 不判断质量，只是逼你在加字的那一刻做归属。乱涨天花板 = 门禁变橡皮图章。
- **100% 覆盖会逼出没断言的测试。** 他们自己把 mutation testing 放在 proposed。抄覆盖率数字前先抄「测试描述行为」。
- **implemented Note 维护税。** 改路径必须改 Note。不做就会和代码打架。归档校准不够会要么垃圾堆、要么误冻还在用的决策。
- **proposed 堆着不建。** 现在 25 篇未落地规格。文档先行的代价是规格仓库膨胀；要定期 reject 或删。
- **Skill 不是法律。** 自称 guidance。只写 skill 不写 gate，agent 下次就不听。
- **双语是成本。** 配对门禁要同改；翻译 skill 故意不自动跑。小项目先中文一篇即可。
- **钩子太宽会教人绕过。** 他们把全套从 pre-push 拿掉，就是吃过亏。

---

## 9. distilly 该抄什么（最小可行治理）

不要第一天复制 20 个 verify 脚本。抄**形状**，门禁按痛点加。

| 抄 | 第一版怎么落 |
|---|---|
| 根 AGENTS.md 常设命令 | 短：改代码先读 architecture；非平凡带 Note；Markdown 是事实；Client 不长业务 |
| 子树 AGENTS | `docs/`、`src/distilly_engine/` 需要时再加 |
| Agent Note 三态 + Alternatives | 目录即可；format 脚本可以第二周再写 |
| 大功能先 proposed | 本文和独立规格先于 SDK 实现（你们已经在做） |
| 落地改现在时 | 不要在 architecture 里写「我们打算」 |
| cookbook | 「怎么加 SourceAdapter」「怎么加 HostInjector」带验证步骤 |
| 能查的承诺写成命令 | 先：链接、Note 头、测试。预算等文档开始膨胀再加 |
| Skill | `distilly-doc-standards`、`distilly-pre-push` 各一页，合同仍在 docs |
| hook 保持窄 | lint + 空白；typecheck/tests 按 diff 跑 |
| 不抄 | 双语门禁、100% 覆盖、 Cordis 目录生成、Issue policy 全套——等真痛再加 |

一事实一归属对 distilly 已经适用：产品规格（本文/系统设计）≠ 决策 Note ≠ cookbook ≠ 包 docstring。不要把 EverOS 调研和 `Person.get` 签名写在同一个永远增长的文件里——调研进 Note 或 postmortem，现行合同进 architecture。

---

## 10. 证据索引

| 主张 | 证据 |
|---|---|
| Agent 是主要开发者 | `quality-gates.md` Decision 段 |
| 合同在 docs、流程在 skill | `doc-tiers-and-budgets.md` Alternatives「Housing the standard inside the skill」 |
| Note 格式机器查 | `scripts/verify-agent-note-format.ts` |
| 预算机器查 | `scripts/doc-budgets.manifest.json` + `verify-doc-budgets` |
| doc-sync 叶子清单 | `scripts/run-gates.ts` `docSyncLeafGates` |
| CI 静态车道 | `.github/workflows/ci.yml` job `node 24 / static` → `check:ci:static` |
| hook 范围 | `lefthook.yml`；理由 `fast-local-git-hooks.md` |
| proposed 先于代码 | `proposed/feature/2026-08-04-task-surface.md` |
| CLAUDE 与 AGENTS 同一套 | 根与 `packages/` 的 `CLAUDE.md` → `AGENTS.md` symlink |
| 评审人审散文 | `dsh-code-review/SKILL.md` Blocking #1 |
| 新包必须带 README | `docs/cookbook/adding-a-package.md` 第 1 节 |
| 人类 PR 绑 Issue | `.github/pull_request_template.md` + `issue-policy.yml` |

相关仓库内文件：根 `AGENTS.md`、`docs/AGENTS.md`、`.agents/notes/README.md`、`packages/AGENTS.md`。
