> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 18. 遥测（你问过能不能记次数上传服务器）

能做。已经在 prototype 里落地：`tools/telemetry.py`，opt-in，无端点则完全惰性。环境变量现为 `DOT_SKILL_TELEMETRY` / `DOT_SKILL_TELEMETRY_ENDPOINT`，改名后换 `DISTILLY_*`。

约束（哲学 2.3 / 2.4）：

- 没配端点就不问、不发
- 交互式问一次并记住；非交互拒绝且不落盘
- 数的是创作（蒸了、装了），承认数不到「被模型读了 SKILL.md」
- 禁止为了指标在投影里塞必调工具

---
