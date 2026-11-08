from __future__ import annotations

import mailbox
import tempfile
import unittest
from email.message import EmailMessage
from pathlib import Path

import _paths  # noqa: F401
from email_parser import extract_email_body, parse_eml_file, parse_mbox_file


class EmailBodyTest(unittest.TestCase):
    def test_plain_body_remains_preferred_to_html_alternative(self) -> None:
        message = EmailMessage()
        message.set_content("Plain body.")
        message.add_alternative("<p>HTML alternative.</p>", subtype="html")
        self.assertEqual(extract_email_body(message), "Plain body.")

    def test_forwarded_attachment_does_not_replace_html_body(self) -> None:
        message = EmailMessage()
        message["From"] = "author@example.com"
        message["Subject"] = "Synthetic test"
        message.set_content("<p>This is the current message.</p>", subtype="html")

        forwarded = EmailMessage()
        forwarded["From"] = "someone-else@example.com"
        forwarded.set_content("This is the forwarded attachment.")
        message.add_attachment(forwarded, filename="forwarded.eml")

        with tempfile.TemporaryDirectory() as directory:
            eml = Path(directory) / "sample.eml"
            eml.write_bytes(message.as_bytes())
            mbox_path = Path(directory) / "sample.mbox"
            archive = mailbox.mbox(mbox_path)
            try:
                archive.add(message)
            finally:
                archive.close()

            for parse, path in ((parse_eml_file, eml), (parse_mbox_file, mbox_path)):
                with self.subTest(format=path.suffix):
                    emails = parse(str(path), "author@example.com")
                    self.assertEqual(
                        [email["body"] for email in emails],
                        ["This is the current message."],
                    )
