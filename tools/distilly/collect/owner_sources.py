"""Discover the information sources a personal agent already has about its owner.

This is the local half of owner-profile discovery. It looks at what is
configured on this machine and reports names only:

- always-on user and memory files of known hosts,
- MCP servers / connectors configured in known host config files,
- installed skills of known hosts,
- personal data exports sitting in ~/Downloads.

It never prints config values (commands, args, env, headers, tokens) and never
opens the exports. The agent combines this report with what it can see in its
own session (its tool list, connectors, memory, and the platform it runs on),
classifies each source with ``classify()``, and asks the owner which ones to use.

Usage:
  python3 owner_sources.py discover [--json]
  python3 owner_sources.py classify <name> [<name> ...]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from distilly.core import paths


# Category hints. Matching is by whole tokens of a source name, so "x" matches
# "x", "x-mcp" or "x_api" but not "xero". The list only seeds the agent's own
# judgement: anything unmatched is reported as "unknown" for the agent to
# inspect from the tool's description.
CATEGORIES: dict[str, dict] = {
    "mail": {
        "tokens": {"gmail", "mail", "email", "outlook", "imap", "fastmail", "proton", "protonmail", "superhuman"},
        "read": "10-20 messages the owner sent recently (not received mail)",
        "learns": "tone, sign-off, languages, who they work with (roles only)",
    },
    "calendar": {
        "tokens": {"calendar", "gcal", "cal", "calendly", "ical", "caldav", "fantastical"},
        "read": "last 4 weeks of event times and titles",
        "learns": "weekly rhythm, meeting load, deep-work and offline hours",
    },
    "social": {
        "tokens": {"x", "twitter", "tweet", "tweets", "instagram", "threads", "bluesky", "bsky", "mastodon",
                   "linkedin", "weibo", "xiaohongshu", "rednote", "reddit", "facebook", "tiktok", "douyin"},
        "read": "the owner's own recent posts, replies and bio (not their feed)",
        "learns": "public voice, topics they care about, posting habits",
    },
    "docs": {
        "tokens": {"drive", "gdrive", "docs", "notion", "obsidian", "onedrive", "sharepoint", "dropbox",
                   "confluence", "evernote", "bear", "craft", "quip", "coda", "logseq", "notes"},
        "read": "titles and first lines of recently edited files",
        "learns": "current projects and how they organise work",
    },
    "code": {
        "tokens": {"github", "gitlab", "bitbucket", "linear", "jira", "gitea"},
        "read": "the owner's recent pull requests, commits or issues",
        "learns": "stack, work style, current projects",
    },
    "chat": {
        "tokens": {"slack", "discord", "telegram", "whatsapp", "wechat", "imessage", "messages", "teams",
                   "lark", "feishu", "dingtalk", "signal", "line"},
        "read": "a small sample of messages the owner wrote in their own chats",
        "learns": "casual tone, languages, response habits",
    },
    "media": {
        "tokens": {"spotify", "youtube", "music", "podcasts", "goodreads", "letterboxd", "pocket", "readwise"},
        "read": "recent listening, watching or reading history",
        "learns": "interests and taste",
    },
    "ai_memory": {
        "tokens": {"memory", "memories", "mem0", "honcho", "chatgpt", "openai", "claude"},
        "read": "what this memory already says about the owner",
        "learns": "everything the owner has already told an assistant",
    },
    # Sensitive categories: proposed only when the owner asks, never read by default.
    "health": {
        "tokens": {"health", "fitness", "strava", "garmin", "oura", "whoop", "fitbit"},
        "read": "nothing by default; only what the owner explicitly asks for",
        "learns": "routines the owner chooses to share",
        "sensitive": True,
    },
    "finance": {
        "tokens": {"bank", "plaid", "stripe", "paypal", "venmo", "alipay", "ynab", "brokerage"},
        "read": "nothing; financial data stays out of the profile",
        "learns": "-",
        "sensitive": True,
    },
}

EXPORT_PATTERNS = (
    (re.compile(r"^twitter-.*\.zip$|^x-archive.*\.zip$", re.I), "social", "X / Twitter archive"),
    (re.compile(r"^takeout-.*\.(zip|tgz)$", re.I), "docs", "Google Takeout"),
    (re.compile(r"chatgpt|openai.*export|conversations\.json$", re.I), "ai_memory", "ChatGPT export"),
    (re.compile(r"^claude.*export|^data-.*claude", re.I), "ai_memory", "Claude export"),
    (re.compile(r"\.(mbox|eml)$", re.I), "mail", "mail export"),
    (re.compile(r"^instagram-.*\.zip$|^facebook-.*\.zip$", re.I), "social", "Meta account export"),
)

_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")


def tokens_of(name: str) -> set[str]:
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", name)
    return {token for token in _TOKEN_SPLIT.split(spaced.lower()) if token}


def classify(name: str) -> str:
    """Return the category for a source name, or 'unknown'."""
    found = tokens_of(name)
    for category, spec in CATEGORIES.items():
        if found & spec["tokens"]:
            return category
    return "unknown"


def describe(category: str) -> dict:
    spec = CATEGORIES.get(category)
    if not spec:
        return {
            "read": "inspect the tool's own description first, then propose a small read-only slice",
            "learns": "decide from what the tool does",
            "sensitive": False,
        }
    return {"read": spec["read"], "learns": spec["learns"], "sensitive": bool(spec.get("sensitive"))}


# ─── Locating host configuration ───────────────────────────────────────────────


def home() -> Path:
    return Path(os.environ.get("HOME", str(Path.home())))


def openclaw_workspace() -> Path:
    return paths.openclaw_workspace(home())


def user_files() -> list[tuple[str, Path]]:
    h = home()
    workspace = openclaw_workspace()
    return [
        ("claude-code", h / ".claude" / "CLAUDE.md"),
        ("openclaw", workspace / "USER.md"),
        ("openclaw", workspace / "MEMORY.md"),
        ("hermes", h / ".hermes" / "memories" / "USER.md"),
        ("hermes", h / ".hermes" / "memories" / "MEMORY.md"),
        ("codex", h / ".codex" / "AGENTS.md"),
        ("distilly", h / ".distilly" / "owner" / "profile.md"),
    ]


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _server_names(value: object) -> list[str]:
    return list(value.keys()) if isinstance(value, dict) else []


def _json_mcp_names(path: Path) -> list[str]:
    data = _read_json(path)
    names = _server_names(data.get("mcpServers"))
    projects = data.get("projects")
    for project in projects.values() if isinstance(projects, dict) else ():
        if isinstance(project, dict):
            names.extend(_server_names(project.get("mcpServers")))
    return names


_TOML_TABLE = re.compile(r"^\s*\[\s*mcp_servers\.\"?([^\]\".]+)\"?\s*\]", re.M)
_YAML_KEY = re.compile(r"^(\s+)([A-Za-z0-9_.-]+)\s*:", re.M)


def _codex_mcp_names(path: Path) -> list[str]:
    try:
        return _TOML_TABLE.findall(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _yaml_section_keys(path: Path, section: str) -> list[str]:
    """Return the direct child keys of a top-level YAML section, without a YAML parser."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, ValueError):
        return []
    names: list[str] = []
    inside = False
    child_indent = None
    for line in lines:
        if re.match(rf"^{re.escape(section)}\s*:", line):
            inside = True
            continue
        if not inside:
            continue
        if line.strip() and not line.startswith((" ", "\t")):
            break
        match = _YAML_KEY.match(line)
        if match:
            indent = len(match.group(1))
            child_indent = indent if child_indent is None else child_indent
            if indent == child_indent:
                names.append(match.group(2))
    return names


