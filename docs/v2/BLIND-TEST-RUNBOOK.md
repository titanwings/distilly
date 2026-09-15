# 效果层盲测 runbook（A/B holdout）

`docs/v2/ACCEPTANCE.md` 把"效果"单列一层，因为它**不能自证**：蒸馏器和裁判都不能是自己。
本文件固定流程与判据，脚本只做机械部分（切分、派生、渲染、算分），不代替裁判。

一句话：**A 半段给蒸馏器，B 半段只给检查者**；裁判只看渲染页，从不看语料。

## 0. 角色

| 角色 | 看到什么 | 不能看到 |
|---|---|---|
| 蒸馏器 distiller | A 半段语料（实验组）或 A 半段原文（对照组） | B 半段 |
| 裁判 judge | `profile.html` + `judge-prompt.md` | 任何语料、任何身份线索 |
| 检查者 checker | A/B 半段原文 + 裁判的 10 条 | —— |

三种角色都必须是**模型或人**，不是本脚本。同一模型不得同时充当蒸馏器与裁判。

## 1. 切分（检查者一个人做）

```bash
node scripts/split-corpus.mjs --in <corpus.srt> --out /tmp/blind-probe --ratio 0.7
# A: 28 cues 00:00:01.000–00:03:12.000 / B: 10 cues 00:03:12.300–00:04:21.000
# split.json 记录两侧 sha256 与切点，任何一方都能独立复算
```

字幕按**时间轴**切（不是按条数），文本按段落数切。`split.json` 是对外可验证的凭据：
两侧 sha256、`cut.timecode`、`split_by`。B 半段从此刻起不进蒸馏器、不进渲染目录。

## 2. 实验组（证据层）

```bash
node scripts/blind-test.mjs prepare --a /tmp/blind-probe/A.srt \
  --person blind-sample-01 --out /tmp/blind-run --baseline
```

`prepare` 在 `<out>/work/` 里跑真实的 `harvest → retrospect`，然后写出：

| 文件 | 给谁 | 内容 |
|---|---|---|
| `deriver-input.md` | 蒸馏器（作者步） | 每条派生结论 + 锚点 + 锚点表；**不含原文** |
| `view.skeleton.json` | 蒸馏器（作者步） | 七段骨架，`evidence[]` 已按账本填好 |
| `profile.html` | 裁判 | `--baseline` 直接产出的页面（私有模式） |
| `judge-prompt.md` | 裁判 | 固定问题：10 条可验证特征 + 每条一句预测 |
| `scores.template.json` | 检查者 | 空白评分表（两臂共用一张） |
| `receipt.json` | 检查者 | 派生化、`sections_filled`、`gaps`、页 sha256、外链检查 |

`--baseline` 是**机械基线**：每段只由对应的派生 kind 填充，脚本自己不写一句散文，
也**不补它证明不了的东西**——`gaps` 列出派生层没产出的段落（例如没有时间戳就没有 timeline，
样本不足就没有 values/boundaries），页面为这些段落渲染「本节证据不足」。
回执里的 `view_source` 明说是 `mechanical-baseline`；真实跑法是用模型读 `deriver-input.md`
把七段写成 `view.authored.json`，再：

```bash
node scripts/blind-test.mjs finalize --out /tmp/blind-run --view /tmp/blind-run/view.authored.json --strict
# 校验 + 渲染 + 更新回执；--strict 让 check 不通过时退出码为 1
```

两种来源在 `receipt.view_source` 与 `receipt.view.sha256` 里可区分，评分别混用。

## 3. 对照组（裸 prompt，无证据层）

```bash
node scripts/blind-test.mjs control --a /tmp/blind-probe/A.srt --out /tmp/blind-run
```

`control-prompt.md` = 同一段 A 半段**原文** + "不要运行任何命令、不要生成知识库，直接写画像"。
把模型输出落到 `control-profile.md`。这一臂检验的是：**如果没有证据层也能拿到同样的命中率，
证据层就是多余的**。

## 4. 打分（检查者）

裁判输出填进 `scores.json`（结构见 `scores.template.json`），每条一个 `verdict`：

| verdict | 含义 |
|---|---|
| `hit` | B 半段能直接证实 |
| `partial` | 方向对但细节错/过泛，计 0.5 |
| `miss` | B 半段明确反驳 |
| `undecidable` | B 半段没有信息可判（**不是**"看起来像"） |
| `fabricated` | 页面没说过、或与 B 半段冲突却讲得很确定的断言 |

```bash
node scripts/blind-test.mjs score --scores /tmp/blind-run/scores.json --out /tmp/blind-run/report.md
```

判据（脚本算，不手算）：

- 命中率 = (hit + 0.5×partial) / 可判定条数，**≥ 0.70**
- 无法判定比例 = undecidable / 总条数，**≤ 0.20**
- 编造数 = `fabricated` 条数，**必须 = 0**，否则该臂直接 FALSIFIED
- 反向对照：实验组命中率应高于对照组；若持平或更低，证据层在**这段语料上**没有价值，要写进结论

未填写的条目按 `undecidable` 计（不填 ≠ 通过），所以空表一定 FAIL。

## 5. 记录

一次跑完的最小留档（全部本地，截图不入库，见 `dst-evidence/`）：

1. `split.json`（切分凭据）
2. `receipt.json` + `view-diagnostics.json`（页面来源与已知缺口）
3. `profile.html` / `control-profile.md`（两臂刺激）
4. 裁判 10 条原文、`scores.json`、`report.md`
5. 一句话结论：这段语料上证据层是否值得，以及 `gaps` 是否影响了判断

## 6. 已知边界

- `prepare` 的机械基线**不是**"自动写画像"：它只把派生结论搬到页面上。真正的作者步仍需模型或人，
  这也意味着"效果层"验收必须有人/模型参与，脚本永远不会替你签字。
- 一段语料能支撑几段是派生层说了算；`gaps` 非空时，命中率只在填出的段落上可比，
  报告里必须写明这一点。
- 身份盲：`prepare --person <slug>` 决定页面上的 `slug`；要让裁判连人名也看不到，
  用一个中性 slug（如 `blind-sample-01`）跑，目录名与页面都不含真名。
- 裁判与蒸馏器若用同一模型，须在结论里注明；同模型自评会让命中率偏高。
