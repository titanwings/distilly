# dot-skill v2 · 渲染层（`view check` / `view render`）

本文件说明 `views/<slug>.view.json` 的规范形状、渲染产物的不变式、诊断目录，以及
`ds/06-retrospect` 需要写入的 `evidence[]` 锚点字段。实现见 `src/views/schema.mjs`、
`src/views/render.mjs`、`viewer/*.js`、`scripts/generate-template.mjs`、
`scripts/visual-check.mjs`。契约本身（`docs/v2/CONTRACT.md`）没有被本文件修改。

## 1. 命令

```bash
distilly view check  <slug|--person <slug>> [--file <path>] [--root <dir>] [--shareable] [--json]
distilly view render <slug|--person <slug>> [--file <path>] [--root <dir>] [--out <path>] [--shareable] [--json]
```

- `<slug>` / `--person <slug>`：在 `<root>`（默认当前目录）下找 `skills/<family>/<slug>/views/<slug>.view.json`；
  也可以直接传 `--file path/to/<slug>.view.json`，或把 `.view.json` 路径当位置参数。
- `view check`：只校验，退出码 `0` 通过 / `1` 有 error。`--json` 输出纯 JSON 回执（`diagnostics[]` 可直接喂回模型）。
- `view render`：校验通过后写 `views/<slug>.html` 与 `evidence/renders/receipt.json`；校验失败 → **不写任何产物** + 退出码 `1`。
- `--shareable`：内联原文引文（见 §4）。默认私有。
- 缺输入 / JSON 语法错 / 找不到文件：非零退出，并在 `supportedFixes` / stderr 里给补救步骤。

## 2. 磁盘契约

```
skills/<family>/<slug>/
  views/<slug>.view.json          # 作者（LLM）只写章节、顺序、强调；不含新事实
  views/<slug>.html               # render 产物：单文件、离线、双主题、零请求
  evidence/renders/receipt.json   # render 回执（sha256 + 字节数 + 内联来源清单）
```

## 3. `view.json` 规范形状

```json
{
  "meta": {
    "slug": "zhang-san",              // 必须与文件名 <slug>.view.json 一致
    "title": "张三 · 沟通与协作画像",   // 不能是「个人画像」这类占位词
    "subtitle": "可选副标题",
    "lang": "zh-CN",                  // en* → 英文界面文案
    "generated_at": "2026-09-13T00:00:00Z",
    "theme": "auto"                   // auto | light | dark（页面初始主题）
  },
  "sections": [
    { "id": "portrait", "kind": "claims", "title": "一句话画像", "summary": "可选",
      "items": [
        { "text": "结论一句话（不得复制原文 ≥12 字）",
          "anchors": ["k0012"], "confidence": "high", "emphasis": true }
      ] }
  ],
  "evidence": [
    { "anchor": "k0012", "source": "feishu", "kind": "message",
      "path": "knowledge/text/feishu.md", "id": "ledger-k0012",
      "at": "2024-03-02", "sha256": "…", "note": "为什么支撑该结论",
      "quote": "原文（只有 --shareable 才内联）" }
  ]
}
```

### 3.1 页面八段（顺序固定）

| # | `sections[].id` | `kind` | 默认标题 | 来源 |
|---|---|---|---|---|
| 1 | `portrait` | `claims` | 一句话画像 | 作者 |
| 2 | `communication` | `claims` | 沟通风格 | 作者 |
| 3 | `values` | `claims` | 决策与价值观 | 作者 |
| 4 | `workstyle` | `claims` | 工作方式 | 作者 |
| 5 | `relationship` | `claims` | 关系与称呼 | 作者 |
| 6 | `boundaries` | `warnings` | 边界与雷区 | 作者 |
| 7 | `timeline` | `timeline` | 时间线演变 | 作者 |
| 8 | `evidence` | — | 证据附录 | **派生**：由 `evidence[]` ∪ 正文引用的锚点渲染，不得手写 |

`kind` 只允许 `claims | timeline | warnings`（第 8 段例外：它由 `appendixEntries()` 派生）。

### 3.2 条目字段

| 字段 | 适用 | 规则 |
|---|---|---|
| `text` | 全部 | 必填，非空，建议 ≤280 字 |
| `anchors` | 全部 | 必填，≥1 个，格式 `k0012` 或 `k0012:t3` |
| `confidence` | `claims` / `warnings` 必填；`timeline` 可省 | `high | medium | low` |
| `at` | `timeline` | 必填（`date` 会被归一化为 `at`） |
| `severity` | `warnings` | 可选，`high | medium | low` |
| `emphasis` | `claims` | 可选，`true` 时加粗（顶部 `emphasis: ["voice"]` 也可） |