def mcp_configs() -> list[tuple[str, Path, list[str]]]:
    h = home()
    found = [
        ("claude-code", h / ".claude.json", _json_mcp_names(h / ".claude.json")),
        ("claude-code", Path.cwd() / ".mcp.json", _json_mcp_names(Path.cwd() / ".mcp.json")),
        ("claude-desktop", h / "Library/Application Support/Claude/claude_desktop_config.json",
         _json_mcp_names(h / "Library/Application Support/Claude/claude_desktop_config.json")),
        ("claude-desktop", h / ".config/Claude/claude_desktop_config.json",
         _json_mcp_names(h / ".config/Claude/claude_desktop_config.json")),
        ("codex", h / ".codex" / "config.toml", _codex_mcp_names(h / ".codex" / "config.toml")),
        ("hermes", h / ".hermes" / "config.yaml", _yaml_section_keys(h / ".hermes" / "config.yaml", "mcp_servers")),
        ("cursor", h / ".cursor" / "mcp.json", _json_mcp_names(h / ".cursor" / "mcp.json")),
    ]
    return [(host, path, sorted(set(names))) for host, path, names in found if names]


def skill_dirs() -> list[tuple[str, Path]]:
    h = home()
    return [
        ("claude-code", h / ".claude" / "skills"),
        ("openclaw", openclaw_workspace() / "skills"),
        ("hermes", h / ".hermes" / "skills"),
        ("codex", h / ".agents" / "skills"),
    ]


