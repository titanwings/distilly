# PR-07 · 需要凭据的采集渠道 + computer-use 同意门（ds/07-collect-consent）

契约：`docs/v2/CONTRACT.md`（§1 命令表、§2 磁盘契约、§3 回执与密钥、§4 证据纪律、§5 门禁）。
本 PR 只做「要 key 的渠道 + 同意门 + 可选转写」，schema v4 / 迁移 / 发布留给 `ds/08`。

范围：新增 `src/collect/{feishu,slack,dingtalk,x}.mjs`、`src/consent.mjs`、`src/optional/transcribe.mjs`、
`tests/collect.test.mjs`、`tests/consent.test.mjs`、本文件；`bin/distilly.mjs` 只加一段独立分发。
未改动：`src/skill/**`、`src/parse/**`、`src/knowledge/**`、`src/views/**`、`src/hosts/agents.mjs`、
`SKILL.md`、`prompts/**`、他人的 `tests/*.test.mjs`、`docs/v2/**`。

## 1. 变更摘要（每个提交一件事）

| commit | 内容 | 文件 |
| --- | --- | --- |
| `b23b69a` | 同意门：`grant/verify/revoke/list/prune`，`~/.distilly/consent.json`（0600） | `src/consent.mjs` (517) |
| `d254202` | 飞书渠道：注入 fetch、原样落盘、账本、退避、游标续传 | `src/collect/feishu.mjs` (804) |
| `2dff76e` | Slack 渠道：GET-only、两种限流形态、scope 错误映射 | `src/collect/slack.mjs` (716) |
| `13101f1` | 钉钉渠道：只读通讯录名片 + 「消息无公开读接口」明确 unavailable + 浏览器捕获登记 | `src/collect/dingtalk.mjs` (833) |
| `ff4d998` | X 两条路：API v2（Bearer、分页、`since_id` 续采）+ 同意门浏览器模式 | `src/collect/x.mjs` (959) |
| `35bd455` | 可选转写：OpenAI 兼容 HTTP 或宿主捕获，产物带 provenance | `src/optional/transcribe.mjs` (705) |
| `d7375ff` | CLI 注册 `collect` / `consent` / `transcribe`（独立分发块，未碰 install/uninstall） | `bin/distilly.mjs` |
| `8bc6ed4` | 分页 / 限流 / 续传 / 缺 key / 不伪造 / 密钥不泄露测试 | `tests/collect.test.mjs` (706) |
| `43eaee5` | 同意门 + exit 2 + 写操作扫描测试 | `tests/consent.test.mjs` (409) |
| `00159c1` | `consent --help` 修复 + 双语帮助断言 | 同上两文件 |
| `2442345` | 本文件 | `docs/evidence/pr-07-collect-consent.md` |
| `5047c23` | 合并 `dot-skill-test`（唯一冲突 `bin/distilly.mjs`：保留 ds/03 的 `view` 分支与本分支的 collect/consent/transcribe 分支，各自独立 else-if） | `bin/distilly.mjs` |
| `37fd4e4` | 与合并后的知识契约对齐：转写账本 `kind: "transcript"`（`src/knowledge/ledger.mjs` 的 `ENTRY_KINDS` 成员）；浏览器捕获支持可重复 `--url`，账本与回执记录 `url/urls`（`prompts/computer-use.md` §3 要求每屏带 URL） | 三个模块 + 两个测试 |

（按用户指令：**未 push、未建 PR**，只在本地提交，由维护者在本地合并到集成分支。）

合并后全树测试：`node --test` = **154 pass / 0 fail**（集成分支原有 120 + 本分支 34）；
`node scripts/prompt-lint.mjs` = 0 findings（16 个契约命令，含本次注册的 collect/consent/transcribe）。

命令面（契约 §1 的子集）：

```
distilly collect <feishu|slack|dingtalk|x> …        --json 回执
distilly collect x|dingtalk --mode browser --consent <token> [--capture <file>]
distilly consent <grant|list|verify|revoke|prune>    --json；失败时 exit 2
distilly transcribe <audio|video> [--capture <transcript.txt>]  --json
```

## 2. 测试命令与结果

