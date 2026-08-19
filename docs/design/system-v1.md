# distilly 系统设计 v1.1（对话还原）

> **已入仓。** 本文件是对话还原全文。实现必须对照本文，不能只读 architecture.md。
> 分层目录：[docs/README.md](../README.md)。按章：[design/README.md](README.md)。
> 本机克隆：`/Users/zhoutianyi/project/distilly`。
> 状态：讨论定稿草稿，待实现。v1 收得太狠，本版按 [那段对话](cda3e1ea-d1bb-4ff9-abf4-b48c5833cf3b) 把拍过板的机制写回来。
> 创建：2026-08-19；补全：同日
> 仓库本机：`/Users/zhoutianyi/project/distilly`（分支 distilly）。不要在 `~/.claude/skills/dot-skill` 或 DSH `test-titanwings` 里当产品家。
> 现有原型：`~/.claude/skills/dot-skill` = `titanwings/colleague-skill` 的完整 clone（`feat/telemetry`）。`tools/adapters/` 整目录未提交。
> 旁图：[[dot-skill-system-design]] 哲学与完成度；[[agent-memory-storage-landscape]] 记忆调研；[[everos-design-breakdown]] EverOS；Cursor canvas `distilly-architecture`。

---

## 0. v1 漏了什么（先看这个）

上一版只剩目录和函数签名。对话里已经拍板、却被收成一句的，至少有这些：

| 被收掉的 | 对话里实际说了什么 |
|---|---|
| 产品从哪来 | 你原话：Colleague Skill scope 太小，要做成所有 agent 自带的 profile；面板选 marketplace、客制化、版本自选；bot 用真人蒸出来的性格，用户 @ 交互 |
| 设计哲学 | 六条，每条有「体现」和「拒绝」。没有拒绝的原则只是口号 |
| 记忆生态 | Markdown 不是主流 memory 项目的默认；分野是「写给谁看」。Hindsight 客观/主观分网、Memvid 只追加坑、AGENTS.md 无 schema |
| 为什么要 SQLite | 变更检测、FTS5、sqlite-vec、双向同步事务。现在 persona 几 KB **不必上**；marketplace 才需要投影 |
| EverOS 机制 | 删 `.index/` 不丢记忆；队列表路径一行；LSN 用途与非严格单调；四道一致性守卫；写强一致读最终一致；heap-expand 事实驱逐；超参数不给旋钮 |
| 蒸馏客观 vs 稳定 | 你纠正：客观 ≠ 重跑逐字相同。漂是要压的缺陷。置信度 = 材料支撑度。集合哈希没变就跳过 |
| 七组方法 | 先是完整产品能力清单（约 30 个动词），再收成 `Distilly`+`Person`。两组都要留着，不能只留瘦 SDK |
| Profile 六面语义 | 每面装什么、真实性靠什么、空合法、域包、Claim YAML、先 claim 再渲染 |
| 图 | 陈述边/派生边（后改名关系/相似）、space、pending mention、升级成 `relations/a__b/`、复杂度表、禁止 commit 时 O(n²) |
| ChatCut | 包结构、托管 MCP+OAuth、IAB、装完新开对话、规范 skill symlink、widget-forms 中性字段 |
| 四种调用方 | 模型 / 插件 / 面板市场 / **Bot**（后补回） |
| 三种装法 | `prompt()` 临时、`install()` 长期发现、`export()` 一对一身份。`agent.md` 不是加载机制 |
| 注入七坑 | 没有统一改 system 的 API、塞错槽污染全局、install≠会话、包装不同、子代理无 MCP、全文代价、宿主方言不能串 |
| 遥测 | opt-in、无端点完全惰性、数不到「被模型使用」、禁止为指标在 SKILL.md 里塞必调工具 |
| 现有完成度 | 地基有、产品形态零代码；CI 盯错分支；110 测试从未在 GitHub 跑过 |

下面按对话密度写，不按「好概括」写。类和函数仍在第 9 节。

---

## 1. 我们现在想做什么（用你的原意，不是一句 slogan）

起点不是「做 SDK」。起点是：

Colleague Skill 只针对同事，**scope 太小**。要把它做成 **所有 Agent 自带的 profile**。别人要知道这是我们做的、会持续维护；以后所有 agent 都用这套 profile。

你当时要的产品面（2026-08-18 原话结构）：

1. **前端面板与 Marketplace**
   给每个 agent 建 profile。在我们自己的窗口里，从 marketplace 选一个 profile 加载进来。
2. **用户自定义**
   前端里改。可以有自己的 agent、自己的「同事」这类角色。材料可以从桌面浏览记录等加载。**选择权给用户**，不由我们设采集限制（Agent 权限比普通软件大）。
3. **Evolving 与版本**
   持续改人物性格，做好版本。用户自选加载哪一版。血缘必须在**版本粒度**看得见：这一百个源里有哪些。
4. **Bot**
   你当时就说 **Bot 可以先做**。Bot 需要人物性格，用户 @ 交互。每个 bot 提前内置我们蒸出来的真人性格，不要 bot 自己编一份。
5. **先适配 Codex 和 Claude Code**，再铺开。要有前端面板（ChatCut 那种嵌在 Codex 里的窗口）。

后来定位收成一句话，但上面五条没有作废，只是分了版次：

**distilly = 用客观蒸馏，从已有事实生成可追溯的 personal memory / profile layer，再用 Agent SDK 接到 coding agent 和 bot。**

不是再做一个 Claude skill。Skill / `SKILL.md` / Hermes `SOUL.md` 都是投影。真相是引擎里的人、材料、版本、关系。

和 EverOS 的关系（纠正过一次）：真正对标的是它的 **profile 线**（单份画像、持续覆写），不是 episode 流水账。EverOS 只给使用者本人做一份、覆写就没了；我们做成 **多主体、可追溯、可修正、可分享**，默认还不用单独 API key。

记谁：所有人。同事 / 关系 / 名人 / 动漫 / **self**。`self` 与他人共用同一套模型，只是 id 特殊。

材料：宿主扒网、电脑操作截飞书；用户喂文件；用户 self-correct。我们不替用户设「不准采飞书」。

---

## 2. 设计哲学（每条必须有拒绝）

来自完成度讨论。一条原则如果没有对应的拒绝，它就只是口号。

### 2.1 Markdown 是唯一事实来源

其余一切都是投影，且必须可从它重建。版本快照、`lineage.jsonl`、`SKILL.md` frontmatter 全部由 `meta.json` 与产物文件派生。面板与 marketplace 不得引入第二个事实来源。

**拒绝：** 把 profile 状态放进云端数据库。这是与 ChatCut 的根本分歧——它的项目状态在 SaaS 上。

### 2.2 可追溯是一等公民，不是元数据装饰

每个版本都要能回答：我是从哪些源蒸馏出来的、置信多少、覆盖多完整。provenance 进 `meta.json`，`meta.json` 进 PRIMARY_ARTIFACTS（版本快照带血缘），另有 append-only `lineage.jsonl`，快照被裁剪后血缘仍在。

**拒绝：** 只在最新版本上记血缘——回滚会让血缘与产物错位。你已确认：一百个源必须在版本粒度看得见。

### 2.3 默认惰性，显式启用

任何有副作用的能力，未显式配置时应当完全不动，包括不打扰用户。遥测没有配置端点就不问、不发。成熟度门禁默认 0.0 放行。后台 LLM 蒸馏必须显式给 key。

**拒绝：** 「默认开启 + README 教你怎么关」。受益方是我们，就不该由用户承担默认成本。

### 2.4 不为度量扭曲产品

模型读 `SKILL.md` 不执行代码，因此「persona 被使用」数不到。文档里直说遥测是**创作活跃度**，不是使用活跃度。

**拒绝：** 在 persona 的 `SKILL.md` 里塞一个必须调用的工具来凑使用量。

### 2.5 地基不压在会腐烂的接口上

越靠近宿主内部机制的东西，越不能承重。插件第一版可以不含面板：纯 MCP + 宿主原生表单。`preview_start` 在 Claude Code 2.1.220 里已经不存在，ChatCut 照它写的 skill 现在就是失效的。

**拒绝：** 先做面板再做引擎。委托采集故意烂在宿主 skill，不烂在仓库。

### 2.6 选择权归用户

