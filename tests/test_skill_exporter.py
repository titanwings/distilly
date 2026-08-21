from __future__ import annotations

import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import skill_writer  # noqa: E402
from skill_exporter import (  # noqa: E402
    PACKAGE_EXT,
    _build_package_meta,
    _scrub_meta,
    _validate_package_extension,
    export_skill,
    import_skill,
    inspect_package,
)
from skill_presets import normalize_character  # noqa: E402


def _make_skill(
    base_dir: Path,
    character: str = "colleague",
    slug: str = "zhangsan",
    **meta_overrides,
) -> Path:
    """Create a minimal skill on disk for testing."""
    meta = {
        "name": slug.title(),
        "profile": {"company": "TestCo", "level": "L3", "role": "Engineer"},
        "tags": {"personality": ["direct"], "culture": ["startup"]},
        **meta_overrides,
    }
    if "character" not in meta:
        meta["character"] = character
    return skill_writer.create_skill(
        base_dir,
        slug,
        meta,
        "# Work\n\n## Scope\n\nTest work content.\n",
        "# Persona\n\n## Layer 0: Core\n\nTest persona content.\n",
    )


class ExportTest(unittest.TestCase):
    """Tests for skill_exporter.export_skill."""

    def test_export_creates_tar_gz_with_package_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            _make_skill(base_dir, slug="zhangsan")

            out = export_skill("colleague", "zhangsan", str(tmp), base_dir=str(base_dir))

            self.assertTrue(out.exists())
            self.assertTrue(out.name.endswith(PACKAGE_EXT))
            self.assertGreater(out.stat().st_size, 0)

            with tarfile.open(out, "r:gz") as tar:
                names = sorted(m.name for m in tar.getmembers())
                self.assertIn("package.json", names)
                self.assertIn("skill/meta.json", names)
                self.assertIn("skill/SKILL.md", names)
                self.assertIn("skill/work.md", names)
                self.assertIn("skill/persona.md", names)
                self.assertIn("skill/manifest.json", names)

                pkg = json.loads(tar.extractfile("package.json").read())
                self.assertEqual(pkg["package_format"], "1")
                self.assertEqual(pkg["slug"], "zhangsan")
                self.assertEqual(pkg["character"], "colleague")

    def test_export_knowledge_excluded_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            skill_dir = _make_skill(base_dir, slug="zhangsan")
            (skill_dir / "knowledge" / "messages").mkdir(parents=True, exist_ok=True)
            (skill_dir / "knowledge" / "messages" / "chat.txt").write_text("hello")

            out = export_skill("colleague", "zhangsan", str(tmp), base_dir=str(base_dir))

            with tarfile.open(out, "r:gz") as tar:
                names = [m.name for m in tar.getmembers()]
                self.assertFalse(any("knowledge/" in n for n in names))

    def test_export_include_knowledge_adds_knowledge_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            skill_dir = _make_skill(base_dir, slug="zhangsan")
            (skill_dir / "knowledge" / "messages").mkdir(parents=True, exist_ok=True)
            (skill_dir / "knowledge" / "messages" / "chat.txt").write_text("hello")

            out = export_skill(
                "colleague", "zhangsan", str(tmp), base_dir=str(base_dir), include_knowledge=True
            )

            with tarfile.open(out, "r:gz") as tar:
                names = sorted(m.name for m in tar.getmembers())
                knowledge_files = [n for n in names if "knowledge/" in n]
                self.assertTrue(len(knowledge_files) > 0)
                self.assertIn("skill/knowledge/messages/chat.txt", knowledge_files)

    def test_export_dotfiles_excluded_from_knowledge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            skill_dir = _make_skill(base_dir, slug="zhangsan")
            (skill_dir / "knowledge" / "messages").mkdir(parents=True, exist_ok=True)
            (skill_dir / "knowledge" / "messages" / "chat.txt").write_text("ok")
            (skill_dir / "knowledge" / "messages" / ".DS_Store").write_text("junk")

            out = export_skill(
                "colleague", "zhangsan", str(tmp), base_dir=str(base_dir), include_knowledge=True
            )

            with tarfile.open(out, "r:gz") as tar:
                names = [m.name for m in tar.getmembers()]
                self.assertFalse(any(".DS_Store" in n for n in names))
                self.assertTrue(any("chat.txt" in n for n in names))

    def test_export_strips_personal_info_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            _make_skill(
                base_dir,
                slug="zhangsan",
                profile={
                    "company": "ACME",
                    "real_name": "Zhang San",
                    "email": "zs@acme.com",
                },
                knowledge_sources=["private_chat_export.json"],
            )

            out = export_skill("colleague", "zhangsan", str(tmp), base_dir=str(base_dir))

            with tarfile.open(out, "r:gz") as tar:
                meta = json.loads(tar.extractfile("skill/meta.json").read())
                profile = meta.get("profile", {})
                self.assertEqual(profile.get("real_name"), "[redacted]")
                self.assertEqual(profile.get("email"), "[redacted]")
                self.assertEqual(meta.get("knowledge_sources"), "[redacted]")
                self.assertEqual(profile.get("company"), "ACME")  # not PII

    def test_export_no_strip_personal_preserves_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            _make_skill(
                base_dir,
                slug="zhangsan",
                profile={"real_name": "Zhang San", "company": "ACME"},
                knowledge_sources=["chat.json"],
            )

            out = export_skill(
                "colleague", "zhangsan", str(tmp), base_dir=str(base_dir), strip_personal=False
            )

            with tarfile.open(out, "r:gz") as tar:
                meta = json.loads(tar.extractfile("skill/meta.json").read())
                self.assertEqual(meta["profile"]["real_name"], "Zhang San")
                self.assertIn("chat.json", meta.get("knowledge_sources", []))

    def test_export_include_versions_adds_versions_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            skill_dir = _make_skill(base_dir, slug="zhangsan")
            versions = skill_dir / "versions" / "v1"
            versions.mkdir(parents=True)
            (versions / "work.md").write_text("v1 work")

            out = export_skill(
                "colleague", "zhangsan", str(tmp), base_dir=str(base_dir), include_versions=True
            )

            with tarfile.open(out, "r:gz") as tar:
                names = [m.name for m in tar.getmembers()]
                self.assertTrue(any("versions/v1/work.md" in n for n in names))

    def test_export_relationship_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "relationship"
            _make_skill(
                base_dir,
                character="relationship",
                slug="mireille",
                profile={"role": "Partner"},
            )

            out = export_skill("relationship", "mireille", str(tmp), base_dir=str(base_dir))

            with tarfile.open(out, "r:gz") as tar:
                pkg = json.loads(tar.extractfile("package.json").read())
                self.assertEqual(pkg["character"], "relationship")
                meta = json.loads(tar.extractfile("skill/meta.json").read())
                self.assertEqual(meta["character"], "relationship")

    def test_export_celebrity_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "celebrity"
            _make_skill(
                base_dir,
                character="celebrity",
                slug="karpathy",
                profile={"identity": "AI Researcher"},
            )

            out = export_skill("celebrity", "karpathy", str(tmp), base_dir=str(base_dir))

            with tarfile.open(out, "r:gz") as tar:
                pkg = json.loads(tar.extractfile("package.json").read())
                self.assertEqual(pkg["character"], "celebrity")
                self.assertEqual(pkg["research_profile"], "budget-friendly")

    def test_export_nonexistent_skill_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                export_skill("colleague", "nonexistent", str(tmp))

    def test_export_output_to_directory_creates_default_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp).resolve()
            base_dir = tmp / "skills" / "colleague"
            _make_skill(base_dir, slug="zhangsan")

            out = export_skill("colleague", "zhangsan", str(tmp), base_dir=str(base_dir))

            self.assertEqual(out.parent, tmp)
            self.assertEqual(out.name, f"zhangsan{PACKAGE_EXT}")

    def test_export_output_specific_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            _make_skill(base_dir, slug="zhangsan")

            out = export_skill(
                "colleague", "zhangsan", str(tmp / "my-export.skill.tar.gz"), base_dir=str(base_dir)
            )

            self.assertEqual(out.name, "my-export.skill.tar.gz")