```bash
node --check src/consent.mjs src/collect/*.mjs src/optional/transcribe.mjs bin/distilly.mjs
node --test tests/collect.test.mjs     # 20 pass / 0 fail（约 0.6s）
node --test tests/consent.test.mjs     # 14 pass / 0 fail（约 0.4s）
node --test                            # 合并后全树 154 pass / 0 fail（含集成分支 120）
node scripts/prompt-lint.mjs           # 0 findings in 26 files（16 个契约命令都真实存在）
```

全部测试**零网络**：请求走注入的 `fetch`；CLI 路径用
`NODE_OPTIONS=--import=<tmp>/preload.mjs` 在子进程里替换 `globalThis.fetch`，
mock 路由逐条应答并把请求记到 JSON，断言据此进行。没有访问任何真实 API，也没有使用真实凭据
（测试把 `HOME` 指向临时目录，避免读到本机遗留的 `~/.colleague-skill/*_config.json`）。

逐条对应任务要求：

| 要求 | 测试 | 结果 |
| --- | --- | --- |
| 分页：3 页按游标拉完，页间游标正确 | `feishu: three cursor pages…`、`slack: three cursor pages…`、`x: pagination_token pages…` | pass |
| 限流：429 + `Retry-After` 退避重试 | `feishu: 429 + Retry-After backs off…`（断言 `sleep` 收到恰好 `2000ms`） | pass |
| 限流超上限：带警告退出 + 保留已落盘部分 | `feishu: past the retry cap…`（page1 在盘上、page2 不存在、`partial:true`、`unavailable[0].reason` 含 `rate-limited`） | pass |
| 续传：第二次从中断游标继续，不重复拉已完成页 | `feishu: the second run resumes…`（第二次只有 1 次 messages 请求且带 `page_token=tok-2`） | pass |
| 缺 key：非零退出 + 补救步骤 + `unavailable` | `every channel fails loudly without a credential…`（四个渠道） | pass |
| **不伪造**：失败路径下 `knowledge/raw/` 不产生任何文件 | 同上 + `an API-level error is never turned into fake data` + `CLI missing-key path…`（断言 `knowledge/` 目录都不存在） | pass |
| **密钥不泄露**：假 key 跑成功/失败两条路径，stdout/stderr/回执都不含该值 | `CLI success path: a fake key never reaches…`、`CLI failure path: a rejected key leaks nothing…`、`CLI: a fake credential passed through the environment…`、`transcribe: the OpenAI-compatible backend keeps the key out…` | pass |
| 错误信息含「去哪里配置」的补救步骤 | 同上（断言 stderr 含 `slack_config.json`、`fix:`、`api.slack.com/apps`；feishu 断言含 `im:message:readonly`） | pass |
| 同意门：无 token / 过期 → exit 2 + 「等待用户同意」回执 | `collect x --mode browser without a token exits 2…`、`an expired consent token exits 2…`、`consent CLI: … with exit 2 once it is gone` | pass |
| **代码里不存在写操作**（能力层面，不靠 prompt） | `no collector source contains a write endpoint…`、`only the allowlisted mutations exist…`、`no exported collector function can like, follow…`、`every request a collector makes is GET, except the allowlisted exchange` | pass |
| transcribe：无能力 → `unavailable`，不静默降级 | `transcribe: no backend is an explicit unavailable…`、`transcribe: an empty provider response fails…` | pass |
| transcribe：成功带 `provenance{method,producer,confidence}` | `transcribe: the host backend registers provenance…`、`transcribe: the OpenAI-compatible backend…` | pass |

「无写操作」这条是**机械**断言，不是承诺：

* 四个渠道的**每个**请求都经过 `assertReadOnly(url, method)`；非 GET 且不在该渠道
  `ALLOWED_MUTATIONS` 里的请求在发出前抛错。允许清单被测试逐字钉死：
  `feishu = [POST /auth/v3/tenant_access_token/internal]`、
  `dingtalk = [POST /v1.0/oauth2/accessToken, POST /v1.0/contact/users/search]`（都是查询语义）、
  `slack = []`、`x = []`（纯 GET）。
* 源码扫描（**先剥注释**，所以「禁止点赞」这类文字不会造成假阳性）不含
  `/likes`、`/retweets`、`/follows`、`/favorites`、`statuses/update`、`chat.postMessage`、
  `direct_messages`、`reactions.add`、`files.upload`、`/2/tweets`、`messages/send`；导出的符号名也不含写动词。
* `method: "POST"` 的调用点数量被钉死（feishu 1、slack 0、dingtalk 2、x 0，减去允许清单声明数），
  新增一个写调用会直接让测试变红，必须人工复核。

