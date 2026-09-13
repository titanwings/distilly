<div align="center">

# 🧬 Distilly

**이전 이름: Colleague Skill / colleague-skill.**

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

🧑‍💼 &nbsp;동료가 퇴사하고, 멘토가 졸업하고, 팀원이 이동하면서 그들의 플레이북과 맥락이 통째로 사라졌나요?<br>
💞 &nbsp;가족, 오랜 친구, 연인과 점점 멀어지는데 함께였던 그 느낌만큼은 붙잡고 싶으신가요?<br>
🌟 &nbsp;절대 만날 수 없는 좋아하는 작가, 우상, 사상가 — 그 사람이 당신의 질문에 어떻게 답할지 궁금하신가요?

</td></tr>
</table>

### ✨ Distilly는 사람을 재사용 가능한 Person Profile로 증류합니다.

<br>

Distilly는 한 사람의 근거가 확인되는 경험, 판단, 말투, 업무 방식을 AI 에이전트와 호환 봇이 재사용할 수 있는 Person Profile로 증류합니다.

동료 · 파트너 · 가족 · 오랜 친구 · 우상 · 공인 · 가상의 인물 — 심지어 자기 자신까지

**소스 자료 + 당신의 설명 → 근거 기반 Person Profile → Agent / Bot**

<br>

