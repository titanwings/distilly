> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 12. 插件怎么做（ChatCut：抄包，不抄云）

仓库参照 [ChatCut-Inc/agent-plugin](https://github.com/ChatCut-Inc/agent-plugin)：

```
codex/.codex-plugin/plugin.json + .mcp.json + skills/
claude/.claude-plugin/plugin.json + skills/   # 规范 skill symlink
```

用户侧 ChatCut：`marketplace add` → `plugin add` → **`mcp login` OAuth** → **必须新开对话**。业务走远程 `https://api.chatcut.io`。要表单走 Codex MCP App widget。要给用户看编辑器时返回 `browserHandoff.url`，Codex 内嵌浏览器。模型不能去点编辑器 DOM。

ChatCut「托管 origin + OAuth」= 项目状态在他们云上，MCP 是远程的，登录换 token。**我们的内容不需要加载到云端。** profile 只在 `~/.distilly`。

该抄：一个 git 当 marketplace；`codex/`+`claude/` 两包；规范 skill symlink；`plugin.json` 的 interface（Codex 有品牌位）；装完提醒新开对话；表单走宿主原生能力。

不该抄：远程 MCP + login；人的数据放云；第一版就做 IAB 大面板；在插件包里复制引擎。

验收（Codex 插件成立的四条）：

1. `plugin add` 之后新开对话，模型能列出五个工具
2. 「蒸馏公开人物 X」走完：浏览 → ingest → commit → 本地出现 `subjects/`
3. 下一句「你是 X」能 `get` 到声音和例句
4. **不登录任何云账号**也能完成

面板以后：MCP 返回 `http://127.0.0.1:<固定端口>`，Codex IAB 能开 loopback（已查）。Claude 侧可行性未验证。第一版可以没有面板。

`install` 实现必须是安装器插件，每多一个宿主加一个安装器，和适配器同一道缝。

---
