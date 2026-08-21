#!/usr/bin/env python3
"""Screen collected relationship material for sensitive personal data.

This tool runs over the raw material gathered under ``knowledge/{slug}/`` before
that material is handed to the persona/work analyzers. It never edits, redacts,
or deletes the source files: it only produces a structured report so the user
can decide, per category, whether to keep / redact / exclude the material.

The screen is intentionally conservative about what it claims to find. Detectors
that can be structurally validated (Korean RRN, Chinese resident ID, credit-card
numbers) are checksum-verified so they rarely fire on ordinary digit runs.
Detectors that cannot be validated (addresses, sensitive-topic keywords) are
reported as weaker signals and are documented with their known false-positive
modes below.

Usage:
  python3 tools/privacy_screen.py --knowledge-dir ./knowledge/{slug} \
      --target-name "Alex" --user-name "me"
  python3 tools/privacy_screen.py --knowledge-dir ./knowledge/{slug} --json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


# ---------------------------------------------------------------------------
# Status values
# ---------------------------------------------------------------------------

STATUS_CLEAR = "CLEAR"
STATUS_NEEDS_REVIEW = "NEEDS_REVIEW"

# Files under knowledge/ that are worth screening. Everything else (images,
# binaries, the report itself) is skipped rather than guessed at.
DEFAULT_SUFFIXES = (".txt", ".md", ".json", ".csv", ".eml", ".log")

REPORT_FILENAME = "privacy_report.json"

# What this screen does NOT catch. Kept next to the code so it stays honest and
# so the same wording can be surfaced in the report and in the README.
KNOWN_LIMITATIONS = [
    "Free-text mentions of other people's names are not detected; only speaker "
    "labels in chat-style exports are.",
    "A speaker who leads only one line is not reported, because a single "
    "'Name:' line cannot be told apart from prose such as 'Note:'.",
    "Sensitive-topic detection is keyword-based, so it misses paraphrase, slang, "
    "and any language whose vocabulary is not listed.",
    "Addresses are matched on shape (road/city markers plus a number) and will "
    "both over-fire on ordinary sentences and miss unusual formats.",
    "Images, audio, and other binary attachments are not inspected at all.",
    "A CLEAR status means no configured pattern matched. It is not a guarantee "
    "that the material contains no sensitive information.",
    "Detected identifier values are always masked in this report, but third-party "
    "speaker names are shown in full so you can tell who they are.",
]


# ---------------------------------------------------------------------------
# Structural validators
# ---------------------------------------------------------------------------


def luhn_valid(digits: str) -> bool:
    """Return True when a digit string passes the Luhn checksum.

    Used to keep the credit-card detector from firing on arbitrary 13-19 digit
    runs such as order numbers or concatenated timestamps.
    """
    if not digits.isdigit() or not 13 <= len(digits) <= 19:
        return False
    total = 0
    parity = len(digits) % 2
    for index, char in enumerate(digits):
        value = int(char)
        if index % 2 == parity:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def korean_rrn_valid(digits: str) -> bool:
    """Return True when 13 digits form a valid Korean resident registration number.

    Validates the birth-date portion and the trailing check digit. Without this,
    the pattern ``\\d{6}-\\d{7}`` would match plenty of ordinary date-like text.
    """
    if not digits.isdigit() or len(digits) != 13:
        return False

    month = int(digits[2:4])
    day = int(digits[4:6])
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return False
    # The 7th digit encodes century + gender; 0 and 9 are not assigned.
    if digits[6] not in "12345678":
        return False

    weights = (2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5)
    total = sum(int(char) * weight for char, weight in zip(digits[:12], weights))
    return (11 - (total % 11)) % 10 == int(digits[12])


def chinese_id_valid(value: str) -> bool:
    """Return True when an 18-character string is a valid PRC resident ID.

    The final character may be ``X``. The ISO 7064 MOD 11-2 check keeps this from
    matching long numeric identifiers generally.
    """
    value = value.upper()
    if len(value) != 18 or not value[:17].isdigit():
        return False
    if value[17] not in "0123456789X":
        return False

    month = int(value[10:12])
    day = int(value[12:14])
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return False

    weights = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    checks = "10X98765432"
    total = sum(int(char) * weight for char, weight in zip(value[:17], weights))
    return checks[total % 11] == value[17]


# ---------------------------------------------------------------------------
# Detector definitions
# ---------------------------------------------------------------------------
#
# Each detector is (category, severity, compiled pattern, validator). The
# validator receives the matched text and returns True to keep the finding. It
# exists so structural checks can suppress the bulk of false positives.
#
# severity is advisory only: it orders the summary table so the user sees
# identity-grade identifiers before softer topical signals.

DETECTORS: list[tuple[str, str, re.Pattern[str], object]] = [
    (
        "pii.national_id.kr",
        "high",
        # Korean RRN, hyphenated or bare. Checksum-validated below.
        re.compile(r"\b(\d{6})[-\s]?(\d{7})\b"),
        lambda text: korean_rrn_valid(re.sub(r"\D", "", text)),
    ),
    (
        "pii.national_id.cn",
        "high",
        re.compile(r"\b\d{17}[\dXx]\b"),
        lambda text: chinese_id_valid(text),
    ),
    (
        "pii.credit_card",
        "high",
        # Groups of 4 separated by space or hyphen, or a bare 13-19 digit run.
        re.compile(r"\b(?:\d[ -]?){12,18}\d\b"),
        lambda text: luhn_valid(re.sub(r"\D", "", text)),
    ),
    (
        "pii.bank_account",
        "high",
        # Account numbers are only recognised when a bank keyword sits next to
        # them; the digit shape alone is far too generic to match on its own.
        re.compile(
            r"(?:계좌|예금주|은행|송금|账户|银行卡|转账|account\s*(?:no\.?|number)|IBAN)"
            r"[^\n]{0,20}?\b\d[\d-]{7,19}\d\b",
            re.IGNORECASE,
        ),
        None,
    ),
    (
        "pii.email",
        "medium",
        re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
        None,
    ),
    (
        "pii.phone",
        "medium",
        # Requires a country prefix or separators. A bare 10-digit run is not
        # matched, which is what keeps order IDs and timestamps out.
        re.compile(
            r"(?:\+\d{1,3}[-.\s]?)?(?:0\d{1,2}|\(\d{2,3}\))[-.\s]\d{3,4}[-.\s]\d{4}\b"
            r"|\b1[3-9]\d{9}\b"
        ),
        None,
    ),
    (
        "pii.address",
        "low",
        # Shape-based: a Korean/Chinese administrative or road marker followed by
        # a number. Documented as noisy; treated as a low-severity hint.
        re.compile(
            r"[가-힣A-Za-z0-9]+(?:시|군|구|동|읍|면)\s*[가-힣A-Za-z0-9]*\s*"
            r"[가-힣A-Za-z0-9]+(?:로|길)\s*\d+"
            r"|[一-鿿]{2,}(?:省|市|区|县)[一-鿿]{0,10}(?:路|街|号)\s*\d*"
            r"|\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b"
        ),
        None,
    ),
]

# Keyword lexicons for topical categories. These cannot be validated, so they are
# reported as signals to review rather than as confirmed sensitive content.
SENSITIVE_LEXICONS: dict[str, tuple[str, tuple[str, ...]]] = {
    "sensitive.health": (
        "medium",
        (
            "우울증", "공황", "정신과", "진단", "수술", "입원", "처방", "항우울제",
            "임신", "유산", "장애", "암 ", "치료",
            "抑郁", "焦虑症", "精神科", "住院", "手术", "确诊", "怀孕", "流产",
            "depression", "anxiety disorder", "diagnosis", "diagnosed",
            "hospitalized", "surgery", "prescription", "therapy", "miscarriage",
            "pregnant", "disability",
        ),
    ),
    "sensitive.sexual": (
        "high",
        (
            "성관계", "섹스", "야한", "누드",
            "做爱", "性关系", "裸照",
            "sex", "sexual", "nude", "nsfw", "intimate photo",
        ),
    ),
    "sensitive.minor": (
        "high",
        (
            "미성년", "초등학생", "중학생", "고등학생", "만 14세", "만14세",
            "未成年", "小学生", "初中生",
            "minor", "underage", "under 18", "middle schooler", "elementary school",
        ),
    ),
    "sensitive.financial": (
        "medium",
        (
            "연봉", "빚", "대출", "월세", "보증금", "카드값", "파산",
            "年薪", "贷款", "债务", "破产",
            "salary", "debt", "loan", "mortgage", "bankrupt", "net worth",
        ),
    ),
    "sensitive.affiliation": (
        "medium",
        (
            "교회", "성당", "절에", "불교", "기독교", "천주교", "이슬람",
            "정당", "지지하는 후보", "보수", "진보",
            "教会", "佛教", "基督教", "党员",
            "church", "mosque", "synagogue", "buddhist", "christian", "muslim",
            "voted for", "political party", "conservative party", "labour party",
        ),
    ),
}

# Chat-export speaker labels, e.g. "Alex: hi", "[2024-01-01 10:00] Alex: hi",
# "2024-01-01 10:00 Alex : hi". Only these structured labels are used for
# third-party detection; free-text name mentions are explicitly out of scope.
# The leading date/time is consumed explicitly rather than with a wildcard: a
# loose prefix backtracks into the clock's own colon and captures a digit as the
# speaker name.
SPEAKER_PATTERNS = (
    # ISO-ish timestamp, optionally followed by a comma: "2024-01-02 10:00 Alex: hi",
    # "2024-01-02 15:15, 민준 : hi".
    re.compile(
        r"^\s*\[?\d{4}[-/.]\d{1,2}[-/.]\d{1,2}"
        r"(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\s*\]?\s*[,\-–]?\s*"
        r"([^\s:：][^:：]{0,30}?)\s*[:：]\s"
    ),
    # KakaoTalk desktop export: "2024년 1월 2일 오후 3:15, 민준 : hi".
    re.compile(
        r"^\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)?\s*\d{1,2}:\d{2}\s*[,\-–]?\s*"
        r"([^\s:：][^:：]{0,30}?)\s*[:：]\s"
    ),
    # Bracketed label followed by a bracketed time, as exported from KakaoTalk on
    # iOS: "[민준] [오후 3:20] hi".
    re.compile(r"^\s*\[([^\]\n]{1,30})\]\s*\[[^\]\n]{0,20}\]\s*\S"),
    re.compile(r"^\s*([^\s:：][^:：]{0,30}?)\s*[:：]\s"),
)

# Document and email-header lead-ins that share the "Word:" shape with speaker
# labels but are never participants.
SPEAKER_STOPWORDS = frozenset(
    {
        "note", "notes", "summary", "warning", "caution", "todo", "tip", "update",
        "example", "output", "input", "result", "status", "source", "sources",
        "http", "https", "re", "fw", "fwd",
        "from", "to", "cc", "bcc", "subject", "date", "sent", "reply-to",
        "참고", "요약", "주의", "발신", "수신", "제목", "날짜",
        "备注", "摘要", "注意", "发件人", "收件人", "主题", "日期",
    }
)

# A label must lead at least this many lines before it counts as a speaker. Real
# participants recur; prose lead-ins like "Note:" usually appear once. This is
# the main defence against flagging ordinary sentences as third parties.
MIN_SPEAKER_LINES = 2


# ---------------------------------------------------------------------------
# Masking
# ---------------------------------------------------------------------------


def mask_value(value: str, keep: int = 2) -> str:
    """Mask the middle of a matched value so the report is safe(r) to keep.

    Keeps at most ``keep`` leading and trailing characters. Short values are
    masked entirely rather than partially revealed.
    """
    stripped = value.strip()
    if len(stripped) <= keep * 2:
        return "*" * len(stripped)
    return f"{stripped[:keep]}{'*' * (len(stripped) - keep * 2)}{stripped[-keep:]}"


def build_preview(line: str, match_text: str, window: int = 20) -> str:
    """Return a short context preview with the matched span masked out."""
    masked = mask_value(match_text)
    index = line.find(match_text)
    if index == -1:
        return masked
    start = max(0, index - window)
    end = min(len(line), index + len(match_text) + window)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(line) else ""
    body = line[start:index] + masked + line[index + len(match_text):end]
    return f"{prefix}{body.strip()}{suffix}"


# ---------------------------------------------------------------------------
# Screening
# ---------------------------------------------------------------------------


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().casefold()


def _speaker_label(line: str) -> tuple[str, int] | None:
    """Return the (label, column) of a chat-style speaker prefix, if any.

    Only shape is judged here; whether the label is an actual participant is
    decided later by the recurrence rule in :func:`collect_speaker_lines`.
    """
    for pattern in SPEAKER_PATTERNS:
        match = pattern.match(line)
        if not match:
            continue
        # Strip separator punctuation a timestamp prefix may have left attached.
        label = match.group(1).strip().strip(",-–·")
        label = label.strip()
        if not label or len(label) > 30:
            return None
        if len(label.split()) > 4:
            return None
        # Trailing sentence punctuation means this was prose, not a label.
        if label[-1] in ".!?,;":
            return None
        if _normalize_name(label) in SPEAKER_STOPWORDS:
            return None
        return label, match.start(1) + 1
    return None


def collect_speaker_lines(text: str) -> dict[str, list[tuple[str, int, int]]]:
    """Map each candidate speaker label to the lines where it leads.

    Keyed by the normalized label so casing and spacing variants collapse
    together; each value keeps the original label plus line/column positions.
    """
    speakers: dict[str, list[tuple[str, int, int]]] = {}
    for line_number, line in enumerate(text.splitlines(), start=1):
        found = _speaker_label(line)
        if found is None:
            continue
        label, column = found
        speakers.setdefault(_normalize_name(label), []).append((label, line_number, column))
    return speakers


def screen_text(
    text: str,
    source: str = "<text>",
    target_name: str | None = None,
    known_participants: tuple[str, ...] = (),
    include_previews: bool = True,
) -> list[dict]:
    """Screen one blob of text and return a list of findings.

    ``target_name`` and ``known_participants`` are the people the user has
    already accounted for; any other speaker label found in chat-style lines is
    reported under ``third_party.speaker``.
    """
    allowed_speakers = {
        _normalize_name(name)
        for name in (*known_participants, target_name or "")
        if name
    }
    findings: list[dict] = []

    for line_number, line in enumerate(text.splitlines(), start=1):
        # DETECTORS is ordered most-specific first, so the first detector to
        # claim a span wins and looser patterns cannot double-report it (a
        # national ID, for instance, is also a Luhn-valid digit run).
        claimed: list[tuple[int, int]] = []
        for category, severity, pattern, validator in DETECTORS:
            for match in pattern.finditer(line):
                matched = match.group(0)
                if validator is not None and not validator(matched):
                    continue
                start, end = match.span()
                if any(start < claimed_end and claimed_start < end for claimed_start, claimed_end in claimed):
                    continue
                claimed.append((start, end))
                findings.append(
                    {
                        "category": category,
                        "severity": severity,
                        "source": source,
                        "line": line_number,
                        "column": start + 1,
                        "masked_preview": build_preview(line, matched)
                        if include_previews
                        else mask_value(matched),
                    }
                )

        lowered = line.casefold()
        for category, (severity, keywords) in SENSITIVE_LEXICONS.items():
            for keyword in keywords:
                index = lowered.find(keyword.casefold())
                if index == -1:
                    continue
                findings.append(
                    {
                        "category": category,
                        "severity": severity,
                        "source": source,
                        "line": line_number,
                        "column": index + 1,
                        "matched_term": keyword.strip(),
                        "masked_preview": build_preview(line, line[index : index + len(keyword)])
                        if include_previews
                        else mask_value(keyword),
                    }
                )
                break  # one finding per category per line is enough to flag it

    # Third parties are judged over the whole text rather than line by line: a
    # label only counts as a participant once it has led several lines.
    for normalized, occurrences in collect_speaker_lines(text).items():
        if normalized in allowed_speakers or len(occurrences) < MIN_SPEAKER_LINES:
            continue
        label, first_line, first_column = occurrences[0]
        findings.append(
            {
                "category": "third_party.speaker",
                "severity": "high",
                "source": source,
                "line": first_line,
                "column": first_column,
                "message_count": len(occurrences),
                # Shown in the clear on purpose: the user has to recognise who
                # this is to decide whether their messages may be used. Unlike an
                # ID number, a chat display name is not an identifier value the
                # report would otherwise be leaking — it sits in the source file
                # right next to this report, which never leaves the machine.
                "speaker": label,
            }
        )

    return findings


def iter_source_files(knowledge_dir: Path, suffixes: tuple[str, ...] = DEFAULT_SUFFIXES):
    """Yield screenable files under a knowledge directory, skipping the report."""
    for path in sorted(knowledge_dir.rglob("*")):
        if not path.is_file() or path.name == REPORT_FILENAME:
            continue
        if path.suffix.lower() in suffixes:
            yield path


def screen_directory(
    knowledge_dir: Path,
    target_name: str | None = None,
    known_participants: tuple[str, ...] = (),
    include_previews: bool = True,
) -> dict:
    """Screen every readable file under ``knowledge_dir`` and build a report."""
    knowledge_dir = Path(knowledge_dir)
    findings: list[dict] = []
    scanned: list[str] = []
    skipped: list[str] = []

    for path in iter_source_files(knowledge_dir):
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            skipped.append(str(path.relative_to(knowledge_dir)))
            continue
        relative = str(path.relative_to(knowledge_dir))
        scanned.append(relative)
        findings.extend(
            screen_text(
                text,
                source=relative,
                target_name=target_name,
                known_participants=known_participants,
                include_previews=include_previews,
            )
        )

    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding["category"]] = counts.get(finding["category"], 0) + 1

    return {
        "status": STATUS_NEEDS_REVIEW if findings else STATUS_CLEAR,
        "knowledge_dir": str(knowledge_dir),
        "target_name": target_name,
        "files_scanned": scanned,
        "files_skipped": skipped,
        "counts_by_category": dict(sorted(counts.items())),
        "total_findings": len(findings),
        "findings": findings,
        "limitations": list(KNOWN_LIMITATIONS),
        "note": (
            "This report itself references sensitive locations in your source "
            "material. Treat it as sensitive: it stays local and is never "
            "published with the generated skill."
        ),
    }


def write_report(report: dict, knowledge_dir: Path) -> Path:
    """Write the report next to the screened material and return its path."""
    knowledge_dir = Path(knowledge_dir)
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    report_path = knowledge_dir / REPORT_FILENAME
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report_path


SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def format_summary(report: dict, max_examples: int = 2) -> str:
    """Render the human-facing summary table shown at the confirmation gate."""
    lines = [
        f"Privacy screen: {report['status']}",
        f"Files scanned: {len(report['files_scanned'])}"
        + (f"  (skipped: {len(report['files_skipped'])})" if report["files_skipped"] else ""),
        "",
    ]
    if not report["findings"]:
        lines.append("No configured pattern matched.")
    else:
        by_category: dict[str, list[dict]] = {}
        for finding in report["findings"]:
            by_category.setdefault(finding["category"], []).append(finding)

        ordered = sorted(
            by_category.items(),
            key=lambda item: (
                SEVERITY_ORDER.get(item[1][0]["severity"], 3),
                -len(item[1]),
                item[0],
            ),
        )
        lines.append(f"{'category':<26}{'sev':<8}{'count':>6}")
        lines.append("-" * 40)
        for category, items in ordered:
            lines.append(f"{category:<26}{items[0]['severity']:<8}{len(items):>6}")
        lines.append("")
        lines.append("Examples (masked):")
        for category, items in ordered:
            for finding in items[:max_examples]:
                if "speaker" in finding:
                    detail = f"{finding['speaker']} ({finding['message_count']} messages)"
                else:
                    detail = finding["masked_preview"]
                lines.append(
                    f"  [{category}] {finding['source']}:{finding['line']}  {detail}"
                )

    lines.extend(["", "Not covered by this screen:"])
    lines.extend(f"  - {item}" for item in report["limitations"])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Screen collected relationship material for sensitive personal data"
    )
    parser.add_argument(
        "--knowledge-dir",
        required=True,
        help="Directory holding the collected material, e.g. ./knowledge/{slug}",
    )
    parser.add_argument(
        "--target-name",
        default=None,
        help="Name of the person being distilled; their speaker label is not flagged",
    )
    parser.add_argument(
        "--participant",
        action="append",
        default=[],
        dest="participants",
        help="Additional expected speaker label (repeatable), e.g. the user themselves",
    )
    parser.add_argument(
        "--no-previews",
        action="store_true",
        help="Omit context previews and report masked matches only",
    )
    parser.add_argument(
        "--fail-on-review",
        action="store_true",
        help="Exit with code 1 when the status is NEEDS_REVIEW (for gating scripts)",
    )
    parser.add_argument("--json", action="store_true", help="Print the report as JSON")
    args = parser.parse_args()

    knowledge_dir = Path(args.knowledge_dir).expanduser()
    if not knowledge_dir.exists():
        parser.error(f"knowledge dir not found: {knowledge_dir}")

    report = screen_directory(
        knowledge_dir,
        target_name=args.target_name,
        known_participants=tuple(args.participants),
        include_previews=not args.no_previews,
    )
    report_path = write_report(report, knowledge_dir)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_summary(report))
        print(f"\nReport written to {report_path}")

    if args.fail_on_review and report["status"] == STATUS_NEEDS_REVIEW:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