CLI 冒烟（人工跑过一次，均无网络）：

```
$ distilly collect feishu --chat-id oc_demo --json      → exit 1；work/ 下 0 个文件
$ distilly collect x --mode browser --json              → exit 2（waiting-for-user-consent）
$ distilly transcribe a.m4a --json                      → exit 1（no-backend + 4 条补救步骤）
$ distilly --check-package                              → Distilly package payload is valid.
```

## 3. before-after

### 3.1 渠道数量与代码量

| | legacy（Python，`tools/`） | 现在（Node，零依赖） |
| --- | --- | --- |
| 飞书 | `feishu_auto_collector.py` 960 行（`requests`，含交互式 setup） | `src/collect/feishu.mjs` 804 行 |
| Slack | `slack_auto_collector.py` 722 行（`slack_sdk`） | `src/collect/slack.mjs` 716 行 |
| 钉钉 | `dingtalk_auto_collector.py` 790 行（`requests` + Playwright 抓消息） | `src/collect/dingtalk.mjs` 833 行（API 只读名片 + 宿主捕获登记） |
| X | `research/xquik_public_posts.py` 406 行（第三方 Xquik，`XQUIK_API_KEY`） | `src/collect/x.mjs` 959 行（X API v2 直连 + 同意门浏览器模式） |
| 转写 | `research/transcribe_audio.py` 304 行（whisper 本地 / OpenAI SDK） | `src/optional/transcribe.mjs` 705 行（HTTP 或宿主捕获） |
| 合计 | 5 个工具、3182 行、运行时依赖 `requests`/`slack_sdk`/`openai`/`playwright` | 5 个模块 + 同意门 517 行、运行时依赖 **0**；测试 1115 行 |

渠道数没有缩水（5 → 5），但能力边界变了：钉钉的消息历史在 legacy 里靠 Playwright 驱动浏览器，
本 PR **不驱动浏览器**，改为「同意门 + 宿主捕获登记」；X 从第三方聚合 API 改回官方 API v2。

### 3.2 密钥是否曾经泄露（对照）

legacy 里能指名道姓的泄露点：

| 位置 | legacy 行为 | 现在 |
| --- | --- | --- |
| `tools/feishu_auto_collector.py:920` | `print(f"   token: {token_data['access_token'][:20]}...")` —— **把 user_access_token 的前 20 个字符打到 stdout** | 只打印配置文件名 `feishu_config.json`；`redact()`/`scrub()` 双重兜底，测试断言 stdout/stderr/回执都不含注入的假 key |
| `tools/feishu_auto_collector.py:147,195` | `print(f"获取 token 失败：{data}")` —— 原样打印整个 API 响应 | 失败只输出 `code=…` 与 `msg`（经 `redact`），补救步骤指向 `~/.distilly/feishu_config.json` |
| `tools/dingtalk_auto_collector.py:113` | 同上，原样打印响应体 | 同上：`auth-failed` + 配置文件名 + 应用后台链接 |
| `tools/transcribe_audio.py:145,152` | `if not api_key: return ""` / `except ImportError: return ""` —— **静默降级成空转写**，调用方拿到空字符串继续跑 | 无后端 → `unavailable: no-backend` + 非零退出 + 4 条补救步骤；provider 返回空文本 → `empty-transcript` 失败，**不写空产物** |
| 全部 legacy 采集器 | 凭据只在 `~/.distilly/*_config.json`（含 `~/.colleague-skill/` 回退） | 同一路径 + `DISTILLY_HOME` 覆盖（测试用）；env 优先 |

现在的机械保障：`redact(text, secrets)` 在所有对外文本上过滤凭据值，`scrub(receipt, secrets)` 对回执做
JSON 往返过滤 —— 即使将来有人在深层嵌套里拼进密钥，回执也不会带出去。

## 4. 已知缺口与未验证项

1. **钉钉消息历史没有 API 路径**（唯一「能力缺口」）：仓库自己的证据是
   `tools/dingtalk_auto_collector.py:518` 用 Playwright 抓取，并在帮助文本里写明「历史消息需浏览器方案」。
   本 PR 不发明端点：api 模式只采通讯录名片，消息走 `--mode browser`（同意门 + 宿主捕获登记）。
   宿主侧真正的 computer use 实现不在本 PR 范围。