Agent 权限比普通软件大，我们不替用户设采集限制，但每个选择必须显式可见。采集器逐个 opt-in。遥测在交互式终端问一次并记住；**非交互运行一律拒绝且不落盘**，免得自动化替用户答了。

**拒绝：** 把「非交互时的拒绝」写进配置——那会让用户永远不再被问到。

### 2.7 蒸馏是客观的（你纠正之后）

从已有事实抽出结构。不是再采样一次主观印象。

我曾经把「输出是否忠于材料」和「重跑是否逐字相同」混在一起。温度计读数有波动不代表温度是主观的。

推论（比 v1 严）：

- 材料没变而输出变了是 **bug**，该有测试：同一批材料重复蒸馏，结构化字段应当一致。
- **置信度 = 这条结论被材料支撑的程度**，不是模型对自己文笔的把握。材料多、直接、互相印证就高。
- **per-claim 血缘不再是开放决策**：不能溯源的判断就是模型编的。先写 claim，再渲染 Markdown。
- 新版本置信度**下降本身是异常**：材料只会增加，支撑只应变强。挂起，不是「防主观漂移」。
- 材料集合哈希没变 → **跳过蒸馏**。客观意味着幂等。在「蒸馏是主观的」框架下这个优化不成立。
- self-correct 不是「用主观覆盖主观」，是 **用户补了材料里没有的事实**。必须进 `corrections/`。修正后重蒸仍冲突 → 查提示词或解析，不是让用户反复改。
- LLM 采样噪声要**压**：降温、固定采样、结构化字段一致性校验、必要时多次采样取一致部分。不当成系统固有属性去容忍。

### 2.8 不随部署变化的东西不要给旋钮

EverOS 检索算法把超参数冻成模块常量，OME 策略才给 `ome.toml`。用户该调的是「要不要后台蒸」，不是 RRF 的 k。给出不该调的旋钮是在制造事故。

---

## 3. 记忆生态里我们站哪（调研结论，不要再凭印象）

星标最高的独立 memory 项目，**一个用 Markdown 的都没有**：Mem0 向量抽事实，Zep/Graphiti 要 Neo4j 或 FalkorDB，Letta 是 Postgres 有状态运行时。用 Markdown 的是另一批：coding agent 的原生上下文文件，加上 Basic Memory、EverOS。

分界线不是新旧，是**这份存储写给谁看**。要人打开编辑 → 纯文本；只有机器读、且记忆多到装不下 → 数据库。中间那批是刻意双层：Markdown 当事实，索引可重建。我们和 EverOS、Basic Memory 共用这个结构。产品前提是用户要在面板里改 persona，所以 Markdown 是被需求锁死的，不是偏好。

和我们直接有关的两个：

- **Hindsight**：客观事实和带置信分的主观意见分开放。「用户叫 Priya」和「我认为他喜欢短回答」不混。我们停在文件级，它做到单条信念。现在有了 claim，粒度对齐了。
- **Memvid**：append-only + 内容哈希跟 `lineage.jsonl` 同源，但它把产物也做成不可变帧，改一条要重建整个文件。我们只让血缘只追加，产物可改。这个坑已经绕过。

**AGENTS.md** 已被六万多个项目采用，但明确没有 schema、没有版本号、没有约束性语言。我们做的版本化和血缘补的就是这一格。这比「又一个 memory 项目」更能说清位置。

EverOS 要四组独立凭证：`[llm]` `[embedding]` `[multimodal]` `[rerank]`，全必填。它是自带 LLM 调用的服务，跟宿主模型无关。我们默认零 key，这个优势要写进 README 第一屏。

---

## 4. 已锁定 / 仍开放

### 4.1 已锁定

1. 独立仓库。skill 只是分发形态。当前工作副本在 `~/.claude/skills/dot-skill`，应 `cp -a` 到 `~/Documents/distilly`，skill 路径改 symlink。
2. Markdown / jsonl 是事实。SQLite 是派生索引 + 同步状态机，可删可重建。
3. 蒸馏客观。集合哈希没变跳过。输出漂是缺陷。
4. 默认零 key。执行者可切换：无 key 时只标 pending，宿主 `commit`；有 key 时 daemon 也走同一 `commit`。
5. 要处理多模态，**不要必填 multimodal key**。未解析成文本的不进蒸馏。
6. 采集：留 `SourceAdapter` 抽象，社区写实现。第一版主路径是宿主 `ingest`。仓库里不写飞书官方 API。
7. 接入点只有 **Recall / Capture** 两个动词。框架绑定去对钩子。不要指望模型记得调 MCP。
8. self-correct 必须变成证据：`corrections/` + 立刻新版本 + 参与下次蒸馏。置信度下降挂起，`promote`/`reject`。
9. Client 学 DSH：`Distilly` + `Person`。七组是内部模块，不是用户背的 30 个方法。但 **七组清单要留着**，否则面板一做就缺动词。
10. 一个引擎、**四张脸**：模型 MCP / 宿主插件 / 面板市场 / Bot。
11. 临时人格：父 `get`/`prompt`，完整 profile 塞进**这一次子运行**。禁止写全局 `AGENTS.md`。
12. 完整 profile 整段塞。第一版不做 salience 裁剪。适配器塞不下只报错，不准偷偷裁引擎。
13. Profile = 闭内核 + 开域 + 带证据 claim。不要顶层 `work.md`+`persona.md`。
14. `colleague`/`celebrity` 降级为默认域包。默认入口 `person`。
15. 图第一版只做**关系**（曾用名「陈述边」，已废）。不做「相似」。加节点 O(1)，接关系 O(k)，禁止每次 commit 全图 O(n²)。
16. Bot 是 binding，不准自建人格文件。一个 bot 第一版钉一个 subject+version。
17. 抄 ChatCut 包结构，不抄云 MCP/OAuth。验收：不登录也能蒸公开人物并 `get`。
18. 第一版默认进程内引擎。`client.py` 先同进程门面。
19. 协议冻名字。MCP 工具名、`Material` 字段只加不改。skill 声明 `distilly >= x`。

### 4.2 仍开放

| # | 问题 | 倾向 |
|---|---|---|
| A | `create` 时材料必须属于谁 | 必须指明。归属推断第二版 |
| B | marketplace 形态 | 第二版。引擎先留 `export` / 版本标识 |
| C | celebrity 肖像 / 同意 | 产品政策，不进第一版引擎 |
| D | Bot 先 Hermes 还是 Telegram | Hermes 更便宜（已有 profile 目录）；Telegram UI 现成 |
| E | 面板 loopback | Codex IAB 能开 127.0.0.1（已查）；Claude 未实测。第一版可以无面板 |
| F | CI 与改名 | 搬仓后第一件事。`DOT_SKILL_*` → `DISTILLY_*` |
| G | per-claim 血缘实现粒度 | 方向已锁（必须有），落地格式见 Claim |

---

## 5. 总体架构

```
绑定层     Claude / Codex / LangGraph / OpenAI Agents SDK / Hermes / Telegram
           Recall = get() / prompt()     Capture = ingest | accept_collect
           自动路径必须挂 lifecycle hook，不能指望模型自觉
                │
Client SDK  Distilly + Person          ← 程序员和绑定只碰这一层
                │
Protocol    同进程 | 以后 JSON-RPC / MCP 共用形状
                │
引擎        收集管道 → Material
           蒸馏管道 → profile + claims + 关系
           队列 / 版本 / 投影
                │
存储        ~/.distilly/
            Markdown / jsonl = 事实
            .index/ = 可删可重建
```

四张脸（不是四套产品）：

```
                    distilly_engine
                   /    |     |     \
            MCP工具  Person   面板HTTP   Bot binding
            （模型） （脚本）  （市场/图） （钉一个人）
```

DSH 类比：DSH runtime = 车，DSH SDK = 方向盘（`DeepSeekHarness.run`）。distilly engine = 车，`Distilly`+`Person` = 方向盘。**不要把七组业务摊成 Client 上 30 个方法**，也不要把市场焊进 MCP。

蒸馏执行者：

```
无 LLM key ──► 摄入/去重/边界/排队 ──► 标 pending ──► 宿主蒸 ──► commit
有 LLM key ──► 同上                 ──► daemon 蒸  ──► 同一 commit
                                                      │
                                           置信度 ≥ 当前 → current
                                           置信度 < 当前 → 挂起 promote/reject
```

