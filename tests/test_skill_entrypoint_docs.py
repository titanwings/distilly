from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_HOSTS = (
    "Claude Code",
    "Hermes Agent",
    "OpenClaw",
    "Codex",
    "DeepSeek Harness",
    "Pi coding agent",
    "Grok Build",
    "OpenCode",
)
HOST_LOGO_FILES = (
    "claude-code-wordmark-dark.svg",
    "claude-code-wordmark-light.svg",
    "hermes-agent-wordmark.png",
    "openclaw-wordmark-dark.svg",
    "openclaw-wordmark-light.svg",
    "codex-mark-dark.png",
    "codex-mark-light.png",
    "deepseek-wordmark-dark.svg",
    "deepseek-wordmark-light.svg",
    "pi-mark.svg",
    "grok-build-mark-dark.png",
    "grok-build-mark-light.png",
    "opencode-wordmark-dark.svg",
    "opencode-wordmark-light.svg",
)
# Slash invocations start at a text boundary; slashes inside install paths are allowed.
README_INVOCATION_PATTERNS = (
    re.compile(r"\$distilly\b"),
    re.compile(r"@distilly\b"),
    re.compile(r"(?<![\w.-])/distilly\b"),
    re.compile(r"(?<![\w.-])/skill(?:\s+|:)distilly\b"),
    re.compile(r"(?<![\w.-])/skills\b"),
    re.compile(r"(?<![\w.-])/\{character\}-\{slug\}"),
    re.compile(r"\$\{character\}-\{slug\}"),
    re.compile(r"(?<![\w.-])/skill:\{character\}-\{slug\}"),
)
HAN_CHARACTER = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
BUNDLED_PATH = re.compile(r"\b((?:prompts|tools)/[\w./-]+\.(?:md|py|sh))\b")
BARE_TOOL_CALL = re.compile(r"(?:python3|bash) \"?tools/")
ROUTER_MAX_LINES = 80
RESEARCH_FLOOR = re.compile(r"`([A-Z][\w -]+?) (?:>=|=) \d+`")


def _instruction_files() -> dict[str, str]:
    """Everything the agent may read while running the Skill: the router plus prompts."""
    paths = [ROOT / "SKILL.md", *sorted((ROOT / "prompts").rglob("*.md"))]
    return {path.relative_to(ROOT).as_posix(): path.read_text(encoding="utf-8") for path in paths}