2. **Xquik 路线未迁移**：`XQUIK_API_KEY` / `tools/research/xquik_public_posts.py` 的第三方聚合路径被
   X API v2 直连取代；如果仍需要 Xquik（无 X 官方额度时），要单独补一个渠道模块。
3. **未对真实 API 验证**：所有响应形状来自两处——legacy 采集器的解析代码（飞书 `code/data.items/
   has_more/page_token`、Slack `ok/messages/response_metadata.next_cursor`、钉钉 `accessToken` /
   `list`）与 X API v2 的公开文档（`data/meta.next_token/newest_id`、`/2/users/by/username/:handle`）。
   本沙箱没有凭据、也不允许真联网，因此**没有任何一次真实请求**；联调时若形状有偏差，
   改动点是各模块的 `collect*` 解析处与对应 mock。
4. **钉钉名片搜索的分页未验证**：legacy 只调用过 `offset: 0`，因此本模块只发一页，并在结果满页时
   给 warning 说明「continuation 未对活租户验证」。
5. **collect 只落 raw + 账本，不产锚点**：`knowledge/text/*.md` 的 `[k00NN]` 段落锚点属于
   ds/02 的 parse-\* / harvest 车道（见 §5 接口）。`doctor` 的「锚点回指率」在 ds/02 合并前不会有
   collect 渠道的贡献，这是预期。
6. **同意门是本机能力门，不是用户身份认证**：`consent.json` 0600，任何能读该文件的本地进程都能用
   同一个 token；没有 host 绑定、没有一次性 nonce、没有 UI 弹窗。真正的「用户点了同意」由宿主的
   交互负责，本模块只保证「没有 token 就跑不起来」且 token 会过期。
7. **无交互式 `--setup`**：legacy 三个采集器都有问答式配置向导；本 PR 只给补救文本（写哪个文件、
   开哪些 scope、去哪申请）。向导化留给后续。
8. **浏览器模式交付的是宿主自报数据**：`--capture` 的字节按「原样」入库，但内容真实性无法自证，
   因此 provenance 标成 `confidence: "host-reported"`，账本里同时记录同意指纹（token 的 sha256 前 12 位）
   与 scope，便于审计。
9. **`knowledge/index.json` 的合并语义需与 ds/02 对齐**：本 PR 采用「数组 + 按 `id` upsert + 原子写」，
   id 形如 `feishu:oc_demo:p001`。合并 ds/02 后已确认：`loadLedger` 接受数组形式、只要求每条有字符串 `id`，
   `appendEntry` 只按 `sha256 + origin` 去重、不校验 `kind`/`method` 枚举 —— 因此本 PR 的条目可被现有
   ledger 代码读写。**但** `src/knowledge/ledger.mjs` 的 `ENTRY_KINDS` 目前没有 `raw`（零凭据解析器的词表），
   且全库 id 方案是 `k00NN`。若 ds/08 要求统一，改动点是三处 `appendLedger` 调用点 + 六个 `kind` 字面量。
10. **computer-use 每屏「归一化文本 + 锚点」只完成了一半**：`prompts/computer-use.md` §3 要求每屏落
    页面原文（带 `[k00NN]`）到 `knowledge/text/<source>.md`。本 PR 落的是原样字节（`knowledge/raw/x/`）+
    账本条目（含 `url`、`fetched_at`、`method`、`consent`），文本归一化与锚点分配仍属 ds/02 的
    `recordDocument` / `parse-*` 车道 —— 见 §5，ds/08 若要求 collect 直接产出锚点，应把
    `writeRaw + appendEntry` 换成 `KnowledgeStore + recordDocument`。

## 5. 给 ds/08（schema v4 + 发布）的接口

**采集产物如何进账本**（`knowledge/index.json`，契约 §2）：

```json
{
  "id": "x:99:p001",
  "kind": "raw",
  "origin": "raw/x/99-p001.json",
  "source": "x",
  "fetched_at": "2026-09-13T00:00:00.000Z",
  "bytes": 512,
  "sha256": "…",
  "credentialed": true,
  "credential_source": "config",          // config | env | legacy-config
  "credential_file": "x_config.json",     // 只允许文件名，永远不是值
  "method": "api-v2-bearer",              // api-tenant-token | api-user-token | api-bot-token | api-app-token | browser-host | host-transcribe | openai-http
  "items": 2,
  "provenance": {"method": "host-transcribe", "producer": "host:model", "confidence": "host-reported"},
  "consent": {"scope": "collect:x:browser", "granted_at": "…", "expires_at": "…", "token_sha256_12": "…"},
  "warnings": []
}
```