没有 `pending` + `commit`，默认零 key 路径是断的。

多模态同一规则：图/PDF/音频先落 `raw/`；谁解析（宿主视觉 / 本机 OCR / 可选云端 key）可切换；没解析的像素不进蒸馏，否则模型会「看图编」。

三条队列，成本差三个数量级，触发必须分开：

| 队列 | 成本 | 何时 | 失败 |
|---|---|---|---|
| ingest | 廉价 | 材料落地就处理：哈希、归档、计数 | 几乎只可能是磁盘/格式，多为不可重试 |
| distill | 昂贵 | **按主体边界**，绝不逐条。无 key 只挂 pending | 限流超时可重试；材料坏了需人介入 |
| index | 中等 | 产物变了 | 派生物，失败可重建。第一版可空转 |

边界：材料积累量、时间窗、用户 `flush`。不是 EverOS 的对话语义边界。

从 EverOS 抄 / 不抄：

| 项 | 取舍 | 理由 |
|---|---|---|
| 三层存储 | 抄 | Markdown 事实、SQLite 状态队列、索引可重建 |
| 队列表 + processing 守卫 | 抄 | 认领、终态 WHERE、启动回收孤儿 |
| retryable 三态 TRUE/FALSE/NULL | 抄 | 限流 ≠ YAML 写坏 |
| 部分索引 | 抄 | 队列表不随历史涨 |
| 写强一致 / 读最终一致 | 抄 | 写进文档，不留给用户撞 |
| 对外状态机比内部小 | 抄 | 对外 pending/done/failed，processing 是内部 |
| profile 单份覆写 | 改造 | 我们有版本，current 是指针 |
| reflect 式合并 + 软废弃 | 抄方向 | 改到几十版会碎片化 |
| episode 流水账 | 不抄 | 主体是人不是事件 |
| LanceDB 四段检索 / heap-expand | 不抄 | 第一版整份进 context |
| 必填四 key | 不抄 | 默认宿主蒸 |
| 采集写死在仓库 | 不抄 | 主路径 agent + 用户喂 |
| 拒绝 grep 兜底 | 抄态度 | 索引坏了重建，不给假可用 |

Recall / Capture 对框架（抄切法，不抄宿主词进 SDK）：

| 框架 | Recall | Capture | 注意 |
|---|---|---|---|
| OpenAI Agents SDK | `Runner.run()` 前 | 整个 run 成功后从 result | handoff 不要每个 `on_agent_end` 都提交 |
| LangGraph | `before_agent` 一次 | `after_agent` | 禁止每轮 `before_model` 都 `get` |
| AutoGen | 实现他们的 `Memory.query` | 自己包 `run()` flush | 他们不会替你 flush |
| CrewAI | `PRE_MODEL_CALL` 必须 run 级缓存 | `OUTPUT` / `EXECUTION_END` | |
| Claude / Codex | MCP + **lifecycle hook** | 结束看 `pending` | 只靠模型调 MCP 不可靠 |

Capture **不要默认把整段对话当记忆**。进库的是材料或用户修正，不是推理过程（与 DSH「存 tool call、排除 reasoning」同构）。Recall 默认是指定主体的 `get`，不是广搜。

---

## 6. 仓库文件树（源码，学 DSH 切包）

该抄的是怎么切包，不是抄 JSON-RPC。DSH：`protocol` / `client` / `server`；`api.ts` 产品面，`client.ts` 协议面；根只导出消费者接口。Python 孪生：`api.py` / `client.py` / `models.py` / `errors.py`。

DSH SDK 简单，是因为**产品动词就一个：跑一轮**。车在 runtime 里。我们 Client 同样瘦，但不会瘦到只剩一个 `run`——产品动词是「人」上的几个动作。

```
distilly/
├── README.md
├── AGENTS.md
├── pyproject.toml
├── src/
│   ├── distilly/                       # 根只导出 Distilly, Person, 错误
│   │   ├── __init__.py
│   │   ├── api.py                      # 产品面
│   │   ├── client.py                   # 连进程内引擎；以后换 daemon 传输
│   │   ├── models.py
│   │   └── errors.py
│   ├── distilly_protocol/              # MCP / JSON-RPC / 以后 TS 共用形状
│   │   ├── types.py
│   │   └── mcp.py
│   ├── distilly_engine/                # 「车」。Client 不长业务
│   │   ├── store/                      # layout, subject, material, index
│   │   ├── queue/                      # schema, service（LSN、守卫）
│   │   ├── distill/                    # hasher, runner, commit, prompts
│   │   ├── profile/                    # schema, render, migrate
│   │   ├── graph/                      # relations, mentions
│   │   ├── version/                    # snapshot, lineage
│   │   └── project/                    # SKILL.md, host export
│   ├── distilly_adapters/              # 采集。entry point: distilly.adapters
│   │   ├── base.py                     # 已有 454 行草稿
│   │   ├── registry.py
│   │   └── builtin/                    # 第一版最多一个 web 样板
│   └── distilly_bindings/              # 注入 + bot。第一版就要注入
│       ├── protocol.py                 # HostInjector
│       ├── claude.py
│       ├── codex.py
│       ├── langgraph.py
│       ├── openai_agents.py
│       ├── hermes.py
│       └── telegram.py
├── plugin/                             # 可独立小仓。照 ChatCut 包结构
│   ├── marketplace.json
│   ├── codex/
│   │   ├── .codex-plugin/plugin.json
│   │   ├── .mcp.json                   # python -m distilly.mcp，本地 stdio
│   │   └── skills/
│   │       ├── distilly-usage/         # 产品 skill：怎么蒸
│   │       ├── collect-web/            # 委托扒公开页
│   │       └── widget-ask/             # 仅 Codex：问「蒸哪个人」
│   └── claude/
│       ├── .claude-plugin/plugin.json
│       └── skills/                     # usage/collect symlink 同一份
├── tests/
└── examples/
    ├── headless_ingest.py
    └── spawn_ten_subagents.py
```

`plan_collect`、`promote`、适配器 registry **不准**从 `distilly` 根再 export。要深用去 `distilly.engine` / `distilly.adapters`。

对应：

| DSH | distilly |
|---|---|
| `packages/sdk/protocol` | `distilly_protocol` |
| `api.ts`（`DeepSeekHarness`+Session） | `api.py`（`Distilly`+`Person`） |
| `client.ts` | `client.py` |
| `packages/sdk/server` + runtime | `distilly_engine` |
| Cordis 插件 | `SourceAdapter` + entry point（同一道缝，不是同一框架） |
| 不存在于 SDK 组的框架代码 | `distilly_bindings` |

Cordis 对 SourceAdapter：对上的是「扩展点在 runtime/engine，不在 Client」。对不上：Cordis 是整套插件运行时；entry point 只是发现并实例化一次；`SourceAdapter` 只解决 Material 从哪来。

现有可搬：`tools/adapters/base.py` + `__init__.py`；provenance / schema v4 / `meta.json` / `lineage.jsonl` / telemetry；约 110 本地测试。

---

## 7. 家目录文件树（运行时）

家：`~/.distilly/`，可用 `DISTILLY_ROOT` 改。

```
~/.distilly/
├── distilly.toml                      # 根配置（无 key 也能跑）
├── adapters.toml                      # 凭据；secret 字段由框架保管
├── spaces/
│   ├── entrepreneurs.china.toml       # 显示名、是否虚构、默认域包
│   └── anime.naruto.toml
├── subjects/
│   └── <subject-id>/                  # self / wang-xing / luffy
│       ├── manifest.json
│       ├── meta.json                  # schema、身份、provenance、材料集合哈希、lifecycle
│       ├── SKILL.md                   # 投影，可重建，不是事实
│       ├── profile/
│       │   ├── identity.md            # 内核，空合法
│       │   ├── voice.md
│       │   ├── psyche.md
│       │   ├── relations.md
│       │   ├── boundaries.md
│       │   ├── texture.md
│       │   ├── timeline.md            # 可空
│       │   ├── domains/
│       │   │   ├── vocation.md        # 有材料才建
│       │   │   ├── craft.md
│       │   │   ├── intimacy.md
│       │   │   ├── kinship.md
│       │   │   └── public.md
│       │   └── claims.jsonl
│       ├── knowledge/
│       │   ├── messages/
│       │   ├── emails/
│       │   ├── docs/
│       │   ├── web/
│       │   ├── transcripts/
│       │   ├── raw/                   # 图/PDF/音频；未转文本不进蒸馏
│       │   └── corrections/           # 最高信
│       ├── versions/
│       │   ├── vN/                    # 当时整个 profile/ + SKILL + meta
│       │   └── vN-awaiting/           # 置信度下降未顶替
│       ├── lineage.jsonl
│       └── state.json                 # pending / awaiting_promote / 上次集合哈希
├── relations/
│   └── <a>__<b>/                      # 仅「关系也值得蒸」时升级
├── graph/
│   └── relations.jsonl                # 关系事实层，只追加 + valid_to
└── .index/                            # 可删可重建
    ├── sqlite/
    │   ├── queue.db                   # ingest/distill/index + LSN
    │   └── graph.db                   # 节点、关系、mention；派生边以后才有
    └── catalog.json                   # list/search 投影
```

