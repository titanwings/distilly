"""Save the owner's own profile and link it into a host's always-on user file.

Unlike the colleague / relationship / celebrity families, the owner profile is
not a role-play Skill. It describes the person who owns the agent, so the agent
can read it as context every session.

Layout:
- Full profile: ``~/.distilly/owner/profile.md`` (previous copies kept in
  ``~/.distilly/owner/versions/``).
- Always-on summary: the profile's ``## Always-on summary`` section, written
  between Distilly markers into the host's user file, e.g. ``~/.claude/CLAUDE.md``
  for Claude Code or ``~/.openclaw/workspace/USER.md`` for OpenClaw. Text outside
  the markers is never changed.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from distilly.core import paths


BEGIN_MARKER = "<!-- distilly:owner-profile:begin -->"
END_MARKER = "<!-- distilly:owner-profile:end -->"
SUMMARY_HEADINGS = ("always-on summary", "常驻摘要")

# OpenClaw gives USER.md its own 4,000-character budget; leave room for text
# the user or the agent already keeps there.
DEFAULT_MAX_SUMMARY_CHARS = 3000

SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
)


def owner_home() -> Path:
    """Return the directory that stores the canonical owner profile."""
    return Path(os.environ.get("DISTILLY_OWNER_HOME", Path.home() / ".distilly" / "owner")).expanduser()


def openclaw_workspace() -> Path:
    """Resolve the OpenClaw workspace the same way OpenClaw does."""
    return paths.openclaw_workspace(Path.home())


HOST_USER_FILES = {
    "claude-code": lambda: Path.home() / ".claude" / "CLAUDE.md",
    "openclaw": lambda: openclaw_workspace() / "USER.md",
}

HOST_ALIASES = {"claude": "claude-code"}

# Always-on summary limits per host, in characters. OpenClaw's USER.md has its
# own 4,000-character budget, shared with anything else the user keeps there.
# Claude Code has no hard limit on ~/.claude/CLAUDE.md, but it is loaded into
# every session, so keep the same budget.
HOST_SUMMARY_LIMITS = {
    "claude-code": DEFAULT_MAX_SUMMARY_CHARS,
    "openclaw": DEFAULT_MAX_SUMMARY_CHARS,
}


def summary_limit(host: str | None, override: int | None = None) -> int:
    """Return the summary limit for a host, or an explicit override."""
    if override is not None:
        return override
    if host:
        return HOST_SUMMARY_LIMITS.get(HOST_ALIASES.get(host, host), DEFAULT_MAX_SUMMARY_CHARS)
    return DEFAULT_MAX_SUMMARY_CHARS


def resolve_host_file(host: str) -> Path:
    host = HOST_ALIASES.get(host, host)
    if host not in HOST_USER_FILES:
        raise ValueError(f"unsupported host: {host} (supported: {', '.join(HOST_USER_FILES)})")
    return HOST_USER_FILES[host]()


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def extract_summary(profile_text: str) -> str:
    """Return the body of the profile's always-on summary section."""
    lines = profile_text.splitlines()
    start = None
    for index, line in enumerate(lines):
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if match and match.group(1).strip().lower() in SUMMARY_HEADINGS:
            start = index + 1
            break
    if start is None:
        raise ValueError("profile has no '## Always-on summary' (or '## 常驻摘要') section")

    end = len(lines)
    for index in range(start, len(lines)):
        if re.match(r"^#{1,2}\s", lines[index]):
            end = index
            break
    summary = "\n".join(lines[start:end]).strip()
    if not summary:
        raise ValueError("the always-on summary section is empty")
    return summary


def find_secrets(text: str) -> list[str]:
    return [pattern.pattern for pattern in SECRET_PATTERNS if pattern.search(text)]


def check_profile(profile_text: str, max_chars: int = DEFAULT_MAX_SUMMARY_CHARS) -> str:
    """Validate a profile and return its summary."""
    if find_secrets(profile_text):
        raise ValueError("profile looks like it contains a secret (API key, token or private key); remove it first")
    if BEGIN_MARKER in profile_text or END_MARKER in profile_text:
        raise ValueError("profile must not contain Distilly marker comments")
    summary = extract_summary(profile_text)
    if len(summary) > max_chars:
        raise ValueError(
            f"always-on summary is {len(summary)} characters; keep it under {max_chars} "
            "and move detail to the rest of the profile"
        )
    return summary


def save_profile(source: Path, home: Path | None = None, max_chars: int = DEFAULT_MAX_SUMMARY_CHARS) -> Path:
    """Copy a reviewed profile into the owner home, keeping the previous copy."""
    home = home or owner_home()
    text = source.read_text(encoding="utf-8")
    check_profile(text, max_chars)

    destination = home / "profile.md"
    home.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.read_text(encoding="utf-8") == text:
            return destination
        versions = home / "versions"
        versions.mkdir(exist_ok=True)
        shutil.copy2(destination, versions / f"profile-{timestamp()}.md")
    destination.write_text(text, encoding="utf-8")
    return destination


