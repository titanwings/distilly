# PR-03 渲染层证据（`ds/03-render`）

纯文字证据。截图/PNG **不入库**，见 §6；本文件只记录数值、命令与结果。

## 1. 变更摘要

单文件 HTML 渲染层：模板是生成物、八段页面、双主题、默认私有、`view check` 结构化诊断、
`view render` 确定性产物 + 回执、Playwright visual-check 八项。

| commit | 内容 |
|---|---|
| `feat(view): add the page template fragments and viewer runtime` | `assets/template.source.html`、`viewer/{sections,theme,export,focus}.js` |
| `feat(view): generate the single-file template from fragments` | `scripts/generate-template.mjs` + 生成物 `assets/distilly-template.html` |
| `feat(view): validate view.json against the v2 contract` | `src/views/schema.mjs`（八段/kind/锚点/confidence/12 字原文 + 诊断形状 + 宽容归一化） |
| `feat(view): render a view.json into a single-file HTML page` | `src/views/render.mjs`（payload 注入、回执、确定性、离线校验） |
| `feat(cli): register view check and view render` | `bin/distilly.mjs` 增加 `view` 子命令（最小注册，见 §8 缺口 1） |
| `chore(view): add the playwright visual check script` | `scripts/visual-check.mjs` |
| `test(view): cover schema diagnostics, rendering and template drift` | `tests/views.test.mjs`、`tests/template.test.mjs` |
| `docs(view): document the render layer contract` | `docs/v2/RENDER.md` |
| `docs(evidence): record the pr-03 render evidence` | 本文件 |

未触碰 `src/parse/**`、`src/knowledge/**`、`src/skill/**`、`src/install/**`、`SKILL.md`、`prompts/**`；
未修改 `docs/v2/CONTRACT.md`。

## 2. 测试命令与结果

```
$ node --test tests/views.test.mjs tests/template.test.mjs
# tests 44
# pass 44
# fail 0
# duration_ms 710.41
```

- `tests/views.test.mjs`（35 项）：schema 正/反例、诊断形状逐字段断言、12 字原文边界（11 字不算、12 字算）、
  `--shareable` 放行、锚点格式/回指、宽容形状归一化（含幂等）、确定性（两次渲染字节相同）、
  私有产物不含引文、`--shareable` 产物含引文且回执记录 `inlined_sources[]`、
  CLI `view check/render --person --json` 与退出码。
- `tests/template.test.mjs`（9 项）：模板 = 碎片构建结果（字节相同）、`--check` 干净退出 0、
  **碎片改了但模板没重生成 → 非零退出**（在临时目录里改 `viewer/sections.js` 后断言 exit 1，
  重新生成后回到 0）、marker 缺失/重复报错、`</script>` 碎片被拒、产物单文件 + CSP + 无 `http(s)://`、
  两次渲染字节相同。

## 3. 产物大小与 sha256

| 文件 | 字节 | sha256 |
|---|---|---|
| `assets/distilly-template.html`（生成物） | 41673 | `cb88a172694f31eb970d8f323ffefc1a13319d8aa17c84705ead959d1c738798` |
| `assets/template.source.html` | 10955 | `483189a41f196c7434aa359881a5c34a265db9d25fea3744aa788a776225f1db` |
| `viewer/sections.js` | 15585 | `80967985aee069058589ac5dff5ce4b5aada3b9af40cf6b5039753700017aaa7` |
| `viewer/theme.js` | 4073 | `3f9e73ee72a3dfbf4ca22e5b14551458b1b7251750e6740ab2db04a99bfc474a` |
| `viewer/export.js` | 6323 | `5eab79b4ceb5f3dabb5a4841c63c1f736bc3a64afdc0528b39fdb6900bccb06f` |
| `viewer/focus.js` | 4592 | `5a17e146cb6a1044ae94d9928cb5bb7198bcd1e2c672dd5d33e656e1a9456c91` |

示例人 `zhang-san`（fixture 在 `/tmp/dst-fixture`，不入库；8 个锚点、18 条结论）：

| 产物 | 字节 | sha256 |
|---|---|---|
| `views/zhang-san.html`（默认私有） | 48338 | `2a0ace948a6027dfec12c77e0052c5c0f035fa3742a39fedb7ec47c9e9f46db0` |
| `views/zhang-san.shareable.html`（`--shareable`） | 49244 | `782118192556b49188bfd97da733e389947dc6be0e8bb6b010f9002581b5b9e1` |
| `evidence/renders/receipt.json`（私有运行） | 1505 | `d4aea409510c0535258266b46dd0726890cce5eac6a95109c8e4cdd1ceac911d` |
| `evidence/renders/receipt.json`（shareable 运行） | 3450 | `651cdd69f131d3c6130698211a8934a9456ce8bf7340df3ed770e27901906ba4` |
| 验收语料形状 `lin-gong.html`（无 `meta.slug`/无 `evidence[]`） | 46402 | `cce9cdb8c850da34917b430ec462e8c370f6adb0ce605733f933ae1477bdba4e` |