class ImportTest(unittest.TestCase):
    """Tests for skill_exporter.import_skill."""

    def test_import_restores_skill_to_target_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src_base = tmp / "src" / "skills" / "colleague"
            _make_skill(src_base, slug="zhangsan")
            pkg = export_skill("colleague", "zhangsan", str(tmp / "export"), base_dir=str(src_base))

            target = import_skill(str(pkg), base_dir=str(tmp / "dst" / "skills" / "colleague"))

            self.assertTrue(target.exists())
            self.assertTrue((target / "SKILL.md").exists())
            self.assertTrue((target / "work.md").exists())
            self.assertTrue((target / "persona.md").exists())
            self.assertTrue((target / "meta.json").exists())
            self.assertTrue((target / "manifest.json").exists())
            self.assertTrue((target / ".dot-skill-install.json").exists())

    def test_import_preserves_skill_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src_base = tmp / "src" / "skills" / "colleague"
            _make_skill(src_base, slug="zhangsan")
            pkg = export_skill("colleague", "zhangsan", str(tmp / "export"), base_dir=str(src_base))

            target = import_skill(str(pkg), base_dir=str(tmp / "dst" / "skills" / "colleague"))
            work = (target / "work.md").read_text()

            self.assertIn("Test work content", work)

    def test_import_conflict_without_force_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            dst_base = tmp / "dst" / "skills" / "colleague"
            _make_skill(dst_base, slug="zhangsan")
            pkg = export_skill("colleague", "zhangsan", str(tmp / "export"), base_dir=str(dst_base))

            with self.assertRaises(FileExistsError):
                import_skill(str(pkg), base_dir=str(dst_base), force=False)

    def test_import_force_overwrites_existing_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            dst_base = tmp / "dst" / "skills" / "colleague"
            _make_skill(dst_base, slug="zhangsan")
            pkg = export_skill("colleague", "zhangsan", str(tmp / "export"), base_dir=str(dst_base))

            # Should not raise
            target = import_skill(str(pkg), base_dir=str(dst_base), force=True)
            self.assertTrue(target.exists())

    def test_import_relationship_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src_base = tmp / "src" / "skills" / "relationship"
            _make_skill(
                src_base,
                character="relationship",
                slug="mireille",
                profile={"role": "Partner"},
            )
            pkg = export_skill("relationship", "mireille", str(tmp / "export"), base_dir=str(src_base))

            target = import_skill(
                str(pkg), base_dir=str(tmp / "dst" / "skills" / "relationship")
            )

            meta = json.loads((target / "meta.json").read_text())
            self.assertEqual(meta["character"], "relationship")

    def test_import_celebrity_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src_base = tmp / "src" / "skills" / "celebrity"
            _make_skill(
                src_base,
                character="celebrity",
                slug="karpathy",
            )
            pkg = export_skill("celebrity", "karpathy", str(tmp / "export"), base_dir=str(src_base))

            target = import_skill(
                str(pkg), base_dir=str(tmp / "dst" / "skills" / "celebrity")
            )

            meta = json.loads((target / "meta.json").read_text())
            self.assertEqual(meta["character"], "celebrity")

    def test_import_nonexistent_package_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            import_skill("/tmp/nonexistent.skill.tar.gz")

    def test_import_wrong_extension_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "not-a-package.zip"
            fake.write_text("junk")
            with self.assertRaises(ValueError):
                import_skill(str(fake))

    def test_import_nonexistent_base_dir_creates_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src_base = tmp / "src" / "skills" / "colleague"
            _make_skill(src_base, slug="zhangsan")
            pkg = export_skill("colleague", "zhangsan", str(tmp / "export"), base_dir=str(src_base))

            new_base = tmp / "completely" / "new" / "path"
            target = import_skill(str(pkg), base_dir=str(new_base))

            self.assertTrue(target.exists())


