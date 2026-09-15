# PR-09 · 证据脊柱打通 + 效果层盲测装置

- 分支：`dot-skill-test`（集成分支，本轮 9 个原子提交直接在本地集成分支上）
- 交付：`src/knowledge/anchors.mjs`、`src/derive/retrospect.mjs`、`src/parse/subtitle.mjs`、
  `src/views/{schema,render}.mjs`、`viewer/sections.js`、`src/commands/view.mjs`、
  `scripts/{split-corpus,blind-test,visual-check,acceptance}.mjs`、
  `tests/{retrospect,views,blind-test,parse-subtitle,knowledge-ledger}.test.mjs`、
  `docs/v2/{RENDER,STATUS,BLIND-TEST-RUNBOOK}.md`
- 依赖：`ds/01`–`ds/08` 的合并成果（本机已合并到 `dot-skill-test`）
- **零运行时依赖、零模型调用、零网络**；`playwright` 只在 CI 的 `acceptance` job 里用于 visual-check
- 按用户指令**不 push、不建 PR**：全部提交只在本地
- 截图不入库：PNG 在 `dst-evidence/screenshots/pr-09-evidence-spine/`（`.gitignore` 已含 `evidence/`、`dst-evidence/`）

## 1. 这一轮为什么存在

`docs/v2/ACCEPTANCE.md` 的"效果层"不能自证，于是先搭 A/B 盲测装置。装置第一次跑通就
把三个**真实缺陷**照了出来——它们各自的分支测试都是绿的，因为每个分支只测自己那一层的
格式；跨层跑一次就崩。

## 2. 三个缺陷与修法

| # | 缺陷 | 现象（可复算） | 根因 | 修法 | 回归测试 |
| --- | --- | --- | --- | --- | --- |
| 1 | 锚点格式不一致 | `retrospect` 对任何 harvest 出的语料都输出空集 | `assignAnchorsToText` 写 `k0012 text`；`CONTRACT.md` §2、`store.mjs` 头注释与唯一读者 `retrospect` 都要求 `[k0012] text` | 渲染器改回方括号；读取端兼容旧格式并告警 | `tests/retrospect.test.mjs`「a harvested subtitle reaches the derivation layer」「a pre-bracket text file is still read」+ `knowledge-ledger`/`parse-subtitle` 的 text 行断言 |
| 2 | 溯源假警告 | 每次运行都报 `has no ledger entry with a matching sha256` | 账本存**原始字节**摘要，代码拿它比对**归一化文本**摘要，永不相等 | 按 `locations.text` 认亲；只有账本真带 `text_sha256` 才校验摘要 | 「provenance follows the ledger's text link, not the raw digest」 |
| 3 | 说话人丢失 | `面试官：…` 识别不出说话人，voice/relations 退化为无归属统计 | `SPEAKER_PREFIX` 只认半角 `: `，中文导出用全角 `：` | 接受全角；半角无空格仍不认（否则 `https://…` 会解析出说话人 `https`） | `tests/parse-subtitle.test.mjs`「speaker prefixes are read from ASCII and full-width colons, but not from URLs」 |

顺带修掉两个会误导使用者的东西：

- `.gitignore` 的 `knowledge/` 匹配任意层级，把 `src/knowledge/` 也排除了：已跟踪文件不受影响，
  但**新增**的源码模块会被 `git add` 静默跳过。例外必须写在排除规则之后才生效。
- `view render --file /tmp/x.view.json` 把回执写到 `/evidence/`（祖父目录当成了 Skill 目录）；
  现在只有父目录名为 `views` 才向上取一层。

## 3. 改动前后（同一段语料，可复算）

语料：`tests/fixtures/public-corpus/synthetic-interview` 的 A 半段（28 条 cue，由
`scripts/split-corpus.mjs` 按时间轴切出，`split.json` 记两侧 sha256）。
"改动前"= `/tmp/dst-before` worktree（`b56ccbe`，本次修复之前的代码）实跑。

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| `knowledge/text/subtitle.md` 行格式 | `k0001 面试官：面试官：…`（且前缀重复一次） | `[k0001] 面试官：…` |
| `retrospect` 可引用段落 | 0 | 28 |
| 派生结论（7 个文件合计） | **0**（claims 全空） | **22**（voice 11 / stats 4 / timeline 4 / relations 3） |
| 回指锚点 | 0 / 56 | 19 / 56 |
| 回执 warnings | 2（溯源假警告 + 说话人） | 0 |
| 说话人归属 | 无 | 面试官 / 林工 |
| 页面 | 渲染被拒绝（3 个 `VIEW_SECTION_MISSING`），读者手里没有页面 | 8 段齐全：4 段有证据 + 3 段显式「本节证据不足」+ 附录 18 锚点，52287 bytes |

改动前的原话（`dst-evidence/screenshots/pr-09-evidence-spine/before.txt`）：

