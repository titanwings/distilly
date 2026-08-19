# Design

This folder is the product contract. [system-v1.md](system-v1.md) is the uncut v1.1 reconstruction of the design conversation. [v1/](v1/) holds the same sections as separate files so an agent can load one topic.

If a chapter and `system-v1.md` disagree, **the parent file wins**. Edit the parent, then the chapter.

`docs/architecture.md` is the live-tree map. It is not a substitute for this folder.

## Reading order

Implementing the first slice (no key, public figure, `get` with voice examples):

1. [00 gaps](v1/00-gaps.md) — what a short outline will drop
2. [01 intent](v1/01-intent.md) — product origin, five faces, who we remember
3. [04 locked](v1/04-locked-and-open.md) — do not reopen without a new Agent Note
4. [09 SDK spec](v1/09-sdk-spec.md) — `Distilly`, `Person`, types, MCP five tools
5. [07 home tree](v1/07-home-tree.md) — `~/.distilly/` layout
6. [15 profile](v1/15-profile-layer.md) — core / domain / claim
7. [11 inject](v1/11-host-injection.md) — three load paths and the seven host pitfalls
8. [20 success](v1/20-success-path.md) and [21 order](v1/21-landing-order.md)

Then load the section that owns the change (adapters, bot, graph, ChatCut, telemetry).

## Sections

| File | Section |
|---|---|
| [00-gaps.md](v1/00-gaps.md) | 0 上一版收掉了什么 |
| [01-intent.md](v1/01-intent.md) | 1 产品原意与五条产品面 |
| [02-philosophy.md](v1/02-philosophy.md) | 2 哲学（每条带拒绝） |
| [03-memory-landscape.md](v1/03-memory-landscape.md) | 3 记忆生态站位 |
| [04-locked-and-open.md](v1/04-locked-and-open.md) | 4 已锁定 / 仍开放 |
| [05-architecture.md](v1/05-architecture.md) | 5 层、四张脸、队列、EverOS 取舍、框架钩子 |
| [06-source-tree.md](v1/06-source-tree.md) | 6 源码切包 |
| [07-home-tree.md](v1/07-home-tree.md) | 7 运行时 `~/.distilly/` |
| [08-capabilities.md](v1/08-capabilities.md) | 8 七组内部动词 |
| [09-sdk-spec.md](v1/09-sdk-spec.md) | 9 类、值类型、引擎、MCP |
| [10-source-adapters.md](v1/10-source-adapters.md) | 10 `SourceAdapter` |
| [11-host-injection.md](v1/11-host-injection.md) | 11 `HostInjector` 与七坑 |
| [12-plugins-chatcut.md](v1/12-plugins-chatcut.md) | 12 抄包不抄云 |
| [13-widget-forms.md](v1/13-widget-forms.md) | 13 问人适配 |
| [14-bot.md](v1/14-bot.md) | 14 Bot binding |
| [15-profile-layer.md](v1/15-profile-layer.md) | 15 内核 / 域 / claim |
| [16-relations.md](v1/16-relations.md) | 16 关系图与复杂度 |
| [17-sqlite.md](v1/17-sqlite.md) | 17 何时才上索引 |
| [18-telemetry.md](v1/18-telemetry.md) | 18 遥测约束 |
| [19-completeness.md](v1/19-completeness.md) | 19 现有完成度 |
| [20-success-path.md](v1/20-success-path.md) | 20 主路径与六步验收 |
| [21-landing-order.md](v1/21-landing-order.md) | 21 落地顺序与明确不做 |
| [22-doc-evolution.md](v1/22-doc-evolution.md) | 22 改接口先改本文 |
| [23-governance.md](v1/23-governance.md) | 23 治理怎么用 DSH |

Changing a locked item in §4.1 requires a new Agent Note that states the alternative that lost. Closing an item in §4.2 updates that table and dates it.