* 写入是**幂等 upsert**：同 `id` 覆盖，`knowledge/index.json` 保持一个 JSON 数组、按 `id` 排序、原子替换。
  合并后已与 `src/knowledge/ledger.mjs` 核对：`loadLedger` 接受该数组形式（每条只需字符串 `id`），
  `appendEntry` 不校验 `kind`/`method` 枚举，所以本 PR 的条目与 ds/02 的条目可以共存于同一文件。
  **待 ds/08 决定**：是否把 `kind: "raw"` 与 `method: "api-v2-bearer"` 等加入 `ENTRY_KINDS`/`ENTRY_METHODS`
  （现在的词表只覆盖零凭据解析器），以及是否把 collect 的 id 从 `channel:target:pNNN` 改成全库统一的 `k00NN`。
* 浏览器/宿主捕获额外带 `url` / `urls`（`prompts/computer-use.md` §3 的每屏 URL 要求）。
* `credentialed` 语义：走过 API 凭据 = `true`；浏览器/宿主捕获 = `false`（另有 `consent` 块）。
* schema v4 若要给条目加 `schema` 版本字段，建议直接在 `appendLedger` 的入口统一注入，避免三处重复。
* 原始字节在 `knowledge/raw/<channel>/<target>-p<NNN>.json`，**逐字节原样**（不重新序列化），
  sha256 与 `bytes` 均来自落盘字节。

**consent 文件格式**（`~/.distilly/consent.json`，0600，`DISTILLY_HOME` 可覆盖）：

```json
{ "version": 1,
  "grants": [ { "token": "dsc_<32hex>", "scope": "collect:x:browser",
                "granted_at": "ISO", "expires_at": "ISO", "note": "optional" } ] }
```

* 默认 TTL 24h（`--ttl <分钟>`）；`verify(token, {scope, now})` 返回
  `{ok, reason: granted|no-token|unknown-token|scope-mismatch|expired|unreadable-store, status: granted|waiting-for-user-consent, remediation[]}`。
* scope 约定 `<action>:<channel>:<mode>`（当前用 `collect:x:browser`、`collect:dingtalk:browser`）。
* 采集侧只把 **token 的 sha256 前 12 位**写进账本，绝不落 token 原文；`list` 会打印 token 供用户复制。

**运行状态文件**（不在仓库内，位于 `$DISTILLY_HOME/state/`）：

* `<channel>-<sha256(root+target)[:12]>.json`：`{cursor, pages, items, updated_at, completed}`。
* 采集成功即删除（X 例外：保留 `since_id`/`newest_id`，供下次增量采集）。

**转写产物**：`knowledge/raw/transcribe/<name>.json`（原样响应）+ `knowledge/text/<name>.md`
（前言含 `provenance`，正文按 `[hh:mm:ss]` 分段）。前言里标了 `anchors: pending`：
**锚点由 parse-subtitle / harvest 补齐**，ds/08 的 v4 schema 若要求 `knowledge/text` 必有锚点，
需要在这些产物上补一遍锚点分配（或让 collect 复用 ds/02 的锚点分配器）。

## 6. 回滚

* 单个渠道回滚：`git revert <commit>` —— 每个采集器是独立提交、独立文件，互不牵连；
  `bin/distilly.mjs` 的分发块引用被删模块时会以 `Cannot find module` 响亮失败（不会静默降级）。
* 全部回滚：`git revert 00159c1 43eaee5 8bc6ed4 d7375ff 35bd455 ff4d998 13101f1 2dff76e d254202 b23b69a`
  （本文件的提交最后 revert），回到 `dot-skill-test` 的 `42f7e1b` 状态；
  仓库内没有任何其他文件被本 PR 触碰（`git diff --stat 42f7e1b..HEAD` 可见全部改动面）。
* 回滚不影响用户数据：`~/.distilly/`（凭据、consent、state）与 `knowledge/` 产物都在仓库外，
  legacy Python 采集器仍在 `tools/` 里可用。
* 本 PR 未提交任何截图/大文件；`.gitignore` 的 `dst-evidence/` 未被触碰。
