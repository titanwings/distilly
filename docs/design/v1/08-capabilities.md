> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 8. 七组产品能力（内部清单）+ 对外瘦 SDK

七组是**怕漏**，不是用户 API。面板 / 市场 / 批准没有这些动词会做不出来。对外第一眼仍是 `Distilly` + `Person`。

### 8.1 主体

| 方法 | 做什么 |
|---|---|
| `create(kind, name, **identity)` | 建人。kind 是域包：`person` / `colleague` / `celebrity` / `self` |
| `list(*, kind=None, space=None)` | 有哪些人 |
| `get(subject, version=None)` | 结构化 profile。Recall 用 |
| `search(query)` | 按名字 / 标签 |
| `delete(subject)` | 软删除，不物理抹血缘 |

`self` 用 `create("self")` 一次即可。

### 8.2 收集

| 方法 | 做什么 |
|---|---|
| `ingest(subject, materials)` | 所有路径汇合：落盘、哈希、去重、过边界 |
| `ingest_files(subject, paths)` | 用户丢文件 |
| `list_adapters()` | 已注册来源 |
| `resolve_subject(adapter_id, query)` | 平台上这个人是谁，多候选不猜测 |
| `plan_collect(...)` | 委托：给宿主 `AgentPlan` |
| `accept_collect(plan, artifacts)` | OCR/正文 → Material → 内部 ingest |
| `collect(...)` | Direct 适配器自己采（v1 可不实现） |
| `preflight(adapter_id)` | 凭据在不在，别浪费队列 |

宿主自己扒网收成文本，直接 `ingest`，不必经过适配器。

### 8.3 蒸馏与修正

| 方法 | 做什么 |
|---|---|
| `pending()` | 已过边界、等宿主蒸 |
| `flush(subject)` | 现在就过边界 |
| `commit(subject, draft, provenance)` | 交回结果；置信度下降 → awaiting_promote |
| `promote` / `reject` | 处理挂起版本 |
| `correct(subject, patch)` | `corrections/` + 立刻新版本 |
| `status(subject)` | 材料数、集合哈希、队列态、confidence / maturity |

### 8.4 版本

| 方法 | 做什么 |
|---|---|
| `versions(subject)` | 列表 + 每版 provenance 摘要 |
| `diff(subject, a, b)` | 两版差异 |
| `rollback(subject, version)` | 恢复为当前；血缘记一次 rollback，不删历史 |
| `lineage(subject, version=None)` | 读 jsonl，版本粒度源清单 |

### 8.5 装载

| 方法 | 做什么 |
|---|---|
| `prompt(subject, version=None)` | 只给模型看的投影字符串，不落宿主目录。临时 10 个用这个 |
| `export(subject, host)` | 一对一身份文件（SOUL.md / agent.md） |
| `install(subject, host)` | 写入该宿主 skills 根。实现必须是 host id → 安装器插件，不能写死 Claude 路径 |
| `uninstall(subject, host)` | 去掉投影，不动家里 |

### 8.6 市场（接口留着，实现第二版）

`browse` / `pull` / `publish`。不要进 MCP，不要进 README 第一屏。

### 8.7 关系

`link` `invalidate` `neighbors` `path` `subgraph` `mentions` `resolve_mention`

`similar` / `rebuild_graph` 留给以后的「相似」，第一版不做。

---
