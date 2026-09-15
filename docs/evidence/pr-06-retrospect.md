# PR-06 · `retrospect`：确定性回望派生

- 分支：`ds/06-retrospect`（基于 `dot-skill-test`）
- 交付：`src/derive/retrospect.mjs`、`src/derive/fixtures/synthetic-group/**`、`tests/retrospect.test.mjs`、`bin/distilly.mjs` 的最小注册
- 依赖：无（不 import `src/knowledge/**`，等 ds/02 落地后也不冲突）；**零运行时依赖、零模型调用、零网络**
- 本文纯文字，无截图；证据目录 `dst-evidence/` 未入库（`.gitignore` 已含）
- 按用户指令**不 push、不建 PR**：以下提交都在本地 `ds/06-retrospect` 上

## 1. 变更

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | `test(derive): add the synthetic ledger fixture for retrospect` | `src/derive/fixtures/synthetic-group/`：一份形状与契约一致、特征事先已知的合成账本（4 说话人 / 71 条 / 3 个来源）。`.gitignore` 增加两条否定规则，只把 fixtures 下的 `knowledge/` 重新纳入版本控制 |
| 2 | `feat(derive): derive stats from the ledger, deterministically` | 模块骨架：读账本与 `knowledge/text/*.md`、锚点解析与「不可回指就不引用」的纪律、`stableStringify` + `round(4)`、`run(args, io)` CLI 入口与契约形状回执、`stats` 维度 |
| 3 | `feat(derive): derive voice and relations from the ledger` | `voice`（句长 / 标点密度与构成 / 表情密度 / 口头禅 n-gram / 称呼用法 / 疑问比例）与 `relations`（回应频次、回应不对称、发起分布、回应间隔、称呼用法与称呼变化） |
| 4 | `feat(derive): derive timeline phases and shift candidates` | `timeline`（阶段切分 + 阶段特征 + 最大阶段差异）与 `shifts`（滑窗 + 双阈值的突变点候选） |
| 5 | `feat(derive): derive avoidance candidates and contradictions` | `boundaries`（R1/R2/R3/R4 四条可解释规则）与 `conflicts`（褒贬 + 确定程度两个立场的相反句子对） |
| 6 | `feat(cli): register the retrospect subcommand` | `bin/distilly.mjs` 里**一段自包含分支**：动态 import、`process.exitCode` 透传、位置放在通用 `--help` 之前以便该子命令拥有自己的双语帮助。没有重构 install/uninstall |
| 7 | `test(derive): assert anchor resolution, determinism and the empty path` | `tests/retrospect.test.mjs`：7 条断言，见 §2 |

文件清单（新增 6 + 修改 2）：

```
src/derive/retrospect.mjs                                   新增
src/derive/fixtures/synthetic-group/README.md               新增
src/derive/fixtures/synthetic-group/knowledge/index.json    新增
src/derive/fixtures/synthetic-group/knowledge/text/group-chat.md            新增
src/derive/fixtures/synthetic-group/knowledge/text/dm-lin-chen.md           新增
src/derive/fixtures/synthetic-group/knowledge/text/incident-postmortem.md   新增
tests/retrospect.test.mjs                                   新增
bin/distilly.mjs                                            修改（+8）
.gitignore                                                  修改（+3）
docs/evidence/pr-06-retrospect.md                           新增（本文）
```

合计 `9 files changed, 3024 insertions(+)`（其中 `src/derive/retrospect.mjs` 2350 行、`tests/retrospect.test.mjs` 449 行）。

未触碰：`src/knowledge/**`、`src/parse/**`、`src/skill/**`、`src/views/**`、`src/install/**`、`src/collect/**`、`SKILL.md`、`prompts/**`、`docs/v2/**`、其他 `tests/*.test.mjs`。

## 2. 测试命令与结果

```
$ node --test tests/retrospect.test.mjs
ok 1 - the fixture ledger digests match the fixture text bytes
ok 2 - seven files are written and every claim cites a resolvable anchor
ok 3 - two runs over the same ledger are byte-identical
ok 4 - the features the fixture was built around are actually found
ok 5 - two messages yield empty claim lists and a stated reason
ok 6 - the derivation calls no network and no model
ok 7 - the CLI entry point returns a contract-shaped receipt
# tests 7 / pass 7 / fail 0
```