[🆕 새로운 점](#-이번-메이저-릴리스의-새로운-점) · [📦 데이터 소스](#-지원-데이터-소스) · [⚡ 설치](#-설치) · [🚀 사용법](#-사용법) · [✨ 데모](#-데모) · [💬 Discord](https://discord.gg/NVX66RxWZv)

[**영어**](../../README.md) · [**중국어**](README_ZH.md) · [**스페인어**](README_ES.md) · [**독일어**](README_DE.md) · [**일본어**](README_JA.md) · [**러시아어**](README_RU.md) · [**포르투갈어**](README_PT.md)

</div>

---

<div align="center">

### 🎉 2026.08.13 마일스톤 — **Distilly가 20K ⭐를 돌파했습니다!**

스타를 눌러주신 모든 분들께 큰 감사를 드립니다 — 앞으로도 계속 릴리즈하고, 계속 증류해 나가겠습니다.

</div>

> 🧬 **2026.08.24 업데이트** — Creator 이름과 디렉터리, 엔트리포인트를 모두 **Distilly**로 통일했습니다. Claude Code, Hermes, OpenClaw, Codex, DeepSeek Harness, Pi, Grok Build, OpenCode의 로컬 Skill 발견 방식을 각 호스트의 현재 규칙에 맞춰 문서화했고, Grok Bot은 saved-Skill 프리뷰 흐름으로 별도 표시합니다.

> 📝 **2026.06.01 업데이트** — **[COLLEAGUE.SKILL 기술 보고서](https://arxiv.org/pdf/2605.31264)가 공개되었습니다**; 가장 기쁜 점은 단순히 paper를 냈다는 사실이 아니라, 커뮤니티가 함께 gallery를 165명의 기여자가 만든 215개 skills와 skill-card 누적 100k+ stars까지 키웠고, 논문 Acknowledgements에 모든 커뮤니티 기여자를 담았다는 점입니다.

> 🗺️ **2026.04.13** — **Distilly 로드맵이 공개되었습니다!** colleague.skill로 시작한 프로젝트는 이제 **Distilly**라는 이름으로 동료뿐 아니라 누구든 증류합니다. 👉 **[전체 로드맵 보기](../../ROADMAP.md)** · **[💬 Discord](https://discord.gg/NVX66RxWZv)**

> 🌐 **2026.04.07** — 커뮤니티 갤러리가 공개되었습니다! 어떤 스킬이든 메타 스킬이든 트래픽을 자신의 GitHub 저장소로 바로 연결할 수 있습니다. 중간 단계 없음. 👉 **[titanwings.github.io/colleague-skill-site](https://titanwings.github.io/colleague-skill-site/)**

<div align="center">

Created by [@titanwings](https://github.com/titanwings)

</div>

---

## 🆕 이번 메이저 릴리스의 새로운 점

### 1️⃣ Colleague Skill에서 Distilly로

Distilly는 더 이상 “동료” 시나리오에만 묶여 있지 않습니다. `distilly` Creator는 하나의 흐름으로 세 가지 인물 패밀리의 근거 기반 Person Profile을 만들고, 각 Profile을 Agent Skill로 패키징합니다. Creator Skill과 디렉터리의 정식 이름은 모두 `distilly`입니다.

### 2️⃣ 세 가지 캐릭터 패밀리

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
<td align="center"><sub>동료 · 멘토 · 팀원 · 업/다운스트림 파트너</sub></td>
<td align="center"><sub>전 연인 · 파트너 · 부모 · 친구 · 가까운 가족</sub></td>
<td align="center"><sub>공인 · 크리에이터 · 공적 발언가 · 가상의 인물</sub></td>
</tr>
<tr>
<td><sub>Work Skill + Persona 2단 아키텍처 — 기술 표준과 워크플로뿐 아니라, 말투와 사내 태도까지 학습합니다. Lark / DingTalk / Slack 자동 수집을 지원합니다.</sub></td>
<td><sub>🆕 <b>사진 공유 기능 곧 출시</b> — 증류된 관계가 메시지에 답장만 하는 게 아니라, 실제 사람처럼 사진을 보내고 하루의 한 조각을 공유합니다.</sub></td>
<td><sub>완성도 높은 <b>6차원 리서치 툴체인</b> 탑재 (자막 → 트랜스크립트 정리 → 리서치 병합 → 품질 점검). 단순한 말투 모방을 넘어, 출처에서 확인되는 사고·의사결정 패턴을 재구성합니다.</sub></td>
</tr>
</tbody>
</table>

각 패밀리는 고유한 소스 수집 전략, 분석 차원, Person Profile 구조를 갖추고 있습니다.

### 3️⃣ 더 많은 Agent 호스트

예전 버전은 Claude Code에서만 동작했지만, 이제 Distilly는 여덟 개의 로컬 Agent 호스트를 지원합니다.

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

생성된 각 Person Profile은 Agent Skill로 패키징되며, 각 호스트의 Skill 디렉터리에 설치할 수 있습니다.

**Grok Bot 프리뷰:** Distilly workflow를 private saved Skill로 수동 이전할 수 있습니다. 현재 저장소의 `SKILL.md`를 Grok Bot에 직접 설치하는 방식은 공식 문서에 없고 검증되지도 않았습니다.

---

## 📦 지원 데이터 소스

| 로고 | 소스 | 메시지 | 문서 / 위키 | 비고 |
|:----:|------|:------:|:-----------:|------|
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark (자동) | ✅ API | ✅ | 이름만 입력하면 완전 자동 |
| <img src="../assets/sources/dingtalk-mark.jpg" alt="DingTalk" width="32" height="32"> | DingTalk (자동) | ⚠️ 브라우저 | ✅ | DingTalk API는 메시지 기록 미지원 |
| <img src="../assets/sources/slack-mark.png" alt="Slack" width="32" height="32"> | Slack (자동) | ✅ API | — | 관리자가 Bot 설치 필요, 무료 플랜은 90일 제한 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/sources/x-mark-dark.svg"><img src="../assets/sources/x-mark-light.svg" alt="X" width="32" height="32"></picture> | 공개 X 게시물 | ✅ API | — | Xquik을 통한 선택적·수량 제한 celebrity 리서치 후보 |
| <img src="../assets/sources/wechat-mark.jpg" alt="WeChat" width="32" height="32"> | WeChat 대화 기록 | ✅ SQLite | — | WeChatMsg 또는 PyWxDump로 먼저 내보내기 |
| 📄 | PDF / 이미지 / 스크린샷 | — | ✅ | 수동 업로드 |
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark JSON 내보내기 | ✅ | ✅ | 수동 업로드 |
| ✉️ | 이메일 `.eml` / `.mbox` | ✅ | — | 수동 업로드 |
| 📝 | Markdown / 직접 붙여넣기 | ✅ | ✅ | 수동 입력 |

> **Lark 호환성 참고:** 현재 호환 수집기는 중국 리전 API 엔드포인트를 사용합니다. 국제 `larksuite.com` 엔드포인트로 라우팅하는 기능은 아직 구현되지 않았습니다.

---

## ⚡ 설치

### 🤖 Agent용

지원되는 로컬 Agent 호스트를 열고 다음 문장을 보내세요.

> `https://github.com/titanwings/distilly`에서 Distilly를 설치한 다음, 이 호스트에서 Distilly를 찾을 수 있는지 확인해 줘.

Agent는 현재 호스트에 맞는 디렉터리에 Skill 이름 `distilly`로 설치합니다.

### 👤 직접 설치하기

```bash
git clone https://github.com/titanwings/distilly <DISTILLY_SKILL_DIR>
```

호스트별 경로, 기존 설치 마이그레이션, Windows 지원, 생성된 Profile 설치, 수집 자격 증명에 관한 자세한 내용은 **[상세 설치 가이드 (INSTALL_EN.md)](../../INSTALL_EN.md)** 를 참고하세요.

---

## 🚀 사용법

Agent에게 다음과 같이 요청하세요.

> Distilly를 사용해서 `<person>`의 Person Profile을 만들어 줘.

1. `colleague`, `relationship`, `celebrity` 중에서 인물 유형을 선택합니다.
2. 설명이나 자료를 제공합니다. 모든 입력 항목은 건너뛸 수 있습니다.
3. 내용을 검토한 뒤 Profile을 생성합니다.

생성된 Profile은 `{character}-{slug}`라는 이름의 Agent Skill로 패키징됩니다.

Celebrity 리서치와 고급 도구에 관한 자세한 내용은 **[상세 설치 가이드 (INSTALL_EN.md)](../../INSTALL_EN.md)** 를 참고하세요.

---

## ✨ 데모

각 패밀리에서 하나씩.

<br>

### 🌟 celebrity — Andrej Karpathy 증류

> 6차원 리서치: 저작 · 인터뷰 · 의사결정 · 표현 DNA · 외부 평가 · 타임라인<br>
> 커뮤니티 작업물 [alchaincyf/karpathy-skill](https://github.com/alchaincyf/karpathy-skill)을 바탕으로 구성

```
사용자          ❯ 요즘 다들 Agent 얘기하는데 — 2026년 AI Agent는 어떤 모습일 것 같아요?

celebrity.skill ❯ 다들 데모만 하고, 아무도 eval을 안 한다.
                  Agent의 병목은 모델 지능이었던 적이 없다 — 스캐폴딩이다:
                  엄격한 평가 하네스, 세밀한 에러 리플레이,
                  제어 가능한 툴 호출 예산, 깔끔한 실패 모드 분석.
                  대부분의 제품은 여전히 "API 래핑 + 몇 가지 툴 + 시스템 프롬프트"에 머물러 있다.
                  그건 데모지, 에이전트가 아니다.
                  2026년에 나는 가장 강한 모델에 베팅하지 않는다 — 가장 좋은
                  스캐폴딩과 가장 엄격한 eval에 베팅한다.
```

<br>

### 🧑‍💼 colleague — ByteDance L2-1 백엔드 증류

> 입력: `ByteDance L2-1 백엔드 엔지니어, INTJ, 책임전가형, ByteDance 스타일`

```
사용자          ❯ 이 API 설계 좀 리뷰해줄래?

distilly ❯ 잠깐 — 영향 범위가 뭐야? 맥락 설명이 없잖아.
                  (읽은 뒤) N+1 쿼리네, 고쳐. 응답은 표준
                  {code, message, data} 형식으로 가. 그게 스펙이야,
                  이유는 묻지 마.

사용자          ❯ 이 버그, 네가 넣은 거 맞지?

distilly ❯ 타임라인이 맞아? 그 기능은 여러 군데를 건드렸고,
                  다른 변경도 있었잖아.
```

<br>

### 💞 relationship — 짝사랑 상대 증류

> 반년치 채팅 로그 + "예민하고, 조용하지만 고집 세고, 중요한 순간에는 진지하게 답해주는 스타일" 업로드

```
사용자             ❯ 오늘 내 생각 했어?

relationship.skill ❯ ...조금 했어. 왜 물어봐?
```

<div align="center">

📚 더 많은 실제 사례는 **[커뮤니티 갤러리](https://titanwings.github.io/colleague-skill-site/)** 에서 — 100개 이상의 스킬이 계속 쌓이고 있습니다.

</div>

---

## 🔧 기능

### 🧱 생성되는 Skill 구조

Distilly는 **Persona**를 범용 베이스로 삼고, 그 위에 패밀리별 모듈을 쌓아 올립니다.

| 패밀리 | Persona 내용 | 추가 모듈 |
|--------|-------------|----------|
| 🧑‍💼 **colleague** | 6단계 성격: 하드 룰 → 정체성 → 표현 → 의사결정 → 대인관계 → Correction | ➕ **Work Skill**: 담당 범위, 워크플로, 출력 선호, 경험 지식 베이스 |
| 💞 **relationship** | 표현 DNA · 감정 트리거 · 갈등 패턴 · 회복 패턴 | — |
| 🌟 **celebrity** | 멘탈 모델 · 의사결정 휴리스틱 · 표현 DNA · 외부 평가 대조 | ➕ 6차원 리서치 도시에 (저작/인터뷰/의사결정/타임라인 등) |

> **실행 흐름**: 작업 수신 → Persona가 태도와 어조 결정 → 추가 모듈이 실행 디테일 채움 → 그 사람의 목소리로 출력

### 🧬 진화 방식

- 🛡️ **안전한 생성** → 같은 `{character}/{slug}`에 Skill이 이미 있으면 파일을 덮어쓰지 않고 생성을 중단한 뒤 진화 모드를 안내합니다
- 📥 **파일 추가** → 변경 내용을 자동 분석해 관련 섹션에 병합, 기존 결론은 덮어쓰지 않음
- 💬 **대화 기반 수정** → "그 사람은 이렇게 안 해, xxx여야 해"라고 말하면 Correction 레이어에 기록되어 즉시 반영
- 🕰️ **버전 관리** → 업데이트할 때마다 자동 아카이브, 이전 어느 버전으로든 롤백 가능
- 🔬 **Celebrity 리서치 파이프라인** → 자막 → 트랜스크립트 정리 → 6차원 리서치 → 품질 점검

---

## ⚠️ 참고 사항

**소스 자료 품질 = Person Profile 품질** — 그리고 품질 높은 소스는 패밀리마다 다릅니다:

| 패밀리 | 소스 우선순위 (높음 → 낮음) |
|--------|------------------------------|
| 🧑‍💼 **colleague** | **본인이 직접 쓴 장문** (설계 문서 / 리뷰 코멘트) **›** **의사결정이 드러나는 답변** **›** 가벼운 그룹 채팅 |
| 💞 **relationship** | 완전한 대화 기록 **›** 편지 / SNS 게시물 / 일기 **›** 제3자 설명 |
| 🌟 **celebrity** | 장문 1차 자료 (본인 저서 / 블로그 / 장시간 인터뷰) **›** 의사결정 기록 (출시, 코드 커밋, Q&A) **›** 검증된 대상 본인의 짧은 게시물 **›** 제3자 논평 |

- **colleague** Lark 자동 수집: 관련 그룹 채팅에 App bot을 추가해야 합니다
- **relationship**: 기간이 길수록 좋고, 갈등과 회복이 모두 담긴 자료가 이상적입니다
- **celebrity**: 2차 해석 자료만 먹이는 건 피하세요
- 아직 데모 버전입니다 — 버그를 발견하면 이슈를 등록해 주세요!

---

## 📄 기술 보고서

> **[COLLEAGUE.SKILL: Automated AI Skill Generation via Expert Knowledge Distillation](https://arxiv.org/pdf/2605.31264)** ([arXiv](https://arxiv.org/abs/2605.31264) · [arXiv PDF](https://arxiv.org/pdf/2605.31264))
>
> 이 논문은 Distilly의 전신인 **colleague.skill**을 다룹니다. Work Skill + Persona 2단 아키텍처, 멀티소스 데이터 수집, Skill 생성 메커니즘을 정리한 것으로, 오늘날 `colleague` 패밀리의 이론적 기반입니다. relationship / celebrity 패밀리 확장에 대한 별도 논문도 계획 중입니다.

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