旧 `PRIMARY_ARTIFACTS`（`SKILL.md` `work.md` `persona.md` `work_skill.md` `persona_skill.md` `manifest.json` `meta.json`，schema v4）迁移时拆进内核/域。`work_skill.md` / `persona_skill.md` 若还要，是 **install 时的切片**，不是家里的结构。

`install(host)`：

```
~/.distilly/subjects/<id>/     ← 唯一事实
        │  install("claude-code")
        ▼
~/.claude/skills/<id>/SKILL.md ← 投影，可再生成
```

血缘和材料不搬家。

---

## 8. 七组产品能力（内部清单）+ 对外瘦 SDK

七组是**怕漏**，不是用户 API。面板 / 市场 / 批准没有这些动词会做不出来。对外第一眼仍是 `Distilly` + `Person`。

### 8.1 主体

| 方法 | 做什么 |
|---|---|
| `create(kind, name, **identity)` | 建人。kind 是域包：`person` / `colleague` / `celebrity` / `self` |
| `list(*, kind=None, space=None)` | 有哪些人 |
| `get(subject, version=None)` | 结构化 profile。Recall 用 |
| `search(query)` | 按名字 / 标签 |
| `delete(subject)` | 软删除，不物理抹血缘 |

`self` 用 `create("self")` 一次即可。

### 8.2 收集

| 方法 | 做什么 |
|---|---|
| `ingest(subject, materials)` | 所有路径汇合：落盘、哈希、去重、过边界 |
| `ingest_files(subject, paths)` | 用户丢文件 |
| `list_adapters()` | 已注册来源 |
| `resolve_subject(adapter_id, query)` | 平台上这个人是谁，多候选不猜测 |
| `plan_collect(...)` | 委托：给宿主 `AgentPlan` |
| `accept_collect(plan, artifacts)` | OCR/正文 → Material → 内部 ingest |
| `collect(...)` | Direct 适配器自己采（v1 可不实现） |
| `preflight(adapter_id)` | 凭据在不在，别浪费队列 |

宿主自己扒网收成文本，直接 `ingest`，不必经过适配器。

### 8.3 蒸馏与修正

| 方法 | 做什么 |
|---|---|
| `pending()` | 已过边界、等宿主蒸 |
| `flush(subject)` | 现在就过边界 |
| `commit(subject, draft, provenance)` | 交回结果；置信度下降 → awaiting_promote |
| `promote` / `reject` | 处理挂起版本 |
| `correct(subject, patch)` | `corrections/` + 立刻新版本 |
| `status(subject)` | 材料数、集合哈希、队列态、confidence / maturity |

### 8.4 版本

| 方法 | 做什么 |
|---|---|
| `versions(subject)` | 列表 + 每版 provenance 摘要 |
| `diff(subject, a, b)` | 两版差异 |
| `rollback(subject, version)` | 恢复为当前；血缘记一次 rollback，不删历史 |
| `lineage(subject, version=None)` | 读 jsonl，版本粒度源清单 |

### 8.5 装载

| 方法 | 做什么 |
|---|---|
| `prompt(subject, version=None)` | 只给模型看的投影字符串，不落宿主目录。临时 10 个用这个 |
| `export(subject, host)` | 一对一身份文件（SOUL.md / agent.md） |
| `install(subject, host)` | 写入该宿主 skills 根。实现必须是 host id → 安装器插件，不能写死 Claude 路径 |
| `uninstall(subject, host)` | 去掉投影，不动家里 |

### 8.6 市场（接口留着，实现第二版）

`browse` / `pull` / `publish`。不要进 MCP，不要进 README 第一屏。

### 8.7 关系

`link` `invalidate` `neighbors` `path` `subgraph` `mentions` `resolve_mention`

`similar` / `rebuild_graph` 留给以后的「相似」，第一版不做。

---

## 9. 类与函数（实现规格）

### 9.1 `Distilly`（`src/distilly/api.py`）

```python
class Distilly:
    def __init__(self, root: str | Path = "~/.distilly", *, client: EngineClient | None = None) -> None: ...
    def person(self, subject_id: str, *, space: str | None = None) -> Person: ...
    def create(self, subject_id: str, *, space: str, display_name: str,
               domain_pack: str = "person", aliases: list[str] | None = None) -> Person: ...
    def list(self, *, space: str | None = None) -> list[SubjectSummary]: ...
    def search(self, query: str) -> list[SubjectSummary]: ...
    def pending(self, *, subject_id: str | None = None) -> list[PendingJob]: ...
    def commit(self, job_id: JobId, draft: DistillDraft, *,
               actor: Literal["host", "daemon", "user"] = "host") -> Version: ...
    def promote(self, version_id: VersionId) -> Version: ...
    def reject(self, version_id: VersionId, *, reason: str | None = None) -> None: ...
    def subgraph(self, seed: list[SubjectId], *, hops: int = 1) -> RelationGraph: ...
    def close(self) -> None: ...
```

市场方法第二版再挂，不要为了做市场养肥 `Person`。

### 9.2 `Person`

```python
class Person:
    @property
    def id(self) -> SubjectId: ...
    @property
    def space(self) -> SpaceId: ...

    def get(self, *, version: VersionId | None = None) -> Profile: ...
    def prompt(self, *, version: VersionId | None = None) -> str:
        """完整中性 Markdown。第一版 = render(get())，不裁。"""

    def ingest(self, materials: list[MaterialIn], *, source: str) -> IngestResult: ...
    def ingest_files(self, paths: list[Path], *, kind: str = "docs") -> IngestResult: ...
    def accept_collect(self, plan: AgentPlan, artifacts: list[str], *, adapter_id: str) -> IngestResult: ...
    def collect(self, adapter_id: str, request: CollectRequest) -> AgentPlan | IngestResult:
        """委托返回 Plan；Direct 自己采。"""

    def correct(self, text: str, *, facet: str | None = None) -> Version: ...
    def flush(self) -> PendingJob: ...
    def status(self) -> SubjectStatus: ...

    def versions(self) -> list[Version]: ...
    def diff(self, a: VersionId, b: VersionId) -> ProfileDiff: ...
    def rollback(self, version: VersionId) -> Version: ...
    def lineage(self, *, version: VersionId | None = None) -> list[LineageEvent]: ...

    def install(self, host: HostName) -> InstallRef: ...
    def uninstall(self, host: HostName) -> None: ...
    def export(self, host: HostName, dest: Path) -> Path: ...

    def link(self, other: str | Person, *, type: str, evidence: list[EvidenceRef],
             confidence: float | None = None) -> Relation: ...
    def invalidate(self, relation_id: RelationId, *, reason: str) -> None: ...
    def neighbors(self, *, type: str | None = None) -> list[Relation]: ...
    def path(self, other: str | Person, *, max_hops: int = 3) -> list[Relation]: ...
    def mentions(self) -> list[PendingMention]: ...
    def resolve_mention(self, mention_id: MentionId, subject_id: SubjectId) -> Relation: ...
```

README 第一屏只写：`get` `ingest` `ingest_files` `correct` `install` `link` `neighbors`，外加 `Distilly.pending/commit`。其余是句柄上的次要方法。

和 Mem0 的差别必须保留：他们 `add` 就抽事实；我们 `ingest` 只收材料，`commit` 才是蒸完的人。两个动词不能合成一个，否则零 key 断了。

### 9.3 `EngineClient`（`client.py`）

