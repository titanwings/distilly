> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 14. Bot（你早就说可以先做，中间被挤掉了）

Bot 不是第四套引擎，是 **Person 的又一种装法**：常驻对话入口，默认 `get` 某个人，用户 @ 跟这个人说话。

| | Codex / Claude 插件 | Bot |
|---|---|---|
| 谁在跑 | 用户打开的 coding agent | 挂着人格的对话进程 |
| UI | IDE + MCP + 可选面板 | Telegram / Discord / Hermes |
| 一次加载 | 可以 `get` 不同人 | 通常钉死一个人 |
| 采集 | 模型去扒 | 用户丢消息/图/语音 → `ingest` |

Hermes profile = 独立 agent（SOUL.md、技能、头像）。那是我们的 `export`/`install` 目标，不是另一种 profile。

Telegram：启动时 `person.get()` 塞进 system，每轮用户消息 `ingest`（或先缓冲）。**聊天窗口就是面板。**

版本：第一版一个 bot 钉一个 subject + 一个 version。要换人就换一个 bot。图在家里，bot 只是图上某一个节点的嘴。

Bot 24 小时自己回，需要的是 **bot 宿主的对话模型 key**，不是 distilly 的蒸馏 key。蒸馏仍可：人在 Codex 里蒸好再 `install`；或 bot 看到 `pending` 再蒸（走有 key 那条执行者）。

**不准自己实现一套人格文件。** 只准 `get`/`ingest`/`commit`/`install`。ChatCut 没有 bot 线，所以他们只有 `codex/`+`claude/`。我们多一个 binding，不要再复制一份 `profile/`。

建议落地（补回你早先的优先级）：

1. 引擎 + `Person` 五个动词
2. **一个 bot 绑定**（Hermes 或 Telegram）
3. Codex / Claude 产品插件
4. 面板 / 关系图 / 我们自己的市场

插件让 coding agent **做**蒸馏；bot 让普通人 **跟蒸好的人说话**。

---
