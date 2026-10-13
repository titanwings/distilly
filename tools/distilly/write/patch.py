"""Merge Work/Persona patches and append Persona corrections."""

from __future__ import annotations

import re


SECTION_HEADING_RE = re.compile(r"^##\s+.+$", re.MULTILINE)


def merge_markdown_patch(existing_content: str, patch_content: str) -> str:
    """Replace matching level-2 markdown sections, otherwise append the patch."""
    matches = list(SECTION_HEADING_RE.finditer(patch_content))
    if not matches:
        return existing_content + ("\n\n" if existing_content else "") + patch_content

    merged = existing_content
    replaced_any = False

    for index, match in enumerate(matches):
        heading = match.group(0)
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(patch_content)
        patch_section = patch_content[start:end].strip()

        section_match = re.search(rf"(?m)^{re.escape(heading)}\s*$", merged)
        if not section_match:
            merged = merged.rstrip() + "\n\n" + patch_section
            continue

        replaced_any = True
        section_start = section_match.start()
        next_section = re.search(r"(?m)^##\s+.+$", merged[section_match.end():])
        section_end = (
            section_match.end() + next_section.start()
            if next_section
            else len(merged)
        )
        merged = merged[:section_start].rstrip() + "\n\n" + patch_section + "\n\n" + merged[section_end:].lstrip()

    if replaced_any:
        return merged.strip() + "\n"
    return merged


def apply_correction(persona_content: str, correction: dict) -> str:
    """Append a normalized correction entry to persona content."""
    scene = correction.get("scene", "general")
    correction_line = f"\n- [{scene}] should not {correction['wrong']}; should {correction['correct']}"
    target = "## Correction Log"
    legacy_target = "## Correction 记录"
    if target in persona_content:
        insert_pos = persona_content.index(target) + len(target)
        rest = persona_content[insert_pos:]
        placeholder = "\n\n(No entries yet)"
        if rest.startswith(placeholder):
            rest = rest[len(placeholder):]
        return persona_content[:insert_pos] + correction_line + rest
    if legacy_target in persona_content:
        insert_pos = persona_content.index(legacy_target) + len(legacy_target)
        rest = persona_content[insert_pos:]
        legacy_placeholder = "\n\n（暂无记录）"
        if rest.startswith(legacy_placeholder):
            rest = rest[len(legacy_placeholder):]
        return persona_content[:insert_pos] + correction_line + rest
    return persona_content + f"\n\n## Correction Log\n{correction_line}\n"


def normalize_corrections(correction: dict | list[dict] | None) -> list[dict]:
    """Normalize a correction payload into a flat list of correction entries."""
    if not correction:
        return []

    if isinstance(correction, list):
        return [item for item in correction if isinstance(item, dict)]

    if isinstance(correction, dict):
        if {"wrong", "correct"} <= correction.keys():
            return [correction]
        for key in ("persona_corrections", "corrections"):
            value = correction.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict) and {"wrong", "correct"} <= item.keys()]

    return []
