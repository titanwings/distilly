from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
import sys


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from privacy_screen import (  # noqa: E402
    STATUS_CLEAR,
    STATUS_NEEDS_REVIEW,
    chinese_id_valid,
    format_summary,
    korean_rrn_valid,
    luhn_valid,
    mask_value,
    screen_directory,
    screen_text,
    write_report,
)


# Structurally valid fixtures (generated to satisfy each checksum) so the
# detectors are exercised on realistic input rather than arbitrary digits.
VALID_KR_RRN = "900101-1000006"
VALID_CN_ID = "110101199003070003"
VALID_CARD = "4111 1111 1111 1111"


def categories(findings) -> set[str]:
    return {finding["category"] for finding in findings}


class ValidatorTest(unittest.TestCase):
    def test_luhn_accepts_valid_and_rejects_invalid(self) -> None:
        self.assertTrue(luhn_valid("4111111111111111"))
        self.assertFalse(luhn_valid("4111111111111112"))
        self.assertFalse(luhn_valid("123"))

    def test_korean_rrn_checksum(self) -> None:
        self.assertTrue(korean_rrn_valid("9001011000006"))
        self.assertFalse(korean_rrn_valid("9001011000007"))
        # Impossible birth month is rejected before the checksum runs.
        self.assertFalse(korean_rrn_valid("9099011000006"))

    def test_chinese_id_checksum(self) -> None:
        self.assertTrue(chinese_id_valid(VALID_CN_ID))
        self.assertFalse(chinese_id_valid("110101199003070004"))


class MaskingTest(unittest.TestCase):
    def test_mask_value_hides_middle(self) -> None:
        masked = mask_value("4111111111111111")
        self.assertTrue(masked.startswith("41"))
        self.assertTrue(masked.endswith("11"))
        self.assertIn("*", masked)
        self.assertNotEqual(masked, "4111111111111111")

    def test_short_values_are_fully_masked(self) -> None:
        self.assertEqual(mask_value("abc"), "***")


class DetectorTest(unittest.TestCase):
    def test_detects_identity_grade_identifiers(self) -> None:
        text = "\n".join(
            [
                f"주민번호는 {VALID_KR_RRN} 이야",
                f"身份证 {VALID_CN_ID}",
                f"card {VALID_CARD}",
            ]
        )
        found = categories(screen_text(text))
        self.assertIn("pii.national_id.kr", found)
        self.assertIn("pii.national_id.cn", found)
        self.assertIn("pii.credit_card", found)

    def test_detects_contact_details(self) -> None:
        text = "call 010-1234-5678 or mail me at someone@example.com"
        found = categories(screen_text(text))
        self.assertIn("pii.phone", found)
        self.assertIn("pii.email", found)

    def test_bank_account_requires_context_keyword(self) -> None:
        with_keyword = screen_text("계좌 110-234-567890 으로 보내줘")
        self.assertIn("pii.bank_account", categories(with_keyword))

        # The same digit shape with no banking context is not an account hit.
        without_keyword = screen_text("주문번호 110-234-567890")
        self.assertNotIn("pii.bank_account", categories(without_keyword))

    def test_detects_sensitive_topics(self) -> None:
        text = "\n".join(
            [
                "작년에 우울증 진단을 받았어",
                "he mentioned his salary and some debt",
            ]
        )
        found = categories(screen_text(text))
        self.assertIn("sensitive.health", found)
        self.assertIn("sensitive.financial", found)

    def test_sensitive_category_reported_once_per_line(self) -> None:
        findings = screen_text("depression anxiety disorder diagnosis therapy")
        health = [f for f in findings if f["category"] == "sensitive.health"]
        self.assertEqual(len(health), 1)


