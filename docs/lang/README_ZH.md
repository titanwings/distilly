<div align="center">

<img src="../social-preview-distilly-v7.png" alt="Distilly — Distill how they think into Person Profiles for Agents" width="100%">

<br>

# 🧬 Distilly

**Formerly: Colleague Skill / colleague-skill（原同事 Skill）**

### 把一个人的经验、判断、表达方式和工作方法，蒸馏成可复用的 Person Profile，交给 Agent 或兼容 Bot 使用。

**聊天 · 文档 · 访谈 · 公开资料 → Distilly → Person Profile → Agent / Bot**

[![Discord](https://img.shields.io/badge/Discord-加入社区-5865F2?logo=discord&logoColor=white)](https://discord.gg/NVX66RxWZv)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://python.org)
[![AgentSkills](https://img.shields.io/badge/AgentSkills-Standard-green)](https://agentskills.io)
[![Stars](https://img.shields.io/github/stars/titanwings/colleague-skill?style=social)](https://github.com/titanwings/distilly/stargazers)

<br>

<table>
<tr><td align="left">

🧑‍💼 &nbsp;你的同事跳槽、导师毕业、搭档转岗，带走了整套工作方法和上下文？<br>
💞 &nbsp;你的家人、老友、伴侣渐行渐远，你想留住和 TA 相处的方式？<br>
🌟 &nbsp;你喜欢的作家、偶像、思想家你够不着，但你想听他对你的问题怎么看？

</td></tr>
</table>

### ✨ 同一套蒸馏流程，适用于不同的人。

<br>

Distilly 是 Agent 工作流中的人物建模层。它把你提供的材料整理成可移植、基于材料的 Person Profile，提取其中可观察的经验、判断模式、表达习惯和工作方法；它不声称复制材料背后的真人。

同事 · 伴侣 · 家人 · 老友 · 偶像 · 名人 · 小说角色，甚至你自己

**原材料 + 你的描述 → 基于材料的 Person Profile → 你的 Agent 或兼容 Bot**

> Person Profile 是可复用的核心产物；当前版本把每份 Profile 封装成 Agent Skill，供支持的宿主安装和调用。创建器 Skill 的正式名称仍是 `distilly`，安装目录也应使用 `distilly`。上方保留原名，用于搜索承接和历史识别。

<br>

[🆕 Distilly 能做什么](#-distilly-现在能做什么) · [📦 数据来源](#-支持的数据来源) · [⚡ 安装](#-安装) · [🚀 使用](#-使用) · [✨ 效果示例](#-效果示例) · [💬 Discord](https://discord.gg/NVX66RxWZv)

[**English**](../../README.md) · [**Español**](README_ES.md) · [**Deutsch**](README_DE.md) · [**日本語**](README_JA.md) · [**Русский**](README_RU.md) · [**Português**](README_PT.md) · [**한국어**](README_KO.md)

</div>

---

<div align="center">

### 🎉 2026.08.13 里程碑 — **项目已突破 20K ⭐！**

感谢每一位点星的朋友，我们会继续发版、继续蒸馏。

</div>

> 🧬 **2026.08.24 更新** — 创建器已端到端统一为 **Distilly**，并按官方最新方式支持 Claude Code、Hermes、OpenClaw、Codex、DeepSeek Harness、Pi、Grok Build 和 OpenCode 的本地 Skill 发现。Grok Bot 单独标为 saved-Skill 预览流程。

> 📝 **2026.06.01 更新** — **[COLLEAGUE.SKILL 技术报告](https://arxiv.org/pdf/2605.31264) 已上线**；这次最开心的不只是发了篇 paper，而是社区一起把 gallery 推到 215 个 skills、165 位贡献者和 100k+ skill-card 累计 stars，论文 Acknowledgements 也专门收录并感谢了所有社区贡献者。

> 🗺️ **2026.04.13** — **Distilly 路线图正式发布！** 项目从原 Colleague Skill 走向更通用的目标：把人物蒸馏成可供 Agent 复用的 Skill。 👉 **[完整路线图](../../ROADMAP.md)** · **[💬 Discord](https://discord.gg/NVX66RxWZv)**

> 🌐 **2026.04.07** — 社区平台上线！任何 skill / meta-skill 可直接给自己的 GitHub repo 引流，没有中间商。 👉 **[titanwings.github.io/colleague-skill-site](https://titanwings.github.io/colleague-skill-site/)**

<div align="center">

Created by [@titanwings](https://github.com/titanwings)

</div>

---

## 🆕 Distilly 现在能做什么？

### 1️⃣ 从 Colleague Skill 到 Distilly

项目不再只围绕「同事」场景设计。`distilly` 创建器用同一套流程，为三类人物生成基于材料的 Person Profile，再将每份 Profile 封装成 Agent Skill。

### 2️⃣ 支持三大人物类型

<table>
<thead>
<tr>
<th width="33%" align="center">🧑‍💼 colleague</th>
<th width="33%" align="center">💞 relationship</th>
<th width="33%" align="center">🌟 celebrity</th>
</tr>
</thead>
<tbody>
<tr>
<td align="center"><sub>同事 · 导师 · 搭档 · 上下游协作者</sub></td>
<td align="center"><sub>前任 · 伴侣 · 父母 · 朋友 · 家人</sub></td>
<td align="center"><sub>名人 · 创作者 · 公众表达者 · 小说角色</sub></td>
</tr>
<tr>
<td><sub>从材料中整理技术规范、工作流程、表达习惯和职场行为，生成 Work Skill + Persona。支持飞书 / 钉钉 / Slack 采集。</sub></td>
<td><sub>把材料中可观察的表达习惯、情绪触发点、冲突模式和修复模式整理成人物 Skill。</sub></td>
<td><sub>内置 <b>六维度研究工具链</b>（字幕下载 → 文稿清洗 → 研究合并 → 质量检查），用于整理可观察的决策、表达与心智模型。</sub></td>
</tr>
</tbody>
</table>

每类人物有独立的信息采集策略、分析维度和 Person Profile 结构。

### 3️⃣ 支持更多 Agent 宿主

旧版只能在 Claude Code 里用。Distilly 现在支持 8 个本地 Agent 宿主：

<table>
<tr>
<td align="center" width="25%"><a href="https://claude.ai/code"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/claude-code-wordmark-dark.svg"><img src="../assets/hosts/claude-code-wordmark-light.svg" alt="Claude Code" height="28"></picture></a></td>
<td align="center" width="25%"><a href="https://github.com/NousResearch/hermes-agent"><img src="../assets/hosts/hermes-agent-wordmark.png" alt="Hermes Agent" height="32"></a></td>
<td align="center" width="25%"><a href="https://github.com/openclaw/openclaw"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/openclaw-wordmark-dark.svg"><img src="../assets/hosts/openclaw-wordmark-light.svg" alt="OpenClaw" height="38"></picture></a></td>
<td align="center" width="25%"><a href="https://github.com/openai/codex" title="Codex"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/codex-mark-dark.png"><img src="../assets/hosts/codex-mark-light.png" alt="Codex" height="64"></picture></a></td>
</tr>
<tr>
<td align="center" width="25%"><a href="https://github.com/deepseek-ai/deepseek-harness"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/deepseek-wordmark-dark.svg"><img src="../assets/hosts/deepseek-wordmark-light.svg" alt="DeepSeek Harness" height="32"></picture></a></td>
<td align="center" width="25%"><a href="https://pi.dev/docs/latest/skills"><img src="../assets/hosts/pi-mark.svg" alt="Pi coding agent" height="46"></a></td>
<td align="center" width="25%"><a href="https://docs.x.ai/build/features/skills-plugins-marketplaces"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/grok-build-mark-dark.png"><img src="../assets/hosts/grok-build-mark-light.png" alt="Grok Build" height="46"></picture></a></td>
<td align="center" width="25%"><a href="https://opencode.ai/docs/skills"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/opencode-wordmark-dark.svg"><img src="../assets/hosts/opencode-wordmark-light.svg" alt="OpenCode" height="32"></picture></a></td>
</tr>
</table>

**Grok Bot 预览：**Grok Bot 支持 saved/private Skills，但官方文档没有说明可直接导入本地 `SKILL.md`。可手工迁移 Distilly 流程为 saved Skill；直接安装仓库尚未验证。

蒸馏出的 Person Profile 会封装成 Agent Skill，并可安装到任意受支持的宿主。

---

## 📦 支持的数据来源

| 标识 | 来源 | 消息记录 | 文档 / Wiki | 备注 |
|:----:|------|:-------:|:-----------:|------|
| <img src="../assets/sources/lark-mark.png" alt="飞书" width="32" height="32"> | 飞书（自动采集） | ✅ API | ✅ | 输入姓名即可，全自动 |
| <img src="../assets/sources/dingtalk-mark.jpg" alt="钉钉" width="32" height="32"> | 钉钉（自动采集） | ⚠️ 浏览器 | ✅ | 钉钉 API 不支持历史消息 |
| <img src="../assets/sources/slack-mark.png" alt="Slack" width="32" height="32"> | Slack（自动采集） | ✅ API | — | 需管理员安装 Bot；免费版限 90 天 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/sources/x-mark-dark.svg"><img src="../assets/sources/x-mark-light.svg" alt="X" width="32" height="32"></picture> | 公开 X 帖子 | ✅ API | — | 通过按返回数量计费的第三方 Xquik 可选采集名人研究候选 |
| <img src="../assets/sources/wechat-mark.jpg" alt="微信" width="32" height="32"> | 微信聊天记录 | ✅ SQLite | — | 需先用 WeChatMsg / PyWxDump / 留痕等工具导出 |
| 📄 | PDF / 图片 / 截图 | — | ✅ | 手动上传 |
| <img src="../assets/sources/lark-mark.png" alt="飞书" width="32" height="32"> | 飞书 JSON 导出 | ✅ | ✅ | 手动上传 |
| ✉️ | 邮件 `.eml` / `.mbox` | ✅ | — | 手动上传 |
| 📝 | Markdown / 直接粘贴 | ✅ | ✅ | 手动输入 |

---

## ⚡ 安装

### 🤖 For Agents

在任意支持的本地 Agent 宿主中发送：

> 从 `https://github.com/titanwings/distilly` 安装 Distilly，并确认当前宿主可以发现它。

Agent 会把 Distilly 作为名为 `distilly` 的 Skill 安装到正确的宿主目录。

### 👤 For Humans

把 Distilly clone 到当前宿主使用的 Skills 目录：

```bash
git clone https://github.com/titanwings/distilly <DISTILLY_SKILL_DIR>
```

各宿主路径、旧版本迁移、Windows、生成 Profile 的安装方式和凭证配置，统一放在 **[详细安装说明](../../INSTALL.md)**。

---

## 🚀 使用

在 Agent 中说：

> 用 Distilly 为 `<人物>` 创建一个 Person Profile。

接下来只需：

1. 选择 `colleague`、`relationship` 或 `celebrity`。
2. 提供一段描述或相关材料；所有字段都可以跳过。
3. 审核结果，让 Distilly 生成 Profile。

结果会封装成名为 `{character}-{slug}` 的 Agent Skill。可选的名人研究流程和高级工具见 **[详细安装说明](../../INSTALL.md)**。

---

## ✨ 效果示例

<br>

### 🌟 celebrity — 蒸馏一个 Andrej Karpathy

> 六维度 research：著作 · 访谈 · 决策 · 表达 DNA · 外部评价 · 时间线<br>
> 案例出自社区作品 [alchaincyf/karpathy-skill](https://github.com/alchaincyf/karpathy-skill)

```
用户            ❯ 现在人人都在说 Agent，你怎么看 2026 年的 AI Agent？

celebrity.skill ❯ 大家都在做 demo，但没人做 eval。
                  Agent 的瓶颈从来不是模型不够聪明，是 scaffolding 跟不上——
                  严格的 evaluation harness、细粒度的错误回放、
                  可控的 tool-calling budget、清楚的 failure mode 分析。
                  大部分产品还停留在"接个 API + 几个 tool + system prompt"的阶段，
                  这叫 demo，不叫 agent。
                  2026 我赌的不是最强模型，是最好的 scaffolding + 最严的 eval。
```

<br>

### 🧑‍💼 colleague — 蒸馏一个字节 2-1 后端

> 输入：`字节 2-1 后端工程师，INTJ，甩锅高手，字节范`

```
用户            ❯ 帮我看一下这个接口设计

colleague.skill ❯ 等等，这个接口的 impact 是什么？背景没说清楚。
                  （看完后）N+1 查询，改掉。返回结构用统一的
                  {code, message, data}，这是规范，不用问为什么。

用户            ❯ 这个 bug 是你引入的吧

colleague.skill ❯ 上线时间对上了吗？那个需求改了好几个地方，
                  还有其他变更。
```

<br>

### 💞 relationship — 蒸馏一个暗恋对象

> 上传半年的聊天记录 + 「性格敏感、话少但嘴硬、会在关键时候认真回」

```
用户               ❯ 你今天有没有想我

relationship.skill ❯ ……有啊，就一点点。你干嘛问这个。
```

<div align="center">

📚 更多实战案例见 **[社区 Gallery](https://titanwings.github.io/colleague-skill-site/)**，已收录 100+ skill

</div>

---

## 🔧 功能特性

### 🧱 生成的 Skill 结构

Distilly 当前的创建器以 **Persona** 为通用底座，不同家族按场景挂载各自的模块：

| 家族 | Persona 内容 | 附加模块 |
|------|-------------|---------|
| 🧑‍💼 **colleague** | 6 层性格结构：硬规则 → 身份 → 表达风格 → 决策模式 → 人际行为 → Correction | ➕ **Work Skill**：负责范围、工作流程、输出偏好、经验知识库 |
| 💞 **relationship** | 表达 DNA · 情绪触发点 · 冲突模式 · 修复模式 | — |
| 🌟 **celebrity** | 心智模型 · 决策启发式 · 表达 DNA · 外部评价对照 | ➕ 六维度 research 档案（著作 / 访谈 / 决策 / 时间线...） |

> **运行逻辑**：接到任务 → Persona 选择材料中可见的偏好与语气 → 附加模块补齐执行细节 → 生成基于材料的回答

### 🧬 进化机制

- 🛡️ **安全创建** → 如果同一个 `{character}/{slug}` 已经有 Skill，创建会停止并提示使用进化模式，不会改写原文件
- 📥 **追加文件** → 自动分析增量 → merge 进对应部分，不覆盖已有结论
- 💬 **对话纠正** → 说「他不会这样，他应该是 xxx」→ 写入 Correction 层，立即生效
- 🕰️ **版本管理** → 每次更新自动存档，支持回滚到任意历史版本
- 🔬 **名人研究管线** → 字幕下载 → 文稿清洗 → 六维度研究 → 质量检查

---

## ⚠️ 注意事项

**原材料质量决定 Person Profile 质量**，不同家族的优质信源不一样：

| 家族 | 信源优先级（高 → 低） |
|------|----------------------|
| 🧑‍💼 **colleague** | 他**主动写的**长文（设计文档 / 评审意见） **›** **决策类回复** **›** 日常群聊消息 |
| 💞 **relationship** | 完整的聊天记录 **›** 往来信件 / 朋友圈 / 日记 **›** 旁人描述 |
| 🌟 **celebrity** | 第一人称著作 / 博客 / 长访谈 **›** 决策记录（发布会、commit、采访）**›** 已核验的本人短帖 **›** 他人评价 |

- **colleague** 飞书自动采集：需将 App bot 加入相关群聊
- **relationship**：时间跨度越长越好，能覆盖冲突与和解更佳
- **celebrity**：避免只喂二手解读
- 目前还是 demo 版本，如果有 bug 请多多提 issue！

---

## 📄 技术报告

> **[COLLEAGUE.SKILL: Automated AI Skill Generation via Expert Knowledge Distillation](https://arxiv.org/pdf/2605.31264)** ([arXiv](https://arxiv.org/abs/2605.31264) · [arXiv PDF](https://arxiv.org/pdf/2605.31264))
>
> 这是 Distilly 前身 **COLLEAGUE.SKILL / colleague-skill（原同事 Skill）** 的技术论文，详细介绍了 Work Skill + Persona 的双层架构、多源数据采集与 Skill 生成机制，也是今天 `colleague` 家族的理论基础。relationship / celebrity 家族的架构扩展会另起论文。

---

## ⭐ Star History

<a href="https://star-history.dera.page/#titanwings/colleague-skill&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=titanwings%2Fdistilly&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=titanwings%2Fdistilly&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=titanwings%2Fdistilly&type=date&legend=top-left" />
 </picture>
</a>

---

<div align="center">

**MIT License** © [titanwings](https://github.com/titanwings)

<sub>Made with 🧬 for everyone who wants to distill a person into a reusable Person Profile.</sub>

</div>
