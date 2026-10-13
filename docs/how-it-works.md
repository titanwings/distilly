# How it works

[Back to README](../README.md)

Distilly turns source material you provide into a source-grounded Person Profile built from observable experience, decision patterns, expression, and ways of working. It does not claim to clone the person behind the material. Each profile is packaged as an Agent Skill so supported hosts can install and invoke it.

## Creating a profile

In your agent, say *"Use Distilly to create a Person Profile for `<person>`."* Then:

1. Choose `colleague`, `relationship`, or `celebrity`.
2. Add a description or source material. Every field is optional.
3. Review the result and let Distilly generate the profile.

The result is packaged as an Agent Skill named `{character}-{slug}`. To profile yourself instead, say *"Use Distilly to set up my profile."*: Distilly interviews you for about five minutes, shows you the profile, then adds a short summary to the file your agent reads every session.

## Person families

The `distilly` creator builds profiles for three person families with one workflow:

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

## Generated profile structure

Distilly's current creator uses **Persona** as the universal base, with family-specific modules layered on top:

| Family | Persona Content | Additional Modules |
|--------|-----------------|-------------------|
| 🧑‍💼 **colleague** | 6-layer personality: hard rules → identity → expression → decisions → interpersonal → Correction | ➕ **Work Skill**: scope, workflow, output preferences, experience knowledge base |
| 💞 **relationship** | Expression DNA · emotional triggers · conflict pattern · repair pattern | — |
| 🌟 **celebrity** | Mental models · decision heuristics · expression DNA · external-evaluation contrast | ➕ Six-dimension research dossier (works / interviews / decisions / timeline...) |

> **Execution**: Receive task → Persona selects material-derived preferences and tone → Additional modules fill in execution detail → Produce a source-grounded response

## Evolution

- 📥 **Append files** → auto-analyze delta → merge into relevant sections, never overwrite existing conclusions
- 💬 **Conversation correction** → say "they wouldn't do that, they'd be xxx" → writes to the Correction layer, takes effect immediately
- 🕰️ **Version control** → auto-archive on every update, rollback to any previous version
- 🔬 **Celebrity research pipeline** → subtitles → transcript cleanup → six-dimension research → quality check

## Choosing good source material

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

## Technical report

**[COLLEAGUE.SKILL: Automated AI Skill Generation via Expert Knowledge Distillation](https://arxiv.org/pdf/2605.31264)** ([arXiv](https://arxiv.org/abs/2605.31264) · [arXiv PDF](https://arxiv.org/pdf/2605.31264))

This is the paper for **COLLEAGUE.SKILL / colleague-skill**, Distilly's predecessor. It covers the Work Skill + Persona two-layer architecture, multi-source data collection, and Skill generation mechanics — the theoretical foundation for today's `colleague` family. Separate papers on the relationship / celebrity family extensions are planned.