class InspectTest(unittest.TestCase):
    """Tests for skill_exporter.inspect_package."""

    def test_inspect_returns_structured_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            _make_skill(base_dir, slug="zhangsan")
            pkg = export_skill("colleague", "zhangsan", str(tmp / "export"), base_dir=str(base_dir))

            info = inspect_package(str(pkg))

            self.assertEqual(info["character"], "colleague")
            self.assertEqual(info["slug"], "zhangsan")
            self.assertEqual(info["package_format"], "1")
            self.assertTrue(len(info["artifacts"]) > 0)
            self.assertIn("skill/SKILL.md", info["artifacts"])
            self.assertGreater(info["size_bytes"], 0)
            self.assertFalse(info["has_knowledge"])

    def test_inspect_shows_knowledge_when_included(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "colleague"
            skill_dir = _make_skill(base_dir, slug="zhangsan")
            (skill_dir / "knowledge" / "messages").mkdir(parents=True, exist_ok=True)
            (skill_dir / "knowledge" / "messages" / "chat.txt").write_text("hi")

            pkg = export_skill(
                "colleague", "zhangsan", str(tmp / "export"), base_dir=str(base_dir), include_knowledge=True
            )
            info = inspect_package(str(pkg))

            self.assertTrue(info["has_knowledge"])
            self.assertTrue(any("knowledge/" in a for a in info["artifacts"]))

    def test_inspect_nonexistent_package_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            inspect_package("/tmp/nonexistent.skill.tar.gz")


class ScrubMetaTest(unittest.TestCase):
    """Tests for _scrub_meta PII redaction."""

    def test_scrub_redacts_pii_fields(self) -> None:
        meta = {
            "profile": {
                "real_name": "Alice",
                "email": "alice@example.com",
                "phone": "555-1234",
                "company": "ACME",
            },
            "knowledge_sources": ["chat.json", "emails.mbox"],
        }

        scrubbed = _scrub_meta(meta)

        self.assertEqual(scrubbed["profile"]["real_name"], "[redacted]")
        self.assertEqual(scrubbed["profile"]["email"], "[redacted]")
        self.assertEqual(scrubbed["profile"]["phone"], "[redacted]")
        self.assertEqual(scrubbed["profile"]["company"], "ACME")
        self.assertEqual(scrubbed["knowledge_sources"], "[redacted]")

    def test_scrub_handles_missing_fields_gracefully(self) -> None:
        meta = {"profile": {"company": "ACME"}}
        scrubbed = _scrub_meta(meta)
        self.assertEqual(scrubbed["profile"]["company"], "ACME")

    def test_scrub_adds_exported_at(self) -> None:
        meta = {"profile": {}}
        scrubbed = _scrub_meta(meta)
        self.assertIn("exported_at", scrubbed.get("lifecycle", {}))


class ValidateExtensionTest(unittest.TestCase):
    """Tests for _validate_package_extension."""

    def test_skill_tar_gz_passes(self) -> None:
        _validate_package_extension(Path("my-skill.skill.tar.gz"))

    def test_skill_tar_passes(self) -> None:
        _validate_package_extension(Path("my-skill.skill.tar"))

    def test_plain_tar_gz_fails(self) -> None:
        with self.assertRaises(ValueError):
            _validate_package_extension(Path("my-skill.tar.gz"))

    def test_zip_fails(self) -> None:
        with self.assertRaises(ValueError):
            _validate_package_extension(Path("my-skill.zip"))


class RoundTripTest(unittest.TestCase):
    """End-to-end export → import round-trip tests."""

    def test_round_trip_colleague(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src_base = tmp / "src" / "skills" / "colleague"
            _make_skill(src_base, slug="zhangsan")
            pkg = export_skill("colleague", "zhangsan", str(tmp / "export"), base_dir=str(src_base))

            target = import_skill(
                str(pkg), base_dir=str(tmp / "dst" / "skills" / "colleague")
            )

            work = (target / "work.md").read_text()
            persona = (target / "persona.md").read_text()
            self.assertIn("Test work content", work)
            self.assertIn("Test persona content", persona)

    def test_round_trip_with_knowledge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src_base = tmp / "src" / "skills" / "colleague"
            skill_dir = _make_skill(src_base, slug="zhangsan")
            (skill_dir / "knowledge" / "docs").mkdir(parents=True, exist_ok=True)
            (skill_dir / "knowledge" / "docs" / "design.md").write_text("# Design Doc")

            pkg = export_skill(
                "colleague", "zhangsan", str(tmp / "export"), base_dir=str(src_base), include_knowledge=True
            )
            target = import_skill(
                str(pkg), base_dir=str(tmp / "dst" / "skills" / "colleague")
            )

            doc = target / "knowledge" / "docs" / "design.md"
            self.assertTrue(doc.exists())
            self.assertIn("Design Doc", doc.read_text())

    def test_round_trip_all_families(self) -> None:
        """Export and re-import one skill from each family."""
        families = [
            ("colleague", "zhangsan", {}),
            ("relationship", "mireille", {"profile": {"role": "Partner"}}),
            ("celebrity", "karpathy", {"profile": {"identity": "Researcher"}}),
        ]

        for character, slug, extra_meta in families:
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                src_base = tmp / "src" / "skills" / character
                _make_skill(src_base, character=character, slug=slug, **extra_meta)
                pkg = export_skill(character, slug, str(tmp / "export"), base_dir=str(src_base))
                target = import_skill(
                    str(pkg), base_dir=str(tmp / "dst" / "skills" / character)
                )

                meta = json.loads((target / "meta.json").read_text())
                self.assertEqual(meta["character"], character, f"Failed for {character}")
                self.assertTrue((target / "SKILL.md").exists(), f"No SKILL.md for {character}")


class PackageMetaTest(unittest.TestCase):
    """Tests for _build_package_meta."""

    def test_build_package_meta_includes_key_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            base_dir = tmp / "skills" / "celebrity"
            _make_skill(
                base_dir,
                character="celebrity",
                slug="karpathy",
                profile={"identity": "Researcher"},
            )
            meta = json.loads(
                (base_dir / "karpathy" / "meta.json").read_text()
            )

            pkg = _build_package_meta(base_dir / "karpathy", meta)

            self.assertEqual(pkg["package_format"], "1")
            self.assertEqual(pkg["character"], "celebrity")
            self.assertEqual(pkg["slug"], "karpathy")
            self.assertEqual(pkg["schema_version"], "3")
            self.assertIn("exported_at", pkg)
            self.assertIn("dot_skill_version", pkg)


if __name__ == "__main__":
    unittest.main()
