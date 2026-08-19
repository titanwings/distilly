> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 21. 落地顺序

1. 独立仓 + 改名（包、路径、遥测环境变量）
2. 修 CI 触发分支（加常驻进程之前必须有真实回归）
3. 搬 adapters + `Distilly`/`Person` + 进程内引擎 + 新磁盘 + v4 迁移
4. MCP 五工具 + 宿主注入（Claude Task / Codex instructions）+ 产品 skill 禁令
5. pending / commit / 置信度闸 / corrections / 集合哈希跳过
6. 关系 jsonl + `link`/`neighbors`/`mentions`
7. 一个 bot 绑定
8. Codex/Claude marketplace 插件包（本地 stdio）
9. daemon 队列（有 key 时）
10. 面板、相似、marketplace、Direct 飞书 API

第一版明确不做：daemon 常驻定时轮询（SDK 不强制）；必填 multimodal/embedding key；LanceDB；salience 裁剪；相似边；在 `api.py` 写死宿主路径。

---
