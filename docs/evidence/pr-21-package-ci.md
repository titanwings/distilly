# PR-21 · 发布产物与 CI 测试命令：两个「门禁全绿但东西是坏的」缺陷

- 分支：`ds/21-package-ci`（worktree `/tmp/dot-skill-test-21`，已本地合并进 `dot-skill-test`）
- 依赖：无
- 发现方式：第 26 轮对抗式验证（独立子代理）复核"测试通过 / 发布检查 7/7"时，
  按 `package.json` 的 `files` 真的 `npm pack` 了一次，并按 CI 的原话跑了 `node --test`
- 本文纯文字，无截图；证据目录 `dst-evidence/` 不入库

## 1. 缺陷 A：npm 发布的产物跑不起来

`package.json` 的 `files` 停留在 Python 时代：

| | `files` 条目 | 存在 | 说明 |
| --- | --- | --- | --- |
| `bin/`、`SKILL.md`、`prompts/`、`references/`、`INSTALL.md`、`INSTALL_EN.md`、`LICENSE`、`CITATION.cff` | ✅ | 对 | — |
| `tools/` | ❌ | **不存在**（Node 移植后删掉了） | 误导 |
| `requirements.txt` | ❌ | **不存在** | 误导 |
| `src/` | — | **没列** | `bin/distilly.mjs` 启动就 `import "../src/cli/args.mjs"` |
| `assets/` | — | **没列** | 单文件模板与拼音表 |
| `scripts/` | — | **没列** | 与 `payloadEntries` 声明不符 |

结果：`npm pack` 出来的 tarball 只有 35 个文件 / 105.7 kB，解包后

```
$ node package/bin/distilly.mjs --version
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../package/src/cli/args.mjs'
VERSION EXIT=1
```

而 prepack 门禁对着它说 **"Distilly package payload is valid."**。原因是
`validatePayload(root = packageRoot)` 校验的是**工作树**（工作树里当然什么都有），
`payloadEntries` 甚至已经把 `src`/`assets`/`scripts` 列全了 —— 门禁检查的是它自己那份
清单，而不是 npm 真正会打包的那份（`package.json` 的 `files`）。

`.github/workflows/publish-package.yml` 会把这个 tarball 原样发出去。

### 修法（三层，缺一层同类问题还会再来）

1. **`package.json`**：`files` 换成 `bin/ src/ assets/ scripts/ SKILL.md prompts/ references/` + 四份文档；
   `engines` 从 `>=18` 改成 `>=20`（CI 矩阵与契约都是 20/22）。
2. **`bin/distilly.mjs` 的 `validatePayload`**：在原有"路径都得在"之外，新增两条
   - `package.json` `files` 里每个条目都必须存在（挡住 `tools/`、`requirements.txt` 这类陈旧条目）
   - `payloadEntries` 里每个路径都必须被某个 `files` 模式**覆盖**（挡住漏掉 `src/`），
     目录模式 `src/` 视为覆盖其下全部，通配符按 `*` 不跨分隔符、`**` 跨分隔符展开

   两条都给出可执行的 remedy。门禁从"描述工作树"变成"描述 tarball"。
3. **`scripts/check_release.mjs` 新增第 7 条**：真的 `npm pack` → 解包 → 跑
   `bin/distilly.mjs --version`，并断言 `src/cli/args.mjs`、`src/commands/index.mjs`、
   `assets/distilly-template.html`、`SKILL.md` 都在包里。**这是原来完全缺失的那一环**：
   其余检查读的都是工作树。

改动前后（同一份缺陷 manifest 喂给新门禁）：

| | before | after |
| --- | --- | --- |
| `--check-package`（工作树完好，`files` 缺 `src/`） | exit 0，`payload is valid` | exit 1，``Error: package.json `files` would omit required paths: src`` + ``Remedy: add "src/"`` |
| `--check-package`（`files` 含 `tools/`） | exit 0 | exit 1，``names paths that do not exist: tools, requirements.txt`` |
| `npm pack` 产物 | 35 文件 / 105.7 kB，`--version` exit 1 | 445 kB，`--version` → `1.0.0` |
| `check_release.mjs` | 7/7（看不见产物） | 8/8（第 7 条就是产物本身）；缺陷 manifest 下 7/8 且错误信息点名 `tools, requirements.txt` |

## 2. 缺陷 B：CI 的单元测试步骤是红的

`.github/workflows/ci.yml:30` 跑的是**裸** `node --test`，`package.json` 的
`scripts.test` 同样是裸 `node --test`。Node 的默认发现规则包含 `**/*-test.mjs`，
于是 `scripts/blind-test.mjs` 被当成测试文件收集：以无参数方式 spawn → 按契约打印用法
→ exit 2 → 被记成 **1 个失败测试**。

```
$ node --test          # 与 CI:30、npm test 完全一致
not ok 1 - scripts/blind-test.mjs
# tests 379  # pass 378  # fail 1
node --test EXIT=1
npm test    EXIT=1
```

