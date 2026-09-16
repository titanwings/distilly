# PR-12 · 飞书三路补齐 + `note`：CONTRACT §1 命令面完成

- 分支：`ds/11-feishu-clients`（3 个原子提交）与 `ds/12-note`（1 个），都已本地合并进 `dot-skill-test`
- 交付：`src/collect/feishu-mcp.mjs`、`src/collect/feishu-browser.mjs`、`src/commands/note.mjs`、
  `src/collect/feishu.mjs`（逐页归一化）、`src/parse/feishu.mjs`（开放平台消息页）、
  `src/parse/chat.mjs`、`src/knowledge/ledger.mjs`、`src/consent.mjs`、
  `tests/{feishu-mcp,feishu-browser,note,collect,parse-feishu}.test.mjs`
- **不 push**（用户暂停推送）；截图与命令留档：`dst-evidence/screenshots/pr-12-feishu-routes/`

## 1. 采集到的语料现在能派生（改动前后，可复算）

`collect feishu` 原来只写 `knowledge/raw/feishu/*.json` + 自己的账本条目：数据落盘了，
但 `knowledge/text/*.md` 里什么都没有——而那是派生层唯一读的东西。**凭据渠道采到的语料
蒸馏不了**，证据脊柱在 raw 桶就断了。

同一页飞书消息（12 条有正文），改动前 = worktree `/tmp/dst-pre-collect`（`15bf6c3`）：

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 采集产物 | `raw` 一页 | `raw` + `text/feishu.md` |
| 账本条目 | 1 条 raw（无 `locations.text`、无锚点） | **1 条同时带 raw 与 text**，24 个锚点 |
| `retrospect` 回指 | 0 / 0 | **10 / 24** |
| 派生结论 | 全 0（7 个文件） | stats 6 / relations 4 / timeline 4 / voice 5 |

（3 条消息的小页在改动后仍 `cited 0`：低于 `retrospect` 的最低样本数 8，
回执照旧给"样本不足"的理由，不硬凑。）

## 2. 飞书三条路各自负责什么

| 路 | 命令 | 谁在做 | 关键纪律 |
| --- | --- | --- | --- |
| 开放 API | `collect feishu --chat-id <oc_…>` | 本模块（tenant/user token） | 逐页一个条目，raw 逐字 + text 带锚点；解析不了的页仍然落 raw 并在 warnings 点名 |
| MCP | `collect feishu --mode mcp --url <文档>｜--chat-id <oc_…>` | 本模块经 `npx -y feishu-mcp --stdio` | transport 可注入（无 npx/租户/网络即可测）；**工具白名单封闭**；凭据只进子进程环境、不进 argv；回执只可能出现配置文件名 |
| 浏览器 | `collect feishu --mode browser --consent <token> --capture <文件>` | **宿主**在 computer use 下抓取 | 无同意 → exit 2「waiting-for-user-consent」且零文件；无 `--capture` → 回 `awaiting-host-capture` + 逐步计划；有 capture → 逐字落盘 + 去标签归一化（标 synthetic、不伪造字节区间），条目带 `provenance: host-reported` 与 `consent` |

**为什么浏览器一路不是 Playwright**：`tools/feishu_browser.py` 用 Playwright 驱动用户本机
Chrome（复用登录态）。v2 把"驱动浏览器、注入输入"归为 computer use，属于宿主职责，
必须走显式同意（与 `collect x --mode browser` 同一套设计，CONTRACT §4）。
所以移植的是流水线真正拥有的部分——同意门、计划、逐字落盘、归一化——浏览本身留给宿主。
测试里有一条策略断言：源码不含 `playwright`/`puppeteer`/`page.click|type|fill|goto`。

## 3. `note`：最后一条契约命令

`note --from <file|->` 是唯一"材料从未以文件形式存在"的入口：宿主读了页面/PDF/截图并理解了它。

- 正文按原样入库（raw 逐字 + text 带锚点，锚点指回 raw 字节）；
- 条目 `method: "model-read"`、`credentialed: false`，回执与条目 warnings 都写明
  `this text was written by a model that read the source material; it is model-mediated,
  not a first-hand capture`——**不许下游当成一手采集**；
- `--from -` 读 stdin；空输入 exit 1 且不产生条目；同一段文字重复登记幂等；
- `PLANNED` 因此清空，`doctor` 的未实现行改为
  `none — every command in CONTRACT §1 is implemented`。

## 4. 这一轮修掉的缺陷

| 缺陷 | 现象 | 修法 |
| --- | --- | --- |
| 采集页不能被重放 | `harvest <存下来的原始页>`（最自然的复算方式）回执只说 `format feishu-api has no parser`：只落 raw、无 text、派生全 0 | `parseChat` 的分发表补上 `feishu-api` case + 回归断言 |
| 凭据来源丢失 | 走 `recordDocument` 的条目丢了 `credential_source`/`credential_file`（只有采集器手工构造的 raw 条目才有） | `buildEntry` 带上这两个字段（只可能是文件名，永不含值） |
| 同意提示串渠道 | 任何渠道的补救文案都写 `collect x --mode browser` | 按 scope 里的渠道名生成（`collect:feishu:browser` → `collect feishu …`） |
| 渲染失败被 ENOENT 掩盖 | `blind-test finalize` 渲染失败后仍去读 `profile.html`，真实原因埋在诊断里（本轮被误导过一次） | 无产物就抛错并逐条列出渲染诊断 |

## 5. 怎么验

```bash
node --test tests/*.test.mjs           # 340 pass / 0 fail（33 个文件）
node scripts/prompt-lint.mjs           # 0 findings
node scripts/generate-template.mjs --check
DISTILLY_PLAYWRIGHT_ROOT=/tmp/audit-mcp node scripts/acceptance.mjs   # 20/20
node scripts/visual-check.mjs <页面>   # 8/8（本轮页面见 pr-12 截图目录）
```

新增测试 22 条：`feishu-mcp` 8、`feishu-browser` 7、`note` 6、采集归一化 1（`collect`）。

## 6. 已知缺口（更新）

- **发送者名字**：开放平台消息页只带 `sender.id`，名字要另调通讯录 API。归因如实写 id 并在
  warnings 说明"这次没调通讯录"，不假装有名字。MCP 一路是否返回名字取决于 `feishu-mcp` 的实现。
- **MCP 覆盖面**：`--url` 支持 wiki/docx/docs/sheets；`base`（多维表格）没有对应工具，
  按名字拒绝并给出理由。
- **浏览器一路是"宿主转述"**：`provenance.confidence` 明确写 `host-reported`，
  它不是"我们验证过的登录态"。页面上被抓到的内容质量取决于宿主的抓取。
- 派生层仍有池化口径未拆分：标点密度与 `shifts`（句长已按说话人分列，见 PR-11）。
- `scripts/parity.mjs` 需要一份迁移前的 rev 才能跑（历史证据，不是日常门禁）。