Node v22.23.1（要求 ≥ 20）。`node --test` 不指定文件时，本分支 `tests/` 下只有这一个 `.mjs`，同样 7/7。

逐条对应任务要求：

| 要求 | 落在哪条 | 结果 |
| --- | --- | --- |
| 夹具 ≥3 说话人、≥60 条、含语调突变与话题回避；7 个文件都生成 | 4 + 2 | 通过（4 人 / 71 条；`shifts` 找到长度突变，`boundaries` 找到两处回避，`conflicts` 找到同一人前后矛盾与跨人分歧，`relations` 找到「林工→林哥」） |
| 每条 claim 至少 1 个 `evidence`，且都能在夹具账本里回指 | 2 | 通过（38 条 claim / 106 个引用 / 46 个不同锚点 / 0 悬空；脚本另按 `docs/v2/ACCEPTANCE.md` §5 的正则 `k\d{4}(?::t\d+)?` 扫一遍字节，同样 0 悬空） |
| 两次运行 sha256 相同 | 3 | 通过（同进程两次 + 换目录 + **两个独立 `bin/distilly.mjs` 进程**，三种都比对逐文件 sha256） |
| 样本不足：只给 2 条 → 空 claims + notes 给理由 | 5 | 通过（7 个文件全部 `claims: []`，note 写明「只有 2 条 …低于 …8」；退出码 0，不抛错） |
| 没有网络/模型调用 | 6 | 通过（源码扫描 + 只允许 `node:` import） |

### 2.1 反向对照（证明断言真的会红）

在 `/tmp` 的整份副本上做变异，测试文件不动：

| 变异 | 结果 |
| --- | --- |
| A：把一个值改成依赖 `process.pid` | `not ok 3`（**只有跨进程那条能抓到**：同进程两次跑不出差别） |
| B：某条 claim 引用一个账本没声明的锚点 `k9999` | `not ok 2` |
| C：把样本不足分支的 `notes` 清空 | `not ok 5` |
| D：`makeClaim` 返回的 claim 里 `evidence` 改成 `[]` | `not ok 2` + `not ok 4` |

## 3. 夹具规模与各维度产出条数

夹具：`src/derive/fixtures/synthetic-group`，4 个说话人（林工 / 小陈 / 老周 / 阿May），71 条消息，
3 个来源（群聊 44 条、1:1 私聊 26 条、复盘文档 1 段），时间跨度 2024-03-04 → 2024-03-20（16.256 天），
账本声明 71 个锚点（`k0001:t1`…`k0001:t44`、`k0002:t1`…`k0002:t26`、`k0003`，两种粒度都有）。

| 维度 | claims | evidence 引用 | 不同锚点 | notes | 说明 |
| --- | --- | --- | --- | --- | --- |
| `stats` | 8 | 23 | 8 | 0 | 条数 / 来源数 / 参与者 / 人数 / 时间范围 / 跨度 / 密度 / 长度分布 |
| `voice` | 11 | 36 | 24 | 0 | 句长、标点密度、标点构成、表情、5 条口头禅、称呼用法、疑问比例 |
| `relations` | 6 | 16 | 11 | 0 | 回应频次、回应不对称、发起分布、回应间隔、称呼用法、称呼变化 |
| `timeline` | 4 | 11 | 9 | 0 | 3 个阶段 + 1 条最大阶段差异 |
| `shifts` | 2 | 6 | 6 | 1 | 2 个长度突变点（故障开始 +19.75 字/条，回到常态 −27.83 字/条） |
| `boundaries` | 4 | 8 | 8 | 1 | 2 条 R1+R3（offer 被两次挡回）+ 2 条 R2（问句后极短回复） |
| `conflicts` | 3 | 6 | 6 | 1 | 褒贬 2 条（同一人「远程办公」、跨人「这个方案」）+ 确定程度 1 条（「幂等键」） |
| **合计** | **38** | **106** | **46**（账本 71 个锚点里被引用 46 个） | 3 | 置信度分布：high 18 / medium 19 / low 1 |