class FalsePositiveGuardTest(unittest.TestCase):
    def test_plain_digit_runs_are_not_flagged(self) -> None:
        # An order id and a bare six-digit code should not become an RRN or card.
        found = categories(screen_text("order 1234567890123 code 900101"))
        self.assertNotIn("pii.national_id.kr", found)
        self.assertNotIn("pii.credit_card", found)

    def test_one_span_is_reported_by_one_detector_only(self) -> None:
        # A Korean RRN is also a Luhn-valid digit run; the more specific
        # detector claims the span and the card detector must stay out.
        found = categories(screen_text(f"주민번호 {VALID_KR_RRN}"))
        self.assertIn("pii.national_id.kr", found)
        self.assertNotIn("pii.credit_card", found)

    def test_ordinary_prose_with_colon_is_not_a_speaker(self) -> None:
        text = "Note: this sentence merely contains a colon and should stay quiet."
        self.assertNotIn("third_party.speaker", categories(screen_text(text)))


class ThirdPartyTest(unittest.TestCase):
    def test_flags_unexpected_speaker_labels(self) -> None:
        transcript = "\n".join(
            [
                "Alex: are you coming tonight",
                "me: yes",
                "Jordan: I'll bring the cake",
                "Alex: nice",
                "Jordan: see you at eight",
            ]
        )
        findings = screen_text(
            transcript,
            target_name="Alex",
            known_participants=("me",),
        )
        third_party = [f for f in findings if f["category"] == "third_party.speaker"]
        self.assertEqual(len(third_party), 1)
        # The speaker name is reported in the clear so the user can identify who
        # it is; identifier values elsewhere stay masked.
        self.assertEqual(third_party[0]["speaker"], "Jordan")

    def test_timestamped_lines_capture_the_name_not_the_clock(self) -> None:
        # A loose date prefix backtracks into the clock's colon and captures a
        # digit; this guards the explicit date/time prefix.
        transcript = "\n".join(
            [
                "2024-01-02 10:00 Alex: hi",
                "2024-01-02 10:02 Jordan: I'll be there",
                "2024-01-02 10:03 Jordan: see you at eight",
            ]
        )
        findings = screen_text(transcript, target_name="Alex")
        third_party = [f for f in findings if f["category"] == "third_party.speaker"]
        self.assertEqual(len(third_party), 1)
        self.assertEqual(third_party[0]["speaker"], "Jordan")
        self.assertEqual(third_party[0]["message_count"], 2)

    def test_kakaotalk_desktop_export_format(self) -> None:
        transcript = "\n".join(
            [
                "2024년 1월 2일 오후 3:15, 민준 : 오늘 시간 돼?",
                "2024년 1월 2일 오후 3:16, 나 : 응 괜찮아",
                "2024년 1월 2일 오후 3:17, 서연 : 나도 갈래",
                "2024년 1월 2일 오후 3:18, 서연 : 8시에 봐",
            ]
        )
        findings = screen_text(transcript, target_name="민준", known_participants=("나",))
        third_party = [f for f in findings if f["category"] == "third_party.speaker"]
        self.assertEqual(len(third_party), 1)
        self.assertEqual(third_party[0]["speaker"], "서연")

    def test_kakaotalk_bracketed_export_format(self) -> None:
        transcript = "\n".join(
            [
                "[민준] [오후 3:20] 오늘 시간 돼?",
                "[서연] [오후 3:21] 나도 갈래",
                "[서연] [오후 3:22] 8시에 봐",
            ]
        )
        findings = screen_text(transcript, target_name="민준")
        third_party = [f for f in findings if f["category"] == "third_party.speaker"]
        self.assertEqual(len(third_party), 1)
        self.assertEqual(third_party[0]["speaker"], "서연")

    def test_comma_separated_timestamp_does_not_leak_into_the_name(self) -> None:
        transcript = "2024-01-02 15:15, Jordan : hi\n2024-01-02 15:16, Jordan : again"
        findings = screen_text(transcript, target_name="Alex")
        third_party = [f for f in findings if f["category"] == "third_party.speaker"]
        self.assertEqual(len(third_party), 1)
        self.assertEqual(third_party[0]["speaker"], "Jordan")

    def test_single_line_label_is_not_treated_as_a_speaker(self) -> None:
        # One "Name:" line is indistinguishable from prose, so it stays quiet.
        transcript = "Alex: hi\nAlex: still there\nCasey: one off line"
        findings = screen_text(transcript, target_name="Alex")
        self.assertNotIn("third_party.speaker", categories(findings))

    def test_target_and_known_participants_are_not_flagged(self) -> None:
        transcript = "Alex: hi\nme: hello\nAlex: how are you"
        findings = screen_text(
            transcript,
            target_name="Alex",
            known_participants=("me",),
        )
        self.assertNotIn("third_party.speaker", categories(findings))