确定性：同一输入连续两次 `view render`，HTML 与 receipt 的 sha256 均不变（单元测试与 §4 手工各验一次）。
私有 HTML 中检索三条引文均**不存在**；`--shareable` HTML 中三条全部存在，且
`receipt.inlined_sources[]` 长度 8（每条含 `anchor/source/kind/path/quote_sha256/quote_bytes`）。

## 4. visual-check 八项（手工跑）

命令：

```
DISTILLY_PLAYWRIGHT_ROOT=<含 node_modules 的目录> \
  node scripts/visual-check.mjs <html> --out /tmp/dst-evidence/pr-03/
```

对三个页面各跑一次，均 **exit 0、8/8 通过**；下面逐条列出私有示例页的结果（`--json` 回执在 `/tmp/vc-private.json`）。

| # | 项 | 结果 | 数值 |
|---|---|---|---|
| 1 | console 无 error/warning | ✅ | 0 条 console / 0 个 pageerror / 0 个失败请求 |
| 2 | 八段非空 | ✅ | 8 段 / 26 条 / 附录 8 锚点 |
| 3 | 无横向溢出 | ✅ | 最大溢出 0px @ 1280/768/375px |
| 4 | 双主题对比度 | ✅ | 最小对比度 6.00:1；背景亮度 light 1.0 → dark 0.0118；`light→dark` 手动切换生效 |
| 5 | 锚点可定位到附录 | ✅ | 8/8 个锚点可聚焦（含回指链接），正文引用无悬空 |
| 6 | 零网络请求（离线 + CSP） | ✅ | 0 个外部请求 / 静态外链 0 个 / CSP 存在 |
| 7 | `@media print` 不裁切 | ✅ | 8 段可见 / 正文 1450 字符（与屏幕一致）/ 溢出 0px |
| 8 | 出 PNG | ✅ | 4 张 → `/tmp/dst-evidence/pr-03` |

另两个页面（同一套断言，逐条全绿）：

- `legacy`（`lin-gong`，验收脚本的 `view.template.json` 形状 + 无 `evidence[]`）：8 段 / 14 条 / 7 锚点，
  最小对比度 6.00:1，0 外部请求。
- `shareable`（`zhang-san`）：8 段 / 26 条 / 8 锚点，附录内联 8 条引文，最小对比度 6.00:1。

**负向对照**（证明断言真的会失败，不是恒真；输出在 `/tmp/dst-tamper-out/`）：

| 篡改 | 退出码 | 失败项 |
|---|---|---|
| 删除 CSP meta | 1 | 零网络请求（离线 + CSP） |
| 注入 `https://` 外链 CSS | 1 | console 无 error/warning、零网络请求 |
| payload 删除时间线段 | 1 | 八段非空、锚点可定位到附录、print 不裁切 |
| 亮色 `muted` 改成近背景色 | 1 | 双主题对比度 |
| 暗色 `muted` 改成近背景色 | 1 | 双主题对比度 |
| 手动暗色覆盖失效（`color-scheme` 打回 light） | 1 | 双主题对比度 |
| 正文引用一个没有附录行的锚点 | 1 | 锚点可定位到附录 |
| 原始页面（对照组） | 0 | — |

其中「亮/暗 muted 低对比度」与「手动覆盖失效」两组对照是发现真实缺陷后补的：
最初 `:root { color-scheme: light }` 把 `light-dark()` 钉死在亮色，导致深色页面根本没变色，
而对比度断言仍然全绿；现在 theme 断言额外比较**实际背景亮度**（light 1.0 / dark 0.0118），
并断言手动切换必须覆盖系统偏好。

## 5. 其他手工验证

```
$ node scripts/generate-template.mjs --check
template is up to date: sha256 cb88a172… (41673 bytes, 4 fragments)   # exit 0

$ node bin/distilly.mjs view check zhang-san --root /tmp/dst-fixture
view check ok: 7/8 segments, 18 items, 8/8 anchors cited, 0 warning(s)

$ node bin/distilly.mjs view check --person lin-gong --root /tmp/dst-legacy --json   # 验收调用形式
{"command":"view check","person":"lin-gong","ok":true,...,"anchors":{"total":7,"cited":7}}
```

- 指纹/大小一致性：`receipt.outputs[0].sha256` 与实际 HTML 文件 sha256 相同（`tests/views.test.mjs` 断言）。
- 产物检索 `http://` / `https://` / `<script src=` / `<link href=` / `@import` 均为 0 命中（CSP 之外无任何外链）。

## 6. 截图（不入库）

目录 `/tmp/dst-evidence/pr-03/`（`.gitignore` 已含 `dst-evidence/`）：