### 3.3 `evidence[]`（给 `ds/06-retrospect` 的接口）

| 字段 | 必填 | 说明 |
|---|---|---|
| `anchor` | ✅ | 账本锚点 id，必须能在 `knowledge/index.json` 回指；同一文档内唯一 |
| `source` | ✅ | 来源渠道：`feishu` / `slack` / `email` / `doc` / `note` / … |
| `kind` | 建议 | `message` / `email` / `doc` / `note` / `derived`；缺失只降级为 warning |
| `path` | 建议 | 相对 Skill 目录，如 `knowledge/text/feishu.md`（绝对路径 → warning） |
| `id` | 可选 | 账本条目 id（`knowledge/index.json` 的 `id`） |
| `at` | 可选 | 该锚点的时间（ISO 或原始时间串），显示在附录行 |
| `sha256` | 可选 | 来源文件 sha256，页面只显示前 12 位 |
| `note` | 建议 | 一句话说明「这条锚点为什么支撑该结论」 |
| `quote` | 可选 | 原话；**只有 `--shareable` 才会进 HTML**，私有模式下连字节都不出现 |

正文里出现的每个锚点都应当有对应的 `evidence[]` 条目：
`evidence[]` 非空时，未登记的锚点 = error（`VIEW_ANCHOR_UNKNOWN`）；
`evidence[]` 缺失/为空时 = warning（`VIEW_EVIDENCE_METADATA_MISSING`），附录仍然渲染，
未登记的锚点以「裸编号」行显示（`source: "unknown"`, `kind: "anchor"`），**不编造来源**，
并写进回执的 `unavailable[]`。

## 4. 私有 / 可分享

- **默认私有**：`buildPayload()` 直接从 payload 里删掉 `evidence[].quote` 字段，HTML 字节中不出现任何原文；
  页面只显示结论 + 锚点编号。回执 `inlined_sources: []`。
- **`--shareable`**：`quote` 内联为 `<blockquote class="quote" data-inlined="true">`，
  回执 `inlined_sources[]` 逐条记录 `{anchor, source, kind, path, quote_sha256, quote_bytes}`——
  「内联了哪些来源」可审计。
- **12 字规则**：私有模式下，`meta.title/subtitle`、`section.summary`、每条 `items[].text`
  与任何 `quote` 做「显著字符」（去掉空白与标点，只留字母/数字/汉字）n-gram 比对，
  ≥12 个连续字符命中即 `VIEW_QUOTE_LEAK`（error）。`--shareable` 时不检查（此时引文是刻意内联的）。

## 5. 宽容输入（归一化）

手工写或早期版本可能用别的词汇。`normalizeView()` 会把它改写成规范形状，
并产生**一条** `VIEW_SHAPE_NORMALIZED` warning（列出每一处替换，绝不静默）：

| 输入 | 归一化为 |
|---|---|
| 顶层 `slug` / `title` | `meta.slug` / `meta.title` |
| `headline: {text, anchors, confidence}` | `sections[0]` = `portrait`（并 `emphasis: true`） |
| `id`: `voice` / `communication_style` / `work` / `relations` / `red_lines` / `milestones` … | `communication` / `communication_style→communication` / `workstyle` / `relationship` / `boundaries` / `timeline` |
| `claims[]` / `points[]` / `warnings[]` / `entries[]` | `items[]` |
| `points[].date` | `at` |
| `timeline` 条目缺 `confidence` | `medium`（并计入 warning） |
| 顶层 `emphasis: ["voice"]` | 对应 section 的 `items[].emphasis = true` |

`kind`、`confidence`、锚点格式、锚点回指这些**语义**要求不放宽：写错就报 error 并给修复建议。

## 6. 诊断形状

每条诊断都是：

```json
{ "code": "VIEW_ANCHOR_MISSING", "severity": "error",
  "message": "sections[0].items[0] needs at least one evidence anchor",
  "subject": { "path": "sections[0].items[0].anchors", "identity": "portrait" },
  "evidence": { "observed": "undefined" },
  "supportedFixes": ["add \"anchors\": [\"k0012\"]", "never state a conclusion the ledger cannot support"] }
```

`severity=error` → 退出码 1、拒绝渲染；`warning` → 渲染继续，回执里列出。

