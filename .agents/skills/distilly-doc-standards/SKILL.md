---
name: distilly-doc-standards
description: Use when writing, moving, or reviewing documentation on the distilly branch — choosing which file owns a fact, adding Agent Notes, or responding to verify_agent_notes failures.
---

# distilly documentation workflow

Contracts live in [docs/AGENTS.md](../../../docs/AGENTS.md). This skill is the walk, not a second standard.

1. Name the document's subject and its direct children. Keep full detail only for the subject.
2. Choose the folder: product contract → `docs/design/`; live tree → `architecture.md`; steps → `cookbook/`; review rules → `docs/process/`; why → Agent Note.
3. Do not compress [system-v1.md](../../../docs/design/system-v1.md) into architecture.md. Edit the parent design file first, then the matching `docs/design/v1/` chapter.
4. Search `.agents/notes/` before adding a note. Update the owner or cross-link.
5. Run `python3 scripts/verify_agent_notes.py` after note or standing-doc edits.
6. Standing docs stay present tense. The design corpus may keep conversation density.
