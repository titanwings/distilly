"""Keep translated READMEs from drifting away from the English source.

README.md is the source of truth. README_ZH.md is a full translation, so it
must keep the same sections, images and external links. The other languages
are short landing pages that point back to the English README.
"""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
LANG_DIR = ROOT / "docs" / "lang"
SOURCE = ROOT / "README.md"
FULL_TRANSLATIONS = ("ZH",)
LANDING_PAGES = ("DE", "ES", "JA", "KO", "PT", "RU")

SECTION = re.compile(r"^## (\S+)", re.MULTILINE)
IMAGE = re.compile(r'(?:src|srcset)="([^"]+)"')
EXTERNAL_LINK = re.compile(r'(?:\]\(|href=")(https?://[^)"\s]+)')
# Badge images carry localized labels, so they are not compared.
LOCALIZED_HOSTS = ("img.shields.io",)


def _sections(content: str) -> int:
    """Return how many `##` sections a README has; headings are translated, so only the count is compared."""
    return len(SECTION.findall(content))


def _images(content: str, prefix: str) -> set:
    return {
        src[len(prefix):] if src.startswith(prefix) else src
        for src in IMAGE.findall(content)
    }


def _external_links(content: str) -> set:
    return {
        link
        for link in EXTERNAL_LINK.findall(content)
        if not any(host in link for host in LOCALIZED_HOSTS)
    }


class TranslationSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source = SOURCE.read_text(encoding="utf-8")

    def test_full_translations_match_source_structure(self) -> None:
        for language in FULL_TRANSLATIONS:
            name = f"README_{language}.md"
            content = (LANG_DIR / name).read_text(encoding="utf-8")
            with self.subTest(file=name):
                self.assertEqual(
                    _sections(self.source),
                    _sections(content),
                    f"{name} sections differ from README.md; translate the added or removed section",
                )
                source_images = _images(self.source, "docs/")
                translated_images = _images(content, "../")
                self.assertEqual(
                    sorted(source_images - translated_images),
                    [],
                    f"{name} is missing images from README.md",
                )
                self.assertEqual(
                    sorted(translated_images - source_images),
                    [],
                    f"{name} has images that README.md no longer uses",
                )
                self.assertEqual(
                    sorted(_external_links(self.source) - _external_links(content)),
                    [],
                    f"{name} is missing links from README.md",
                )

    def test_landing_pages_point_to_english_source(self) -> None:
        for language in LANDING_PAGES:
            name = f"README_{language}.md"
            content = (LANG_DIR / name).read_text(encoding="utf-8")
            with self.subTest(file=name):
                self.assertIn("(../../README.md)", content)
                self.assertIn("(../../INSTALL_EN.md)", content)
                self.assertIn(
                    "git clone https://github.com/titanwings/distilly <DISTILLY_SKILL_DIR>",
                    content,
                )

    def test_language_navigation_lists_every_translation(self) -> None:
        translations = sorted(
            path.name for path in LANG_DIR.glob("README_*.md")
        )
        self.assertEqual(
            translations,
            sorted(f"README_{lang}.md" for lang in FULL_TRANSLATIONS + LANDING_PAGES),
        )
        for name in translations:
            self.assertIn(f"(docs/lang/{name})", self.source, f"README.md does not link {name}")


if __name__ == "__main__":
    unittest.main()