| code | 级别 | 含义 |
|---|---|---|
| `VIEW_DOC_INVALID` | error | 顶层不是 JSON 对象 |
| `VIEW_META_MISSING` / `VIEW_SLUG_MISSING` / `VIEW_TITLE_MISSING` | error | `meta` 缺失或关键字段缺失 |
| `VIEW_SLUG_MISMATCH` | error | `meta.slug` 与文件名不一致 |
| `VIEW_TITLE_GENERIC` / `VIEW_TITLE_TOO_LONG` | warning | 标题是占位词 / 过长 |
| `VIEW_SECTIONS_MISSING` / `VIEW_SECTION_INVALID` / `VIEW_SECTION_ID_MISSING` | error | `sections` 结构问题 |
| `VIEW_SECTION_MISSING` | error | 缺某一段（八段齐全检查） |
| `VIEW_SECTION_UNKNOWN` | error | `id` 不在八段之内 |
| `VIEW_SECTION_DUPLICATE` | error | 同一 `id` 出现多次 |
| `VIEW_SECTION_DERIVED` | error | 手写了派生的 `evidence` 段 |
| `VIEW_SECTION_ORDER` | warning | 段序与固定顺序不一致 |
| `VIEW_KIND_INVALID` | error | `kind` 不是 `claims|timeline|warnings`，或与固定段不符 |
| `VIEW_SECTION_ITEMS_MISSING` / `VIEW_SECTION_EMPTY` | error | 没有条目 |
| `VIEW_ITEM_INVALID` / `VIEW_ITEM_TEXT_MISSING` | error | 条目结构/文案问题 |
| `VIEW_ITEM_TEXT_TOO_LONG` | warning | 单条 >280 字 |
| `VIEW_ANCHOR_MISSING` | error | 条目没有锚点 |
| `VIEW_ANCHOR_FORMAT` | error | 锚点不是 `k0012` / `k0012:t3` |
| `VIEW_ANCHOR_UNKNOWN` | error | `evidence[]` 非空但缺这条锚点 |
| `VIEW_CONFIDENCE_INVALID` | error | `confidence` 不在 `{high,medium,low}` |
| `VIEW_TIMELINE_AT_MISSING` | error | 时间线条目缺 `at` |
| `VIEW_SEVERITY_INVALID` | warning | `severity` 取值非法 |
| `VIEW_EVIDENCE_EMPTY` | error | 既没有锚点也没有 `evidence[]` → 第 8 段会空 |
| `VIEW_EVIDENCE_INVALID` / `VIEW_EVIDENCE_DUPLICATE` | error | `evidence[]` 条目结构/重复 |
| `VIEW_EVIDENCE_KIND_MISSING` / `VIEW_EVIDENCE_PATH_ABSOLUTE` | warning | 元数据不完整 |
| `VIEW_EVIDENCE_METADATA_MISSING` | warning | 缺整个 `evidence[]`，附录退化为裸锚点编号 |
| `VIEW_EVIDENCE_UNCITED` | warning | 有锚点没有被任何结论引用 |
| `VIEW_QUOTE_LEAK` | error | 私有模式下出现 ≥12 字连续原文 |
| `VIEW_SHAPE_NORMALIZED` | warning | 使用了宽容输入，已归一化（含替换清单） |

## 7. 模板流水线（防漂移）

```
assets/template.source.html   +   viewer/{sections,theme,export,focus}.js
        │  scripts/generate-template.mjs（固定 marker 拼接）
        ▼
assets/distilly-template.html （生成物，提交进仓库）
        │  src/views/render.mjs（把 @@DISTILLY:VIEW_DATA@@ 换成 payload）
        ▼
views/<slug>.html             （单文件、离线、双主题）
```

- marker：`<!-- @@DISTILLY:VIEWER_SECTIONS@@ -->`（theme/export/focus 同理）与 JSON script 里的
  `@@DISTILLY:VIEW_DATA@@`；缺一个、多一个、或拼接后残留未知 marker 都直接报错。
- `node scripts/generate-template.mjs --check`：模板与碎片不一致 → 打印两边 sha256 并**退出码 1**；
  `--json` 给回执。改碎片必须重新生成并提交模板，`tests/template.test.mjs` 断言了这一点。
- 生成时会拒绝会破坏页面的碎片（`</script`、`<!--`、`import/export`、`http(s)://`、`require(`）。
- 产物不变式：`<meta charset>` 只有一份、`<html>` 只有一份、CSP 正是
  `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'`、
  全文没有 `http(s)://`（因此没有外链、没有字体/图片请求）。

## 8. 确定性