def discover() -> dict:
    """Return a names-only report of local sources."""
    report: dict = {"user_files": [], "connectors": [], "skills": [], "exports": []}

    for host, path in user_files():
        if path.is_file() and path.stat().st_size > 0:
            report["user_files"].append({"host": host, "path": str(path), "bytes": path.stat().st_size})

    for host, path, names in mcp_configs():
        for name in names:
            category = classify(name)
            report["connectors"].append({"host": host, "name": name, "config": str(path),
                                         "category": category, **describe(category)})

    for host, root in skill_dirs():
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir()):
            if child.is_dir() and (child / "SKILL.md").exists() and child.name != "distilly":
                category = classify(child.name)
                if category != "unknown":
                    report["skills"].append({"host": host, "name": child.name,
                                             "category": category, **describe(category)})

    downloads = home() / "Downloads"
    if downloads.is_dir():
        for child in sorted(downloads.iterdir()):
            for pattern, category, label in EXPORT_PATTERNS:
                if pattern.search(child.name):
                    report["exports"].append({"name": child.name, "path": str(child),
                                              "kind": label, "category": category, **describe(category)})
                    break
    return report


def render(report: dict) -> str:
    lines = ["Local sources found (names only, nothing was opened):", ""]
    if not any(report.values()):
        return "No local sources found. Use what you can see in this session, then ask the owner."
    for item in report["user_files"]:
        lines.append(f"- user file ({item['host']}): {item['path']}")
    for item in report["connectors"]:
        flag = " [sensitive]" if item["sensitive"] else ""
        lines.append(f"- connector ({item['host']}): {item['name']} -> {item['category']}{flag}")
    for item in report["skills"]:
        lines.append(f"- skill ({item['host']}): {item['name']} -> {item['category']}")
    for item in report["exports"]:
        lines.append(f"- export: {item['name']} -> {item['kind']}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover owner-profile sources on this machine")
    sub = parser.add_subparsers(dest="action", required=True)
    disc = sub.add_parser("discover", help="List local user files, connectors, skills and exports")
    disc.add_argument("--json", action="store_true", help="Print JSON")
    cls = sub.add_parser("classify", help="Classify source names (e.g. tool or connector names)")
    cls.add_argument("names", nargs="+")
    args = parser.parse_args()

    if args.action == "discover":
        report = discover()
        print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else render(report))
        return

    result = [{"name": name, "category": classify(name), **describe(classify(name))} for name in args.names]
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()
