# 对照：nuwa-skill 怎么做的，我们该抄什么

> 起因：讨论「语料形状」与「效果怎么量」时，被要求去看 `alchaincyf/nuwa-skill` 的做法。
> 本文只记录**跑过、读过**的事实，不转述宣传语。抓取日期 2026-09-15，仓库 `main` 分支。

## 0. 它是什么

- 形态：**纯 Skill**（`SKILL.md` + `references/` + `scripts/` + `examples/`），MIT，靠 Agent Skills 协议跑在
  Claude Code / Codex / Cursor / OpenClaw / Hermes 等 runtime。**没有 CLI、没有依赖、没有机械门禁。**
- 定位：输入一个名字 → 自动调研 → 提炼这个人的**思维框架**（不是角色扮演），产出一个 `*-perspective` Skill。
- 它的 README 开头写明师承：[同事.skill](https://github.com/titanwings/colleague-skill)「证明了蒸馏一个人是可行的」——
  也就是我们的前身。它把问题从「蒸馏同事」推到「蒸馏任何公众人物」。

## 1. 它的流程（6 个 Phase，带两个人工检查点）

| Phase | 做什么 | 关键设计 |
|---|---|---|
| 0 分流 | 明确人名 → 直接路径；模糊需求 → 诊断路径（10 个需求维度反推人选） | 没想好蒸馏谁时，先做需求定位再推荐 |
| 0A 澄清 | 确认人名/聚焦方向/用途/新建或更新，然后问一句：**「你手上有没有这个人的一手素材？书籍 PDF、演讲/访谈 transcript、视频字幕、博客导出」** | 这一问决定采集模式 |
| 0.5 建目录 | 先建 `references/research/01..06` + `sources/` | 调研必须落盘；「不存文件的调研等于没做」 |
| 1 采集 | **6 个并行 subagent**：著作 / 对话 / 表达 / 他者批评 / 决策 / 时间线，各写一个 md，标注一手 vs 二手，矛盾保留 | 三种模式：纯网络搜索 / 本地语料优先 / 纯本地语料；本地优先时只对缺失维度补搜 |
| 1.5 检查点 | 展示来源数量表 + 矛盾点 + 信息不足维度，**等用户确认** | 「垃圾进垃圾出，在这里拦截比在 Phase 4 返工便宜」 |
| 2 提炼 | 心智模型 3-7 个 + 决策启发式 5-10 条 + 表达 DNA + 价值观与反模式 + 内在张力 + 诚实边界 | 见 §2 的三重验证 |
| 2.5 检查点 | 展示提炼摘要，**等用户确认** | 「提炼是主观判断最重的环节」 |
| 3 构建 | 按模板填 `SKILL.md`，并生成「回答工作流（Agentic Protocol）」 | 从心智模型**反推**研究维度，遇到需要事实的问题强制先联网核查 |
| 4 验证 | 子 agent 跑 3 道已知立场题 + 1 道超范围题 + 1 道风格题 | 独立于主 agent，避免自评偏差 |
| 5 精炼 | 双 agent（结构评估 + 触发条件评审）产出改进建议 | Phase 2→4 最多循环 2 次，不无限打磨 |

## 2. 它凭什么说「这是心智模型」——三重验证

一个观点要被收录为心智模型，必须同时通过：

1. **跨域复现**：在此人讨论的 ≥2 个不同领域出现；
2. **有生成力**：能用它推断此人对新问题的立场；
3. **有排他性**：不是所有聪明人都会这样想。

只过 1 重 → **降级**为「决策启发式」；0 重 → 丢弃。
表达层另有量化口径：平均句长、疑问句比例、类比密度、第一人称使用率、确定性语气比例、转折频率。

## 3. 它怎么处理「说话人」——不处理，绕开

这是本次对照对我们最要紧的一条。

它的字幕工具链只有两个脚本（`scripts/download_subtitles.sh` 55 行、`scripts/srt_to_transcript.py` 108 行，
sha256 见 §7）。清洗逻辑是：**去掉序号行、时间戳行、HTML 标签，相邻重复行去重，短句合并成段**。
说话人标签**原样留在正文里**，交给读文本的模型自己理解。

它能这么干，是因为它的语料形状天然是**一个人的一手产出**（著作、本人演讲/访谈、本人社媒）。
多人会议根本不是它的输入。**它不是解决了说话人归属问题，是产品设计上绕开了它。**

用我们的公开语料实跑它的脚本（`us-house-floor-2009-07-29/transcript.srt`，C-SPAN 真实字幕）：

```
$ python3 srt_to_transcript.py us-house.srt us-house.nuwa.txt
✅ 转换完成  字数: 36399  段落数: 825

原始 SRT           : 84860 字符, 5430 行
它的 transcript    : 36399 字符, 825 段
说话人标签         : 84 处 → 产物里作为普通文本保留 84 处（无结构）
产物里还有时间戳吗 : 否（时间戳去干净了）
```

而它的产物开头是这样的：

```
starttime 1248896221.592 QUORUM IS NOT PRESENT AND MAKES WITH THE UNITED STATES HOUSE OF REPRESENTATIVES.
...
>> MR. S SUSPEND THE RULES AND PASS THE , A BILL TO RESTORE THE HIGHWAY TRUST FUND ...
```

两处泄漏值得记下来：**字幕头字段 `starttime 1248896221.592` 被当成正文写进了语料**；
**`>>` 换人标记没被剥掉**。我们的 `parse` 层对同一份文件会把这些头字段收进 warnings 并在产物里
报出来，而不是混进正文。我们这边同一份语料的产物是 `knowledge/text/*.md`：`[k00NN] <时间> <说话人>：文本`，
每行可回指到原文的字节区间，说话人从 84 处标签里认出 82 条记录。

**结论**：它的路线要的是「喂给模型读的干净语料」，我们要的是「每条结论能回指的审计链」。
两者的取舍不同，但「一个人」这个输入形状是对的，我们此前在会议记录上优化解析器是错的。

## 4. 它怎么量效果——保真度评分卡

`references/fidelity-scorecard.md`，100 分五维：

| 维度 | 分 | 测法 |
|---|---|---|
| 立场一致性 | 30 | 3 道人物公开表态过的问题，对比回答方向 |
| 风格辨识度 | 20 | 不看名字盲读，能否认出是谁（还是通用 AI 腔） |
| 边缘诚实度 | 20 | 1 道超范围题：标注「这是推断」=满分，伪装成本人断言 = 0 |
| 来源透明度 | 15 | **静态检查**：有来源章节、一手占比 >50%、关键引语有出处 |
| 结构完整度 | 15 | **静态检查**：心智模型 3-7 个、诚实边界 ≥3 条、内在张力 ≥2 对、反模式清单 |

等级 A ≥85 / B 70-84 / C 55-69 / D <55。铁律：**答题 agent 与评分 agent 必须是两个独立 agent，
绝不自评自证**（其文档引用 SkillLens 论文称 LLM 自评准确率 46.4%、接近随机；该论文我们未独立核对）。
反作弊四条：答题者不知道被测什么维度、评分者不参与答题、出题避开 skill 内已有示例对话、
重要结论双评分 agent 且分差 >10 人工复核。15 个官方 Skill 已全部跑完并公开分数。

**对我们最关键的判断**：这套评分卡的「立场一致性 30 分」需要**人物的公开已知立场**作为真值，
因此**只适用于公众人物**。我们的 A/B holdout（按时间码切语料，A 给蒸馏者、B 只给裁判）
不依赖真值，是给**私人语料**（同事 / 伴侣 / 自己）设计的。两者不是替代关系：
**公开人物用评分卡，私人语料用 A/B holdout。**

## 5. 逐项对照

| 维度 | nuwa-skill | 我们（dot-skill / distilly） | 谁更强 |
|---|---|---|---|
| 输入形状 | 一个人的一手产出（著作/访谈/社媒），多源 | 通道采集（chat/邮件/文档/字幕）+ 锚点账本 | 形状它更对；覆盖面我们更广 |
| 说话人 | 不处理，标签留成普通文本 | 解析层认领说话人（VTT voice / `Name:` / 全角冒号 / 句中换人），锚点带说话人 | 我们 |
| 字幕清洗 | 108 行 Python，去时间戳/序号/标签/重复行 | 结构化解析 + 字节级锚点 + 头字段进 warnings | 我们（可回指、不泄漏） |
| 提炼层 | 心智模型三重验证、决策启发式、表达 DNA、反模式、内在张力 | `derive/` 七个维度是**行为统计**（句长/标点/口头禅 n-gram/回应频次/时间线/边界/转向/冲突） | 它（认知层我们还没有） |
| 效果测量 | 评分卡五维 + 独立双 agent + 公开 FIDELITY.md | `blind-test.mjs` A/B holdout（prepare/finalize/control/score） | 各有适用域；**它已经跑出数字，我们还没跑** |
| 可验证性 | 「来源透明度」是静态检查（有没有章节、占比） | 锚点回指可机械验证到字节区间 | 我们 |
| 工程门禁 | 无 | acceptance 12 项 / 目标审计 15 行 / visual-check 8 项 / prompt-lint / 模板防漂移 / CI | 我们 |
| 分发 | 50+ runtime，一行 `npx skills add`，已产出 14 个成品 | 双入口（CLI + Skill），19 个 `ds/*` PR | 它更成熟；我们更可审计 |

## 6. 可采纳项（按性价比排序，尚未动手）

1. **换语料形状**（最优先、最便宜）：选一个「有自己的访谈/演讲字幕」的人，而不是从会议里切人。
   这一步同时解锁评分卡（公开立场可查）。**与本仓库既有结论一致：单人语料的正确来源是单人产出。**
2. **移植评分卡，并加一条它做不到的机械维度**：`scripts/fidelity.mjs` ——
   来源透明度 / 结构完整度 / **锚点回指率（机械可算）** 自动出分；
   立场一致性 / 风格辨识度 / 边缘诚实度 出 rubric + 独立裁判 prompt；产出 `FIDELITY.md`。
   两种模式并存：公众人物走评分卡，私人语料走 A/B holdout。
3. **把三重验证做成 `derive` 的筛选门槛**：跨域复现 / 生成力 / 排他性。
   现状反证：`voice.catchphrases` 现在输出「二级缓」「级缓存」这类话题三元组——
   正是「没有排他性过滤」的典型症状。
4. **抄信源纪律**：知乎 / 微信公众号 / 百度百科永远排除；中文只用权威媒体 + B站原始视频 + 小宇宙原始音频；
   「本地一手素材权重最高」；来源不足（<10 条）时提前降期望并把诚实边界写长。

**不采纳**：把字幕洗成纯文本（我们要付锚点可回指的代价）；去掉机械门禁（那是我们比它强的地方）。

## 7. 来源与复现

- 仓库：<https://github.com/alchaincyf/nuwa-skill>（MIT）
- `SKILL.md`：<https://raw.githubusercontent.com/infometa/workbuddyskills/main/skills/nuwa-skill/SKILL.md>
  （同一 skill 的镜像，字段与 alchaincyf 版一致）
- 方法论：`references/extraction-framework.md`、`references/fidelity-scorecard.md`
- 成品样例：`examples/steve-jobs-perspective/SKILL.md`（27 KB，6 心智模型 / 8 决策启发式 / 五条诚实边界，
  含「幸存者偏差」自我批评）
- 本次实跑的两个脚本（原样下载，仅存于 `/tmp`，未入库）：
  `srt_to_transcript.py` sha256 `fe9de1d39243920f1c28fee519faa45c18230c67e41d1c34d4af83cdbc4f6b8b`、
  `download_subtitles.sh` sha256 `6b729f2117c552ca7a35013c0c7b2cac849db7057b7e5b6285d9a89c6ce93598`

复现清洗对比：

```bash
curl -sSL -o /tmp/nuwa/srt_to_transcript.py \
  https://raw.githubusercontent.com/alchaincyf/nuwa-skill/main/scripts/srt_to_transcript.py
cp tests/fixtures/public-corpus/us-house-floor-2009-07-29/transcript.srt /tmp/nuwa/us-house.srt
python3 /tmp/nuwa/srt_to_transcript.py /tmp/nuwa/us-house.srt /tmp/nuwa/us-house.nuwa.txt
```