def render_block(summary: str, profile_path: Path) -> str:
    return (
        f"{BEGIN_MARKER}\n"
        "## About my owner (Distilly owner profile)\n\n"
        "This describes the person you work for. Use it as context; do not imitate them.\n\n"
        f"{summary}\n\n"
        f"Full profile: `{profile_path}`. Read it when a task needs more detail. "
        "Suggest corrections to the owner instead of editing this block yourself.\n"
        f"{END_MARKER}"
    )


_BLOCK_PATTERN = re.compile(re.escape(BEGIN_MARKER) + r".*?" + re.escape(END_MARKER), re.DOTALL)


def apply_block(existing: str, block: str | None) -> str:
    """Insert, replace, or (when block is None) remove the Distilly block."""
    if existing.count(BEGIN_MARKER) != existing.count(END_MARKER) or existing.count(BEGIN_MARKER) > 1:
        raise ValueError("user file has unbalanced or duplicate Distilly markers; fix it by hand first")

    if _BLOCK_PATTERN.search(existing):
        if block is None:
            updated = _BLOCK_PATTERN.sub("", existing)
            return re.sub(r"\n{3,}", "\n\n", updated).strip("\n") + ("\n" if updated.strip() else "")
        return _BLOCK_PATTERN.sub(lambda _match: block, existing)

    if block is None:
        return existing
    if not existing.strip():
        return block + "\n"
    return existing.rstrip("\n") + "\n\n" + block + "\n"


def write_user_file(target: Path, updated: str) -> Path | None:
    """Write the user file, backing up any previous content. Returns the backup path."""
    backup = None
    if target.exists():
        if target.read_text(encoding="utf-8") == updated:
            return None
        backup = target.with_name(f"{target.name}.distilly-backup-{timestamp()}")
        shutil.copy2(target, backup)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(updated, encoding="utf-8")
    return backup


def link_profile(
    target: Path,
    profile_path: Path,
    dry_run: bool = False,
    max_chars: int = DEFAULT_MAX_SUMMARY_CHARS,
) -> tuple[str, Path | None]:
    """Write the summary block into a host user file. Returns (new text, backup)."""
    summary = check_profile(profile_path.read_text(encoding="utf-8"), max_chars)
    existing = target.read_text(encoding="utf-8") if target.exists() else ""
    updated = apply_block(existing, render_block(summary, profile_path))
    if dry_run:
        return updated, None
    return updated, write_user_file(target, updated)


def unlink_profile(target: Path, dry_run: bool = False) -> tuple[str, Path | None]:
    """Remove the Distilly block from a host user file."""
    existing = target.read_text(encoding="utf-8") if target.exists() else ""
    updated = apply_block(existing, None)
    if dry_run or updated == existing:
        return updated, None
    return updated, write_user_file(target, updated)


def main() -> None:
    parser = argparse.ArgumentParser(description="Distilly owner profile")
    sub = parser.add_subparsers(dest="action", required=True)

    save = sub.add_parser("save", help="Store a reviewed profile as the canonical owner profile")
    save.add_argument("--profile", required=True, help="Path to the reviewed profile markdown")

    link = sub.add_parser("link", help="Write the always-on summary into a host user file")
    link.add_argument("--host", help="claude-code or openclaw")
    link.add_argument("--target", help="Explicit user file path (overrides --host)")
    link.add_argument("--dry-run", action="store_true", help="Print the result without writing")

    unlink = sub.add_parser("unlink", help="Remove the Distilly block from a host user file")
    unlink.add_argument("--host", help="claude-code or openclaw")
    unlink.add_argument("--target", help="Explicit user file path (overrides --host)")
    unlink.add_argument("--dry-run", action="store_true", help="Print the result without writing")

    sub.add_parser("where", help="Print the owner profile path and host user files")

    for command in (save, link):
        command.add_argument(
            "--max-summary-chars",
            type=int,
            help="Override the always-on summary limit (default: the host's limit)",
        )

    args = parser.parse_args()
    profile_path = owner_home() / "profile.md"

    try:
        if args.action == "save":
            saved = save_profile(
                Path(args.profile).expanduser(),
                max_chars=summary_limit(None, args.max_summary_chars),
            )
            print(f"Owner profile saved: {saved}")
            return

        if args.action == "where":
            print(f"Owner profile: {profile_path}{'' if profile_path.exists() else ' (not created yet)'}")
            for host in HOST_USER_FILES:
                print(f"{host}: {resolve_host_file(host)}")
            return

        if not args.target and not args.host:
            parser.error("pass --host or --target")
        target = Path(args.target).expanduser() if args.target else resolve_host_file(args.host)

        if args.action == "link":
            if not profile_path.exists():
                raise FileNotFoundError(f"no owner profile at {profile_path}; run 'save' first")
            max_chars = summary_limit(None if args.target else args.host, args.max_summary_chars)
            updated, backup = link_profile(target, profile_path, args.dry_run, max_chars)
        else:
            updated, backup = unlink_profile(target, args.dry_run)
    except (ValueError, FileNotFoundError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print(f"--- {target} (dry run, not written) ---")
        print(updated)
        return
    print(f"Updated: {target}")
    if backup:
        print(f"Previous version kept at: {backup}")
