# PR-20 · 仓库忽略规则：把用户数据、凭据与本地证据的边界补回来

- 分支：`ds/20-repo-hygiene`（worktree `/tmp/dot-skill-test-20`，已本地合并进 `dot-skill-test`）
- 依赖：无
- 发现方式：第 26 轮对抗式验证（独立子代理）复核「截图不入库 / 无 Python 残留」时，
  顺手 `git check-ignore` 了真实使用会产生的路径，发现 `.gitignore` 只剩 10 行
- 本文纯文字，无截图；证据目录 `dst-evidence/` 不入库

## 1. 缺陷

`.gitignore` 在 v2 期间被一次**合并**整段替换。提交历史里它的行数：

| 提交 | 行数 | 说明 |
| --- | --- | --- |
| `6a0b31a` | 27 | AgentSkills 目录结构重构 |
| `653a5a6` | 34 | dot-skill 引擎文件回归 |
| `05ff594` | 40 | 冻结 v2 契约，追加 `dst-evidence/`、`*.evidence.local` |
| `07d1ba5` | **43** | 合成账本夹具，追加 fixtures 的 `knowledge/` 例外 |
| （某次合并） | **5** | 只剩 knowledge 相关规则 |
| `06cea58` | 10 | 追加 `!src/knowledge/**`（本意是 +5 行的补充提交） |
| `238f9b8`（HEAD） | 10 | 一直是 10 行 |

`06cea58` 的提交信息写的是"例外必须写在排除规则之后"，但它基于的父提交已经只剩 5 行，
所以它**补不回**丢掉的东西。丢失的规则：

- `skills/*` + 三个 example 白名单 —— **真实人物的档案**（文件头第一行就是
  `# Generated Distilly outputs (user data, not committed)`）
- `.distilly/`、`.colleague-skill/` —— **凭据配置**
- `playwright-data/` —— 本地浏览器 profile
- `.DS_Store`、`Thumbs.db` —— OS 文件
- `dst-evidence/`、`*.evidence.local` —— 契约 §4 要求的"截图不入库"机制

### 为什么一直没被发现

三条门禁都只看**已经跟踪的东西**，而这次丢的是"以后会被创建的东西"：

- `git status` 干净 —— 因为没人真的在仓库里跑过 `harvest`
- `audit-objective.mjs` 第 10 条只查 `git ls-files` 里有没有证据图片 → 0 张，通过
- `check_release.mjs` 不查忽略规则

## 2. 改动前 → 改动后（可复算）

复现：在仓库里造出真实使用会产生的文件，然后看 `git status`。

```bash
mkdir -p skills/colleague/real_person/knowledge/text skills/colleague/real_person/views \
         .distilly playwright-data dst-evidence/screenshots
echo '{"name":"真人"}'                        > skills/colleague/real_person/meta.json
echo '{"api_key":"sk-live-DEADBEEF"}'        > .distilly/config.json
echo 'cookie'                                > playwright-data/state.json
touch .DS_Store
echo png                                     > dst-evidence/screenshots/real-person-profile.png
git status --porcelain
```

| | before（`238f9b8`） | after（本分支） |
| --- | --- | --- |
| `git status --porcelain` | `?? .DS_Store`、`?? .distilly/`、`?? dst-evidence/`、`?? playwright-data/`、`?? skills/colleague/real_person/` | 空（只剩 `.gitignore` 自己的修改） |
| `git add -A` 会收进 | `.DS_Store`、`.distilly/config.json`（**明文 API key**）、`dst-evidence/screenshots/real-person-profile.png`、`playwright-data/state.json`、`skills/colleague/real_person/meta.json` | 无 |
| 反向误伤 | `src/knowledge/**`、`skills/colleague/example_*`、夹具 `knowledge/` 均可见 ✅ | 同样全部可见 ✅ |

`origin/dot-skill`（默认分支）上这些路径**全部**被忽略，`git status` 为空 —— 所以这是
v2 分支引入的**回归**，不是"本来就没管"。

逐条命中的规则（after）：

```
skills/colleague/real_person/meta.json             .gitignore:4:skills/colleague/*	
skills/colleague/real_person/knowledge/text/a.md   .gitignore:4:skills/colleague/*	
.distilly/config.json                              .gitignore:21:.distilly/	
playwright-data/state.json                         .gitignore:26:playwright-data/	
.DS_Store                                          .gitignore:47:.DS_Store	
dst-evidence/screenshots/real-person-profile.png   .gitignore:51:dst-evidence/	
knowledge/raw/a.txt                                .gitignore:38:knowledge/	
```

## 3. 门禁加强（否则同类事情还会溜过）

只修文件不够：原来那条审计看得见"现在的仓库"，看不见"以后的仓库"。

### `tests/gitignore.test.mjs`（新增，3 条）

用 `git check-ignore -q`（按模式判定，路径无需存在，因此测试不改工作树）从两侧钉死边界：

- 必须被忽略：真实人物目录（`meta.json` / `persona.md` / `knowledge/raw` / `knowledge/text` /
  `evidence/derived` / `evidence/renders` / `views/*.html`）、根级 `knowledge/raw`、
  `.distilly/`、`.colleague-skill/`、`playwright-data/`、`dst-evidence/`、`.DS_Store`、`Thumbs.db`
- 必须仍然可见：`src/knowledge/**`（含"以后新增的模块"）、夹具 `knowledge/`、三个 example
- 顺序：`!src/knowledge/` 与 `!src/derive/fixtures/**/knowledge/` 必须出现在最后一条
  `knowledge/` 规则**之后**（git 最后匹配者胜，顺序错了就静默失效）

在缺陷版 `.gitignore` 上实测：**2 条失败**（`# pass 1 / # fail 2`）；修复版上 3/3 通过。

### `scripts/audit-objective.mjs` 第 10 条

原来只查 `git ls-files` 里的证据图片数。现在同一条里追加机制检查：对 9 个"真实使用会
创建"的路径逐个 `git check-ignore`，必须全部命中。缺陷版实测 **16/17**，修复版 **17/17**
（证据串新增 `ignore rules cover 9/9 created-in-tree paths`）。

## 4. 测试结果

```
$ node --test tests/gitignore.test.mjs            # 3 pass / 0 fail（修复版）
$ node --test tests/gitignore.test.mjs            # 1 pass / 2 fail（缺陷版，证明这条测试咬得住）
$ node --test tests/*.test.mjs                    # 381 pass / 0 fail（39 → 40 个文件）
$ node scripts/audit-objective.mjs --skip-acceptance   # 17/17（缺陷版 16/17）
```

## 5. 已知缺口

- `node --test`（不带参数，即 CI 与 `npm test` 实际跑的命令）在本轮**是失败的**，原因是
  `scripts/blind-test.mjs` 被 Node 的默认发现规则（`**/*-test.mjs`）当成测试文件收集，
  裸跑打印用法并 exit 2。这是**独立缺陷**，不在本 PR 范围内，另开 PR 处理。
- 本 PR 只恢复忽略规则，不改任何运行时代码；`skills/colleague/example_*` 等已跟踪文件
  不受影响（已跟踪文件本来就不受 `.gitignore` 约束）。
