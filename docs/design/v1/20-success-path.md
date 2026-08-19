> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 20. 主路径与成功标准

```
create(person, space)
  → 宿主扒 / 喂文件 / plan+accept
  → ingest（哈希变了才过边界）
  → pending → 宿主蒸（先 claims，再渲染，再投影）
  → commit(profile + claims + 抽到的关系)
      置信度下降 → versions/vN-awaiting
  → get / prompt / install
  → correct 落 corrections，立刻改对应 claim
```

第一版 SDK 成功标准（六步）：

1. 用户指定一个人
2. agent 用浏览或截图采到材料，或用户丢进导出文件
3. `ingest` 去重落盘
4. 宿主蒸馏并 `commit`
5. 下次对话 `get` 能加载这版
6. 用户改一处 `correct`，再 `get` 能看到，且 `corrections/` 里有记录

这六步过了，第一版成立。其余产品面往这几个方法后面加，不改 `Material` 和 `commit` 的形状。

Codex 插件另加第 12 节四条验收。总验收第一刀：无登录、无 key，对公开网页人物走完并 `get` 到带例句的 `voice` 和带 evidence 的 claim。

---
