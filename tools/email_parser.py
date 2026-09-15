#!/usr/bin/env python3
"""
邮件解析器

支持格式：
1. .eml 文件（标准邮件格式）
2. .txt 文件（纯文本邮件记录）
3. .mbox 文件（多封邮件合集）

用法：
    python email_parser.py --file emails.eml --target "zhangsan@company.com" --output output.txt
    python email_parser.py --file inbox.mbox --target "张三" --output output.txt
"""

import email
import email.policy
import mailbox
import re
import sys
import argparse
from pathlib import Path
from email.header import decode_header
from html.parser import HTMLParser


class HTMLTextExtractor(HTMLParser):
    """从 HTML 邮件内容中提取纯文本"""

    def __init__(self):
        super().__init__()
        self.result = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = False
        if tag in ("p", "br", "div", "tr"):
            self.result.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.result.append(data)

    def get_text(self):
        return re.sub(r"\n{3,}", "\n\n", "".join(self.result)).strip()


def decode_mime_str(s: str) -> str:
    """解码 MIME 编码的邮件头字段"""
    if not s:
        return ""
    parts = decode_header(s)
    result = []
    for part, charset in parts:
        if isinstance(part, bytes):
            charset = charset or "utf-8"
            try:
                result.append(part.decode(charset, errors="replace"))
            except Exception:
                result.append(part.decode("utf-8", errors="replace"))
        else:
            result.append(str(part))
    return "".join(result)


def extract_email_body(msg) -> str:
    """从邮件对象中提取正文文本"""
    body = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition", ""))

            if "attachment" in disposition:
                continue

            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                try:
                    body = payload.decode(charset, errors="replace")
                    break
                except Exception:
                    body = payload.decode("utf-8", errors="replace")
                    break

            elif content_type == "text/html" and not body:
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                try:
                    html = payload.decode(charset, errors="replace")
                except Exception:
                    html = payload.decode("utf-8", errors="replace")
                extractor = HTMLTextExtractor()
                extractor.feed(html)
                body = extractor.get_text()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                body = payload.decode(charset, errors="replace")
            except Exception:
                body = payload.decode("utf-8", errors="replace")

    # 清理引用内容（Re: 时的原文引用）
    body = re.sub(r"\n>.*", "", body)
    body = re.sub(r"\n-{3,}.*?原始邮件.*?\n", "\n", body, flags=re.DOTALL)
    body = re.sub(r"\n_{3,}\n.*", "", body, flags=re.DOTALL)

    return body.strip()


def is_from_target(from_field: str, target: str) -> bool:
    """判断邮件是否来自目标人"""
    from_str = decode_mime_str(from_field).lower()
    target_lower = target.lower()
    return target_lower in from_str


def parse_eml_file(file_path: str, target: str) -> list[dict]:
    """解析单个 .eml 文件"""
    with open(file_path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=email.policy.default)

    from_field = str(msg.get("From", ""))
    if not is_from_target(from_field, target):
        return []

    subject = decode_mime_str(str(msg.get("Subject", "")))
    date = str(msg.get("Date", ""))
    body = extract_email_body(msg)

    if not body:
        return []

    return [{
        "from": decode_mime_str(from_field),
        "subject": subject,
        "date": date,
        "body": body,
    }]


def parse_mbox_file(file_path: str, target: str) -> list[dict]:
    """解析 .mbox 文件（多封邮件合集）"""
    results = []
    mbox = mailbox.mbox(file_path)

    for msg in mbox:
        from_field = str(msg.get("From", ""))
        if not is_from_target(from_field, target):
            continue

        subject = decode_mime_str(str(msg.get("Subject", "")))
        date = str(msg.get("Date", ""))
        body = extract_email_body(msg)

        if not body:
            continue

        results.append({
            "from": decode_mime_str(from_field),
            "subject": subject,
            "date": date,
            "body": body,
        })

    return results


