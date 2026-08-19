> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 6. 仓库文件树（源码，学 DSH 切包）

该抄的是怎么切包，不是抄 JSON-RPC。DSH：`protocol` / `client` / `server`；`api.ts` 产品面，`client.ts` 协议面；根只导出消费者接口。Python 孪生：`api.py` / `client.py` / `models.py` / `errors.py`。

DSH SDK 简单，是因为**产品动词就一个：跑一轮**。车在 runtime 里。我们 Client 同样瘦，但不会瘦到只剩一个 `run`——产品动词是「人」上的几个动作。

```
distilly/
├── README.md
├── AGENTS.md
├── pyproject.toml
├── src/
│   ├── distilly/                       # 根只导出 Distilly, Person, 错误
│   │   ├── __init__.py
│   │   ├── api.py                      # 产品面
│   │   ├── client.py                   # 连进程内引擎；以后换 daemon 传输
│   │   ├── models.py
│   │   └── errors.py
│   ├── distilly_protocol/              # MCP / JSON-RPC / 以后 TS 共用形状
│   │   ├── types.py
│   │   └── mcp.py
│   ├── distilly_engine/                # 「车」。Client 不长业务
│   │   ├── store/                      # layout, subject, material, index
│   │   ├── queue/                      # schema, service（LSN、守卫）
│   │   ├── distill/                    # hasher, runner, commit, prompts
│   │   ├── profile/                    # schema, render, migrate
│   │   ├── graph/                      # relations, mentions
│   │   ├── version/                    # snapshot, lineage
│   │   └── project/                    # SKILL.md, host export
│   ├── distilly_adapters/              # 采集。entry point: distilly.adapters
│   │   ├── base.py                     # 已有 454 行草稿
│   │   ├── registry.py
│   │   └── builtin/                    # 第一版最多一个 web 样板
│   └── distilly_bindings/              # 注入 + bot。第一版就要注入
│       ├── protocol.py                 # HostInjector
│       ├── claude.py
│       ├── codex.py
│       ├── langgraph.py
│       ├── openai_agents.py
│       ├── hermes.py
│       └── telegram.py
├── plugin/                             # 可独立小仓。照 ChatCut 包结构
│   ├── marketplace.json
│   ├── codex/
│   │   ├── .codex-plugin/plugin.json
│   │   ├── .mcp.json                   # python -m distilly.mcp，本地 stdio
│   │   └── skills/
│   │       ├── distilly-usage/         # 产品 skill：怎么蒸
│   │       ├── collect-web/            # 委托扒公开页
│   │       └── widget-ask/             # 仅 Codex：问「蒸哪个人」
│   └── claude/
│       ├── .claude-plugin/plugin.json
│       └── skills/                     # usage/collect symlink 同一份
├── tests/
└── examples/
    ├── headless_ingest.py
    └── spawn_ten_subagents.py
```

`plan_collect`、`promote`、适配器 registry **不准**从 `distilly` 根再 export。要深用去 `distilly.engine` / `distilly.adapters`。

对应：

| DSH | distilly |
|---|---|
| `packages/sdk/protocol` | `distilly_protocol` |
| `api.ts`（`DeepSeekHarness`+Session） | `api.py`（`Distilly`+`Person`） |
| `client.ts` | `client.py` |
| `packages/sdk/server` + runtime | `distilly_engine` |
| Cordis 插件 | `SourceAdapter` + entry point（同一道缝，不是同一框架） |
| 不存在于 SDK 组的框架代码 | `distilly_bindings` |

Cordis 对 SourceAdapter：对上的是「扩展点在 runtime/engine，不在 Client」。对不上：Cordis 是整套插件运行时；entry point 只是发现并实例化一次；`SourceAdapter` 只解决 Material 从哪来。

现有可搬：`tools/adapters/base.py` + `__init__.py`；provenance / schema v4 / `meta.json` / `lineage.jsonl` / telemetry；约 110 本地测试。

---
