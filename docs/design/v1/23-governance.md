> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

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