def parse_txt_file(file_path: str, target: str) -> list[dict]:
    """
    解析纯文本格式的邮件记录
    支持简单的分隔格式：
    From: xxx
    Subject: xxx
    Date: xxx
    ---
    正文内容
    ===
    """
    results = []

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 尝试按分隔符切割多封邮件
    emails_raw = re.split(r"\n={3,}\n|\n-{3,}\n(?=From:)", content)

    for raw in emails_raw:
        from_match = re.search(r"^From:\s*(.+)$", raw, re.MULTILINE)
        subject_match = re.search(r"^Subject:\s*(.+)$", raw, re.MULTILINE)
        date_match = re.search(r"^Date:\s*(.+)$", raw, re.MULTILINE)

        from_field = from_match.group(1).strip() if from_match else ""
        if not is_from_target(from_field, target):
            continue

        # 提取正文（去掉头部字段后的内容）
        body = re.sub(r"^(From|To|Subject|Date|CC|BCC):.*\n?", "", raw, flags=re.MULTILINE)
        body = body.strip()

        if not body:
            continue

        results.append({
            "from": from_field,
            "subject": subject_match.group(1).strip() if subject_match else "",
            "date": date_match.group(1).strip() if date_match else "",
            "body": body,
        })

    return results


def classify_emails(emails: list[dict]) -> dict:
    """
    对邮件按内容分类：
    - 长邮件（正文 > 200 字）：技术方案、观点陈述
    - 决策类：包含明确判断的邮件
    - 日常沟通：短邮件
    """
    long_emails = []
    decision_emails = []
    daily_emails = []

    decision_keywords = [
        "同意", "不同意", "建议", "方案", "觉得", "应该", "决定", "确认",
        "approve", "reject", "lgtm", "suggest", "recommend", "think",
        "我的看法", "我认为", "我觉得", "需要", "必须", "不需要"
    ]

    for e in emails:
        body = e["body"]

        if len(body) > 200:
            long_emails.append(e)
        elif any(kw in body.lower() for kw in decision_keywords):
            decision_emails.append(e)
        else:
            daily_emails.append(e)

    return {
        "long_emails": long_emails,
        "decision_emails": decision_emails,
        "daily_emails": daily_emails,
        "total_count": len(emails),
    }


def format_output(target: str, classified: dict) -> str:
    """格式化输出，供 AI 分析使用"""
    lines = [
        f"# 邮件提取结果",
        f"目标人物：{target}",
        f"总邮件数：{classified['total_count']}",
        "",
        "---",
        "",
        "## 长邮件（技术方案/观点类，权重最高）",
        "",
    ]

    for e in classified["long_emails"]:
        lines.append(f"**主题：{e['subject']}** [{e['date']}]")
        lines.append(e["body"])
        lines.append("")
        lines.append("---")
        lines.append("")

    lines += [
        "## 决策类邮件",
        "",
    ]

    for e in classified["decision_emails"]:
        lines.append(f"**主题：{e['subject']}** [{e['date']}]")
        lines.append(e["body"])
        lines.append("")

    lines += [
        "---",
        "",
        "## 日常沟通（风格参考）",
        "",
    ]

    for e in classified["daily_emails"][:30]:
        lines.append(f"**{e['subject']}**：{e['body'][:200]}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="解析邮件文件，提取目标人发出的邮件")
    parser.add_argument("--file", required=True, help="输入文件路径（.eml / .mbox / .txt）")
    parser.add_argument("--target", required=True, help="目标人物（邮箱地址或姓名）")
    parser.add_argument("--output", default=None, help="输出文件路径（默认打印到 stdout）")

    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"错误：文件不存在 {file_path}", file=sys.stderr)
        sys.exit(1)

    suffix = file_path.suffix.lower()

    if suffix == ".eml":
        emails = parse_eml_file(str(file_path), args.target)
    elif suffix == ".mbox":
        emails = parse_mbox_file(str(file_path), args.target)
    else:
        emails = parse_txt_file(str(file_path), args.target)

    if not emails:
        print(f"警告：未找到来自 '{args.target}' 的邮件", file=sys.stderr)
        print("提示：请检查目标名称/邮箱是否与文件中的 From 字段一致", file=sys.stderr)

    classified = classify_emails(emails)
    output = format_output(args.target, classified)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"已输出到 {args.output}，共 {len(emails)} 封邮件")
    else:
        print(output)


if __name__ == "__main__":
    main()

