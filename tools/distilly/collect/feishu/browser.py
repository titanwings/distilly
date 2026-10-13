"""
飞书浏览器抓取器（Playwright 方案）

复用本机 Chrome 登录态，无需任何 token，能访问你有权限的所有飞书内容。

支持：
  - 飞书文档（docx/docs）
  - 飞书知识库（wiki）
  - 飞书表格（sheets）→ 导出为 CSV
  - 飞书消息记录（指定群聊）

安装：
  pip install playwright
  playwright install chromium

用法：
  python3 feishu_browser.py --url "https://xxx.feishu.cn/wiki/xxx" --output out.txt
  python3 feishu_browser.py --url "https://xxx.feishu.cn/docx/xxx" --output out.txt
  python3 feishu_browser.py --chat "后端组" --target "张三" --limit 500 --output out.txt
  python3 feishu_browser.py --url "https://xxx.feishu.cn/sheets/xxx" --output out.csv
"""

from __future__ import annotations

import sys
import time
import argparse
from pathlib import Path
from typing import Optional

from distilly.core.chrome import default_chrome_profile


get_default_chrome_profile = default_chrome_profile


def make_context(playwright, chrome_profile: Optional[str], headless: bool):
    """创建复用登录态的浏览器上下文"""
    profile = chrome_profile or get_default_chrome_profile()
    try:
        ctx = playwright.chromium.launch_persistent_context(
            user_data_dir=profile,
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            ignore_default_args=["--enable-automation"],
            viewport={"width": 1280, "height": 900},
        )
        return ctx
    except Exception as e:
        print(f"⚠️  无法加载 Chrome Profile：{e}", file=sys.stderr)
        print(f"   尝试的路径：{profile}", file=sys.stderr)
        print("   请用 --chrome-profile 手动指定路径", file=sys.stderr)
        sys.exit(1)


def detect_page_type(url: str) -> str:
    """根据 URL 判断飞书页面类型"""
    if "/wiki/" in url:
        return "wiki"
    elif "/docx/" in url or "/docs/" in url:
        return "doc"
    elif "/sheets/" in url or "/spreadsheets/" in url:
        return "sheet"
    elif "/base/" in url:
        return "base"
    else:
        return "unknown"


def fetch_doc(page, url: str) -> str:
    """抓取飞书文档或 Wiki 的文本内容"""
    page.goto(url, wait_until="domcontentloaded", timeout=30000)

    # 等待编辑器加载（飞书文档渲染较慢）
    selectors = [
        ".docs-reader-content",
        ".lark-editor-content",
        "[data-block-type]",
        ".doc-render-core",
        ".wiki-content",
        ".node-doc-content",
    ]

    loaded = False
    for sel in selectors:
        try:
            page.wait_for_selector(sel, timeout=15000)
            loaded = True
            break
        except Exception:
            continue

    if not loaded:
        # 等待一段时间后直接提取 body 文本
        time.sleep(5)

    # 额外等待异步内容渲染
    time.sleep(2)

    # 尝试多个选择器提取正文
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el:
                text = el.inner_text()
                if len(text.strip()) > 50:
                    return text.strip()
        except Exception:
            continue

    # fallback：提取整个 body
    text = page.inner_text("body")
    return text.strip()


def fetch_sheet(page, url: str) -> str:
    """抓取飞书表格，转为 CSV 格式"""
    page.goto(url, wait_until="domcontentloaded", timeout=30000)

    try:
        page.wait_for_selector(".spreadsheet-container, .sheet-container", timeout=15000)
    except Exception:
        time.sleep(5)

    time.sleep(3)

    # 通过 JS 提取表格数据
    data = page.evaluate("""
        () => {
            const rows = [];
            // 尝试从 DOM 提取可见单元格
            const cells = document.querySelectorAll('[data-row][data-col]');
            if (cells.length === 0) return null;

            const grid = {};
            let maxRow = 0, maxCol = 0;
            cells.forEach(cell => {
                const r = parseInt(cell.getAttribute('data-row'));
                const c = parseInt(cell.getAttribute('data-col'));
                if (!grid[r]) grid[r] = {};
                grid[r][c] = cell.innerText.replace(/\\n/g, ' ').trim();
                maxRow = Math.max(maxRow, r);
                maxCol = Math.max(maxCol, c);
            });

            for (let r = 0; r <= maxRow; r++) {
                const row = [];
                for (let c = 0; c <= maxCol; c++) {
                    row.push(grid[r] && grid[r][c] ? grid[r][c] : '');
                }
                rows.push(row);
            }
            return rows;
        }
    """)

    if data:
        lines = []
        for row in data:
            lines.append(",".join(f'"{cell}"' for cell in row))
        return "\n".join(lines)

    # fallback：直接提取文本
    return page.inner_text("body")


