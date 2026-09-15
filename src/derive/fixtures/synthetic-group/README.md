# `synthetic-group` — retrospect 合成账本夹具

**不是真人对话，也不是真实导出。** 全部内容为本任务原创，随仓库以 MIT 发布，
只用来给 `tests/retrospect.test.mjs` 提供一份"形状正确、特征已知"的账本。

## 它必须能触发的特征

| 特征 | 在哪里 | 用途 |
| --- | --- | --- |
| 4 个说话人 | 老周 / 小陈 / 林工 / 阿May | `stats.participant_*`、`relations.*` |
| 71 条消息 | `group-chat.md` 44 + `dm-lin-chen.md` 26 + `incident-postmortem.md` 1 | 各维度的样本量 |
| 语调/长度突变 | `k0001:t21`–`k0001:t34`（故障期间消息明显变长、带感叹号） | `shifts.*` |
| 话题回避 | `k0001:t18`→`t19`（被问 offer，一句"先不说这个"转开）、`k0001:t31`→`t32`（"这个不方便说"） | `boundaries.*` |
| 同一维度取值相反 | `k0001:t5`（"远程办公挺好的"）vs `k0001:t38`（"远程办公其实很烦"）；`k0001:t9`（"这个方案不行"）vs `k0001:t12`（"这个方案我觉得没问题"）；`k0001:t29`（"保证不会再有第二次"）vs `k0001:t33`（"可能还要再看两天"） | `conflicts.*`（褒贬 + 确定程度两个维度） |
| 称呼变化 | `k0002` 前半段"林工"、后半段"林哥" | `relations.address_*` |
| 锚点两种粒度 | `k0001:tN` / `k0002:tN`（轮次级）与 `k0003`（段落级） | 锚点解析与回指 |
| 表情 | `k0002:t22` 🙂、`k0002:t24` 👍 | `voice.emoji_density` |
| 时间戳 | 每行正文内联 ISO 8601 | `stats.time_*`、`timeline.*` |

## 形状

```
synthetic-group/
  knowledge/index.json          # 数组，3 个条目，每条带 anchors（字符串数组）
  knowledge/text/*.md           # 正文，行首锚点 [k0001:t1] / [k0003]
```

`index.json` 里的 `sha256` 是同一目录下 `.md` 文件的真实摘要；
`tests/retrospect.test.mjs` 会重新计算并断言一致，防止夹具被改坏。
