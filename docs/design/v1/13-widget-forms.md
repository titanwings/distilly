> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 13. widget-forms 是什么

不是一种表单控件，是一份「问人」的适配 skill。不决定问什么，只决定：在这个宿主上，结构化问题用什么原生 UI 问出来。

ChatCut 网页能渲染的标签，Codex/Claude 渲染不了。所以他们抽中性字段再翻译：

| 语义类型 | 意思 |
|---|---|
| `short_text` | 一行文本 |
| `explicit_consent` | 必须用户主动确认，不能预勾 |
| `playable_single_choice` | 单选，选项上能带试听 |
| `playable_preview` | 只展示，不提交 |
| `audio_reference` | 表单里不能上传；让用户把文件附到对话上 |

- Codex：`ask_followup_questions`，MCP App 卡片。不要输出 HTML。
- Claude：Elicitation / `show_widget`。**禁止**调 `ask_followup_questions`。

distilly 若第一版要在 Codex 里问「蒸哪个人 / 选哪个版本」，才需要同类东西。只做 get/ingest/commit、用对话能问清楚的，可以先不做。ChatCut 必须做，是因为选素材/配乐/导出纯文本很容易问乱。

---