def fetch_messages(page, chat_name: str, target_name: str, limit: int = 500) -> str:
    """
    抓取指定群聊中目标人物的消息记录。
    需要先导航到飞书 Web 版消息页面。
    """
    # 打开飞书消息页
    page.goto("https://applink.feishu.cn/client/chat/open", wait_until="domcontentloaded", timeout=20000)
    time.sleep(3)

    # 尝试搜索群聊
    try:
        # 点击搜索
        search_btn = page.query_selector('[data-test-id="search-btn"], .search-button, [placeholder*="搜索"]')
        if search_btn:
            search_btn.click()
            time.sleep(1)
            page.keyboard.type(chat_name)
            time.sleep(2)

            # 选择第一个结果
            result = page.query_selector('.search-result-item:first-child, .im-search-item:first-child')
            if result:
                result.click()
                time.sleep(2)
    except Exception as e:
        print(f"⚠️  自动搜索群聊失败：{e}", file=sys.stderr)
        print(f"   请手动导航到「{chat_name}」群聊，然后按回车继续...", file=sys.stderr)
        input()

    # 向上滚动加载历史消息
    print("正在加载消息历史...", file=sys.stderr)
    messages_container = page.query_selector('.message-list, .im-message-list, [data-testid="message-list"]')

    if messages_container:
        for _ in range(10):  # 滚动 10 次
            page.evaluate("el => el.scrollTop = 0", messages_container)
            time.sleep(1.5)
    else:
        for _ in range(10):
            page.keyboard.press("Control+Home")
            time.sleep(1.5)

    time.sleep(2)

    # 提取消息
    messages = page.evaluate(f"""
        () => {{
            const target = "{target_name}";
            const results = [];

            // 常见的消息 DOM 结构
            const msgSelectors = [
                '.message-item',
                '.im-message-item',
                '[data-message-id]',
                '.msg-list-item',
            ];

            let items = [];
            for (const sel of msgSelectors) {{
                items = document.querySelectorAll(sel);
                if (items.length > 0) break;
            }}

            items.forEach(item => {{
                const senderEl = item.querySelector(
                    '.sender-name, .message-sender, [data-testid="sender-name"], .name'
                );
                const contentEl = item.querySelector(
                    '.message-content, .msg-content, [data-testid="message-content"], .text-content'
                );
                const timeEl = item.querySelector(
                    '.message-time, .msg-time, [data-testid="message-time"], .time'
                );

                const sender = senderEl ? senderEl.innerText.trim() : '';
                const content = contentEl ? contentEl.innerText.trim() : '';
                const time = timeEl ? timeEl.innerText.trim() : '';

                if (!content) return;
                if (target && !sender.includes(target)) return;

                results.push({{ sender, content, time }});
            }});

            return results.slice(-{limit});
        }}
    """)

    if not messages:
        print("⚠️  未能自动提取消息，尝试提取页面文本", file=sys.stderr)
        return page.inner_text("body")

    # 按权重分类输出
    long_msgs = [m for m in messages if len(m.get("content", "")) > 50]
    short_msgs = [m for m in messages if len(m.get("content", "")) <= 50]

    lines = [
        "# 飞书消息记录（浏览器抓取）",
        f"群聊：{chat_name}",
        f"目标人物：{target_name}",
        f"共 {len(messages)} 条消息",
        "",
        "---",
        "",
        "## 长消息（观点/决策类）",
        "",
    ]
    for m in long_msgs:
        lines.append(f"[{m.get('time', '')}] {m.get('content', '')}")
        lines.append("")

    lines += ["---", "", "## 日常消息", ""]
    for m in short_msgs[:200]:
        lines.append(f"[{m.get('time', '')}] {m.get('content', '')}")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="飞书浏览器抓取器（复用 Chrome 登录态）")
    parser.add_argument("--url", help="飞书文档/Wiki/表格链接")
    parser.add_argument("--chat", help="群聊名称（抓取消息记录时使用）")
    parser.add_argument("--target", help="目标人物姓名（只提取此人的消息）")
    parser.add_argument("--limit", type=int, default=500, help="最多抓取消息条数（默认 500）")
    parser.add_argument("--output", default=None, help="输出文件路径（默认打印到 stdout）")
    parser.add_argument("--chrome-profile", default=None, help="Chrome Profile 路径（默认自动检测）")
    parser.add_argument("--headless", action="store_true", help="无头模式（不显示浏览器窗口）")
    parser.add_argument("--show-browser", action="store_true", help="显示浏览器窗口（调试用）")

    args = parser.parse_args()

    if not args.url and not args.chat:
        parser.error("请提供 --url（文档链接）或 --chat（群聊名称）")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("错误：请先安装 Playwright：pip install playwright && playwright install chromium", file=sys.stderr)
        sys.exit(1)

    headless = args.headless and not args.show_browser

    print(f"启动浏览器（{'无头' if headless else '有界面'}模式）...", file=sys.stderr)

    with sync_playwright() as p:
        ctx = make_context(p, args.chrome_profile, headless=headless)
        page = ctx.new_page()

        # 检查是否已登录
        page.goto("https://www.feishu.cn", wait_until="domcontentloaded", timeout=15000)
        time.sleep(2)
        if "login" in page.url.lower() or "signin" in page.url.lower():
            print("⚠️  检测到未登录状态。", file=sys.stderr)
            print("   请在打开的浏览器窗口中登录飞书，登录后按回车继续...", file=sys.stderr)
            if headless:
                print("   提示：请用 --show-browser 参数显示浏览器窗口以完成登录", file=sys.stderr)
                sys.exit(1)
            input()

        # 根据任务类型执行
        if args.url:
            page_type = detect_page_type(args.url)
            print(f"页面类型：{page_type}，开始抓取...", file=sys.stderr)

            if page_type == "sheet":
                content = fetch_sheet(page, args.url)
            else:
                content = fetch_doc(page, args.url)

        elif args.chat:
            content = fetch_messages(
                page,
                chat_name=args.chat,
                target_name=args.target or "",
                limit=args.limit,
            )

        ctx.close()

    if not content or len(content.strip()) < 10:
        print("⚠️  未能提取到有效内容", file=sys.stderr)
        sys.exit(1)

    if args.output:
        Path(args.output).write_text(content, encoding="utf-8")
        print(f"✅ 已保存到 {args.output}（{len(content)} 字符）", file=sys.stderr)
    else:
        print(content)
