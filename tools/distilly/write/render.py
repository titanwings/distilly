"""Render a profile's Work and Persona text into the three SKILL.md artifacts."""

from __future__ import annotations

import re

from distilly.profile.schema import build_identity_string


SKILL_MD_TEMPLATE_EN = """\
---
name: {combined_name}
description: {description}
user-invocable: true
---

# {display_name}

{identity}

---

## PART A: Work

{work_content}

---

## PART B: Persona

{persona_content}

---

## Operating Rules

When any task or question arrives:

1. **Start with PART B**: decide whether you would take the task and in what attitude.
2. **Execute with PART A**: use the work methods, heuristics, and capability profile to do the task.
3. **Keep PART B in the output**: preserve the tone, diction, rhythm, and reaction patterns from the persona.

**Layer 0 rules in PART B always take priority and must never be violated.**
"""


SKILL_MD_TEMPLATE_ZH = """\
---
name: {combined_name}
description: {description}
user-invocable: true
---

# {display_name}

{identity}

---

## PART A：工作能力

{work_content}

---

## PART B：人物性格

{persona_content}

---

## 运行规则

接收到任何任务或问题时：

1. **先由 PART B 判断**：你会不会接这个任务？用什么态度接？
2. **再由 PART A 执行**：用你的技术能力和工作方法完成任务
3. **输出时保持 PART B 的表达风格**：你说话的方式、用词习惯、句式

**PART B 的 Layer 0 规则永远优先，任何情况下不得违背。**
"""


def language_code(meta: dict) -> str:
    """Return the preferred language code for rendered artifacts."""
    return (
        meta.get("language")
        or meta.get("classification", {}).get("language")
        or "en"
    ).lower()


def prefers_chinese(meta: dict) -> bool:
    """Return whether artifact chrome should be rendered in Chinese."""
    return language_code(meta).startswith("zh")


def render_combined_skill(meta: dict, work_content: str, persona_content: str) -> str:
    """Render the combined SKILL.md file from normalized metadata."""
    artifacts = meta["artifacts"]
    identity = build_identity_string(meta)
    description = meta.get("summary") or (
        f"{meta['display_name']}, {identity}" if identity else meta["display_name"]
    )
    template = SKILL_MD_TEMPLATE_ZH if prefers_chinese(meta) else SKILL_MD_TEMPLATE_EN

    return template.format(
        combined_name=artifacts["combined_name"],
        description=description,
        display_name=meta["display_name"],
        identity=identity,
        work_content=work_content,
        persona_content=persona_content,
    )


_PERSONA_HANDOFF_PATTERNS = (
    re.compile(r"如果被问到[^。\n]*职责范围[^。\n]*Persona[^。\n]*。\s*"),
    re.compile(
        r"If (?:you are )?asked (?:a question |about something )?outside (?:of )?(?:your|the) "
        r"(?:recorded )?(?:scope of )?(?:your )?responsibilit(?:y|ies)[^.\n]*Persona[^.\n]*\.\s*",
        re.IGNORECASE,
    ),
)

WORK_ONLY_FALLBACK_ZH = (
    "如果问题超出已记录的职责范围，或原材料不足以回答，请直接说明缺口。"
    "不要臆造缺失信息，也不要引用 Persona。"
)
WORK_ONLY_FALLBACK_EN = (
    "If the question is outside the recorded responsibilities or the source "
    "material is insufficient, state the gap. Do not fabricate missing information "
    "or refer to Persona."
)


def work_only_content(work_content: str, *, chinese: bool) -> str:
    """Copy Work text for the Work-only skill, without a Persona handoff."""
    text = work_content
    for pattern in _PERSONA_HANDOFF_PATTERNS:
        text = pattern.sub("", text)
    text = text.rstrip()
    fallback = WORK_ONLY_FALLBACK_ZH if chinese else WORK_ONLY_FALLBACK_EN
    if fallback not in text:
        text = f"{text}\n\n{fallback}" if text else fallback
    return text


def render_work_skill(meta: dict, work_content: str) -> str:
    """Render the work-only skill artifact."""
    artifacts = meta["artifacts"]
    chinese = prefers_chinese(meta)
    description = (
        f"{meta['display_name']} 的工作能力（仅 Work，无 Persona）"
        if chinese
        else f"{meta['display_name']} work capability only (without persona)"
    )
    body = work_only_content(work_content, chinese=chinese)
    return (
        f"---\nname: {artifacts['work_name']}\n"
        f"description: {description}\n"
        f"user-invocable: true\n---\n\n{body}\n"
    )


def render_persona_skill(meta: dict, persona_content: str) -> str:
    """Render the persona-only skill artifact."""
    artifacts = meta["artifacts"]
    description = (
        f"{meta['display_name']} 的人物性格（仅 Persona，无工作能力）"
        if prefers_chinese(meta)
        else f"{meta['display_name']} persona only (without work capability)"
    )
    return (
        f"---\nname: {artifacts['persona_name']}\n"
        f"description: {description}\n"
        f"user-invocable: true\n---\n\n{persona_content}\n"
    )