候选类维度（`boundaries` / `conflicts` / `shifts`）每条都带触发它的规则名与 ≤40 字的逐字摘录；
`timeline` 的每个阶段带 `from`/`to`/`basis`；`shifts` 把滑窗宽度与两个阈值写进 `notes`。

## 4. 两次运行的 sha256

命令（`--person synthetic-group` 在含 `skills/colleague/synthetic-group/` 的工作目录下执行）：

```
$ node bin/distilly.mjs retrospect --person synthetic-group --json   # 第一次
$ node bin/distilly.mjs retrospect --person synthetic-group --json   # 第二次
```

两次 `evidence/derived/*.json` 的逐文件 sha256 **完全一致**（`diff` 为空），回执本身也逐字节一致：

| 文件 | sha256 |
| --- | --- |
| `stats.json` | `03aa610363f957eb416a8a3e8a8e9141a7522dbdc4bf0bebfce6d3be6baaa695` |
| `voice.json` | `90f995af3664c3c18d83c5ed95bc343fe361a2c452a137a0b3f1306cd0c88259` |
| `relations.json` | `8dcddd11b7c497957885cd054c8b5597a9bd36fdcc7749ecf1fc10001be2dde4` |
| `timeline.json` | `0160da649219211a261da10f63ce70fdcfb4bd195b87f2dea80bd284ee80c4b1` |
| `boundaries.json` | `e0429a12710b7a5303af29185daf75a30f85b51cdd7b7be162383507cfd20de2` |
| `shifts.json` | `60e506618ff44f8fc9e92161fffecf5f1a01441c5191744e93df52ddab734a51` |
| `conflicts.json` | `2c3407f2b2cadb7704f0607efbe01d7e6238d66b66902d997175b1c85f6ba031` |
| 7 个文件的 sha256 再取 sha256 | `25fa1847bc43a3cda2158715db53a1d12106b7f6ffce62a91d4eefcd72daf99c` |

做法上保证确定性的四件事：没有 `Date.now()`/`Math.random()`/`new Date()`（时间戳用手写 UTC 解析，`Date` 只接受毫秒数）；
JSON 一律按键排序输出；浮点统一 `round(4)`；目录与锚点一律排序后遍历。

## 5. 真实验收形状的预演

`scripts/acceptance.mjs` 在本分支上会在第一步 `harvest` 就响亮失败（缺 ds/01、ds/02 的产出），这是预期行为。
为了提前排掉「合并后才炸」的风险，我按它生成账本的方式（`[k0001] <cue>` 段落级锚点、无时间戳、38 条字幕）
手工造了一份同形状的 `knowledge/`，结果：

- 退出码 0，7 个文件齐全，共 **22 条 claim**，逐文件 sha256 两次一致，**0 悬空锚点**；
- `stats.participants` 正确给出 `["林工","面试官"]`（为此把参与者阈值从 3 降到 2：1:1 语料是最常见形态，不能因为只有两个说话人就整维度留空）；
- 没有逐条时间戳时，`timeline` 用 `basis: "order"` 明确标注自己是按账本顺序三分位、`from`/`to` 为 `null`，`notes` 写明原因；
- `boundaries` / `conflicts` 在该语料上是空集 + 说明（合成访谈里没有触发词表与极短回复模式），**没有编造**。

## 6. 已知缺口与未验证项

**方法本身的边界（都写进了 `notes`，不是失败）**

1. 词表是固定的、小的：`boundaries` 的敏感话题 20 条、回避词 18 条，`conflicts` 两个立场维度各约 10 条。
   语料若回避的是词表外的话题，或矛盾不靠显式立场词表达（「这个方案很稳」vs「这个方案会炸」），**不会被发现**。
   这是刻意的：宁可空集 + 说明，也不塞进不可解释的启发式。
