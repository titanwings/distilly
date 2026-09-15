# PR-13 · 目标审计门禁

- 分支：直接落在集成分支 `dot-skill-test`（本地）
- 交付：`scripts/audit-objective.mjs`、`tests/audit-objective.test.mjs`、CI 两处步骤、
  `docs/evidence/pr-01-node-core.md`、`docs/evidence/pr-02-parse-zero-cred.md`

## 1. 为什么

`acceptance.mjs` 证明"流水线能跑"，但证明不了"范围是闭合的"。目标里的每条需求
（Node 单栈、证据脊柱、渲染与 visual-check、双语 prompt、宿主矩阵、渠道与同意、
schema v4、端到端验收、截图不入库、每个 PR 有证据文档）都应该有一条机械检查，
并且每条检查都要说清楚**它读到了什么**；缺口单独成行、不算失败。

## 2. 覆盖面（16 条）

Node 单栈（0 个 tracked `.py` + CI 无 Python 步骤）、证据脊柱磁盘契约与方括号锚点、
retrospect 确定性与锚点纪律、单文件离线页面 + CSP + visual-check、双语 prompt lint、
8 个宿主矩阵 + 防漂移测试、要 key 渠道 + computer-use 同意门（且浏览器一路不驱动浏览器）、
未移植渠道的记账、schema v4 + 幂等迁移、CONTRACT §1 每个命令可解析且 `PLANNED` 为空、
命令注册表规模、第二个公开语料存在且 CI 会跑它、证据图片不入库（项目素材除外）、
每个**真正合并过**的分支都有 PR 证据文档、端到端验收全绿、推送状态。

## 3. 写检查时踩的坑（全部修的是检查，不是结论）

| 误判 | 实际 |
| --- | --- |
| `agent.id` 取不到宿主机名 | `listAgents()` 返回的是**字符串** |
| "仓库不能有任何图片" | 项目素材（宿主 logo、社交预览）是合法的；要禁的是**证据**图片 |
| 把会话工作区的 `dst-evidence/` 当仓库内路径 | 它不在仓库里；仓库内只需断言"无证据图" |
| 用 `git branch --merged HEAD` 判断"已合并分支" | 当前特性分支的 tip 就是 HEAD，会被误判；改为按**合并提交**统计 |

## 4. 怎么验

```bash
node scripts/audit-objective.mjs                    # 16/16，2 条已知缺口
node scripts/audit-objective.mjs --skip-acceptance  # 测试与 CI 的 test job 用这个
node --test tests/audit-objective.test.mjs          # 2 条：全体满足 + 缺口必须显式
```

结果接进 `node --test` 与 CI 两个 job；`--json` 输出供其它脚本消费（`rows`/`failed`/`gaps`）。

## 5. 同轮补齐

- `docs/evidence/pr-01-node-core.md`、`pr-02-parse-zero-cred.md`：最早两条分支缺证据文档，
  审计把它标成唯一未满足项后补写。
- 契约里未移植的四个采集渠道（discord/reddit/notion/gmail）从"读起来像拼错"改成
  `collect/planned-channel` + 逐条需求说明，`doctor` 多打一行 `Planned channels`。

## 6. 已知缺口

- 四个渠道仍未实现（各自需要什么已写进 `PENDING_CHANNELS`）。
- 推送与 PR 受用户冻结影响，全部提交只在本地；解冻后的执行清单在
  `dst-evidence/PR-BODIES/PR-PLAN.md`。