```python
class EngineClient(Protocol):
    def call(self, method: str, params: dict[str, Any]) -> Any: ...
    def close(self) -> None: ...

class InProcessEngineClient:
    def __init__(self, root: Path) -> None: ...

class DaemonEngineClient:
    """第二版。stdio / UDS JSON-RPC。方法名与 InProcess 相同。"""
```

方法名与 protocol 对齐：`subjects.*` `materials.ingest` `distill.*` `profile.*` `graph.*` `hosts.*`

### 9.4 值类型（`models.py`）

```python
SubjectId = Branded[str, "SubjectId"]
# VersionId JobId RelationId MentionId SpaceId 同理
HostName = Literal["claude-code", "codex", "langgraph", "openai-agents", "hermes", "telegram"]

@dataclass(frozen=True)
class EvidenceRef:
    material_digest: str          # 现有 src_ + 8 位 hex 同源
    quote: str | None = None
    path: str | None = None

@dataclass(frozen=True)
class Claim:
    id: str
    facet: str                    # voice.opener / texture.hands / psyche.contradiction.thrift-vs-gift
    text: str
    evidence: tuple[EvidenceRef, ...]
    confidence: float             # 材料支撑度 0..1
    salience: float               # 第一版写入，暂不裁剪
    domain: str | None = None
    observed_in: tuple[str, ...] = ()
    valid_from: datetime | None = None
    valid_to: datetime | None = None

@dataclass(frozen=True)
class CoreFacet:
    name: Literal["identity", "voice", "psyche", "relations", "boundaries", "texture", "timeline"]
    markdown: str

@dataclass(frozen=True)
class DomainFacet:
    name: str
    markdown: str

@dataclass(frozen=True)
class Profile:
    subject_id: SubjectId
    version_id: VersionId
    core: tuple[CoreFacet, ...]
    domains: tuple[DomainFacet, ...]
    claims: tuple[Claim, ...]
    confidence: float
    maturity: Literal["sparse", "forming", "stable"]
    rendered: str

@dataclass(frozen=True)
class MaterialIn:
    kind: str                     # message / document / web / transcript / ...
    content: str                  # 进蒸馏必须是文本
    source_id: str | None = None
    occurred_at: datetime | None = None
    participants: tuple[str, ...] = ()
    metadata: dict[str, object] = field(default_factory=dict)

@dataclass(frozen=True)
class DistillDraft:
    material_set_hash: str
    claims: tuple[Claim, ...]
    core_markdown: dict[str, str]
    domain_markdown: dict[str, str]
    relations: tuple[RelationDraft, ...] = ()   # commit 可附带抽到的关系，否则 1000 人蒸完图是空的
    notes: str | None = None

@dataclass(frozen=True)
class Version:
    id: VersionId
    subject_id: SubjectId
    parent_id: VersionId | None
    actor: Literal["host", "daemon", "user"]
    material_set_hash: str
    confidence: float
    status: Literal["current", "suspended", "rejected", "historical"]

@dataclass(frozen=True)
class Relation:
    id: RelationId
    space: SpaceId
    a: SubjectId
    b: SubjectId
    type: str                     # 开放点分：work.invested / canon.rival / fanon.*
    role: dict[str, str] | None   # {src: "invested", dst: "founded"}
    evidence: tuple[EvidenceRef, ...]
    confidence: float
    valid_from: datetime
    valid_to: datetime | None
    extracted_from: VersionId | None

@dataclass(frozen=True)
class PendingMention:
    id: MentionId
    raw_name: str
    context: str
    subject_hint: SubjectId | None
```

Claim 落盘示例（对话里的形状，实现时对齐）：

```yaml
id: clm_8f3a
facet: voice.opener
statement: "语音开场几乎总是『喂——你听得到吗』，从不用『在吗』"
salience: high
confidence: 0.86
evidence: [src_a1b2, src_c3d4]
domain: null
observed_in: ["voice-note", "late-night"]
```

### 9.5 错误

`DistillyError` `NotFound` `AlreadyExists` `StaleVersion` `PendingCommit` `ConfidenceGate` `AmbiguousMention` `HostUnsupported`

采集错误用适配器那棵树，`ingest` 再映射。

### 9.6 引擎关键类

```python
class Layout:  # 全部路径约定
    def subject_dir / profile_dir / core_md / domain_md / claims
    def knowledge / corrections / versions / lineage / relations_log / queue_db

class MaterialStore:
    def put(self, subject, item) -> tuple[str, bool]: ...   # digest, is_new
    def inventory(self, subject) -> tuple[str, ...]: ...    # raw 未转文本的不在内
    def set_hash(self, subject) -> str: ...

class SubjectStore:
    def create / get / list / read_profile / write_current

class QueueService:
    def enqueue(self, kind: Literal["ingest","distill","index"], subject, payload) -> JobId: ...
    def claim(self, kind, worker) -> QueueRow | None:
        """UPDATE ... WHERE status='pending'。rowcount==0 表示被抢。"""
    def finish(self, job, *, ok: bool, retryable: bool | None, error: str | None) -> None:
        """WHERE status='processing'。用户又改文件导致已 UPSERT 成 pending 时，丢掉过时的 done。"""
    def recover_orphans(self) -> None:
        """启动：processing → pending。"""
    def pending_distill(self, subject=None) -> list[PendingJob]: ...

class MaterialHasher:
    def hash_set(self, digests: Sequence[str]) -> str: ...

class DistillRunner:
    def should_run(self, subject) -> bool: ...          # 哈希相同 → False
    def host_briefing(self, subject) -> HostBriefing: ...
    def run_llm(self, subject, config: LlmConfig) -> DistillDraft: ...

class DraftValidator:
    def validate(self, draft, expected_hash) -> None: ...  # 空核合法；claim.facet 语法

class CommitService:
    def commit(self, job, draft, actor) -> Version: ...
    def promote / reject

class ProfileRenderer:
    def render_facet(self, facet, claims) -> str: ...
    def render_prompt(self, profile) -> str: ...          # 第一版不按 salience 丢

class V4Migrator:
    def migrate_subject(self, old_dir, dest) -> None: ...

class RelationLog:
    def link / invalidate / neighbors   # neighbors 必须走部分索引，禁止热路径全文件扫

class MentionQueue:
    def add / resolve

class SkillProjector / HostExport
```

队列表学 EverOS：一个主体（或一个路径）一行，不是一个事件一行——worker 来不及处理时同一主体被改十次，UPSERT 成最新，天然去重。LSN：给顺序、重新入队公平、算积压。照抄时注意：**`MAX(lsn)+1` 不是严格单调**，两个并发 writer 可能撞号；EverOS 自己也承认。我们若以后做 CDC 再 `BEGIN IMMEDIATE`。mtime 容差必须和对账器共用一个常量。

失败三态：`retryable=True` 自动再入队；`False` 等人改文件（改了会变 mtime）；`NULL` 这行没失败。内容变了重试计数清零。

### 9.7 MCP（模型那张脸）

只这些。不要把七组都变成 tool。`link` 第二版再给模型，避免乱连。`browse` 永远不要给模型当常用工具。

| 工具 | 对应 |
|---|---|
| `distilly_get` | `Person.get` / `prompt` |
| `distilly_ingest` | `Person.ingest`（必须带 subject_id） |
| `distilly_pending` | `Distilly.pending` |
| `distilly_commit` | `Distilly.commit` |
| `distilly_correct` | `Person.correct` |

1000 个人不能 `get` 一遍；模型只应对当前这个人 `get`。

---

## 10. 采集适配器（已有设计，原搬）

文件：`tools/adapters/base.py` → `src/distilly_adapters/base.py`。

三种 mode：`direct_api` / `direct_browser` / `agent_delegated`。只许子类 `DirectAdapter` 或 `DelegatedAdapter`。构造无网络、无读凭据。适配器写盘即越权。

主路径第一版：**模型采完 `ingest`**。适配器是降摩擦，不是开关。没有飞书适配器，蒸馏照样能跑。`direct_api` 第一版只留接口，仓库里不写飞书官方 API。最多带 1～2 个委托样板（`web`、`feishu`）证明社区能扩。

材料类型留在抽象里，不绑厂商视觉 API：`text` `image`（附可选 OCR）`document` `audio`（附可选转写）。