2. `relations.address_shift` 只比较「第一次用的称呼 ≠ 最后一次用的称呼，且各 ≥2 次」。称呼来回摇摆、三段式变化只报首尾。
3. `timeline` 是**等条数**三分位，不是等时长：活动集中在一周的语料，某个阶段可能只跨 5 分钟，另一个跨 3 周。
   `from`/`to` 让这件事可见，但阶段边界不对齐日历。
4. `stats.density_per_hour` 是全跨度的平均值，不反映突发性（故障期一小时 30 条、其余一天 5 条，会平均掉）。
5. `shifts` 只看两个指标（平均长度、感叹号消息比例），不看标点密度、表情或情绪突变。
6. 分句只处理中日韩句末标点与拉丁 `.`/`!`/`?`；小数点会被误判成句末（`3.14` 会在 `3.` 处断开）。夹具与验收语料都不含小数，未验证。
7. 中文中心：英文语料能拿到长度/标点/表情/疑问比例，但拿不到口头禅（CJK n-gram）与矛盾（词表是中文）。
8. `stats.time_range` / `time_span_days` 只有两个锚点可以钉住范围，按置信度规则封顶 `medium`——这是规则使然，不是样本不足。
9. 时间戳只认 ISO 8601（含日期-only、`Z` 与 `±HH:MM`）。epoch 毫秒、本地化格式会退回 `order` 基准。
10. `--person` 会在 `skills/*/<slug>/` 里找；同名 slug 出现在两个 family 时按目录名排序取第一个（确定但武断）。

**未验证**

- 没有用真实私聊/邮件语料跑过（按 `docs/v2/ACCEPTANCE.md` §6，那类语料不进仓库也不进 CI）。
- 没有跑过 `scripts/acceptance.mjs` 的全绿路径：它在 `harvest` 处就停下（缺 ds/01、ds/02）。§5 是我能在这条分支上做到的最接近的预演。
- 没有验证 20 万条量级的账本：`conflicts` 用了倒排索引、`shifts` 是滑窗，`voice` 的 n-gram 是每说话人一张表，但整体没有做过性能基准。
- 没有验证账本声明了锚点、正文里却找不到该锚点的情形（只会出现在 ds/02 半写完的账本上）；此时该锚点会被静默丢弃并给出 warning，warning 文案本身没被测试覆盖。

## 7. 回滚

- 整个 PR 可以整体回滚：`git revert --no-commit <7 个提交>` 然后一次提交；删除 `src/derive/**`、`tests/retrospect.test.mjs`、`docs/evidence/pr-06-retrospect.md` 即可，`bin/distilly.mjs` 只需要去掉那一段 `else if (args[0] === "retrospect")`。
- `retrospect` 只写 `evidence/derived/*.json`，**不改任何输入**（`knowledge/` 只读）。回滚后残留的派生文件是惰性的，可直接 `rm -rf evidence/derived` 重建。
- 与其他分支的耦合点只有两处：`bin/distilly.mjs`（ds/01 会重写整个文件，冲突时保留「一段独立的 retrospect 分支 + 动态 import」这个形状即可）和 `.gitignore`（三行否定规则，只影响 fixtures）。
- 夹具是纯测试数据，删掉它只会让 `tests/retrospect.test.mjs` 变红，不影响任何生产路径。

---

## English summary

`retrospect` derives `evidence/derived/{stats,voice,relations,timeline,boundaries,shifts,conflicts}.json`
from `knowledge/index.json` + `knowledge/text/*.md`, with zero runtime dependencies, zero model
calls and zero network access. Every claim cites at least one anchor **that the ledger itself
declares**, so the acceptance gate's anchor-resolution assertion cannot fail by construction;
when the ledger only declares paragraph-level anchors the units are merged up to that granularity
and a note says so. Seven tests cover anchor resolution, byte-identical reruns across three
comparisons (including two separate CLI processes), the fixture's known features, the
two-message empty path, and a source scan forbidding any network or model call. On the synthetic
fixture: 38 claims, 106 evidence references, 46 distinct anchors, 0 dangling. Known gaps: the
lexicons behind `boundaries` and `conflicts` are small and fixed, `timeline` phases are
equal-count rather than equal-time, and the whole module is Chinese-centric.