class SkillEntrypointDocsTest(unittest.TestCase):
    def _assert_readme_support_contract(self, content: str, source: str) -> None:
        self.assertIn("### 3️⃣", content, f"missing host section in {source}")
        host_section = content.split("### 3️⃣", 1)[1].split("\n---", 1)[0]
        host_rows = re.findall(r'<img [^>]*alt="([^"]+)"', host_section)

        self.assertEqual(list(SUPPORTED_HOSTS), host_rows, f"wrong host list in {source}")
        self.assertNotIn("🟣 **Claude Code**", host_section, f"text host rows remain in {source}")
        self.assertNotIn(
            "img.shields.io/badge/Claude%20Code-Skill",
            content,
            f"duplicate host badges remain in {source}",
        )
        logo_prefix = "docs/assets/hosts/" if source == "README.md" else "../assets/hosts/"
        for logo_file in HOST_LOGO_FILES:
            self.assertIn(logo_prefix + logo_file, host_section, f"missing {logo_file} in {source}")
        self.assertIn("Grok Bot", host_section, f"missing Grok Bot preview in {source}")
        self.assertIn("{character}-{slug}", content, f"missing generated Skill name in {source}")
        self.assertNotIn("## 📂", content, f"project structure section remains in {source}")
        for pattern in README_INVOCATION_PATTERNS:
            self.assertIsNone(
                pattern.search(content),
                f"invocation tutorial matching {pattern.pattern!r} remains in {source}",
            )

    def _assert_readme_quick_start(
        self, content: str, source: str, install_link: str
    ) -> None:
        self.assertIn("## ⚡", content, f"missing install section in {source}")
        quick_start = content.split("## ⚡", 1)[1].split("\n## ✨", 1)[0]
        self.assertIn("### 🤖", quick_start, f"missing Agent path in {source}")
        self.assertIn("### 👤", quick_start, f"missing human path in {source}")
        self.assertIn(
            "git clone https://github.com/titanwings/distilly "
            "<DISTILLY_SKILL_DIR>",
            quick_start,
            f"missing short clone command in {source}",
        )
        self.assertIn(install_link, quick_start, f"missing install guide link in {source}")
        self.assertIn("{character}-{slug}", quick_start)
        self.assertNotIn("<details>", quick_start, f"collapsed install table remains in {source}")
        self.assertNotIn(
            "tools/install_generated_skill.py",
            quick_start,
            f"generated Skill installer detail remains in {source}",
        )
        self.assertNotIn(
            "tools/research/",
            quick_start,
            f"celebrity research commands remain in {source}",
        )

    def test_root_skill_uses_distilly_entrypoint(self) -> None:
        content = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        frontmatter = content.split("---", 2)[1]
        self.assertIn("name: distilly", frontmatter)
        self.assertNotIn("dot-skill", content)
        for invocation in ("`/distilly`", "`$distilly`", "`/skill:distilly`"):
            self.assertIn(invocation, content)
        # Bundled resources resolve against the loaded Skill, never the shell cwd.
        self.assertIn("{distilly_skill_root}", content)
        self.assertIn("${CLAUDE_SKILL_DIR}", content)

    def test_router_stays_short_and_routes_every_flow(self) -> None:
        router = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        # Hosts load SKILL.md in full on every trigger; flow detail loads on demand.
        self.assertLessEqual(len(router.splitlines()), ROUTER_MAX_LINES)
        for flow in sorted((ROOT / "prompts" / "flows").glob("*.md")):
            self.assertIn(flow.relative_to(ROOT).as_posix(), router, f"router never reaches {flow.name}")

    def test_instruction_files_reference_existing_resources(self) -> None:
        for path, content in _instruction_files().items():
            self.assertIsNone(
                BARE_TOOL_CALL.search(content),
                f"{path} runs a bundled tool relative to the shell cwd",
            )
            for reference in BUNDLED_PATH.findall(content):
                self.assertTrue(
                    (ROOT / reference).exists(),
                    f"{path} references missing {reference}",
                )

    def test_every_prompt_is_reachable(self) -> None:
        referenced = set()
        for content in _instruction_files().values():
            referenced.update(BUNDLED_PATH.findall(content))
        referenced.update(
            BUNDLED_PATH.findall((ROOT / "tools" / "distilly" / "profile" / "presets.py").read_text(encoding="utf-8"))
        )
        for prompt_path in sorted((ROOT / "prompts").rglob("*.md")):
            relative = prompt_path.relative_to(ROOT).as_posix()
            self.assertTrue(relative in referenced, f"nothing loads {relative}")

    def test_research_floors_match_merge_summary(self) -> None:
        summary_source = (ROOT / "tools" / "distilly" / "profile" / "research_merge.py").read_text(encoding="utf-8")
        floors = set()
        for content in _instruction_files().values():
            floors.update(RESEARCH_FLOOR.findall(content))
        self.assertTrue(floors, "no research quality floors documented")
        for metric in floors:
            self.assertIn(f"- {metric}:", summary_source, f"merge summary never reports {metric!r}")

    def test_readme_quick_start_and_install_detail_contract(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        install = (ROOT / "INSTALL.md").read_text(encoding="utf-8")
        install_en = (ROOT / "INSTALL_EN.md").read_text(encoding="utf-8")
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")

        self._assert_readme_support_contract(readme, "README.md")
        self._assert_readme_quick_start(readme, "README.md", "(INSTALL_EN.md)")
        self.assertNotIn("/dot-skill", readme)
        self.assertNotIn("skills/dot-skill", readme)
        self.assertIn("https://github.com/titanwings/distilly", readme)
        self.assertNotIn("https://github.com/titanwings/colleague-skill", readme)

        self.assertIn(".claude/skills/distilly", install)
        self.assertIn("~/.openclaw/workspace/skills/distilly", install)
        self.assertIn("~/.agents/skills/distilly", install)
        self.assertIn("~/.dsh/skills/distilly", install)
        self.assertIn("~/.pi/agent/skills/distilly", install)
        self.assertIn("~/.grok/skills/distilly", install)
        self.assertIn("~/.config/opencode/skills/distilly", install)
        self.assertIn(".opencode/skills/distilly", install)
        self.assertIn("/distilly", install)
        self.assertNotIn("/dot-skill", install)
        self.assertNotIn("skills/dot-skill", install)
        self.assertIn("https://github.com/titanwings/distilly", install)
        self.assertNotIn("https://github.com/titanwings/colleague-skill", install)
        self.assertIn("./skills/colleague", install)
        self.assertIn("install_claude_generated_skill.py", install)
        self.assertIn("install_generated_skill.py --host openclaw", install)
        self.assertIn("install_generated_skill.py --host codex", install)
        self.assertIn("install_distilly.py --host openclaw", install)
        self.assertIn("install_distilly.py --host codex", install)
        self.assertIn("tools/research/quality_check.py", install)
        self.assertIn("tools/research/xquik_public_posts.py", install)
        self.assertIn("tools/research/download_subtitles.sh", install)
        self.assertIn("tools/research/merge_research.py", install)
        self.assertIn("pip3 install -r requirements.txt", install)
        self.assertIn("pip3 install yt-dlp", install)
        self.assertIn("~/.claude/skills/distilly", install_en)
        self.assertIn("~/.openclaw/workspace/skills/distilly", install_en)
        self.assertIn("~/.hermes/skills/openclaw-imports/distilly", install_en)
        self.assertIn("~/.agents/skills/distilly", install_en)
        self.assertIn("~/.dsh/skills/distilly", install_en)
        self.assertIn("~/.pi/agent/skills/distilly", install_en)
        self.assertIn("~/.grok/skills/distilly", install_en)
        self.assertIn("~/.config/opencode/skills/distilly", install_en)
        self.assertIn("tools/install_generated_skill.py", install_en)
        self.assertIn("tools/research/download_subtitles.sh", install_en)
        self.assertIn("tools/research/srt_to_transcript.py", install_en)
        self.assertIn("tools/research/merge_research.py", install_en)
        self.assertIn("tools/research/quality_check.py", install_en)
        self.assertIn("pip3 install -r requirements.txt", install_en)
        self.assertIn("pip3 install yt-dlp", install_en)
        self.assertIn("/{character}-{slug}", install)
        self.assertIn("./skills/colleague", skill)
        self.assertIn("DeepSeek Harness", skill)
        self.assertIn("OpenCode", skill)
        self.assertIn("eight agent hosts", readme.lower())
        self.assertIn("兼容宿主", install)

        for logo_file in HOST_LOGO_FILES:
            self.assertTrue((ROOT / "docs" / "assets" / "hosts" / logo_file).is_file())

    def test_repo_does_not_ship_generated_examples(self) -> None:
        ignored = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        self.assertIn("/skills/", ignored)
        self.assertIn("/docs/examples/", ignored)
        self.assertFalse((ROOT / "colleagues").exists())

    def test_multilingual_readmes_list_hosts_without_invocation_tutorials(self) -> None:
        for readme_path in (ROOT / "docs" / "lang").glob("README_*.md"):
            content = readme_path.read_text(encoding="utf-8")
            self.assertNotIn("/dot-skill", content, f"stale /dot-skill in {readme_path.name}")
            if readme_path.name == "README_ZH.md":
                # The other languages are short landing pages (see test_translation_sync.py).
                self._assert_readme_support_contract(content, readme_path.name)
                self._assert_readme_quick_start(content, readme_path.name, "(../../INSTALL.md)")
            self.assertIn(
                "https://github.com/titanwings/distilly",
                content,
                f"missing published repository URL in {readme_path.name}",
            )
            self.assertNotIn(
                "https://github.com/titanwings/colleague-skill",
                content,
                f"stale repository URL in {readme_path.name}",
            )
            self.assertNotIn(
                "colleague_skill.pdf",
                content,
                f"broken local paper link in {readme_path.name}",
            )

    def test_non_chinese_docs_call_the_product_lark(self) -> None:
        non_chinese = [ROOT / "README.md"]
        non_chinese.extend(
            ROOT / "docs" / "lang" / f"README_{language}.md"
            for language in ("DE", "ES", "JA", "KO", "PT", "RU")
        )
        for path in non_chinese:
            content = path.read_text(encoding="utf-8")
            self.assertIn("Lark", content, f"missing Lark in {path.name}")
            self.assertNotIn("Feishu", content, f"stale visible Feishu name in {path.name}")

        chinese = (ROOT / "docs" / "lang" / "README_ZH.md").read_text(encoding="utf-8")
        self.assertIn("飞书", chinese)

    def test_non_chinese_surfaces_do_not_mix_chinese_copy(self) -> None:
        single_language_paths = [
            ROOT / "README.md",
            ROOT / "ROADMAP.md",
            ROOT / "CONTRIBUTING.md",
            ROOT / "CITATION.cff",
            ROOT / "INSTALL_EN.md",
            ROOT / "prompts" / "celebrity" / "research.md",
            ROOT / "prompts" / "celebrity" / "budget_unfriendly" / "framework.md",
            ROOT / ".github" / "PULL_REQUEST_TEMPLATE.md",
        ]
        single_language_paths.extend(
            ROOT / "docs" / "lang" / f"README_{language}.md"
            for language in ("DE", "ES", "KO", "PT", "RU")
        )
        single_language_paths.extend(
            ROOT / ".github" / "ISSUE_TEMPLATE" / name
            for name in (
                "bug_report.md",
                "config.yml",
                "feature_request.md",
                "question.md",
            )
        )

        for path in single_language_paths:
            content = path.read_text(encoding="utf-8")
            self.assertIsNone(
                HAN_CHARACTER.search(content),
                f"Chinese copy remains in {path.relative_to(ROOT)}",
            )

        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        frontmatter = skill.split("---", 2)[1]
        self.assertIsNone(HAN_CHARACTER.search(frontmatter))
        self.assertIsNone(HAN_CHARACTER.search(skill), "Chinese copy remains in SKILL.md")
        self.assertNotIn("# English Version", skill)
        for prompt_path in sorted((ROOT / "prompts").rglob("*.md")):
            self.assertIsNone(
                HAN_CHARACTER.search(prompt_path.read_text(encoding="utf-8")),
                f"Chinese copy remains in {prompt_path.relative_to(ROOT)}",
            )

        content = (ROOT / "docs" / "lang" / "README_JA.md").read_text(encoding="utf-8")
        for stale_phrase in ("原同事", "留痕", "企業微信"):
            self.assertNotIn(stale_phrase, content, "Chinese phrase in README_JA.md")

    def test_code_uses_new_names_with_explicit_legacy_fallbacks(self) -> None:
        writer = (ROOT / "tools" / "distilly" / "write" / "writer.py").read_text(encoding="utf-8")
        schema = (ROOT / "tools" / "distilly" / "profile" / "schema.py").read_text(encoding="utf-8")
        host_table = (ROOT / "tools" / "hosts.json").read_text(encoding="utf-8")
        generated_installer = (
            ROOT / "tools" / "distilly" / "install" / "generated.py"
        ).read_text(encoding="utf-8")

        self.assertIn("DISTILLY_AUTO_INSTALL_CLAUDE", writer)
        self.assertIn("DOT_SKILL_AUTO_INSTALL_CLAUDE", writer)
        self.assertIn('engine.setdefault("name", "distilly")', schema)
        self.assertIn('generation.setdefault("engine", "distilly")', schema)
        self.assertIn('"codex": { "skills_dir": [".agents", "skills"] }', host_table)
        self.assertIn('.distilly-install.json', generated_installer)

        config_source = (ROOT / "tools" / "distilly" / "core" / "config.py").read_text(encoding="utf-8")
        self.assertIn('Path.home() / ".distilly"', config_source)
        self.assertIn('Path.home() / ".colleague-skill"', config_source)
        self.assertIn("path.chmod(0o600)", config_source)
        for collector_name in ("feishu/auto.py", "feishu/mcp.py", "dingtalk.py", "slack.py"):
            collector = (ROOT / "tools" / "distilly" / "collect" / collector_name).read_text(encoding="utf-8")
            self.assertIn("config_file.config_paths(", collector)


if __name__ == "__main__":
    unittest.main()