```
anchors: {"total": 56, "cited": 0}
warnings:
  - knowledge/text/subtitle.md has no ledger entry with a matching sha256; it was read but not trusted for provenance.
  - ledger:k0001: no speaker could be read from this subtitle: SubRip has no speaker field and no cue used a `<v Name>` span or a `Name:` prefix
合计 claims = 0
Error: view.json failed view check with 3 error(s); fix them before rendering
```

## 4. 薄证据渲染（`--allow-missing`）

派生层填不满七段时，默认整页拒绝渲染：一段没有时间戳的语料就产不出页面。补占位结论
等于编内容，同样不可接受。第三个选项是**说出来**：

- `distilly view check|render --allow-missing`：缺失段落与空 `items` 降级为告警，
  逐条留在 `warnings[]`，退出码仍为 0；
- 渲染时按固定页序补回 `{items: [], unavailable: true}`，页面渲染一行
  「本节证据不足：派生层没有产出可引用的结论，按约定不填占位话术。」（`data-empty="unavailable"`，zh/en）；
- 顺序判据改为"存在的段落保持相对顺序"，否则缺一段会把后面每段都报成错位；
- 默认行为不变：不带参数时八段必须齐全。

## 5. 效果层盲测装置

`docs/v2/BLIND-TEST-RUNBOOK.md` 固定角色、步骤、判据与留档。脚本只做机械部分：

| 命令 | 作用 |
| --- | --- |
| `scripts/split-corpus.mjs` | 字幕按时间轴 / 文本按段落切 A/B，写 `split.json`（两侧 sha256、`cut.timecode`、`split_by`） |
| `blind-test prepare` | A → harvest → retrospect → `deriver-input.md`（结论 + 锚点表，无原文）+ 七段骨架 + 裁判 prompt + 空白评分表 + 回执；`--baseline` 另出机械基线页面 |
| `blind-test finalize` | 校验 + 渲染作者写的 view.json + 更新回执（`--strict` 让 check 失败时退出码 1） |
| `blind-test control` | 同一段 A 半段原文的裸 prompt 对照（禁止跑命令、禁止建知识库） |
| `blind-test score` | 命中率（hit + 0.5×partial）、无法判定比例、编造数 → PASS/FAIL/FALSIFIED |

判据：命中率 ≥ 0.70、无法判定 ≤ 0.20、**编造数 = 0**；未填写的条目按"无法判定"计
（空表必然 FAIL）。机械基线不写散文、不补证明不了的东西：证明不了的段落进 `gaps`
并写明原因（"没有日期就不编时间线"），回执标 `view_source: mechanical-baseline`。

## 6. 怎么验（本次实跑结果）

```bash
node scripts/prompt-lint.mjs                  # 0 finding(s) across 26 file(s)，21 个命令全部已注册
node --test tests/*.test.mjs                  # 296 pass / 0 fail（26 个文件）
node scripts/generate-template.mjs --check    # 模板无漂移（viewer 改动后已再生成）
DISTILLY_PLAYWRIGHT_ROOT=/tmp/audit-mcp node scripts/acceptance.mjs
                                              # 20/20 通过（新增 blind-test 与薄证据 visual-check 两段）
```

新增测试 17 条：`tests/blind-test.test.mjs` 9 条（切分不重不漏/可复算/拒绝切不动、
三项指标与阈值边界、空表必 FAIL、prepare 端到端、finalize 作者页、control 对照）、
`tests/retrospect.test.mjs` 3 条、`tests/views.test.mjs` 3 条、`tests/parse-subtitle.test.mjs` 1 条、
`knowledge-ledger` 断言改为契约格式。

## 7. 已知缺口（诚实记录）

- **效果层仍需人/模型签字**：本 PR 只交付可复算的装置与判据，脚本不自评、不冒充裁判。
  命中率/编造率必须由**没看过语料**的裁判 + **看过 B 半段**的检查者产出。
- 同一段语料能支撑几段由派生层的最低样本数决定（本语料 7 段中 3 段为缺口）；
  `gaps` 非空时命中率只在填出的段落上可比，报告必须写明。
- `PLANNED` 里仍是 `parse-chat`（飞书导出格式）与飞书浏览器/MCP 两路，`doctor` 会点名到分支。
- 机械基线的 `portrait` 只是统计事实（"可引用消息 28 条，参与者 …"），不是画像；
  真实作者步应由模型/人写 `view.authored.json` 再 `finalize`。

## 8. 回滚

- 单个提交可独立 revert（9 个提交各自只做一件事，见 `git log --oneline`）。
- 回滚 #1（方括号）会让派生层重新变空：`retrospect` 的旧格式兼容只解决读，不解决写。
- 回滚 #4（`--allow-missing`）会让薄语料的页面重新无法渲染；`blind-test prepare --baseline`
  会直接失败（不静默降级）。
