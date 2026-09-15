# PR-18 · 池化口径收尾 + 带身份映射的第四次盲测

- 分支：`dot-skill-test`（本地集成分支）
- 交付：`src/derive/retrospect.mjs`（标点密度按说话人分列、突变点标注 pooled）
- 盲测对照：A 语料 + `identity.json`（PR-15 的能力）重跑一次，对照组沿用同语料同提示词的画像

## 1. 池化口径收尾

PR-10 的盲测把"池化统计"列为待修项。句长在 PR-11 已按说话人分列，这一轮把剩下两项补上：

| 维度 | 之前 | 现在 |
| --- | --- | --- |
| `voice.punctuation_density` | 一个池化数字 | `{density, pooled: true, by_speaker: {说话人: {mean, median, p90, samples}}}` |
| `shifts.candidate.*` | 只有 metric/window/delta | 加 `pooled: true`，多说话人语料再加 `mixes_speakers: true`——滑窗跑在整条消息流上，一个"突变"可能是对方带来的 |

页面上的效果（同一份语料）：

```
标点密度（标点字符 / 总字符）：density 0.11；pooled true；按说话人：小明 中位 0.15；林工 中位 0.11；老周 中位 0.14
```

## 2. 带身份映射的派生化对照（同一份 A 语料）

| 指标 | run 3（无映射） | run 4（有映射） |
| --- | --- | --- |
| 派生结论 voice | 7 | **11** |
| 回指锚点 | 26/76 | 24/76 |
| 口头禅归属 | 在 `ou_lin` 与 `林工` 之间拆开 | 全部归到 `林工`（回滚 5 / 代码 4 / 方案 4 / 不动 3） |

<!-- BLIND-RESULT -->

## 3. 怎么验

```bash
node --test tests/*.test.mjs                        # 371 pass / 0 fail
node scripts/audit-objective.mjs --skip-acceptance  # 16/16
```