CI 的 `test` job 在 Node 20 与 22 两个 leg 上都是红的。之所以一直没被发现，是因为
本地一直用 `node --test tests/*.test.mjs`（带 glob）验证 —— 那条命令不会收集
`scripts/`，所以 378/378 全绿。**我此前汇报的"378/378 通过"用的是带 glob 的那条，
不是 CI 实际跑的那条**；这个差别本身就是缺陷的一部分。

### 修法

1. **`package.json`** `scripts.test` → `node --test "tests/*.test.mjs"`（显式指明套件在 `tests/`）。
2. **`ci.yml`** 单元测试步骤 → `run: npm test`，与 `package.json` 同一条命令，不会再漂移。
3. **`scripts/blind-test.mjs`** 增加"被测试运行器收集"时的空操作分支：Node 在它 spawn 的
   每个文件里设置 `NODE_TEST_CONTEXT`，配合"且没有子命令参数"这个条件即可精确识别
   （只看环境变量不行 —— 它会被孙进程继承，`tests/blind-test.test.mjs` spawn 的真实调用会被一起静默）。
4. **`tests/package-payload.test.mjs`** 钉死 `ci.yml` 必须 `run: npm test`、
   `scripts.test` 必须是指明 `tests/` 的字符串，且 `engines` 与 CI 矩阵一致。

| | before | after |
| --- | --- | --- |
| `npm test`（= CI 的命令） | 379 / 378 pass / **1 fail**，exit 1 | **392 / 392 pass**，exit 0 |
| `node --test`（裸跑） | 同上，exit 1 | 393 / 393 pass，exit 0 |
| `node scripts/blind-test.mjs`（直接跑） | 用法 + exit 2 | 不变（契约没动） |

## 3. 修 A 的过程中发现的缺陷 C：入口守卫在符号链接下静默不执行

`bin/distilly.mjs` 原本没有入口守卫（`import` 它就会跑 `main()`），为了能对
`validatePayload` 做单元测试，我加了守卫 —— 第一版写成：

```js
const isEntryPoint = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
```

新加的第 7 条发布检查立刻失败了：解包出来的 bin 打印的是空字符串。
原因是 **`import.meta.url` 永远是 realpath，而 `argv[1]` 是调用方写下的路径**。
`npm pack` 的产物解在 `/tmp/...` 下，而 macOS 上 `/tmp` 是 `/private/tmp` 的符号链接，
两者不相等 → 守卫判定"我是被 import 的" → **什么都不做，exit 0**。

这不是边角情况：

- macOS 上 `/tmp`、`/var` 都是符号链接
- **npm 的 `bin` shim（`node_modules/.bin/distilly`）本身就是符号链接**，所以发布出去的
  CLI 会对每一条命令静默地什么都不做

而且这个写法**早就存在**于 `scripts/blind-test.mjs:780`。用未改动的 `/tmp/dst` 复现：

```
$ node /tmp/dst-link/scripts/blind-test.mjs score --scores /nonexistent.json
EXIT=0        ← 0 且无输出，命令被静默丢弃
```

（同一文件用相对路径或在真实路径目录下跑就正常，所以一直没暴露。）

### 修法

新增 `src/cli/entry.mjs` 的 `isEntryPoint(moduleUrl)`，两侧都取 `realpathSync`；
`bin/distilly.mjs`、`scripts/blind-test.mjs`、`scripts/visual-check.mjs` 三处守卫统一改用它
（`visual-check.mjs` 用的是 `pathToFileURL(argv[1]).href === import.meta.url`，同样的问题）。
`tests/entry-point.test.mjs` 用临时目录里的符号链接实跑三个入口，断言它们**真的产生了输出**
（"exit 0 但什么都没做"和"真的做完了"必须能区分开）。

`bin/distilly.mjs` 顺带因此变得可 import（测试能直接 `import { validatePayload }`），
这也是 `tests/package-payload.test.mjs` 能精确覆盖四种 manifest 失败模式的前提。

## 4. 测试结果

```
$ npm test                                    # CI 的同一条命令
# tests 392 / pass 392 / fail 0                exit 0
$ node --test                                 # 裸跑
# tests 393 / pass 393 / fail 0                exit 0
$ node --test tests/package-payload.test.mjs  # 新增 10 条
$ node --test tests/entry-point.test.mjs      # 新增 4 条
$ node scripts/check_release.mjs              # 7/7 → 8/8
$ node scripts/audit-objective.mjs --skip-acceptance   # 17/17
$ DISTILLY_PLAYWRIGHT_ROOT=... node scripts/acceptance.mjs --evidence /tmp/acc21
验收结果：20/20 通过
$ node scripts/prompt-lint.mjs                # 0 findings（26 文件）
$ node scripts/generate-template.mjs --check  # 无漂移 sha256 d85dbfb4…
```