| 文件 | 字节 | 说明 |
|---|---|---|
| `view-light.png` | 469961 | 私有示例页 · 系统浅色 · 1280px 全页 |
| `view-dark.png` | 470750 | 私有示例页 · 手动深色 · 1280px 全页 |
| `view-print.png` | 382689 | 私有示例页 · `@media print` 模拟 |
| `view-mobile-375.png` | 424072 | 私有示例页 · 375px |
| `shareable/view-*.png` | 478377–563528 | `--shareable` 页面（附录内联 8 条引文） |
| `legacy/view-*.png` | 217429–277492 | 验收语料形状页面 |

## 7. 已知缺口与未验证项

1. **`bin/distilly.mjs` 是"最小注册"**：`dot-skill-test`（05ff594）上 ds/01 的通用命令注册器还没落地，
   所以 `view` 子命令直接写在 `bin/distilly.mjs` 现有的 if/else 链里（带 `NOTE(ds/03-render)` 注释）。
   ds/01 合并后应把 handler 搬进注册器；`src/views/*.mjs` 的接口不需要改。
   `--help` 的 `view` 段是中文段 → `---` → `## English` 两段，没有动全局 help。
2. **回执路径会被覆盖**：契约固定 `evidence/renders/receipt.json`，同一 slug 先私有后 `--shareable`
   只保留最后一次；需要留档要自己 `cp`（本 PR 未改契约路径）。
3. **锚点回指未在渲染层校验**：`view check` 只校验 `view.json` 内部一致性；
   「锚点能在 `knowledge/index.json` 回指」由 `scripts/acceptance.mjs` 端到端负责（渲染层不读账本）。
4. **宽容形状是新增的**：`tests/fixtures/public-corpus/.../view.template.json` 用的是
   `headline` / `claims[]` / `points[]` / `date` / 顶层 `slug` / 无 `evidence[]` 的形状，
   与 `docs/v2/RENDER.md` 的规范形状不同。渲染层做了归一化（一条 `VIEW_SHAPE_NORMALIZED` warning +
   `VIEW_EVIDENCE_METADATA_MISSING` warning + 回执 `unavailable[]`），验收能过；
   但**建议**把 fixture 或 ACCEPTANCE.md 统一到规范形状，否则「规范化 warning」会长期存在。
5. **`npm test` 尚未汇总**：`package.json` 没有 `test` 脚本（属 ds/01 范围），本 PR 用
   `node --test tests/views.test.mjs tests/template.test.mjs`。package.json 的 `files[]` 也还没包含
   `assets/`、`viewer/`、`src/`，所以 npm 包暂时不带渲染层。
6. **playwright 未写进 `devDependencies`**：为避开与 ds/01 改同一个 `package.json` 的冲突，
   本 PR 没有动它；缺 playwright 时 visual-check **响亮失败**（exit 2 + 安装指引），
   也可用 `DISTILLY_PLAYWRIGHT_ROOT=<含 node_modules 的目录>` 指定位置。
7. **未验证项**：真实浏览器 Firefox/Safari 未跑（只有 Chrome + Playwright）；`file://` 下的
   localStorage 剪贴板/下载路径未做自动化断言；打印断言基于 `emulateMedia('print')` 的布局，
   没有比对真实 PDF 分页。

## 8. 回滚

- 纯新增 + `bin/distilly.mjs` 一处 `else if (args[0] === "view")` 分支：回滚 = 撤销这些 commit，
  或直接 `git revert <commit>...`；不影响任何既有命令（`install` / `--check-package` / `--version` / `--help`）。
- `assets/distilly-template.html` 是生成物：回滚碎片后跑一次 `node scripts/generate-template.mjs` 即可复原。
- 没有数据库/迁移/外部状态；没有提交任何截图或凭据。

## 9. 给 `ds/06-retrospect` 的接口

`views/<slug>.view.json` 里 `evidence[]` 数组，每个元素期望字段（详见 `docs/v2/RENDER.md` §3.3）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `anchor` | ✅ | 账本锚点 id，`k0012` 或 `k0012:t3`；必须能在 `knowledge/index.json` 回指 |
| `source` | ✅ | 来源渠道（`feishu`/`email`/`doc`/`note`/…），显示为附录徽标 |
| `kind` | 建议 | `message`/`email`/`doc`/`note`/`derived` |
| `path` | 建议 | 相对 Skill 目录（如 `knowledge/text/feishu.md`） |
| `id` | 可选 | 账本条目 id |
| `at` | 可选 | 锚点时间，显示在附录行 |
| `sha256` | 可选 | 来源文件 sha256（页面只显示前 12 位） |
| `note` | 建议 | 一句话说明该锚点为什么支撑对应结论 |
| `quote` | 可选 | 原话；**私有模式不会进 HTML**，只有 `--shareable` 内联并写进回执 |

约定：正文每个锚点都应在 `evidence[]` 里有条目 —— 有 `evidence[]` 时未登记锚点是 **error**；
`evidence[]` 整体缺失时是 warning，附录退化为裸锚点编号（`source: "unknown"`, `kind: "anchor"`），
并在回执 `unavailable[]` 里说明。
