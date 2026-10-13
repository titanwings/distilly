# Data sources

[Back to README](../README.md)

Distilly can collect from these sources. Collector setup and credentials are in the [Install Guide](../INSTALL_EN.md#collector-setup).

| Logo | Source | Messages | Docs / Wiki | Notes |
|:----:|--------|:--------:|:-----------:|-------|
| <img src="assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark (auto) | ✅ API | ✅ | Just enter a name, fully automatic |
| <img src="assets/sources/dingtalk-mark.jpg" alt="DingTalk" width="32" height="32"> | DingTalk (auto) | ⚠️ Browser | ✅ | DingTalk API doesn't support message history |
| <img src="assets/sources/slack-mark.png" alt="Slack" width="32" height="32"> | Slack (auto) | ✅ API | — | Requires admin to install Bot; free plan limited to 90 days |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/sources/x-mark-dark.svg"><img src="assets/sources/x-mark-light.svg" alt="X" width="32" height="32"></picture> | Public X posts | ✅ API | — | Optional, bounded celebrity research candidates through metered third-party service Xquik |
| <img src="assets/sources/wechat-mark.jpg" alt="WeChat" width="32" height="32"> | WeChat chat history | ✅ SQLite | — | Export first with WeChatMsg or PyWxDump |
| 📄 | PDF / Images / Screenshots | — | ✅ | Manual upload |
| <img src="assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark JSON export | ✅ | ✅ | Manual upload |
| ✉️ | Email `.eml` / `.mbox` | ✅ | — | Manual upload |
| 📝 | Markdown / direct paste | ✅ | ✅ | Manual input |
