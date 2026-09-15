# PR-15 · 跨渠道身份映射（`identity.json`）

- 分支：`ds/15-identity`（本地，合并进 `dot-skill-test`）
- 交付：`src/knowledge/identity.mjs`、`src/knowledge/ledger.mjs`（记录时套用 + 账本留痕）、
  `src/commands/harvest.mjs`（`--identity`）、`docs/v2/IDENTITY.md`、`tests/identity.test.mjs`
- 依赖：无。与 PR-11（归一化正文带说话人）配合：那条让派生层知道"谁在说"，这条让它知道
  "不同句柄是同一个人"。

## 1. 为什么

多来源盲测的实验组蒸馏器只能**按渠道分别描述**同一个人：Slack 里是 `林工`，飞书里是 `ou_lin`，
语料没有任何一句说这两者是同一人。派生层因此报出 6 个参与者、把风格统计拆开，
`relationship` 也只能写成"显示名渠道 vs `ou_` 渠道"。裁判据此把若干条断言判为"跨渠道不可验证"。

## 2. 改动前后（同一份多来源语料）

```bash
distilly harvest tests/fixtures/public-corpus/synthetic-multisource \
  --person lin-gong --identity ./identity.json
distilly retrospect --person lin-gong
```

| 指标 | 无映射 | 有映射（林工←ou_lin、小明←ou_chen） |
| --- | --- | --- |
| `knowledge/text/*.md` | `[k0001] … ou_lin：评审前我把风险清单发群里…` | `[k0001] … 林工：评审前我把风险清单发群里…` |
| `stats.participants` | `["林工","ou_lin","小明","老周","ou_chen","ou_zhou"]` | `["林工","小明","老周","ou_zhou"]` |
| `voice.sentence_length.by_speaker` | 6 个"说话人" | 4 个（真人的统计不再被拆开） |
| 账本条目 | 无身份信息 | `identity: {file:"identity.json", handles:["ou_chen","ou_lin"], turns:16}` |

## 3. 纪律

- **句柄唯一**：同一句柄被两人声明 → exit 2 且**零写入**；非法 JSON 同样响亮失败。
- **记录时生效**：规范化在锚定之前，一个 turn 仍是"一个锚点、一个前缀、一行统计"；
  锚点文本仍是源字节的逐字切片（不变式未破）。
- **不做推断**：只合并显式声明的句柄；"措辞像同一个人"不构成合并理由。
- 无映射时行为与以前完全一致。

## 4. 怎么验

```bash
node --test tests/identity.test.mjs    # 5 条
node --test tests/*.test.mjs           # 354 pass / 0 fail
node scripts/audit-objective.mjs --skip-acceptance   # 16/16
```

`tests/identity.test.mjs` 覆盖：句柄在正文与账本里被归一（且原始句柄不残留）、
派生层参与者与 `by_speaker` 合并、无映射时不改任何东西、句柄冲突/非法 JSON 零写入、
纯函数行为（不改输入、match 列表、无文件时的空映射）。

## 5. 已知缺口

- 映射按句柄字符串精确匹配（大小写敏感）；`U02` 这类平台 id 需要写进映射或用导出里的显示名。
- 通讯录 API 自动取名未实现（飞书开放平台页只有 `sender.id`）。
- 映射文件本身没有锚点（它不进 `knowledge/`）；它的存在通过账本条目的 `identity` 字段留痕。