错误：`AdapterError`（`retryable` + `remediation`）、`AdapterAuthError`、`AdapterScopeError`、`AdapterUnavailable`、`AdapterRateLimited`（`retry_after_seconds`）、`AdapterTransient`。

值类型：`SubjectRef` `Material` `AdapterCapabilities` `CollectRequest` `PreflightResult` `AgentPlan`。

```python
class SourceAdapter(ABC):
    adapter_id: str
    display_name: str
    def capabilities(self) -> AdapterCapabilities: ...
    def config_fields(self) -> dict[str, str]: ...          # _token/_secret/_key 当秘密
    def preflight(self, config) -> PreflightResult: ...
    def resolve_subject(self, query, config) -> list[SubjectRef]: ...

class DirectAdapter(SourceAdapter):
    def collect(self, subject, request, config) -> Iterator[Material]: ...  # 生成器，部分成功先 yield 再 raise

class DelegatedAdapter(SourceAdapter):
    def plan(self, subject, request) -> AgentPlan: ...
    def accept(self, plan, artifacts) -> Iterator[Material]: ...  # 解析失败用 AdapterUnavailable，不可重试
```

注册表：`ADAPTER_ENTRY_POINT_GROUP = "distilly.adapters"`；`register` / `load_adapters` / `get_adapter`。第三方 import 失败：警告并跳过。

---

## 11. 宿主注入适配器（第一版就要）+ 实际会碰到的坑

采集适配器可以后做。**注入适配器第一版就要有**，否则 `get` 在各家会塞错地方。

这是 ChatCut widget-forms 的同类物：中性语义按宿主翻译。他们翻译「问人」；我们翻译「灌人格」。

```python
@dataclass(frozen=True)
class Injection:
    instructions: str
    subject_id: SubjectId
    version_id: VersionId
    display_name: str

class HostInjector(Protocol):
    host: HostName
    def inject_subagent(self, injection: Injection, request: HostSpawnRequest) -> HostSpawnRequest:
        """禁止写全局 md。禁止把这次注入登记成 install。"""
    def install(self, profile: Profile, dest_root: Path) -> InstallRef: ...
    def export_identity(self, profile: Profile, dest: Path) -> Path: ...
```

`get` 只产出一份中性 Markdown。不要为 Claude 和 Codex 蒸两份 profile。各适配器只加前后几句包装（「你就是下面这个人」/ Hermes 第二人称）。

三种装法，混用会把产品做脏：

```
profile/（家里，唯一事实）
    ├─ prompt() / get()  → 这一次子代理     ← 临时 10 个
    ├─ install(host)     → 宿主 skills/     ← 长期、可发现
    └─ export(host)      → agent.md/SOUL.md ← 一个常驻身份一个文件
```

`agent.md` / `AGENTS.md` / `CLAUDE.md` / `SOUL.md` 都是**这份运行时的全局说明书**。一份进程通常只吃一套，用来写「怎么测试」，不是用来轮换人格。

- 改全局文件 = 所有对话、所有子代理一起变
- 派 10 个临时的还要写 10 份、用完再删，和宿主缓存缠在一起
- 10 个人写进同一份，上下文又挤又串台

所以：`agent.md` 只适合「这一个常驻 bot 长期就是王兴」。不适合「现在并行 10 个企业家」。`install` 也偏长期，且常要新开对话（工具/技能按会话固定）。

**「会话级」在 coding agent 里 = 子运行级注入，不是改当前窗的隐藏 system。** 各家都没有稳妥的「给当前会话打补丁」API。

| 环境 | 实际口子 | 10 个临时 |
|---|---|---|
| Claude Code | 派 Task / 子代理时自定义 prompt | 10 次派发，每次换一个人 |
| Codex | 子任务 instructions / Runner dynamic instructions | 同上 |
| OpenAI Agents / LangGraph | 每轮 run 的 instructions | 最干净 |
| DSH | 每个 `session(id)` | 10 个 session |
| Hermes / Telegram | 一个进程一份人格 | 不适合「临时」；要 10 个就 10 个进程 |

你会碰到的七件事（适配器必须挡住）：

1. **没有统一的「设置系统提示」。** 父对话里 `get` 了，父自己不会自动变成那个人。10 个临时必须派 10 个子运行。
2. **塞错槽位污染全局。** 写成改 `AGENTS.md`/`CLAUDE.md` = 全仓库沾上，10 个人互相覆盖。产品 skill 第一禁令。
3. **`install` ≠ 会话注入。** 适配器不要默认走 install。
4. **各家包装不同。** 中性正文一份。
5. **子代理不一定带得上 MCP。** 人格必须已经在它的 prompt 里。父 get、子只拿文本。
6. **完整 profile 的代价。** 10 路 = 10 份全文。第一版不管裁剪；塞不下只报「塞不下」。
7. **和 widget-forms 同类。** 不要在 Codex 里用 Claude elicitation HTML，也不要在 Claude 里调 Codex widget。只调用本宿主有的 spawn/instructions API。

产品 skill 写死：先 `get`，再按当前宿主适配器投放，禁止改仓库里的 `AGENTS.md`。父模型必须记得调 `get`，或写成固定流程——和 ChatCut 必须写 skill 是同一个原因。

---

## 12. 插件怎么做（ChatCut：抄包，不抄云）