class ScreenDirectoryTest(unittest.TestCase):
    def test_clean_material_reports_clear(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            knowledge = Path(tmp_dir) / "knowledge" / "alex"
            knowledge.mkdir(parents=True)
            (knowledge / "messages.txt").write_text(
                "we talked about the weather and a movie\n",
                encoding="utf-8",
            )
            report = screen_directory(knowledge)
            self.assertEqual(report["status"], STATUS_CLEAR)
            self.assertEqual(report["total_findings"], 0)
            self.assertIn("messages.txt", report["files_scanned"])

    def test_sensitive_material_reports_needs_review(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            knowledge = Path(tmp_dir) / "knowledge" / "alex"
            knowledge.mkdir(parents=True)
            (knowledge / "messages.txt").write_text(
                f"주민번호 {VALID_KR_RRN}\ncall 010-1234-5678\n",
                encoding="utf-8",
            )
            report = screen_directory(knowledge)
            self.assertEqual(report["status"], STATUS_NEEDS_REVIEW)
            self.assertGreaterEqual(report["counts_by_category"]["pii.national_id.kr"], 1)
            self.assertTrue(report["limitations"])

    def test_report_does_not_contain_raw_sensitive_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            knowledge = Path(tmp_dir) / "knowledge" / "alex"
            knowledge.mkdir(parents=True)
            (knowledge / "messages.txt").write_text(
                f"내 주민번호는 {VALID_KR_RRN} 이고 카드는 {VALID_CARD} 야\n"
                "메일은 secret.person@example.com\n",
                encoding="utf-8",
            )
            report = screen_directory(knowledge)
            serialized = json.dumps(report, ensure_ascii=False)

            self.assertNotIn(VALID_KR_RRN, serialized)
            self.assertNotIn("4111 1111 1111 1111", serialized)
            self.assertNotIn("secret.person@example.com", serialized)

    def test_write_report_round_trips(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            knowledge = Path(tmp_dir) / "knowledge" / "alex"
            knowledge.mkdir(parents=True)
            (knowledge / "messages.txt").write_text("call 010-1234-5678\n", encoding="utf-8")

            report = screen_directory(knowledge)
            report_path = write_report(report, knowledge)

            self.assertTrue(report_path.exists())
            reloaded = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(reloaded["status"], STATUS_NEEDS_REVIEW)

    def test_existing_report_is_not_rescanned(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            knowledge = Path(tmp_dir) / "knowledge" / "alex"
            knowledge.mkdir(parents=True)
            (knowledge / "messages.txt").write_text("call 010-1234-5678\n", encoding="utf-8")
            write_report(screen_directory(knowledge), knowledge)

            second = screen_directory(knowledge)
            self.assertNotIn("privacy_report.json", second["files_scanned"])


class SummaryTest(unittest.TestCase):
    def test_summary_lists_categories_and_limitations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            knowledge = Path(tmp_dir) / "knowledge" / "alex"
            knowledge.mkdir(parents=True)
            (knowledge / "messages.txt").write_text(
                f"주민번호 {VALID_KR_RRN}\n우울증 진단 이야기\n",
                encoding="utf-8",
            )
            report = screen_directory(knowledge)

        summary = format_summary(report)
        self.assertIn(STATUS_NEEDS_REVIEW, summary)
        self.assertIn("pii.national_id.kr", summary)
        self.assertIn("Not covered by this screen:", summary)
        self.assertNotIn(VALID_KR_RRN, summary)


if __name__ == "__main__":
    unittest.main()
