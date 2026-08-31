<div align="center">

<img src="../social-preview-distilly-v7.png" alt="Distilly — Distill how they think into Person Profiles for Agents" width="100%">

<br>

# 🧬 Distilly

**Formerly: Colleague Skill / colleague-skill.**

### Distill a person's experience, judgment, voice, and ways of working into a reusable Person Profile for AI agents and compatible bots.

**Messages · documents · interviews · public sources → Distilly → Person Profile → Agent / Bot**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://python.org)
[![AgentSkills](https://img.shields.io/badge/AgentSkills-Standard-green)](https://agentskills.io)
[![Stars](https://img.shields.io/github/stars/titanwings/colleague-skill?style=social)](https://github.com/titanwings/distilly/stargazers)

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/NVX66RxWZv)

<br>

<table>
<tr><td align="left">

🧑‍💼 &nbsp;Your colleague quit, your mentor graduated, your teammate transferred — taking their whole playbook and context with them?<br>
💞 &nbsp;Your family, old friends, partner drifting apart — and you want to hold on to the way it felt to be with them?<br>
🌟 &nbsp;Your favorite author, idol, thinker you'll never meet — but you want to know what they'd say about your question?

</td></tr>
</table>

### ✨ One project, many kinds of people.

<br>

Distilly is the person-modeling layer for agents. It turns the materials you provide into a portable, source-grounded Person Profile built from observable experience, decision patterns, expression, and ways of working; it does not claim to clone the person behind them.

Colleagues · partners · family · old friends · idols · public figures · fictional characters — even yourself

**Source material + your description → a source-grounded Person Profile → your Agent or compatible Bot**

> A Person Profile is the reusable output. The current release packages each profile as an Agent Skill so supported hosts can install and invoke it. The canonical creator Skill is named `distilly`; install it in a `distilly` directory. The former name above remains for search continuity and project history.

<br>

[🆕 What Distilly does](#-what-distilly-does-today) · [📦 Data Sources](#-supported-data-sources) · [⚡ Install](#-install) · [🚀 Usage](#-usage) · [✨ Demo](#-demo) · [💬 Discord](https://discord.gg/NVX66RxWZv)

[**Chinese**](README_ZH.md) · [**Spanish**](README_ES.md) · [**German**](README_DE.md) · [**Japanese**](README_JA.md) · [**Russian**](README_RU.md) · [**Portuguese**](README_PT.md) · [**Korean**](README_KO.md)

</div>

---

<div align="center">

### 🎉 2026.08.13 Milestone — **the project has passed 20K ⭐!**

Massive thanks to everyone who starred — we'll keep shipping, keep distilling.

</div>

> 🧬 **2026.08.24 Update** — The creator is now named **Distilly** end to end and documents native local Skill discovery for Claude Code, Hermes, OpenClaw, Codex, DeepSeek Harness, Pi, Grok Build, and OpenCode. Grok Bot is listed separately as a saved-Skill workflow preview.

> 📝 **2026.06.01 Update** — **[The COLLEAGUE.SKILL technical report](https://arxiv.org/pdf/2605.31264) is now available**; the happiest part is not just publishing a paper, but seeing the community grow the gallery to 215 skills from 165 contributors with 100k+ cumulative skill-card stars, all acknowledged in the paper.

> 🗺️ **2026.04.13** — **The Distilly Roadmap is live!** What began as Colleague Skill is growing beyond colleagues: distill people into Skills that Agents can reuse. 👉 **[Full Roadmap](../../ROADMAP.md)** · **[💬 Discord](https://discord.gg/NVX66RxWZv)**

> 🌐 **2026.04.07** — Community gallery is live! Any skill / meta-skill can drive traffic directly to your own GitHub repo. No middleman. 👉 **[titanwings.github.io/colleague-skill-site](https://titanwings.github.io/colleague-skill-site/)**

<div align="center">

Created by [@titanwings](https://github.com/titanwings)

</div>

---

## 🆕 What Distilly does today

### 1️⃣ From Colleague Skill to Distilly

The project is no longer limited to the colleague scenario. Its `distilly` creator builds source-grounded Person Profiles for three person families with one workflow, then packages each profile as an Agent Skill.

### 2️⃣ Three character families

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
<td align="center"><sub>Coworkers · mentors · teammates · up/downstream partners</sub></td>
<td align="center"><sub>Exes · partners · parents · friends · close family</sub></td>
<td align="center"><sub>Public figures · creators · public voices · fictional characters</sub></td>
</tr>
<tr>
<td><sub>Builds a Work Skill + Persona from material-derived technical standards, workflows, expression, and workplace behavior. Supports Lark / DingTalk / Slack collection.</sub></td>
<td><sub>Organizes material-derived expression patterns, emotional triggers, conflict patterns, and repair patterns into a reusable Persona Skill.</sub></td>
<td><sub>Ships with a <b>six-dimension research toolchain</b> (subtitles → transcript cleanup → research merge → quality check) for organizing observable decisions, expression, and mental models.</sub></td>
</tr>
</tbody>
</table>

Each family has its own source-collection strategy, analysis dimensions, and Person Profile structure.

### 3️⃣ More Agent hosts

The old version only ran in Claude Code. Distilly now supports native local Skill discovery across eight agent hosts.

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

**Grok Bot preview:** Grok Bot supports saved/private Skills, but its official docs do not describe direct local `SKILL.md` imports. Distilly's workflow can be migrated manually into a saved Skill; direct repo installation is not yet verified.

Each generated Person Profile is packaged as an Agent Skill and can be installed into any supported host.

---

## 📦 Supported Data Sources

| Logo | Source | Messages | Docs / Wiki | Notes |
|:----:|--------|:--------:|:-----------:|-------|
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark (auto) | ✅ API | ✅ | Just enter a name, fully automatic |
| <img src="../assets/sources/dingtalk-mark.jpg" alt="DingTalk" width="32" height="32"> | DingTalk (auto) | ⚠️ Browser | ✅ | DingTalk API doesn't support message history |
| <img src="../assets/sources/slack-mark.png" alt="Slack" width="32" height="32"> | Slack (auto) | ✅ API | — | Requires admin to install Bot; free plan limited to 90 days |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/sources/x-mark-dark.svg"><img src="../assets/sources/x-mark-light.svg" alt="X" width="32" height="32"></picture> | Public X posts | ✅ API | — | Optional, bounded celebrity research candidates through metered third-party service Xquik |
| <img src="../assets/sources/wechat-mark.jpg" alt="WeChat" width="32" height="32"> | WeChat chat history | ✅ SQLite | — | Export first with WeChatMsg or PyWxDump |
| 📄 | PDF / Images / Screenshots | — | ✅ | Manual upload |
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark JSON export | ✅ | ✅ | Manual upload |
| ✉️ | Email `.eml` / `.mbox` | ✅ | — | Manual upload |
| 📝 | Markdown / direct paste | ✅ | ✅ | Manual input |

---

## ⚡ Install

### 🤖 For Agents

Open any supported local Agent host and send:

> Install Distilly from `https://github.com/titanwings/distilly`, then verify that this host can discover it.

The Agent installs Distilly as a Skill named `distilly` in the correct host directory.

### 👤 For Humans

Clone Distilly into the Skills directory used by your host:

```bash
git clone https://github.com/titanwings/distilly <DISTILLY_SKILL_DIR>
```

Host paths, migration, Windows, generated-profile installation, and credential setup are in the **[Detailed Install Guide](../../INSTALL_EN.md)**.

---

## 🚀 Usage

In your Agent, say:

> Use Distilly to create a Person Profile for `<person>`.

Then:

1. Choose `colleague`, `relationship`, or `celebrity`.
2. Add a description or source material. Every field is optional.
3. Review the result and let Distilly generate the profile.

The result is packaged as an Agent Skill named `{character}-{slug}`. For the optional celebrity research pipeline and advanced tools, see the **[Detailed Install Guide](../../INSTALL_EN.md)**.

---

## ✨ Demo

One from each family.

<br>

### 🌟 celebrity — distilling Andrej Karpathy

> Six-dimension research: works · interviews · decisions · expression DNA · external evaluations · timeline<br>
> Case adapted from community work [alchaincyf/karpathy-skill](https://github.com/alchaincyf/karpathy-skill)

```
User            ❯ Everyone's talking about Agents now — what do you think the 2026 AI Agent looks like?

celebrity.skill ❯ Everyone's doing demos, nobody's doing eval.
                  The Agent bottleneck was never model intelligence — it's scaffolding:
                  a strict evaluation harness, fine-grained error replay,
                  controllable tool-calling budgets, clean failure-mode analysis.
                  Most products are still stuck at "wrap an API + a few tools + a system prompt."
                  That's a demo, not an agent.
                  In 2026 I'm not betting on the strongest model — I'm betting on the best
                  scaffolding and the strictest eval.
```

<br>

### 🧑‍💼 colleague — distilling a ByteDance L2-1 backend

> Input: `ByteDance L2-1 backend engineer, INTJ, blame-shifter, ByteDance-style`

```
User            ❯ Can you review this API design?

colleague.skill ❯ Hold on — what's the impact? You haven't explained the context.
                  (after reading) N+1 query, fix it. Use the standard
                  {code, message, data} response format. That's the spec,
                  don't ask why.

User            ❯ This bug was introduced by you, right?

colleague.skill ❯ Does the timeline match? That feature touched multiple places,
                  there were other changes too.
```

<br>

### 💞 relationship — distilling someone you have a crush on

> Upload half a year of chat logs + "sensitive, quiet but stubborn, will actually reply seriously when it matters"

```
User               ❯ Did you think about me today?

relationship.skill ❯ ...I did, a little bit. Why are you asking?
```

<div align="center">

📚 More real-world cases in the **[community gallery](https://titanwings.github.io/colleague-skill-site/)** — 100+ skills and counting

</div>

---

## 🔧 Features

### 🧱 Generated Skill Structure

Distilly's current creator uses **Persona** as the universal base, with family-specific modules layered on top:

| Family | Persona Content | Additional Modules |
|--------|-----------------|-------------------|
| 🧑‍💼 **colleague** | 6-layer personality: hard rules → identity → expression → decisions → interpersonal → Correction | ➕ **Work Skill**: scope, workflow, output preferences, experience knowledge base |
| 💞 **relationship** | Expression DNA · emotional triggers · conflict pattern · repair pattern | — |
| 🌟 **celebrity** | Mental models · decision heuristics · expression DNA · external-evaluation contrast | ➕ Six-dimension research dossier (works / interviews / decisions / timeline...) |

> **Execution**: Receive task → Persona selects material-derived preferences and tone → Additional modules fill in execution detail → Produce a source-grounded response

### 🧬 Evolution

- 🛡️ **Safe create** → if a Skill already uses the same `{character}/{slug}`, creation stops and points you to Evolution instead of rewriting its files
- 📥 **Append files** → auto-analyze delta → merge into relevant sections, never overwrite existing conclusions
- 💬 **Conversation correction** → say "they wouldn't do that, they'd be xxx" → writes to the Correction layer, takes effect immediately
- 🕰️ **Version control** → auto-archive on every update, rollback to any previous version
- 🔬 **Celebrity research pipeline** → subtitles → transcript cleanup → six-dimension research → quality check

---

## ⚠️ Notes

**Source material quality = Person Profile quality** — and quality sources differ across families:

| Family | Source priority (high → low) |
|--------|------------------------------|
| 🧑‍💼 **colleague** | Their **own long-form writing** (design docs / review comments) **›** **decision-making replies** **›** casual group chat |
| 💞 **relationship** | Complete chat history **›** letters / social posts / diaries **›** third-party descriptions |
| 🌟 **celebrity** | First-person books / blogs / long interviews **›** decision records (launches, commits, Q&A) **›** verified first-person short-form posts **›** third-party commentary |

- **colleague** Lark-compatible auto-collection: requires adding the App bot to relevant group chats
- **relationship**: longer time spans are better; material covering both conflict and repair is ideal
- **celebrity**: avoid feeding only second-hand interpretations
- This is still a demo version — please file issues if you find bugs!

---

## 📄 Technical Report

> **[COLLEAGUE.SKILL: Automated AI Skill Generation via Expert Knowledge Distillation](https://arxiv.org/pdf/2605.31264)** ([arXiv](https://arxiv.org/abs/2605.31264) · [arXiv PDF](https://arxiv.org/pdf/2605.31264))
>
> This is the paper for **COLLEAGUE.SKILL / colleague-skill**, Distilly's predecessor. It covers the Work Skill + Persona two-layer architecture, multi-source data collection, and Skill generation mechanics — the theoretical foundation for today's `colleague` family. Separate papers on the relationship / celebrity family extensions are planned.

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