仓库参照 [ChatCut-Inc/agent-plugin](https://github.com/ChatCut-Inc/agent-plugin)：

```
codex/.codex-plugin/plugin.json + .mcp.json + skills/
claude/.claude-plugin/plugin.json + skills/   # 规范 skill symlink
```

用户侧 ChatCut：`marketplace add` → `plugin add` → **`mcp login` OAuth** → **必须新开对话**。业务走远程 `https://api.chatcut.io`。要表单走 Codex MCP App widget。要给用户看编辑器时返回 `browserHandoff.url`，Codex 内嵌浏览器。模型不能去点编辑器 DOM。

ChatCut「托管 origin + OAuth」= 项目状态在他们云上，MCP 是远程的，登录换 token。**我们的内容不需要加载到云端。** profile 只在 `~/.distilly`。

该抄：一个 git 当 marketplace；`codex/`+`claude/` 两包；规范 skill symlink；`plugin.json` 的 interface（Codex 有品牌位）；装完提醒新开对话；表单走宿主原生能力。

不该抄：远程 MCP + login；人的数据放云；第一版就做 IAB 大面板；在插件包里复制引擎。

验收（Codex 插件成立的四条）：

1. `plugin add` 之后新开对话，模型能列出五个工具
2. 「蒸馏公开人物 X」走完：浏览 → ingest → commit → 本地出现 `subjects/`
3. 下一句「你是 X」能 `get` 到声音和例句
4. **不登录任何云账号**也能完成

面板以后：MCP 返回 `http://127.0.0.1:<固定端口>`，Codex IAB 能开 loopback（已查）。Claude 侧可行性未验证。第一版可以没有面板。

`install` 实现必须是安装器插件，每多一个宿主加一个安装器，和适配器同一道缝。

---

## 13. widget-forms 是什么

不是一种表单控件，是一份「问人」的适配 skill。不决定问什么，只决定：在这个宿主上，结构化问题用什么原生 UI 问出来。

ChatCut 网页能渲染的标签，Codex/Claude 渲染不了。所以他们抽中性字段再翻译：

| 语义类型 | 意思 |
|---|---|
| `short_text` | 一行文本 |
| `explicit_consent` | 必须用户主动确认，不能预勾 |
| `playable_single_choice` | 单选，选项上能带试听 |
| `playable_preview` | 只展示，不提交 |
| `audio_reference` | 表单里不能上传；让用户把文件附到对话上 |

- Codex：`ask_followup_questions`，MCP App 卡片。不要输出 HTML。
- Claude：Elicitation / `show_widget`。**禁止**调 `ask_followup_questions`。

distilly 若第一版要在 Codex 里问「蒸哪个人 / 选哪个版本」，才需要同类东西。只做 get/ingest/commit、用对话能问清楚的，可以先不做。ChatCut 必须做，是因为选素材/配乐/导出纯文本很容易问乱。

---

## 14. Bot（你早就说可以先做，中间被挤掉了）

Bot 不是第四套引擎，是 **Person 的又一种装法**：常驻对话入口，默认 `get` 某个人，用户 @ 跟这个人说话。

| | Codex / Claude 插件 | Bot |
|---|---|---|
| 谁在跑 | 用户打开的 coding agent | 挂着人格的对话进程 |
| UI | IDE + MCP + 可选面板 | Telegram / Discord / Hermes |
| 一次加载 | 可以 `get` 不同人 | 通常钉死一个人 |
| 采集 | 模型去扒 | 用户丢消息/图/语音 → `ingest` |

Hermes profile = 独立 agent（SOUL.md、技能、头像）。那是我们的 `export`/`install` 目标，不是另一种 profile。

Telegram：启动时 `person.get()` 塞进 system，每轮用户消息 `ingest`（或先缓冲）。**聊天窗口就是面板。**

版本：第一版一个 bot 钉一个 subject + 一个 version。要换人就换一个 bot。图在家里，bot 只是图上某一个节点的嘴。

Bot 24 小时自己回，需要的是 **bot 宿主的对话模型 key**，不是 distilly 的蒸馏 key。蒸馏仍可：人在 Codex 里蒸好再 `install`；或 bot 看到 `pending` 再蒸（走有 key 那条执行者）。

**不准自己实现一套人格文件。** 只准 `get`/`ingest`/`commit`/`install`。ChatCut 没有 bot 线，所以他们只有 `codex/`+`claude/`。我们多一个 binding，不要再复制一份 `profile/`。

建议落地（补回你早先的优先级）：

1. 引擎 + `Person` 五个动词
2. **一个 bot 绑定**（Hermes 或 Telegram）
3. Codex / Claude 产品插件
4. 面板 / 关系图 / 我们自己的市场

插件让 coding agent **做**蒸馏；bot 让普通人 **跟蒸好的人说话**。

---

## 15. Profile layer（为什么 work+persona 装不下所有人）

顶层 `work.md`+`persona.md` 把「人」默认切成「同事」。关系、名人只能再各写一套 Layer，每多一类人就分叉一次。佳秀那份例子写得好，是因为口头禅、星座、哈哈哈这些细节在；结构上她仍然先是「HRBP」。换成母亲、主播、已故作家、你自己，`work.md` 要么空、要么硬编职责范围。

正确：所有人共用同一套内核；差异进可选的域；细微性格进带证据的 Claim。

### 15.1 内核（闭集，改要 bump schema）

| 面 | 文件 | 装什么 | 真实性主要靠它 |
|---|---|---|---|
| 身份 | `identity.md` | 名字、别称、**复数角色**（可以同时是妈妈、编辑、前同事）、公开/私下身份 | 角色是列表，不是一个 job title |
| 声音 | `voice.md` | 口头禅、节奏、标点、**会怎么说的对话例** | **最重要**。没有例就没有这个人 |
| 内在 | `psyche.md` | 价值观排序、矛盾（人可以自相矛盾）、怎么决定、怎么回避 | 比 MBTI 标签真 |
| 对人 | `relations.md` | 对不同关系的模式：亲密、陌生、权威、群体。用关系类型，不用职级 | 同事只是其中一种 |
| 边界 | `boundaries.md` | 雷区、拒绝方式、不会做的事 | 没有边界的人像角色扮演 |
| 质地 | `texture.md` | 身体习惯、口味、时间感、具体物件、只有 ta 会做的小事 | 「越真实越好」主要加在这里 |
| 时间 | `timeline.md` | 只记有证据的时间点 | 可空 |

内核**禁止**出现「职责范围 / 技术栈 / 对上级汇报」。那些属于域。

蒸馏规则：**材料撑不住的面就空着或标 unassessed，不许用模板句填满。** 空是合法状态。客观蒸馏在文件树上的含义就是这个。

### 15.2 Domain 和 vocation（你问过「vocation 是什么」）

**Domain** 是这个人生活里的一块，有材料才建，没有就不建。不是标签，也不是人的类型。

**Vocation** 是其中一块：ta 怎么做事、靠什么立足——上班、创业、做研究、当老师都算。故意避开「工作 / work」：work 太像同事 skill 里那份职责档案。全职父母、学生、僧人、职业棋手可能有 vocation，母亲往往**没有这个文件**。

| | 内核 | vocation 域 |
|---|---|---|
| 企业家 | 说话先否定再给方案 | 怎么看项目、怎么待投资人、哪几次出手 |
| 动漫角色 | 口头禅、冲动、对谁护短 | 若「职业」是忍者/猎人才写 |
| 你妈妈 | 催你吃饭的句式 | 往往没有 |
| 同事佳秀 | 星座、哈哈哈、语音习惯 | HR 的 pipeline、面评、HC |

还可以有：`craft`（创作方法）、`intimacy`、`kinship`、`public`、`civic`、以后 `fandom.md`——加域不加引擎。

域包：`create("colleague")` = 建议启用 vocation；`create("person")` = 只蒸内核。这是默认打开哪些域，不是两种人型。

### 15.3 Claim

「说话前先笑一下」「拒绝时会先夸对方」「只在语音里骂人」不该再塞进某 Layer 散文里无法溯源。

`facet` 开放点分命名，新细节 = 新路径，不 bump schema。内核 Markdown 给人读、给模型演；`claims.jsonl` 是机器索引和血缘。蒸馏时**先写 claim，再渲染各面散文**。

置信度按「有证据的 claim 覆盖了多少内核面」算，不是模型对自己文笔的打分。

`correct`：`corrections/` 一条材料 → 立刻改对应 claim + 重渲染那一面。

可扩展性靠：内核闭、域开；facet 走数据不走发版；空面合法；家族降级成域包；投影与事实分离（以后给 bot 短卡、给面板全卡，都从同一棵 `profile/` 编）。

---

## 16. 关系图

1000 人不能靠再堆 `relations/a__b/` 目录。那种目录是「这段关系本身也值得蒸一版 profile」。图谱要的是大量轻边。

### 16.1 两种边（先讲清楚，再只用第一种）

曾用名「陈述边 / 派生边」，你不喜欢「陈述」。对用户和面板：

| | 关系 `Relation`（第一版做） | 相似 `Affinity`（第一版不做） |
|---|---|---|
| 从哪来 | 材料写明、蒸馏抽到、或手动 `link` | 两人在同一 facet 上足够像 |
| 例子 | 合伙、师徒、对手、夫妻、同部作品 | 都用「不是，我的意思是」开场 |
| 存哪 | 事实层 `graph/relations.jsonl`，进血缘 | `.index/`，删了能从 claim 重建 |
| 变了怎么办 | `valid_to` 失效，不删 | claim 变了重算 |

不要把「我觉得他们性格像」写成关系——没证据会把图弄脏。官网上写了是联合创始人，不要只当相似度。

面板以后：关系实线，相似虚线。点实线看证据和时间；点虚线看对上的那几条 claim。

### 16.2 节点、space、边字段

节点就是已有 `subject`。企业家、动漫角色都是 `person`，差在域和 **space**，不新造 node 类型。1000 个企业家和 1000 个火影角色默认各一个 space。边默认不出空间；「这个角色像哪个企业家」是跨空间查询，显式打开。

边字段：`type` 开放点分，与 `claim.facet` 同一套扩展法。先给常用：`family.*` `intimacy.*` `work.coworker` `work.founded` `work.invested` `work.rivals`；叙事 `canon.ally` `canon.rival` `canon.mentor` `fanon.*`（同人必须标 fanon）；观念 `influenced_by` `opposed_to`。同一对节点可以有多条不同类型。

边多到「这段关系本身要蒸」时，再升级成 `relations/{a}__{b}/` 完整树。1000 人里只有少数对需要升级。

`commit` 必须能带 `edges[]` / `relations`，否则批量蒸完图是空的。对不上的名字进 `pending_mentions`，人点一下对齐——自动猜错会把图污染到无法用。

动漫角色打开 `fictional`。边可以标 canon/fanon。

### 16.3 复杂度（你问过是不是 O(n)）

| 动作 | 复杂度 |
|---|---|
| 插入节点 | **O(1)**。建目录、插一行索引 |
| 接上关系 | **O(k)**，k = 这次抽到的关系数，与全图人数无关 |
| 相似（倒排，以后） | O(C × 该 facet 平均人数)，通常 ≪ O(n) |
| 相似（朴素） | O(n)。1000 人可接受，10 万不行 |
| 整库 rebuild | O(人数 + 边 + 全部 claim) |

**不要在每次 commit 里对全图做两两全比较（O(n²)）。** 那才会炸。

宽 facet（「都爱用句号」）以后也不物化相似边，只在查询时算。

---

## 17. 为什么现在可以不上 SQLite 检索，以后怎么上

Basic Memory 三组表：文件系统镜像（`checksum`/`mtime`/`size` 跳过未变文件；`permalink` 与 `file_path` 分离，wikilink 不因搬家失效；`relation.to_id` 可空、`to_name` 必有 = 前向引用）；同步状态机（库与磁盘各一份版本+校验和，五态含 `external_change_detected`；`note_file_vacate` 区分移动幽灵和真复制）；FTS5（`tokenchars 0x2F` 让路径不被切碎，`prefix='1,2,3,4'`）。

**现在不需要。** 一份 persona 几 KB，整份进 context。引入是过度工程。

**marketplace 一做就会需要。** 面板要在几百个 profile 里按家族、成熟度、血缘来源筛；`lineage.jsonl` 问「第 5 版用了哪些源」得全文件扫。到那时：Markdown/JSONL 仍是事实，SQLite 只做可删重建的投影。我们已有 `src_` + 八位 hex，增量重建判据现成。

embedding 大概率不需要。只有市场上千个 profile 要语义搜时，也可以跑本地模型，仍不必 key。

EverOS 读路径（备忘，第一版不用）：`SearchManager` 只读；按 `owner_type` **硬分区**不是 where 过滤；组件缺失直接抛错不退化成 grep；heap-expand 让 episode 和 atomic_fact 在同一排序空间竞争（事实驱逐）。我们三个家族以后若检索，与其过滤，不如从一开始走不同召回——celebrity 涉及公众人物，本该和同事走不同策略。

---

## 18. 遥测（你问过能不能记次数上传服务器）

能做。已经在 prototype 里落地：`tools/telemetry.py`，opt-in，无端点则完全惰性。环境变量现为 `DOT_SKILL_TELEMETRY` / `DOT_SKILL_TELEMETRY_ENDPOINT`，改名后换 `DISTILLY_*`。

约束（哲学 2.3 / 2.4）：

- 没配端点就不问、不发
- 交互式问一次并记住；非交互拒绝且不落盘
- 数的是创作（蒸了、装了），承认数不到「被模型读了 SKILL.md」
- 禁止为了指标在投影里塞必调工具

---

## 19. 现有完成度（按产品愿景，不按已写行数）

| 子系统 | 内容 | 状态 |
|---|---|---|
| 蒸馏引擎 | prompts 三家族 + skill_writer 七件产物 | 既有（将被内核/域替换） |
| 版本与血缘 | schema v4、内容寻址源清单、lineage、成熟度门禁 | 已落地 |
| 使用统计 | opt-in 匿名计数 | 已落地 |
| 质量门禁 | ruff 部分修了；CI workflow 触发分支仍是 `main`，默认分支 `dot-skill` | **CI 从未真正跑** |
| 采集抽象 | `SourceAdapter` 未提交 | 草稿 |
| SDK / 独立仓 | Distilly+Person、daemon、MCP | 零代码 |
| 前端面板 | loopback SPA | 零代码；Claude 可行性未验证 |
| Marketplace | 静态 JSON index + 内容哈希 revision | 零代码 |
| Bot 载体 | persona 绑定到 bot 运行时 | 零代码 |
| 注入适配器 | claude/codex/generic | 零代码 |

一句话：地基做完了，产品形态还没开始。约 110 个测试；插件/面板 0 行。

现有蒸馏→安装时序（prototype，迁的时候要改产物路径）：

```
用户提供材料
  → 宿主读 knowledge/ + prompts/ 蒸馏，产出 provenance
  → skill_writer --meta
  → normalize_provenance + scan_source_inventory
  → 写 7 件产物 + meta.json
  → append lineage.jsonl
  → 可选 skill_generated 遥测
  → install_* 成熟度门禁（低于 floor 拒绝）
  → 写入宿主 skills/
  → 可选 skill_installed 遥测
```

迁到 distilly 后：中间产物变成 `claims.jsonl` + 内核/域 Markdown，再投影 `SKILL.md`。

---

## 20. 主路径与成功标准

```
create(person, space)
  → 宿主扒 / 喂文件 / plan+accept
  → ingest（哈希变了才过边界）
  → pending → 宿主蒸（先 claims，再渲染，再投影）
  → commit(profile + claims + 抽到的关系)
      置信度下降 → versions/vN-awaiting
  → get / prompt / install
  → correct 落 corrections，立刻改对应 claim
```

第一版 SDK 成功标准（六步）：

1. 用户指定一个人
2. agent 用浏览或截图采到材料，或用户丢进导出文件
3. `ingest` 去重落盘
4. 宿主蒸馏并 `commit`
5. 下次对话 `get` 能加载这版
6. 用户改一处 `correct`，再 `get` 能看到，且 `corrections/` 里有记录

这六步过了，第一版成立。其余产品面往这几个方法后面加，不改 `Material` 和 `commit` 的形状。

Codex 插件另加第 12 节四条验收。总验收第一刀：无登录、无 key，对公开网页人物走完并 `get` 到带例句的 `voice` 和带 evidence 的 claim。

---

## 21. 落地顺序

1. 独立仓 + 改名（包、路径、遥测环境变量）
2. 修 CI 触发分支（加常驻进程之前必须有真实回归）
3. 搬 adapters + `Distilly`/`Person` + 进程内引擎 + 新磁盘 + v4 迁移
4. MCP 五工具 + 宿主注入（Claude Task / Codex instructions）+ 产品 skill 禁令
5. pending / commit / 置信度闸 / corrections / 集合哈希跳过
6. 关系 jsonl + `link`/`neighbors`/`mentions`
7. 一个 bot 绑定
8. Codex/Claude marketplace 插件包（本地 stdio）
9. daemon 队列（有 key 时）
10. 面板、相似、marketplace、Direct 飞书 API

第一版明确不做：daemon 常驻定时轮询（SDK 不强制）；必填 multimodal/embedding key；LanceDB；salience 裁剪；相似边；在 `api.py` 写死宿主路径。

---

## 22. 文档怎么演进

- 改接口先改本文，再改代码。
- 实现开始后仓库写现在时 `docs/architecture.md`，决策进 Agent Note。
- 开放项关闭时改 4.2 并注日期。
- 旧 skill 测试随迁移改断言：产物路径、schema v4 → `PROFILE_SCHEMA_VERSION`。
- 旁图 canvas 若与本文冲突，以本文为准（旧 canvas 里「仓库不准有采集适配器」「顶层 persona/work」已废）。

---

## 23. 仓库治理（从 DSH 抄形状，不抄全套门禁）

完整审计见同目录 [dsh-governance-audit.md](../process/dsh-governance-audit.md)。这里只写 distilly 落地时怎么用。

DeepSeek Harness 默认开发者是 **coding agent**。他们的「文档先行」不是先写博客，而是：

1. **决策有家**（`.agents/notes/{proposed,implemented,rejected}/`，强制写打败了什么）
2. **现状有家**（`docs/architecture.md` 只写现在时；一事实一归属）
3. **流程有家**（Skill 教怎么走，合同仍在 docs）
4. **能机器查的承诺写成 gate**（Note 格式、链接、预算……）；人只审语义

他们自己的原话：agent 听门禁比听散文可靠；「工作量大」不是理由，因为活是 agent 干的。

distilly 独立仓第一周最小集：

| 抄 | 做什么 |
|---|---|
| 根 `AGENTS.md` | 常设命令 1–3 行：先读 architecture；非平凡带 Note；Markdown 是事实；Client 不长业务 |
| Agent Note 三态 | 大功能先 `proposed/`（本文已经是）；落地同 PR 改成现在时 `implemented/` |
| cookbook | 「加 SourceAdapter / HostInjector」带验证步骤 |
| 窄 hook | lint + 空白；测试按 diff 跑，不把全套挂 pre-push |
| 后加的门 | 链接检查、Note 头格式；文档膨胀再加预算 |

不第一天抄：双语配对、逐文件 100% 覆盖、二十个 verify 脚本、Issue 政策全套。

本文（系统设计）是**现行产品合同**。调研、否决过的方案、EverOS 对照，以后应拆进 Agent Note，避免和 `Person.get` 签名永远长在同一篇里。
