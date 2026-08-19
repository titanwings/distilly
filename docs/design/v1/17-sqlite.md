> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 17. 为什么现在可以不上 SQLite 检索，以后怎么上

Basic Memory 三组表：文件系统镜像（`checksum`/`mtime`/`size` 跳过未变文件；`permalink` 与 `file_path` 分离，wikilink 不因搬家失效；`relation.to_id` 可空、`to_name` 必有 = 前向引用）；同步状态机（库与磁盘各一份版本+校验和，五态含 `external_change_detected`；`note_file_vacate` 区分移动幽灵和真复制）；FTS5（`tokenchars 0x2F` 让路径不被切碎，`prefix='1,2,3,4'`）。

**现在不需要。** 一份 persona 几 KB，整份进 context。引入是过度工程。

**marketplace 一做就会需要。** 面板要在几百个 profile 里按家族、成熟度、血缘来源筛；`lineage.jsonl` 问「第 5 版用了哪些源」得全文件扫。到那时：Markdown/JSONL 仍是事实，SQLite 只做可删重建的投影。我们已有 `src_` + 八位 hex，增量重建判据现成。

embedding 大概率不需要。只有市场上千个 profile 要语义搜时，也可以跑本地模型，仍不必 key。

EverOS 读路径（备忘，第一版不用）：`SearchManager` 只读；按 `owner_type` **硬分区**不是 where 过滤；组件缺失直接抛错不退化成 grep；heap-expand 让 episode 和 atomic_fact 在同一排序空间竞争（事实驱逐）。我们三个家族以后若检索，与其过滤，不如从一开始走不同召回——celebrity 涉及公众人物，本该和同事走不同策略。

---
