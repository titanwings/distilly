> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 19. 现有完成度（按产品愿景，不按已写行数）

| 子系统 | 内容 | 状态 |
|---|---|---|
| 蒸馏引擎 | prompts 三家族 + skill_writer 七件产物 | 既有（将被内核/域替换） |
| 版本与血缘 | schema v4、内容寻址源清单、lineage、成熟度门禁 | 已落地 |
| 使用统计 | opt-in 匿名计数 | 已落地 |
| 质量门禁 | ruff 部分修了；CI workflow 触发分支仍是 `main`，默认分支 `dot-skill` | **CI 从未真正跑** |
| 采集抽象 | `SourceAdapter` 未提交 | 草稿 |
| SDK / 独立仓 | Distilly+Person、daemon、MCP | 零代码 |
| 前端面板 | loopback SPA | 零代码；Claude 可行性未验证 |
| Marketplace | 静态 JSON index + 内容哈希 revision | 零代码 |
| Bot 载体 | persona 绑定到 bot 运行时 | 零代码 |
| 注入适配器 | claude/codex/generic | 零代码 |

一句话：地基做完了，产品形态还没开始。约 110 个测试；插件/面板 0 行。

现有蒸馏→安装时序（prototype，迁的时候要改产物路径）：

```
用户提供材料
  → 宿主读 knowledge/ + prompts/ 蒸馏，产出 provenance
  → skill_writer --meta
  → normalize_provenance + scan_source_inventory
  → 写 7 件产物 + meta.json
  → append lineage.jsonl
  → 可选 skill_generated 遥测
  → install_* 成熟度门禁（低于 floor 拒绝）
  → 写入宿主 skills/
  → 可选 skill_installed 遥测
```

迁到 distilly 后：中间产物变成 `claims.jsonl` + 内核/域 Markdown，再投影 `SKILL.md`。

---
