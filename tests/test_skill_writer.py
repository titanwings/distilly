from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import skill_writer  # noqa: E402
import version_manager  # noqa: E402
from skill_presets import (  # noqa: E402
    get_character_preset,
    get_research_profile_preset,
    resolve_existing_storage_root,
)
from skill_schema import validate_path_segment  # noqa: E402


class SkillWriterTest(unittest.TestCase):
    def test_slugify_produces_portable_kebab_case(self) -> None:
        self.assertEqual(skill_writer.slugify("Zadie Smith"), "zadie-smith")
        self.assertEqual(skill_writer.slugify("Élodie"), "elodie")
        self.assertEqual(skill_writer.slugify("A/B"), "a-b")

    def test_create_skill_rejects_unsafe_slug_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            with self.assertRaisesRegex(ValueError, "kebab-case"):
                skill_writer.create_skill(
                    root / "skills" / "colleague",
                    "../escape",
                    {"name": "Unsafe"},
                    "Work body",
                    "Persona body",
                )
            self.assertFalse((root / "skills" / "escape").exists())

    def test_failed_create_never_deletes_a_replacement_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            skill_dir = base_dir / "contended-after-reservation"
            displaced_dir = base_dir / "incomplete-first-creator"

            def replace_then_fail(
                output_dir: Path,
                _meta: dict,
                _work_content: str,
                _persona_content: str,
            ) -> None:
                self.assertEqual(output_dir, skill_dir)
                (output_dir / "partial.txt").write_text("partial", encoding="utf-8")
                output_dir.rename(displaced_dir)
                output_dir.mkdir()
                (output_dir / "publisher.txt").write_text("competitor", encoding="utf-8")
                raise OSError("simulated write failure")

            with mock.patch.object(
                skill_writer,
                "write_artifacts",
                side_effect=replace_then_fail,
            ):
                with self.assertRaisesRegex(
                    skill_writer.IncompleteSkillCreateError,
                    "simulated write failure",
                ):
                    skill_writer.create_skill(
                        base_dir,
                        "contended-after-reservation",
                        {"name": "Contended After Reservation"},
                        "Work body",
                        "Persona body",
                    )

            self.assertEqual(
                (skill_dir / "publisher.txt").read_text(encoding="utf-8"),
                "competitor",
            )
            self.assertEqual(
                (displaced_dir / "partial.txt").read_text(encoding="utf-8"),
                "partial",
            )

    def test_create_skill_preserves_a_competing_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            skill_dir = base_dir / "contended"
            original_mkdir = Path.mkdir

            def competing_reservation(
                path: Path,
                mode: int = 0o777,
                parents: bool = False,
                exist_ok: bool = False,
            ) -> None:
                if path != skill_dir:
                    original_mkdir(
                        path,
                        mode=mode,
                        parents=parents,
                        exist_ok=exist_ok,
                    )
                    return
                original_mkdir(
                    path,
                    mode=mode,
                    parents=parents,
                    exist_ok=exist_ok,
                )
                (skill_dir / "publisher.txt").write_text("competitor", encoding="utf-8")
                raise FileExistsError("simulated competing reservation")

            with mock.patch.object(
                Path,
                "mkdir",
                new=competing_reservation,
            ):
                with self.assertRaisesRegex(FileExistsError, "create target already exists"):
                    skill_writer.create_skill(
                        base_dir,
                        "contended",
                        {"name": "Contended"},
                        "Work body",
                        "Persona body",
                    )

            self.assertEqual(
                (skill_dir / "publisher.txt").read_text(encoding="utf-8"),
                "competitor",
            )
            self.assertEqual(
                [path.relative_to(skill_dir) for path in skill_dir.rglob("*")],
                [Path("publisher.txt")],
            )
            self.assertEqual(list(base_dir.iterdir()), [skill_dir])

    def test_create_skill_rejects_a_dangling_symlink_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            base_dir.mkdir(parents=True)
            skill_dir = base_dir / "existing-link"
            link_target = base_dir / "missing-target"
            skill_dir.symlink_to(link_target, target_is_directory=True)

            with self.assertRaisesRegex(FileExistsError, "--action update"):
                skill_writer.create_skill(
                    base_dir,
                    "existing-link",
                    {"name": "Existing Link"},
                    "Work body",
                    "Persona body",
                )

            self.assertTrue(skill_dir.is_symlink())
            self.assertEqual(skill_dir.readlink(), link_target)

    def test_cli_reports_post_reservation_failures_and_supports_recovery(self) -> None:
        failures = (
            PermissionError("simulated permission failure"),
            ValueError("simulated metadata failure"),
        )

        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                with tempfile.TemporaryDirectory() as tmp_dir:
                    base_dir = Path(tmp_dir) / "skills" / "colleague"
                    argv = [
                        "skill_writer.py",
                        "--action",
                        "create",
                        "--slug",
                        "write-failure",
                        "--name",
                        "Write Failure",
                        "--base-dir",
                        str(base_dir),
                    ]

                    with mock.patch.object(skill_writer.sys, "argv", argv):
                        with mock.patch.object(
                            skill_writer,
                            "write_artifacts",
                            side_effect=failure,
                        ):
                            with mock.patch.object(
                                skill_writer.sys,
                                "stderr",
                                new_callable=io.StringIO,
                            ) as stderr:
                                with self.assertRaises(SystemExit) as context:
                                    skill_writer.main()

                    self.assertEqual(context.exception.code, 1)
                    self.assertTrue(stderr.getvalue().startswith("error: create failed"))
                    self.assertIn("the directory may be incomplete", stderr.getvalue())
                    self.assertIn(str(base_dir / "write-failure"), stderr.getvalue())
                    self.assertIn(
                        "remove it only if it is the failed create",
                        stderr.getvalue(),
                    )
                    self.assertNotIn("Traceback", stderr.getvalue())
                    incomplete_dir = base_dir / "write-failure"
                    self.assertTrue(incomplete_dir.is_dir())

                    skill_writer.shutil.rmtree(incomplete_dir)
                    with mock.patch.object(skill_writer.sys, "argv", argv):
                        with mock.patch.object(
                            skill_writer.sys,
                            "stdout",
                            new_callable=io.StringIO,
                        ):
                            skill_writer.main()
                    self.assertTrue((incomplete_dir / "meta.json").is_file())

    def test_legacy_path_segments_are_windows_safe(self) -> None:
        self.assertEqual(validate_path_segment("Zadie Smith"), "Zadie Smith")
        self.assertEqual(validate_path_segment("Élodie"), "Élodie")
        for value in ("C:", "foo:bar", "CON", "nul.txt", "trailing.", "trailing "):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "safe path segment"):
                    validate_path_segment(value)

    def test_create_colleague_uses_portable_names_and_adds_engine_schema(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            meta = {
                "name": "Eulalie",
                "profile": {
                    "company": "ByteDance",
                    "level": "L2-1",
                    "role": "Backend Engineer",
                    "mbti": "INTJ",
                },
                "tags": {
                    "personality": ["direct", "data-driven"],
                    "culture": ["byte-dance-style"],
                },
            }

            skill_dir = skill_writer.create_skill(
                base_dir,
                "zhangsan",
                meta,
                "Work body",
                "Persona body",
            )

            saved_meta = json.loads(
                (skill_dir / "meta.json").read_text(encoding="utf-8")
            )
            manifest = json.loads((skill_dir / "manifest.json").read_text(encoding="utf-8"))
            combined_skill = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
            work_skill = (skill_dir / "work_skill.md").read_text(encoding="utf-8")
            persona_skill = (skill_dir / "persona_skill.md").read_text(encoding="utf-8")

            self.assertEqual(saved_meta["schema_version"], "3")
            self.assertEqual(saved_meta["kind"], "meta-skill")
            self.assertEqual(saved_meta["character"], "colleague")
            self.assertEqual(saved_meta["preset"], "distilly.colleague.v1")
            self.assertEqual(saved_meta["engine"]["name"], "distilly")
            self.assertEqual(saved_meta["generation"]["engine"], "distilly")
            self.assertEqual(saved_meta["type"], "colleague")
            self.assertEqual(saved_meta["id"], "meta-skill.colleague.zhangsan")
            self.assertEqual(saved_meta["artifacts"]["combined_name"], "colleague-zhangsan")
            self.assertEqual(saved_meta["artifacts"]["combined_command"], "colleague-zhangsan")
            self.assertEqual(saved_meta["compat"]["legacy_command"], "/create-colleague")
            self.assertEqual(manifest["kind"], "meta-skill")
            self.assertEqual(manifest["character"], "colleague")
            self.assertEqual(manifest["preset"], "distilly.colleague.v1")
            self.assertEqual(manifest["install"]["slash_commands"]["default"], "colleague-zhangsan")
            self.assertEqual(
                manifest["install"]["compatible_runtimes"],
                [
                    "claude-code",
                    "openclaw",
                    "hermes",
                    "codex",
                    "deepseek-harness",
                    "grok-build",
                    "pi",
                    "opencode",
                ],
            )
            self.assertEqual(
                manifest["install"]["installers"]["openclaw"],
                "tools/install_openclaw_generated_skill.py",
            )
            self.assertEqual(
                manifest["install"]["installers"]["codex"],
                "tools/install_codex_generated_skill.py",
            )
            self.assertIn("name: colleague-zhangsan", combined_skill)
            self.assertIn("## PART A: Work", combined_skill)
            self.assertIn("name: colleague-zhangsan-work", work_skill)
            self.assertIn("work capability only", work_skill)
            self.assertIn("name: colleague-zhangsan-persona", persona_skill)
            self.assertIn("persona only", persona_skill)

    def test_create_relationship_uses_character_preset_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "relationship"
            meta = {
                "character": "relationship",
                "name": "Mireille",
                "profile": {
                    "role": "Designer",
                },
            }

            skill_dir = skill_writer.create_skill(
                base_dir,
                "mireille",
                meta,
                "Work body",
                "Persona body",
            )

            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            manifest = json.loads((skill_dir / "manifest.json").read_text(encoding="utf-8"))
            combined_skill = (skill_dir / "SKILL.md").read_text(encoding="utf-8")

            self.assertEqual(saved_meta["kind"], "meta-skill")
            self.assertEqual(saved_meta["character"], "relationship")
            self.assertEqual(saved_meta["preset"], "distilly.relationship.v1")
            self.assertEqual(saved_meta["type"], "relationship")
            self.assertEqual(saved_meta["classification"]["gallery_category"], "Relationship")
            self.assertEqual(saved_meta["compat"]["legacy_storage_root"], "skills/relationship")
            self.assertEqual(manifest["id"], "meta-skill.relationship.mireille")
            self.assertEqual(manifest["character"], "relationship")
            self.assertEqual(saved_meta["artifacts"]["combined_command"], "relationship-mireille")
            self.assertIn("name: relationship-mireille", combined_skill)

    def test_create_skill_renders_chinese_chrome_when_language_is_zh_cn(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "relationship"
            meta = {
                "character": "relationship",
                "name": "Mireille",
                "classification": {
                    "language": "zh-CN",
                },
            }

            skill_dir = skill_writer.create_skill(
                base_dir,
                "mireille",
                meta,
                "Work body",
                "Persona body",
            )

            combined_skill = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
            work_skill = (skill_dir / "work_skill.md").read_text(encoding="utf-8")
            persona_skill = (skill_dir / "persona_skill.md").read_text(encoding="utf-8")

            self.assertIn("## PART A：工作能力", combined_skill)
            self.assertIn("运行规则", combined_skill)
            self.assertIn("仅 Work，无 Persona", work_skill)
            self.assertIn("仅 Persona，无工作能力", persona_skill)

    def test_work_only_skill_replaces_persona_handoff(self) -> None:
        zh_handoff = "如果被问到职责范围外的问题，以该同事的方式回应（参见 Persona 部分）。"
        en_handoff = (
            "If you are asked a question outside your recorded responsibilities, "
            "respond in this colleague's style (see the Persona section)."
        )
        zh_work_content = (
            "## 工作能力使用说明\n\n"
            "当用户要求你完成以下任务时，严格按照上述规范执行。\n\n"
            f"{zh_handoff}\n"
        )
        en_work_content = (
            "## Scope rule\n\n"
            "If asked outside your recorded responsibilities:\n"
            "- State the evidence gap\n\n"
            "## Persona naming note\n\n"
            "Keep this documentation sentence.\n\n"
            f"{en_handoff}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            zh_meta = {
                "name": "Eulalie",
                "language": "zh-CN",
                "profile": {
                    "company": "ByteDance",
                    "level": "L2-1",
                    "role": "Backend Engineer",
                },
            }
            en_meta = {
                "name": "Eulalie",
                "language": "en",
                "profile": {
                    "company": "ByteDance",
                    "level": "L2-1",
                    "role": "Backend Engineer",
                },
            }

            zh_dir = skill_writer.create_skill(
                base_dir / "zh",
                "zhangsan",
                zh_meta,
                zh_work_content,
                "Persona body",
            )
            en_dir = skill_writer.create_skill(
                base_dir / "en",
                "zhangsan",
                en_meta,
                en_work_content,
                "Persona body",
            )

            zh_stored_work = (zh_dir / "work.md").read_text(encoding="utf-8")
            zh_combined = (zh_dir / "SKILL.md").read_text(encoding="utf-8")
            en_stored_work = (en_dir / "work.md").read_text(encoding="utf-8")
            en_combined = (en_dir / "SKILL.md").read_text(encoding="utf-8")
            zh_work_skill = (zh_dir / "work_skill.md").read_text(encoding="utf-8")
            en_work_skill = (en_dir / "work_skill.md").read_text(encoding="utf-8")

            self.assertIn(zh_handoff, zh_stored_work)
            self.assertIn(zh_handoff, zh_combined)
            self.assertIn(en_handoff, en_stored_work)
            self.assertIn(en_handoff, en_combined)
            self.assertNotIn(zh_handoff, zh_work_skill)
            self.assertNotIn(en_handoff, en_work_skill)
            self.assertIn("If asked outside your recorded responsibilities:", en_work_skill)
            self.assertIn("## Persona naming note", en_work_skill)
            self.assertIn("Keep this documentation sentence.", en_work_skill)
            self.assertIn(skill_writer.WORK_ONLY_FALLBACK_ZH, zh_work_skill)
            self.assertIn(skill_writer.WORK_ONLY_FALLBACK_EN, en_work_skill)
            self.assertIn("不要臆造缺失信息", zh_work_skill)
            self.assertNotIn("不要推断", zh_work_skill)
            self.assertIn("Do not fabricate missing information", en_work_skill)
            self.assertNotIn("Do not infer", en_work_skill)
            self.assertNotIn(skill_writer.WORK_ONLY_FALLBACK_ZH, zh_combined)
            self.assertNotIn(skill_writer.WORK_ONLY_FALLBACK_EN, en_combined)

    def test_create_celebrity_adds_research_dirs_and_toolchain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "celebrity"
            meta = {
                "character": "celebrity",
                "name": "Zadie Smith",
                "profile": {
                    "identity": "Novelist",
                    "known_for": "Essay and criticism",
                },
                "tags": ["literature", "essay", "public-intellectual"],
                "knowledge_sources": ["interview", "essay"],
            }

            skill_dir = skill_writer.create_skill(
                base_dir,
                "zadie-smith",
                meta,
                "Work body",
                "Persona body",
            )

            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            manifest = json.loads((skill_dir / "manifest.json").read_text(encoding="utf-8"))

            self.assertEqual(saved_meta["character"], "celebrity")
            self.assertEqual(saved_meta["preset"], "distilly.celebrity.v1")
            self.assertEqual(saved_meta["research_profile"], "budget-friendly")
            self.assertIn("research_tools", saved_meta["engine"])
            self.assertEqual(saved_meta["engine"]["research_profile"], "budget-friendly")
            self.assertIn("research_tools", manifest["toolchain"])
            self.assertEqual(manifest["research_profile"], "budget-friendly")
            self.assertEqual(
                saved_meta["classification"]["tags"],
                ["literature", "essay", "public-intellectual"],
            )
            self.assertIn("Novelist", saved_meta["summary"])
            self.assertIn("Essay and criticism", saved_meta["summary"])
            self.assertTrue((skill_dir / "knowledge" / "research" / "raw").exists())
            self.assertTrue((skill_dir / "knowledge" / "research" / "merged").exists())
            self.assertTrue((skill_dir / "knowledge" / "transcripts").exists())
            self.assertTrue((skill_dir / "knowledge" / "subtitles").exists())

    def test_create_celebrity_budget_unfriendly_embeds_profile_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "celebrity"
            meta = {
                "character": "celebrity",
                "research_profile": "budget-unfriendly",
                "name": "Xu Zhisheng",
                "classification": {"language": "zh-CN"},
            }

            skill_dir = skill_writer.create_skill(
                base_dir,
                "xu-zhisheng",
                meta,
                "Work body",
                "Persona body",
            )

            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            manifest = json.loads((skill_dir / "manifest.json").read_text(encoding="utf-8"))

            self.assertEqual(saved_meta["research_profile"], "budget-unfriendly")
            self.assertEqual(saved_meta["engine"]["quality_profile"], "budget-unfriendly")
            self.assertIn(
                "prompts/celebrity/budget_unfriendly/research.md",
                saved_meta["engine"]["research_profile_bundle"].values(),
            )
            self.assertIn(
                "prompts/celebrity/budget_unfriendly/audit.md",
                saved_meta["engine"]["research_profile_bundle"].values(),
            )
            self.assertIn(
                "references/celebrity_budget_unfriendly_framework.md",
                saved_meta["engine"]["research_profile_references"],
            )
            self.assertEqual(manifest["research_profile"], "budget-unfriendly")
            self.assertEqual(manifest["toolchain"]["quality_profile"], "budget-unfriendly")
            self.assertEqual(manifest["toolchain"]["merge_strategy"], "deep")

    def test_create_celebrity_accepts_string_profile_from_runtime_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "celebrity"
            meta = {
                "character": "celebrity",
                "name": "徐志胜",
                "display_name": "徐志胜",
                "classification": {"language": "zh-CN"},
                "profile": "中国脱口秀演员，以自嘲式观察喜剧著称。",
            }

            skill_dir = skill_writer.create_skill(
                base_dir,
                "xu-zhisheng",
                meta,
                "Work body",
                "Persona body",
            )

            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(saved_meta["profile"], "中国脱口秀演员，以自嘲式观察喜剧著称。")
            self.assertIn("中国脱口秀演员", saved_meta["summary"])

    def test_existing_dot_skill_metadata_keeps_legacy_engine_identifiers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            skill_dir = skill_writer.create_skill(
                base_dir,
                "legacy",
                {
                    "name": "Legacy",
                    "preset": "dot.colleague.v1",
                    "engine": {"name": "dot-skill"},
                    "generation": {"engine": "dot-skill"},
                    "artifacts": {
                        "combined_name": "colleague_legacy",
                        "work_name": "colleague_legacy_work",
                        "persona_name": "colleague_legacy_persona",
                    },
                },
                "Work body",
                "Persona body",
            )

            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(saved_meta["preset"], "dot.colleague.v1")
            self.assertEqual(saved_meta["engine"]["name"], "dot-skill")
            self.assertEqual(saved_meta["generation"]["engine"], "dot-skill")
            self.assertEqual(saved_meta["artifacts"]["combined_name"], "colleague_legacy")
            self.assertIn(
                "name: colleague_legacy",
                (skill_dir / "SKILL.md").read_text(encoding="utf-8"),
            )

    def test_update_preserves_names_from_legacy_meta_without_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            skill_dir = Path(tmp_dir) / "skills" / "colleague" / "legacy_person"
            skill_dir.mkdir(parents=True)
            (skill_dir / "versions").mkdir()
            (skill_dir / "meta.json").write_text(
                json.dumps(
                    {
                        "name": "Legacy Person",
                        "type": "colleague",
                        "version": "v1",
                    }
                ),
                encoding="utf-8",
            )
            (skill_dir / "work.md").write_text("Legacy work\n", encoding="utf-8")
            (skill_dir / "persona.md").write_text("Legacy persona\n", encoding="utf-8")
            legacy_names = {
                "SKILL.md": "colleague_legacy_person",
                "work_skill.md": "colleague_legacy_person_work",
                "persona_skill.md": "colleague_legacy_person_persona",
            }
            for filename, name in legacy_names.items():
                (skill_dir / filename).write_text(
                    f"---\nname: {name}\ndescription: Legacy\n---\n\nLegacy body\n",
                    encoding="utf-8",
                )

            skill_writer.update_skill(skill_dir, work_patch="Updated work")

            for filename, name in legacy_names.items():
                content = (skill_dir / filename).read_text(encoding="utf-8")
                self.assertIn(f"name: {name}", content)
            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(
                saved_meta["artifacts"]["combined_command"],
                "colleague-legacy-person",
            )

    def test_update_rejects_traversal_in_stored_version_before_backup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            skill_dir = skill_writer.create_skill(
                root / "skills" / "colleague",
                "unsafe-version",
                {"name": "Unsafe Version"},
                "Work body",
                "Persona body",
            )
            meta_path = skill_dir / "meta.json"
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["version"] = "../../../../escape"
            meta["lifecycle"]["version"] = "../../../../escape"
            meta_path.write_text(json.dumps(meta), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "safe path segment"):
                skill_writer.update_skill(skill_dir, work_patch="Should not be written")

            self.assertFalse((root / "escape").exists())
            self.assertNotIn(
                "Should not be written",
                (skill_dir / "work.md").read_text(encoding="utf-8"),
            )

    def test_update_regenerates_manifest_and_archives_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            skill_dir = skill_writer.create_skill(
                base_dir,
                "zhangsan",
                {"name": "Eulalie"},
                "Initial work",
                "Initial persona",
            )

            new_version = skill_writer.update_skill(
                skill_dir,
                work_patch="More work",
                correction={"scene": "challenged", "wrong": "apologize", "correct": "ask for evidence"},
            )

            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            manifest = json.loads((skill_dir / "manifest.json").read_text(encoding="utf-8"))
            archived_manifest = skill_dir / "versions" / "v1" / "manifest.json"
            persona_doc = (skill_dir / "persona.md").read_text(encoding="utf-8")

            self.assertEqual(new_version, "v2")
            self.assertEqual(saved_meta["version"], "v2")
            self.assertEqual(saved_meta["corrections_count"], 1)
            self.assertTrue(archived_manifest.exists())
            self.assertEqual(manifest["entrypoints"]["default"], "SKILL.md")
            self.assertIn("apologize", persona_doc)
            self.assertIn("ask for evidence", persona_doc)

    def test_update_accepts_multiple_persona_corrections_in_one_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "celebrity"
            skill_dir = skill_writer.create_skill(
                base_dir,
                "zhou-qimo",
                {
                    "character": "celebrity",
                    "name": "周奇墨",
                    "classification": {"language": "zh-CN"},
                },
                "Initial work",
                "Initial persona",
            )

            new_version = skill_writer.update_skill(
                skill_dir,
                correction={
                    "persona_corrections": [
                        {
                            "scene": "铺陈处境时",
                            "wrong": "一上来就下判断",
                            "correct": "先把处境讲得很普通，再轻轻点一下",
                        },
                        {
                            "scene": "表达立场时",
                            "wrong": "写成明显自嘲型",
                            "correct": "和观众一起承认大家都在局里",
                        },
                    ]
                },
            )

            saved_meta = json.loads((skill_dir / "meta.json").read_text(encoding="utf-8"))
            persona_doc = (skill_dir / "persona.md").read_text(encoding="utf-8")

            self.assertEqual(new_version, "v2")
            self.assertEqual(saved_meta["corrections_count"], 2)
            self.assertIn("一上来就下判断", persona_doc)
            self.assertIn("写成明显自嘲型", persona_doc)
            self.assertEqual(persona_doc.count("## Correction Log"), 1)

    def test_update_replaces_existing_markdown_sections_instead_of_appending_duplicates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "celebrity"
            skill_dir = skill_writer.create_skill(
                base_dir,
                "zhou-qimo",
                {
                    "character": "celebrity",
                    "name": "周奇墨",
                    "classification": {"language": "zh-CN"},
                },
                "\n".join(
                    [
                        "# Work",
                        "",
                        "## 表达规范",
                        "",
                        "- 原始表述",
                        "",
                        "## 输出风格",
                        "",
                        "- 原始结构",
                    ]
                ),
                "\n".join(
                    [
                        "# Persona",
                        "",
                        "## Layer 2: Expression DNA",
                        "",
                        "旧内容",
                        "",
                        "## Layer 3: Mental Models",
                        "",
                        "保持不变",
                    ]
                ),
            )

            skill_writer.update_skill(
                skill_dir,
                work_patch="\n".join(
                    [
                        "## 表达规范",
                        "",
                        "- 新的节奏控制",
                        "",
                        "## 输出风格",
                        "",
                        "- 新的结构模板",
                    ]
                ),
                persona_patch="\n".join(
                    [
                        "## Layer 2: Expression DNA",
                        "",
                        "新内容",
                    ]
                ),
            )

            work_doc = (skill_dir / "work.md").read_text(encoding="utf-8")
            persona_doc = (skill_dir / "persona.md").read_text(encoding="utf-8")

            self.assertEqual(work_doc.count("## 表达规范"), 1)
            self.assertEqual(work_doc.count("## 输出风格"), 1)
            self.assertIn("新的节奏控制", work_doc)
            self.assertNotIn("原始表述", work_doc)
            self.assertEqual(persona_doc.count("## Layer 2: Expression DNA"), 1)
            self.assertIn("新内容", persona_doc)
            self.assertNotIn("旧内容", persona_doc)


class VersionManagerTest(unittest.TestCase):
    def test_backup_and_rollback_include_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir) / "skills" / "colleague"
            skill_dir = skill_writer.create_skill(
                base_dir,
                "zhangsan",
                {"name": "Eulalie"},
                "v1 work",
                "v1 persona",
            )

            version_manager.backup_current_version(skill_dir)
            skill_writer.update_skill(skill_dir, work_patch="v2 work")

            success = version_manager.rollback(skill_dir, "v1")
            restored_work = (skill_dir / "work.md").read_text(encoding="utf-8")

            self.assertTrue(success)
            self.assertIn("v1 work", restored_work)
            self.assertTrue((skill_dir / "versions" / "v1" / "manifest.json").exists())
            self.assertFalse(version_manager.rollback(skill_dir, "../v1"))

    def test_version_manager_can_still_resolve_legacy_colleagues_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            cwd = Path.cwd()
            try:
                os.chdir(tmp_dir)
                legacy_base_dir = Path("colleagues")
                skill_writer.create_skill(
                    legacy_base_dir,
                    "zhangsan",
                    {"name": "Eulalie"},
                    "v1 work",
                    "v1 persona",
                )

                resolved = resolve_existing_storage_root("colleague", slug="zhangsan")
                self.assertEqual(resolved, Path("colleagues"))
            finally:
                os.chdir(cwd)


class PromptPresetTest(unittest.TestCase):
    def test_character_prompt_bundles_exist(self) -> None:
        project_root = Path(__file__).resolve().parents[1]

        for character in ("colleague", "relationship", "celebrity"):
            preset = get_character_preset(character)
            for prompt_path in preset["prompt_bundle"].values():
                if not isinstance(prompt_path, str) or not prompt_path.startswith("prompts/"):
                    continue
                self.assertTrue(
                    (project_root / prompt_path).exists(),
                    f"missing prompt file for {character}: {prompt_path}",
                )
            for tool_path in preset.get("research_tools", {}).values():
                self.assertTrue(
                    (project_root / tool_path).exists(),
                    f"missing research tool for {character}: {tool_path}",
                )
            for profile_name in preset.get("research_profiles", {}):
                profile = get_research_profile_preset(character, profile_name)
                for prompt_path in profile.get("prompt_bundle", {}).values():
                    if not isinstance(prompt_path, str) or not prompt_path.startswith("prompts/"):
                        continue
                    self.assertTrue(
                        (project_root / prompt_path).exists(),
                        f"missing profile prompt file for {character}/{profile_name}: {prompt_path}",
                    )
                for reference_path in profile.get("references", []):
                    self.assertTrue(
                        (project_root / reference_path).exists(),
                        f"missing profile reference for {character}/{profile_name}: {reference_path}",
                    )

        friendly_prompt = (project_root / "prompts" / "celebrity" / "research.md").read_text(encoding="utf-8")
        self.assertIn("01_core_profile.md", friendly_prompt)
        self.assertIn("03_expression_and_reception.md", friendly_prompt)
        self.assertIn(
            "do not collapse the whole pass into one monolithic note",
            friendly_prompt.lower(),
        )
        self.assertIn("actual inspected pages", friendly_prompt)
        self.assertIn("tools/research/xquik_public_posts.py", friendly_prompt)
        self.assertIn("untrusted candidate evidence", " ".join(friendly_prompt.split()))

        strict_prompt = (
            project_root
            / "prompts"
            / "celebrity"
            / "budget_unfriendly"
            / "research.md"
        ).read_text(encoding="utf-8")
        self.assertIn("01_writings.md", strict_prompt)
        self.assertIn("06_timeline.md", strict_prompt)
        self.assertIn("at least 8 grounded source URLs", strict_prompt)
        self.assertIn("Do not replace these six files with one merged scratchpad", strict_prompt)
        self.assertIn("actual inspected pages", strict_prompt)
        self.assertIn("tools/research/xquik_public_posts.py", strict_prompt)
        self.assertIn("untrusted candidate evidence", " ".join(strict_prompt.split()))


if __name__ == "__main__":
    unittest.main()
