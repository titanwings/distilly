<div align="center">

# 🧬 Distilly

**Früher: Colleague Skill / colleague-skill.**

![Distilly — Distill how they think into Person Profiles for Agents](../social-preview-distilly-v7.png)

### **Distill how they think.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://python.org)
[![AgentSkills](https://img.shields.io/badge/AgentSkills-Standard-green)](https://agentskills.io)
[![Stars](https://img.shields.io/github/stars/titanwings/colleague-skill?style=social)](https://github.com/titanwings/distilly/stargazers)

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/NVX66RxWZv)

<br>

<table>
<tr><td align="left">

🧑‍💼 &nbsp;Dein Kollege hat gekündigt, dein Mentor hat seinen Abschluss gemacht, dein Teamkamerad wurde versetzt — und das ganze Playbook samt Kontext ist mit ihnen verschwunden?<br>
💞 &nbsp;Deine Familie, alte Freunde, dein Partner entfernen sich — und du willst das Gefühl festhalten, mit ihnen zusammen zu sein?<br>
🌟 &nbsp;Dein Lieblingsautor, dein Idol, ein Denker, dem du nie begegnen wirst — aber du willst wissen, was sie zu deiner Frage sagen würden?

</td></tr>
</table>

### ✨ Distilly macht aus Menschen wiederverwendbare Person Profiles.

<br>

Distilly destilliert die durch Quellen belegte Erfahrung, das Urteilsvermögen, die Stimme und die Arbeitsweisen einer Person zu einem wiederverwendbaren Person Profile für KI-Agenten und kompatible Bots.

Kollegen · Partner · Familie · alte Freunde · Idole · Personen des öffentlichen Lebens · fiktive Figuren — sogar du selbst

**Quellmaterial + deine Beschreibung → ein quellengestütztes Person Profile → dein Agent oder kompatibler Bot**

<br>

[🆕 Was ist neu](#-was-ist-neu-in-diesem-major-release) · [📦 Datenquellen](#-unterstützte-datenquellen) · [⚡ Installation](#-installation) · [🚀 Nutzung](#-nutzung) · [✨ Demo](#-demo) · [💬 Discord](https://discord.gg/NVX66RxWZv)

[**Englisch**](../../README.md) · [**Chinesisch**](README_ZH.md) · [**Spanisch**](README_ES.md) · [**Japanisch**](README_JA.md) · [**Russisch**](README_RU.md) · [**Portugiesisch**](README_PT.md) · [**Koreanisch**](README_KO.md)

</div>

---

<div align="center">

### 🎉 Meilenstein 2026.08.13 — **Distilly hat 20K ⭐ überschritten!**

Riesigen Dank an alle, die einen Stern dagelassen haben — wir liefern weiter aus, destillieren weiter.

</div>

> 🧬 **Update 2026.08.24** — Der Creator heißt jetzt durchgängig **Distilly**. Lokale Skill-Erkennung wird für Claude Code, Hermes, OpenClaw, Codex, DeepSeek Harness, Pi, Grok Build und OpenCode unterstützt; Grok Bot bleibt ein separater Preview-Ablauf für gespeicherte Skills.

> 📝 **Update 2026.06.01** — **[Der technische Bericht zu COLLEAGUE.SKILL](https://arxiv.org/pdf/2605.31264) ist jetzt verfügbar**; am meisten freut uns nicht nur das Paper selbst, sondern dass die Community die Galerie auf 215 Skills von 165 Mitwirkenden und 100k+ kumulative Skill-Card-Stars gebracht hat, mit allen Community-Beiträgern in den Acknowledgements.

> 🗺️ **2026.04.13** — **Die Distilly-Roadmap ist da!** Das als colleague.skill gestartete Projekt heißt heute **Distilly** — destilliere jede Person, nicht nur Kollegen. 👉 **[Vollständige Roadmap](../../ROADMAP.md)** · **[💬 Discord](https://discord.gg/NVX66RxWZv)**

> 🌐 **2026.04.07** — Die Community-Galerie ist online! Jeder Skill oder Meta-Skill kann Traffic direkt zu deinem eigenen GitHub-Repo leiten. Kein Mittelsmann. 👉 **[titanwings.github.io/colleague-skill-site](https://titanwings.github.io/colleague-skill-site/)**

<div align="center">

Created by [@titanwings](https://github.com/titanwings)

</div>

---

## 🆕 Was ist neu in diesem Major-Release?

### 1️⃣ Von Colleague Skill zu Distilly

Distilly ist nicht mehr nur auf das „Kollegen“-Szenario ausgerichtet. Der `distilly`-Creator erstellt mit einem gemeinsamen Workflow quellengestützte Person Profiles für drei Personenfamilien und verpackt jedes Profil als Agent Skill. Der kanonische Name des Creator-Skills und seines Einstiegspunkts ist `distilly`.

### 2️⃣ Drei Charakter-Familien

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
<td align="center"><sub>Kollegen · Mentoren · Teamkameraden · vor- und nachgelagerte Partner</sub></td>
<td align="center"><sub>Ex-Partner · Partner · Eltern · Freunde · enge Familie</sub></td>
<td align="center"><sub>Personen des öffentlichen Lebens · Creator · öffentliche Stimmen · fiktive Figuren</sub></td>
</tr>
<tr>
<td><sub>Zwei-Schichten-Architektur Work Skill + Persona — lernt sowohl technische Standards und Workflows als auch Sprechweise und Haltung am Arbeitsplatz. Unterstützt automatische Erfassung über Lark / DingTalk / Slack.</sub></td>
<td><sub>🆕 <b>Foto-Sharing-Funktion kommt bald</b> — deine destillierte Beziehung beantwortet nicht nur Nachrichten; sie verschickt Fotos und teilt Ausschnitte aus ihrem Tag, so wie es eine echte Person tun würde.</sub></td>
<td><sub>Wird mit einer vollständigen <b>Recherche-Toolchain über sechs Dimensionen</b> ausgeliefert (Untertitel → Transkript-Bereinigung → Recherche-Merge → Qualitätsprüfung). Nicht bloß Tonimitation, sondern eine quellengestützte Rekonstruktion beobachtbarer Denk- und Entscheidungsmuster.</sub></td>
</tr>
</tbody>
</table>

Jede Familie hat ihre eigene Quellsammelstrategie, eigene Analysedimensionen und eine eigene Person-Profile-Struktur.

### 3️⃣ Mehr Agent-Hosts

Distilly unterstützt die lokale, native Skill-Erkennung auf acht Agent-Hosts:

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

Jedes generierte Person Profile wird als Agent Skill verpackt und kann in das Skill-Verzeichnis eines unterstützten Hosts gelegt werden.

**Grok Bot (Preview):** manuelle Migration als gespeicherter privater Skill. Die direkte Installation der `SKILL.md` dieses Repositories in Grok Bot ist weder offiziell dokumentiert noch verifiziert.

---

## 📦 Unterstützte Datenquellen

| Logo | Quelle | Nachrichten | Docs / Wiki | Hinweise |
|:----:|--------|:-----------:|:-----------:|----------|
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark (automatisch) | ✅ API | ✅ | Einfach einen Namen eingeben, vollautomatisch |
| <img src="../assets/sources/dingtalk-mark.jpg" alt="DingTalk" width="32" height="32"> | DingTalk (auto) | ⚠️ Browser | ✅ | Die DingTalk-API unterstützt keinen Nachrichtenverlauf |
| <img src="../assets/sources/slack-mark.png" alt="Slack" width="32" height="32"> | Slack (auto) | ✅ API | — | Admin muss den Bot installieren; kostenloser Plan auf 90 Tage begrenzt |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/sources/x-mark-dark.svg"><img src="../assets/sources/x-mark-light.svg" alt="X" width="32" height="32"></picture> | Öffentliche X-Posts | ✅ API | — | Optionale, begrenzte Recherchekandidaten zu öffentlichen Personen über Xquik |
| <img src="../assets/sources/wechat-mark.jpg" alt="WeChat" width="32" height="32"> | WeChat-Chatverlauf | ✅ SQLite | — | Zuerst mit WeChatMsg oder PyWxDump exportieren |
| 📄 | PDF / Bilder / Screenshots | — | ✅ | Manueller Upload |
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark-JSON-Export | ✅ | ✅ | Manueller Upload |
| ✉️ | E-Mail `.eml` / `.mbox` | ✅ | — | Manueller Upload |
| 📝 | Markdown / direkt einfügen | ✅ | ✅ | Manuelle Eingabe |

> Der aktuelle Lark-kompatible Collector verwendet die Endpunkte der China-Region. Das Routing für internationale `larksuite.com`-Tenants ist noch nicht implementiert.

---

## ⚡ Installation

### 🤖 Für Agents

Öffne einen unterstützten lokalen Agent-Host und sende ihm:

> Installiere Distilly von https://github.com/titanwings/distilly und prüfe anschließend, ob dieser Host Distilly erkennen kann.

Der Agent installiert das Repository im richtigen Skills-Verzeichnis des Hosts als Skill namens `distilly`.

### 👤 Für Menschen

```bash
git clone https://github.com/titanwings/distilly <DISTILLY_SKILL_DIR>
```

Host-spezifische Pfade, Migration, Windows-Hinweise, die Installation erzeugter Profiles und Zugangsdaten findest du in der **[ausführlichen Installationsanleitung (INSTALL_EN.md)](../../INSTALL_EN.md)**.

---

## 🚀 Nutzung

> Verwende Distilly, um ein Person Profile für `<person>` zu erstellen.

1. Wähle `colleague`, `relationship` oder `celebrity`.
2. Beschreibe die Person oder stelle Materialien bereit; alle Felder sind optional.
3. Prüfe das Person Profile und bestätige anschließend die Erzeugung.

Das Ergebnis wird als Agent Skill namens `{character}-{slug}` verpackt.

Details zur Recherche mit `celebrity` und zu fortgeschrittenen Werkzeugen findest du in der **[ausführlichen Installationsanleitung (INSTALL_EN.md)](../../INSTALL_EN.md)**.

---

## ✨ Demo

Eines aus jeder Familie.

<br>

### 🌟 celebrity — Andrej Karpathy destillieren

> Recherche über sechs Dimensionen: Werke · Interviews · Entscheidungen · Ausdrucks-DNA · externe Bewertungen · Zeitstrahl<br>
> Fallbeispiel adaptiert aus der Community-Arbeit [alchaincyf/karpathy-skill](https://github.com/alchaincyf/karpathy-skill)

```
User            ❯ Alle reden jetzt über Agents — wie sieht deiner Meinung nach der AI Agent von 2026 aus?

celebrity.skill ❯ Alle machen Demos, niemand macht Eval.
                  Der Flaschenhals bei Agents war nie die Modellintelligenz — es ist das Scaffolding:
                  ein striktes Evaluations-Harness, fein granularer Error-Replay,
                  kontrollierbare Tool-Call-Budgets, saubere Failure-Mode-Analyse.
                  Die meisten Produkte hängen immer noch bei „eine API + ein paar Tools + ein System-Prompt" fest.
                  Das ist eine Demo, kein Agent.
                  In 2026 setze ich nicht auf das stärkste Modell — ich setze auf das beste
                  Scaffolding und die strengste Eval.
```

<br>

### 🧑‍💼 colleague — einen ByteDance L2-1 Backend destillieren

> Input: `ByteDance L2-1 Backend-Engineer, INTJ, Schuldabwälzer, ByteDance-Stil`

```
User            ❯ Kannst du dieses API-Design reviewen?

colleague.skill ❯ Moment — was ist der Impact? Du hast den Kontext nicht erklärt.
                  (nach dem Lesen) N+1-Query, beheben. Verwende das Standard-
                  Response-Format {code, message, data}. Das ist die Spec,
                  frag nicht warum.

User            ❯ Dieser Bug wurde von dir eingeführt, oder?

colleague.skill ❯ Passt der Zeitstrahl? Das Feature hat mehrere Stellen berührt,
                  es gab auch andere Änderungen.
```

<br>

### 💞 relationship — jemanden destillieren, in den du verknallt bist

> Lade ein halbes Jahr Chatverlauf hoch + „sensibel, still aber stur, antwortet aber wirklich ernsthaft, wenn es darauf ankommt"

```
User               ❯ Hast du heute an mich gedacht?

relationship.skill ❯ ...ja, ein bisschen. Warum fragst du?
```

<div align="center">

📚 Weitere reale Fallbeispiele in der **[Community-Galerie](https://titanwings.github.io/colleague-skill-site/)** — 100+ Skills und es werden mehr

</div>

---

## 🔧 Funktionen

### 🧱 Struktur des generierten Skills

Distilly verwendet **Persona** als universelle Basis, mit familienspezifischen Modulen darüber:

| Familie | Persona-Inhalt | Zusätzliche Module |
|---------|----------------|--------------------|
| 🧑‍💼 **colleague** | 6-Schichten-Persönlichkeit: harte Regeln → Identität → Ausdruck → Entscheidungen → Zwischenmenschliches → Korrektur | ➕ **Work Skill**: Zuständigkeitsbereich, Workflow, Output-Präferenzen, Erfahrungswissensbasis |
| 💞 **relationship** | Ausdrucks-DNA · emotionale Auslöser · Konfliktmuster · Versöhnungsmuster | — |
| 🌟 **celebrity** | Mentale Modelle · Entscheidungsheuristiken · Ausdrucks-DNA · Kontrast zur externen Bewertung | ➕ Recherche-Dossier über sechs Dimensionen (Werke / Interviews / Entscheidungen / Zeitstrahl...) |

> **Ausführung**: Aufgabe empfangen → Persona bestimmt Haltung & Ton → zusätzliche Module liefern Ausführungsdetails → Ausgabe in ihrer Stimme

### 🧬 Evolution

- 🛡️ **Sicheres Erstellen** → wenn bereits ein Skill mit demselben `{character}/{slug}` existiert, stoppt die Erstellung und verweist auf Evolution, statt dessen Dateien zu überschreiben
- 📥 **Dateien anfügen** → automatische Delta-Analyse → Merge in die relevanten Abschnitte, überschreibt nie bestehende Schlussfolgerungen
- 💬 **Gesprächskorrektur** → sage „so würden sie das nicht tun, sie wären xxx" → wird in die Korrekturschicht geschrieben, wirkt sofort
- 🕰️ **Versionskontrolle** → automatische Archivierung bei jedem Update, Rollback zu jeder früheren Version
- 🔬 **Celebrity-Recherche-Pipeline** → Untertitel → Transkript-Bereinigung → Recherche über sechs Dimensionen → Qualitätsprüfung

---

## ⚠️ Hinweise

**Qualität des Quellmaterials = Qualität des Person Profiles** — und gute Quellen unterscheiden sich zwischen den Familien:

| Familie | Quellen-Priorität (hoch → niedrig) |
|---------|------------------------------------|
| 🧑‍💼 **colleague** | **Selbst verfasste Langtexte** (Design-Docs / Review-Kommentare) **›** **Entscheidungsantworten** **›** beiläufiger Gruppenchat |
| 💞 **relationship** | Vollständiger Chatverlauf **›** Briefe / Social-Posts / Tagebücher **›** Beschreibungen durch Dritte |
| 🌟 **celebrity** | Ausführliche Primärquellen (Bücher / Blogs / lange Interviews in der ersten Person) **›** Entscheidungsaufzeichnungen (Launches, Commits, Q&A) **›** verifizierte kurze Posts der Zielperson **›** Kommentare Dritter |

- **colleague** automatische Lark-Erfassung: Der App-Bot muss den relevanten Gruppenchats hinzugefügt werden
- **relationship**: längere Zeiträume sind besser; Material, das sowohl Konflikt als auch Versöhnung abdeckt, ist ideal
- **celebrity**: füttere nicht nur mit Sekundärinterpretationen
- Dies ist noch eine Demo-Version — bitte erstelle Issues, wenn du Bugs findest!

---

## 📄 Technischer Bericht

> **[COLLEAGUE.SKILL: Automated AI Skill Generation via Expert Knowledge Distillation](https://arxiv.org/pdf/2605.31264)** ([arXiv](https://arxiv.org/abs/2605.31264) · [arXiv PDF](https://arxiv.org/pdf/2605.31264))
>
> Dies ist das Paper für **colleague.skill**, den Vorgänger von Distilly. Es behandelt die Zwei-Schichten-Architektur Work Skill + Persona, die Multi-Source-Datenerfassung und die Mechanik der Skill-Generierung — die theoretische Grundlage für die heutige `colleague`-Familie. Separate Papers zu den Erweiterungen der relationship- / celebrity-Familien sind geplant.

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
