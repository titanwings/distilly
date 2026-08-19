> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 0. v1 漏了什么（先看这个）

上一版只剩目录和函数签名。对话里已经拍板、却被收成一句的，至少有这些：

| 被收掉的 | 对话里实际说了什么 |
|---|---|
| 产品从哪来 | 你原话：Colleague Skill scope 太小，要做成所有 agent 自带的 profile；面板选 marketplace、客制化、版本自选；bot 用真人蒸出来的性格，用户 @ 交互 |
| 设计哲学 | 六条，每条有「体现」和「拒绝」。没有拒绝的原则只是口号 |
| 记忆生态 | Markdown 不是主流 memory 项目的默认；分野是「写给谁看」。Hindsight 客观/主观分网、Memvid 只追加坑、AGENTS.md 无 schema |
| 为什么要 SQLite | 变更检测、FTS5、sqlite-vec、双向同步事务。现在 persona 几 KB **不必上**；marketplace 才需要投影 |
| EverOS 机制 | 删 `.index/` 不丢记忆；队列表路径一行；LSN 用途与非严格单调；四道一致性守卫；写强一致读最终一致；heap-expand 事实驱逐；超参数不给旋钮 |
| 蒸馏客观 vs 稳定 | 你纠正：客观 ≠ 重跑逐字相同。漂是要压的缺陷。置信度 = 材料支撑度。集合哈希没变就跳过 |
| 七组方法 | 先是完整产品能力清单（约 30 个动词），再收成 `Distilly`+`Person`。两组都要留着，不能只留瘦 SDK |
| Profile 六面语义 | 每面装什么、真实性靠什么、空合法、域包、Claim YAML、先 claim 再渲染 |
| 图 | 陈述边/派生边（后改名关系/相似）、space、pending mention、升级成 `relations/a__b/`、复杂度表、禁止 commit 时 O(n²) |
| ChatCut | 包结构、托管 MCP+OAuth、IAB、装完新开对话、规范 skill symlink、widget-forms 中性字段 |
| 四种调用方 | 模型 / 插件 / 面板市场 / **Bot**（后补回） |
| 三种装法 | `prompt()` 临时、`install()` 长期发现、`export()` 一对一身份。`agent.md` 不是加载机制 |
| 注入七坑 | 没有统一改 system 的 API、塞错槽污染全局、install≠会话、包装不同、子代理无 MCP、全文代价、宿主方言不能串 |
| 遥测 | opt-in、无端点完全惰性、数不到「被模型使用」、禁止为指标在 SKILL.md 里塞必调工具 |
| 现有完成度 | 地基有、产品形态零代码；CI 盯错分支；110 测试从未在 GitHub 跑过 |

下面按对话密度写，不按「好概括」写。类和函数仍在第 9 节。

---