- payload 用 `canonicalJson()`（递归按键排序 + 2 空格缩进），回执同样；
- 产物与回执里没有任何 `new Date()` 之类的时间戳（只用 `meta.generated_at`）；
- 因此同一输入跑两次，HTML 与 receipt 的 sha256 完全相同（`tests/views.test.mjs`、
  `tests/template.test.mjs` 都断言）。

## 9. visual-check（开发期）

```bash
DISTILLY_PLAYWRIGHT_ROOT=<含 node_modules 的目录> \
  node scripts/visual-check.mjs views/<slug>.html --out /tmp/dst-evidence/pr-03/
```

八项断言（任一项失败 → 退出码 1；PNG 只写 `--out`，默认 `/tmp/dst-evidence/pr-03/`，不入库）：

1. `console 无 error/warning`（含 pageerror、失败请求）
2. `八段非空`（`[data-section]` = 8，每段有内容，附录有锚点行）
3. `无横向溢出`（1280 / 768 / 375 px）
4. `双主题对比度`（系统深浅 + 手动切换；背景亮度必须真的翻转；采样对 ≥4.5:1）
5. `锚点可定位到附录`（每个锚点行可 `#anchor-<id>` 定位并聚焦，且有回指链接；正文引用的锚点必须都有行）
6. `零网络请求（离线 + CSP）`（除文档自身外 0 请求 + CSP meta 存在 + 无静态外链）
7. `@media print 不裁切`（八段可见、无滚动裁切、正文字符数与屏幕一致）
8. `出 PNG`（`view-light.png` / `view-dark.png` / `view-print.png` / `view-mobile-375.png`）

`playwright` 只是**开发期依赖**：缺失时脚本**响亮失败**（退出码 2 + 安装指引），运行时零依赖。

## 10. 已知缺口

- 回执固定写在 `evidence/renders/receipt.json`：同一 slug 先渲染私有、再渲染 `--shareable`，
  回执只保留最后一次。需要同时留档时请自行 `cp`（本 PR 未改契约路径）。
- `view check` 只校验 `view.json` 内部一致性；锚点能否在 `knowledge/index.json` 回指由
  `docs/v2/ACCEPTANCE.md` 的端到端验收负责（渲染层没有账本输入）。
- 页面不含富交互（无折叠、无搜索）；`export.js` 的「复制 Markdown / 下载 HTML 快照」依赖浏览器
  的剪贴板/下载能力，`file://` 下可能被浏览器策略挡住并给出状态提示。
- 手动主题覆盖记在 `localStorage`（键 `distilly-view-theme`）；某些 `file://` 配置禁用存储时
  只在当前页面视图内生效。

---
## English

The render layer ships two commands, `distilly view check` and `distilly view render`.
`view.json` carries seven authored segments (`portrait`, `communication`, `values`,
`workstyle`, `relationship`, `boundaries`, `timeline`); the eighth segment — the evidence
appendix — is derived from `evidence[]` plus the anchors the prose cites, so it can never
drift from the claims.

`evidence[]` entries are the interface with `ds/06-retrospect`:
`anchor` (required, `k0012` or `k0012:t3`, traceable to `knowledge/index.json`),
`source` (required), `kind`, `path`, `id`, `at`, `sha256`, `note`, and `quote`.

* **Private by default**: quotes are stripped from the embedded payload, so the HTML never
  contains source wording; only conclusions and anchor ids are shown. `--shareable` inlines
  quotes and records every inlined source (`anchor`, `source`, `kind`, `path`, `quote_sha256`,
  `quote_bytes`) in `evidence/renders/receipt.json`.
* **Tolerant input, strict semantics**: alternative shapes (`headline`, `claims[]`, `points[]`,
  `date`, section aliases such as `voice`/`work`/`relations`, a top-level `slug`) are normalised
  with one loud `VIEW_SHAPE_NORMALIZED` warning. Kinds, confidence values, anchor syntax and
  anchor resolution are never relaxed.
* **Every diagnostic is self-repairing**: `{code, severity, message, subject{path, identity},
  evidence, supportedFixes[]}`; errors exit 1 and block rendering.
* **The template is a build artifact**: `assets/template.source.html` plus `viewer/*.js` are
  joined through fixed markers into `assets/distilly-template.html`;
  `node scripts/generate-template.mjs --check` exits non-zero on drift.
* **Deterministic**: canonical JSON, no timestamps, so two runs produce byte-identical HTML
  and receipts.
* **visual-check** (development only, playwright) asserts eight contracts — silent console,
  eight non-empty segments, no horizontal overflow, dual-theme contrast, resolvable anchors,
  zero network requests, unclipped print layout, PNG evidence — and fails loudly when
  playwright is missing.
