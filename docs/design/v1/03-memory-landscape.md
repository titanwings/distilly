> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 3. 记忆生态里我们站哪（调研结论，不要再凭印象）

星标最高的独立 memory 项目，**一个用 Markdown 的都没有**：Mem0 向量抽事实，Zep/Graphiti 要 Neo4j 或 FalkorDB，Letta 是 Postgres 有状态运行时。用 Markdown 的是另一批：coding agent 的原生上下文文件，加上 Basic Memory、EverOS。

分界线不是新旧，是**这份存储写给谁看**。要人打开编辑 → 纯文本；只有机器读、且记忆多到装不下 → 数据库。中间那批是刻意双层：Markdown 当事实，索引可重建。我们和 EverOS、Basic Memory 共用这个结构。产品前提是用户要在面板里改 persona，所以 Markdown 是被需求锁死的，不是偏好。

和我们直接有关的两个：

- **Hindsight**：客观事实和带置信分的主观意见分开放。「用户叫 Priya」和「我认为他喜欢短回答」不混。我们停在文件级，它做到单条信念。现在有了 claim，粒度对齐了。
- **Memvid**：append-only + 内容哈希跟 `lineage.jsonl` 同源，但它把产物也做成不可变帧，改一条要重建整个文件。我们只让血缘只追加，产物可改。这个坑已经绕过。

**AGENTS.md** 已被六万多个项目采用，但明确没有 schema、没有版本号、没有约束性语言。我们做的版本化和血缘补的就是这一格。这比「又一个 memory 项目」更能说清位置。

EverOS 要四组独立凭证：`[llm]` `[embedding]` `[multimodal]` `[rerank]`，全必填。它是自带 LLM 调用的服务，跟宿主模型无关。我们默认零 key，这个优势要写进 README 第一屏。

---
