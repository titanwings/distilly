> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 10. 采集适配器（已有设计，原搬）

文件：`tools/adapters/base.py` → `src/distilly_adapters/base.py`。

三种 mode：`direct_api` / `direct_browser` / `agent_delegated`。只许子类 `DirectAdapter` 或 `DelegatedAdapter`。构造无网络、无读凭据。适配器写盘即越权。

主路径第一版：**模型采完 `ingest`**。适配器是降摩擦，不是开关。没有飞书适配器，蒸馏照样能跑。`direct_api` 第一版只留接口，仓库里不写飞书官方 API。最多带 1～2 个委托样板（`web`、`feishu`）证明社区能扩。

材料类型留在抽象里，不绑厂商视觉 API：`text` `image`（附可选 OCR）`document` `audio`（附可选转写）。

错误：`AdapterError`（`retryable` + `remediation`）、`AdapterAuthError`、`AdapterScopeError`、`AdapterUnavailable`、`AdapterRateLimited`（`retry_after_seconds`）、`AdapterTransient`。

值类型：`SubjectRef` `Material` `AdapterCapabilities` `CollectRequest` `PreflightResult` `AgentPlan`。

```python
class SourceAdapter(ABC):
    adapter_id: str
    display_name: str
    def capabilities(self) -> AdapterCapabilities: ...
    def config_fields(self) -> dict[str, str]: ...          # _token/_secret/_key 当秘密
    def preflight(self, config) -> PreflightResult: ...
    def resolve_subject(self, query, config) -> list[SubjectRef]: ...

class DirectAdapter(SourceAdapter):
    def collect(self, subject, request, config) -> Iterator[Material]: ...  # 生成器，部分成功先 yield 再 raise

class DelegatedAdapter(SourceAdapter):
    def plan(self, subject, request) -> AgentPlan: ...
    def accept(self, plan, artifacts) -> Iterator[Material]: ...  # 解析失败用 AdapterUnavailable，不可重试
```

注册表：`ADAPTER_ENTRY_POINT_GROUP = "distilly.adapters"`；`register` / `load_adapters` / `get_adapter`。第三方 import 失败：警告并跳过。

---
