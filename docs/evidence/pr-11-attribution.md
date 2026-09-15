# PR-11 · 归因修复：派生层第一次认得出「谁」+ 飞书导出解析

- 分支：`ds/10-attribution`（3 个原子提交）已本地合并进 `dot-skill-test`；飞书导出在
  `ds/09-feishu`（1 个原子提交）同样已合并。**都没有 push**（用户暂停推送）。
- 交付：`src/parse/common.mjs`、`src/knowledge/anchors.mjs`、`src/knowledge/ledger.mjs`、
  `src/parse/{chat,subtitle,feishu}.mjs`、`src/commands/{harvest,parse-chat}.mjs`、
  `src/derive/retrospect.mjs`、`tests/{text-attribution,parse-feishu}.test.mjs`
- 截图与命令留档：`dst-evidence/screenshots/pr-11-attribution/`（不入库）

## 1. 为什么做这个

`docs/evidence/pr-10-blind-test-runs.md` 的盲测暴露了一条断言在留出集上被判失败：
"句长中位数 13 字"。复算发现**派生值其实是池化的**——A 半段里被描述者本人中位 15 字、
面试官 7 字、池化 13 字。根因不在统计本身，而在**归一化正文丢掉了说话人与时间**：
`knowledge/text/*.md` 是派生层唯一读的文件，而说话人只留在 parser 的 metadata 里。
手写夹具 `src/derive/fixtures/synthetic-group` 一直是
`[k0001:t1] 2024-03-04T09:02:00Z 老周：…`，只有真实采集的语料不是。

## 2. 改动前后（同一段语料，可复算）

语料：12 条 Slack 消息、两位说话人、每条带 `ts`（`dst-evidence/.../corpus-messages.json`）。
"改动前"= worktree `/tmp/dst-pre-attr`（`773d56c`，本次修复之前的代码）实跑。

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| `knowledge/text/chat.md` | `[k0001] 先看数据，再看日志…` | `[k0001] 2023-11-14T22:13:20.000Z Alice：先看数据，再看日志…` |
| 派生结论数 | stats 2 / relations 0 / timeline 4 / voice 6 | stats **6** / relations **4** / timeline 4 / voice 6 |
| `stats.participants` | （没有这条 claim） | `["Alice","Bob"]` |
| `timeline.phase` | `basis: "order"`、`from: null` | `basis: "time"`、`from 2023-11-14T22:13:20Z` |
| `voice.sentence_length` | 只有池化值 | 池化值 + `pooled: true` + `by_speaker`（Alice 中位 20 / Bob 19） |
| `retrospect` warnings | 1（假警告：缺 users.json） | 0 |

同一个修复还顺带修掉两个证据脊柱缺陷：

| 缺陷 | 现象 | 修法 |
| --- | --- | --- |
| 正文互相覆盖 | 同一 `--source` 采集两份导出时，第二份**静默覆盖**第一份的 `knowledge/text/<source>.md`：账本两条 entry 都在，一份文档的段落从派生层的输入里消失 | 第一份占 `<source>.md`，后来的按文件名 stem 写成 `<source>--<file>.md`；同一份字节重复导入仍幂等 |
| Slack 假警告 | 导出带 `username` 时名字已解析，回执仍警告"id 无法解析" | 解析完再判断：只有 turns 里真的残留 `U123…` 才告警并点名 |

## 3. 关键设计：前缀是渲染期 markup，不是正文

`[k0012]` 锚点本来就是这样加的。归因前缀走同一条路：

- `recordsFromCharSpans` 透传 `speaker`/`at`，`assembleContent` 把它们放进 `segments[]`，
  **正文保持逐字**（`entries[].text` 与锚点文本不变）；
- `anchorNormalized` 渲染成 `[k0012] <at> <speaker>：正文`；
- 正文已经带前缀的不重复（字幕 cue 里的 `Lin: …`）；
- 字幕只带说话人（时间码是录制位置、不是日期），chat/飞书带时间 + 说话人。

不变式仍然成立：**锚点文本 == 源字节切片**，`tests/text-attribution.test.mjs`
与 `tests/parse-chat.test.mjs` 都断言这一点（字幕锚点覆盖整条 cue 的信封，
断言正文逐字落在该区间内）。

## 4. 顺带交付：飞书消息导出解析（`ds/09-feishu`）

移植 `tools/feishu_parser.py`（251 行）。原工具是"过滤 + 排版"（只留目标人的消息、
分成长消息/决策/日常三桶），这两件事在本仓各有归属（`harvest --person`、
`retrospect`），所以只保留**读格式**的部分：JSON 数组或 `messages|records|data`
包裹、全部字段别名、`sender{}`/`content{text}`/`content[]`、手工 `.txt` 日志
（`--format feishu-text` 才认）、占位符跳过并告警、`walkJsonLeaves` 定位真实字节。

顺带修掉 Instagram 分支的误判：它用"任一键出现过即匹配"的 `findObjectArray` 判定，
把同样带 `sender_name` 的飞书导出吃掉了；现在要求每条都同时有
`sender_name + timestamp_ms`，飞书作为最后的兜底形状。

## 5. 怎么验

```bash
node --test tests/*.test.mjs           # 317 pass / 0 fail（29 个文件）
node scripts/prompt-lint.mjs           # 0 findings
DISTILLY_PLAYWRIGHT_ROOT=/tmp/audit-mcp node scripts/acceptance.mjs   # 20/20 通过
node scripts/visual-check.mjs <页面>   # 8/8（本轮页面见 pr-11 截图目录）
```

新增测试 11 条：`tests/text-attribution.test.mjs` 4 条（前缀格式与不重复、
源字节不变式、派生层拿到人名与日期、同源两份导出不互相覆盖）、
`tests/parse-feishu.test.mjs` 7 条（别名与形状、占位符、包裹与 txt、拒绝无关输入、
与 Instagram 的分工、账本锚点回指 + 幂等、CLI 两条路径）。

## 6. 已知缺口（更新）

- **飞书另外两路仍未移植**：`tools/feishu_browser.py`（Playwright 复用本机登录态）与
  `tools/feishu_mcp_client.py`（MCP App Token，`npx feishu-mcp --stdio`）。
- **`note` 命令**（`CONTRACT.md` §1：把 LLM 自己读到的内容登记进账本，
  `method: "model-read"`）仍未实现，`PLANNED` 现只剩它。
- 归因只覆盖有说话人/时间的格式：OOXML 与压缩包成员的正文仍是纯文本（它们本来就没有
  说话人概念），`voice` 的 `by_speaker` 在这些语料上不会出现。
- 日期口径：字幕的时间码刻意不进正文（不是日期），因此字幕语料的 `timeline`
  仍会走 `basis: "order"`。
