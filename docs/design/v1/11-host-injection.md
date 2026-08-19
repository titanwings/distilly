> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 11. 宿主注入适配器（第一版就要）+ 实际会碰到的坑

采集适配器可以后做。**注入适配器第一版就要有**，否则 `get` 在各家会塞错地方。

这是 ChatCut widget-forms 的同类物：中性语义按宿主翻译。他们翻译「问人」；我们翻译「灌人格」。

```python
@dataclass(frozen=True)
class Injection:
    instructions: str
    subject_id: SubjectId
    version_id: VersionId
    display_name: str

class HostInjector(Protocol):
    host: HostName
    def inject_subagent(self, injection: Injection, request: HostSpawnRequest) -> HostSpawnRequest:
        """禁止写全局 md。禁止把这次注入登记成 install。"""
    def install(self, profile: Profile, dest_root: Path) -> InstallRef: ...
    def export_identity(self, profile: Profile, dest: Path) -> Path: ...
```

`get` 只产出一份中性 Markdown。不要为 Claude 和 Codex 蒸两份 profile。各适配器只加前后几句包装（「你就是下面这个人」/ Hermes 第二人称）。

三种装法，混用会把产品做脏：

```
profile/（家里，唯一事实）
    ├─ prompt() / get()  → 这一次子代理     ← 临时 10 个
    ├─ install(host)     → 宿主 skills/     ← 长期、可发现
    └─ export(host)      → agent.md/SOUL.md ← 一个常驻身份一个文件
```

`agent.md` / `AGENTS.md` / `CLAUDE.md` / `SOUL.md` 都是**这份运行时的全局说明书**。一份进程通常只吃一套，用来写「怎么测试」，不是用来轮换人格。

- 改全局文件 = 所有对话、所有子代理一起变
- 派 10 个临时的还要写 10 份、用完再删，和宿主缓存缠在一起
- 10 个人写进同一份，上下文又挤又串台

所以：`agent.md` 只适合「这一个常驻 bot 长期就是王兴」。不适合「现在并行 10 个企业家」。`install` 也偏长期，且常要新开对话（工具/技能按会话固定）。

**「会话级」在 coding agent 里 = 子运行级注入，不是改当前窗的隐藏 system。** 各家都没有稳妥的「给当前会话打补丁」API。

| 环境 | 实际口子 | 10 个临时 |
|---|---|---|
| Claude Code | 派 Task / 子代理时自定义 prompt | 10 次派发，每次换一个人 |
| Codex | 子任务 instructions / Runner dynamic instructions | 同上 |
| OpenAI Agents / LangGraph | 每轮 run 的 instructions | 最干净 |
| DSH | 每个 `session(id)` | 10 个 session |
| Hermes / Telegram | 一个进程一份人格 | 不适合「临时」；要 10 个就 10 个进程 |

你会碰到的七件事（适配器必须挡住）：

1. **没有统一的「设置系统提示」。** 父对话里 `get` 了，父自己不会自动变成那个人。10 个临时必须派 10 个子运行。
2. **塞错槽位污染全局。** 写成改 `AGENTS.md`/`CLAUDE.md` = 全仓库沾上，10 个人互相覆盖。产品 skill 第一禁令。
3. **`install` ≠ 会话注入。** 适配器不要默认走 install。
4. **各家包装不同。** 中性正文一份。
5. **子代理不一定带得上 MCP。** 人格必须已经在它的 prompt 里。父 get、子只拿文本。
6. **完整 profile 的代价。** 10 路 = 10 份全文。第一版不管裁剪；塞不下只报「塞不下」。
7. **和 widget-forms 同类。** 不要在 Codex 里用 Claude elicitation HTML，也不要在 Claude 里调 Codex widget。只调用本宿主有的 spawn/instructions API。

产品 skill 写死：先 `get`，再按当前宿主适配器投放，禁止改仓库里的 `AGENTS.md`。父模型必须记得调 `get`，或写成固定流程——和 ChatCut 必须写 skill 是同一个原因。

---