测试数 378 → 392（新增 `tests/package-payload.test.mjs` 10 条、`tests/entry-point.test.mjs` 4 条）。

## 5. 已知缺口（本 PR 不含，已另外记账）

- **审计门禁里两条恒真行**：`audit-objective.mjs` 在 `--skip-acceptance` 时把验收那条硬编码为
  `true`，推送那条也无条件 `true`。前者是设计（验收在另一个 CI job 里跑），后者是为了让
  外部冻结不把审计染红 —— 但"17/17 满足；已知缺口 2 条"这样的措辞确实容易被读成
  "全都满足了"。属于措辞问题，不是检查能力问题。
- **陈旧 Python 元数据**：`.github/PULL_REQUEST_TEMPLATE.md` 还教人跑
  `python -m unittest discover`、`.github/ISSUE_TEMPLATE/bug_report.md` 还在问 Python 版本、
  `scripts/parity.mjs` 还要 `python3` 且默认 rev 在当前树里没有 `tools/`。
- **CLI 帮助不一致**：`src/commands/retrospect.mjs` 把 `--dir` 说成"skills 根目录"，实际是
  人物目录；英文帮助里没有 `--dir`；同时给 `--person` 与 `--dir` 时 `--dir` 静默胜出。
- **账本里 turn 锚点的 `file` 字段是裸文件名**（段落锚点是可解析的 `raw/...` 路径）。
  当前无害（`locations.raw` 才是指针，派生输出引用 0 个 turn 锚点），但消费者按
  `anchor_detail[].file` 解析会失败。

## 6. 更正：这一版把 CI 修绿了吗？没有

本节是事后补记，事实与上面的结论相反，保留原文以便对照。

上面把 `scripts.test` 定成 `node --test "tests/*.test.mjs"`，并在本机（Node 22）验证
通过。**CI 从建立起没有一次是绿的**：那次改动之后 30 次运行仍然全部 failure。
两个原因，都不是产品代码：

1. **引号让 glob 到不了 Node 20。** shell 不会展开带引号的 glob，而 Node 20 的
   `--test` 只接受字面路径（不支持 glob），Node 20 那条腿直接
   `Could not find '…/tests/*.test.mjs'` 退出；Node 22 支持 glob，所以本机永远绿。
   矩阵里同时有 20 和 22，CI 必红。
   更要命的是有一条测试把这个坏字符串**钉死**了：
   `assert.equal(manifest.scripts.test, 'node --test "tests/*.test.mjs"')` ——
   断言一条命令的**文本**不等于断言它能跑。
   现在用不加引号的 `node --test tests/*.test.mjs`，并改为断言：不是裸 `node --test`、
   参数里没有引号、每个参数都能对上真实文件。
   （`node --test tests/` 也不行：Node 20 认目录，Node 22 把位置参数当 glob、拿目录
   当模块，报 `Cannot find module '…/tests'`。）

2. **目标审计在 CI 里直接崩，而不是报告。** 推送行的
   `rev-parse --verify --quiet` 包在会抛异常的 `git()` 里，ref 不存在时 git 以 1
   退出且无输出，于是这一行 —— 本该报告"这个分支不在任何远端上"的那一行 —— 把整个
   审计抛崩（CI 日志里 stdout/stderr 全空）。CI 的 checkout 本来就没有
   `origin/dot-skill-test` 跟踪 ref，所以每次必崩。现在 ref 探测用不抛异常的
   `gitRef()`；CI 里这一行记为缺口并写明理由，本地仍严格。

修掉这两个之后，测试才**第一次真的在 CI 里跑起来**，于是又露出两条一直藏着的
"只在开发机上通过"的测试：

3. `tests/feishu-mcp.test.mjs` 的两条 CLI 路由测试不传 env，`loadCredential` 于是
   回落读 `~/.colleague-skill/feishu_config.json` —— 我本机上那份改名前的旧凭据。
   CI 上没有它，必红。同一文件里"缺凭据要响亮失败"那条早就为此隔离过 HOME，这两条
   漏了。
4. `knowledge/raw/slack/C0123-p001.json` 这条断言：`writeRaw` 会把名字过一遍
   `slug()`，落盘其实叫 `c0123-p001.json`。macOS 的 APFS 大小写不敏感，所以本机
   "通过"；Linux runner 一眼就红。

第 1、2 条修完后 CI 仍未绿，正是第 3、4 条挡着 —— 它们只有在 CI 真的执行测试时
才会现身。第 2、3、4 条是同一个教训的三种形状：**本地绿说明不了任何事，除非本地与
CI 的差异（Node 版本、环境变量、大小写不敏感的文件系统、开发机上的历史文件）被
显式消掉。**

补记后的验证（全部在 CI 上）：

```
Node 20       success
Node 22       success
Acceptance    success   ← 三个 job 全绿，本仓库第一次
```
