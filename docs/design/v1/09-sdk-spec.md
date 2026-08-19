> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 9. 类与函数（实现规格）

### 9.1 `Distilly`（`src/distilly/api.py`）

```python
class Distilly:
    def __init__(self, root: str | Path = "~/.distilly", *, client: EngineClient | None = None) -> None: ...
    def person(self, subject_id: str, *, space: str | None = None) -> Person: ...
    def create(self, subject_id: str, *, space: str, display_name: str,
               domain_pack: str = "person", aliases: list[str] | None = None) -> Person: ...
    def list(self, *, space: str | None = None) -> list[SubjectSummary]: ...
    def search(self, query: str) -> list[SubjectSummary]: ...
    def pending(self, *, subject_id: str | None = None) -> list[PendingJob]: ...
    def commit(self, job_id: JobId, draft: DistillDraft, *,
               actor: Literal["host", "daemon", "user"] = "host") -> Version: ...
    def promote(self, version_id: VersionId) -> Version: ...
    def reject(self, version_id: VersionId, *, reason: str | None = None) -> None: ...
    def subgraph(self, seed: list[SubjectId], *, hops: int = 1) -> RelationGraph: ...
    def close(self) -> None: ...
```

市场方法第二版再挂，不要为了做市场养肥 `Person`。

### 9.2 `Person`

```python
class Person:
    @property
    def id(self) -> SubjectId: ...
    @property
    def space(self) -> SpaceId: ...

    def get(self, *, version: VersionId | None = None) -> Profile: ...
    def prompt(self, *, version: VersionId | None = None) -> str:
        """完整中性 Markdown。第一版 = render(get())，不裁。"""

    def ingest(self, materials: list[MaterialIn], *, source: str) -> IngestResult: ...
    def ingest_files(self, paths: list[Path], *, kind: str = "docs") -> IngestResult: ...
    def accept_collect(self, plan: AgentPlan, artifacts: list[str], *, adapter_id: str) -> IngestResult: ...
    def collect(self, adapter_id: str, request: CollectRequest) -> AgentPlan | IngestResult:
        """委托返回 Plan；Direct 自己采。"""

    def correct(self, text: str, *, facet: str | None = None) -> Version: ...
    def flush(self) -> PendingJob: ...
    def status(self) -> SubjectStatus: ...

    def versions(self) -> list[Version]: ...
    def diff(self, a: VersionId, b: VersionId) -> ProfileDiff: ...
    def rollback(self, version: VersionId) -> Version: ...
    def lineage(self, *, version: VersionId | None = None) -> list[LineageEvent]: ...

    def install(self, host: HostName) -> InstallRef: ...
    def uninstall(self, host: HostName) -> None: ...
    def export(self, host: HostName, dest: Path) -> Path: ...

    def link(self, other: str | Person, *, type: str, evidence: list[EvidenceRef],
             confidence: float | None = None) -> Relation: ...
    def invalidate(self, relation_id: RelationId, *, reason: str) -> None: ...
    def neighbors(self, *, type: str | None = None) -> list[Relation]: ...
    def path(self, other: str | Person, *, max_hops: int = 3) -> list[Relation]: ...
    def mentions(self) -> list[PendingMention]: ...
    def resolve_mention(self, mention_id: MentionId, subject_id: SubjectId) -> Relation: ...
```

README 第一屏只写：`get` `ingest` `ingest_files` `correct` `install` `link` `neighbors`，外加 `Distilly.pending/commit`。其余是句柄上的次要方法。

和 Mem0 的差别必须保留：他们 `add` 就抽事实；我们 `ingest` 只收材料，`commit` 才是蒸完的人。两个动词不能合成一个，否则零 key 断了。

### 9.3 `EngineClient`（`client.py`）

```python
class EngineClient(Protocol):
    def call(self, method: str, params: dict[str, Any]) -> Any: ...
    def close(self) -> None: ...

class InProcessEngineClient:
    def __init__(self, root: Path) -> None: ...

class DaemonEngineClient:
    """第二版。stdio / UDS JSON-RPC。方法名与 InProcess 相同。"""
```

方法名与 protocol 对齐：`subjects.*` `materials.ingest` `distill.*` `profile.*` `graph.*` `hosts.*`

### 9.4 值类型（`models.py`）

```python
SubjectId = Branded[str, "SubjectId"]
# VersionId JobId RelationId MentionId SpaceId 同理
HostName = Literal["claude-code", "codex", "langgraph", "openai-agents", "hermes", "telegram"]

@dataclass(frozen=True)
class EvidenceRef:
    material_digest: str          # 现有 src_ + 8 位 hex 同源
    quote: str | None = None
    path: str | None = None

@dataclass(frozen=True)
class Claim:
    id: str
    facet: str                    # voice.opener / texture.hands / psyche.contradiction.thrift-vs-gift
    text: str
    evidence: tuple[EvidenceRef, ...]
    confidence: float             # 材料支撑度 0..1
    salience: float               # 第一版写入，暂不裁剪
    domain: str | None = None
    observed_in: tuple[str, ...] = ()
    valid_from: datetime | None = None
    valid_to: datetime | None = None

@dataclass(frozen=True)
class CoreFacet:
    name: Literal["identity", "voice", "psyche", "relations", "boundaries", "texture", "timeline"]
    markdown: str

@dataclass(frozen=True)
class DomainFacet:
    name: str
    markdown: str

@dataclass(frozen=True)
class Profile:
    subject_id: SubjectId
    version_id: VersionId
    core: tuple[CoreFacet, ...]
    domains: tuple[DomainFacet, ...]
    claims: tuple[Claim, ...]
    confidence: float
    maturity: Literal["sparse", "forming", "stable"]
    rendered: str

@dataclass(frozen=True)
class MaterialIn:
    kind: str                     # message / document / web / transcript / ...
    content: str                  # 进蒸馏必须是文本
    source_id: str | None = None
    occurred_at: datetime | None = None
    participants: tuple[str, ...] = ()
    metadata: dict[str, object] = field(default_factory=dict)

@dataclass(frozen=True)
class DistillDraft:
    material_set_hash: str
    claims: tuple[Claim, ...]
    core_markdown: dict[str, str]
    domain_markdown: dict[str, str]
    relations: tuple[RelationDraft, ...] = ()   # commit 可附带抽到的关系，否则 1000 人蒸完图是空的
    notes: str | None = None

@dataclass(frozen=True)
class Version:
    id: VersionId
    subject_id: SubjectId
    parent_id: VersionId | None
    actor: Literal["host", "daemon", "user"]
    material_set_hash: str
    confidence: float
    status: Literal["current", "suspended", "rejected", "historical"]

@dataclass(frozen=True)
class Relation:
    id: RelationId
    space: SpaceId
    a: SubjectId
    b: SubjectId
    type: str                     # 开放点分：work.invested / canon.rival / fanon.*
    role: dict[str, str] | None   # {src: "invested", dst: "founded"}
    evidence: tuple[EvidenceRef, ...]
    confidence: float
    valid_from: datetime
    valid_to: datetime | None
    extracted_from: VersionId | None

@dataclass(frozen=True)
class PendingMention:
    id: MentionId
    raw_name: str
    context: str
    subject_hint: SubjectId | None
```

Claim 落盘示例（对话里的形状，实现时对齐）：

```yaml
id: clm_8f3a
facet: voice.opener
statement: "语音开场几乎总是『喂——你听得到吗』，从不用『在吗』"
salience: high
confidence: 0.86
evidence: [src_a1b2, src_c3d4]
domain: null
observed_in: ["voice-note", "late-night"]
```

### 9.5 错误

`DistillyError` `NotFound` `AlreadyExists` `StaleVersion` `PendingCommit` `ConfidenceGate` `AmbiguousMention` `HostUnsupported`

采集错误用适配器那棵树，`ingest` 再映射。

### 9.6 引擎关键类

```python
class Layout:  # 全部路径约定
    def subject_dir / profile_dir / core_md / domain_md / claims
    def knowledge / corrections / versions / lineage / relations_log / queue_db

class MaterialStore:
    def put(self, subject, item) -> tuple[str, bool]: ...   # digest, is_new
    def inventory(self, subject) -> tuple[str, ...]: ...    # raw 未转文本的不在内
    def set_hash(self, subject) -> str: ...

class SubjectStore:
    def create / get / list / read_profile / write_current

class QueueService:
    def enqueue(self, kind: Literal["ingest","distill","index"], subject, payload) -> JobId: ...
    def claim(self, kind, worker) -> QueueRow | None:
        """UPDATE ... WHERE status='pending'。rowcount==0 表示被抢。"""
    def finish(self, job, *, ok: bool, retryable: bool | None, error: str | None) -> None:
        """WHERE status='processing'。用户又改文件导致已 UPSERT 成 pending 时，丢掉过时的 done。"""
    def recover_orphans(self) -> None:
        """启动：processing → pending。"""
    def pending_distill(self, subject=None) -> list[PendingJob]: ...

class MaterialHasher:
    def hash_set(self, digests: Sequence[str]) -> str: ...

class DistillRunner:
    def should_run(self, subject) -> bool: ...          # 哈希相同 → False
    def host_briefing(self, subject) -> HostBriefing: ...
    def run_llm(self, subject, config: LlmConfig) -> DistillDraft: ...

class DraftValidator:
    def validate(self, draft, expected_hash) -> None: ...  # 空核合法；claim.facet 语法

class CommitService:
    def commit(self, job, draft, actor) -> Version: ...
    def promote / reject

class ProfileRenderer:
    def render_facet(self, facet, claims) -> str: ...
    def render_prompt(self, profile) -> str: ...          # 第一版不按 salience 丢

class V4Migrator:
    def migrate_subject(self, old_dir, dest) -> None: ...

class RelationLog:
    def link / invalidate / neighbors   # neighbors 必须走部分索引，禁止热路径全文件扫

class MentionQueue:
    def add / resolve

class SkillProjector / HostExport
```

队列表学 EverOS：一个主体（或一个路径）一行，不是一个事件一行——worker 来不及处理时同一主体被改十次，UPSERT 成最新，天然去重。LSN：给顺序、重新入队公平、算积压。照抄时注意：**`MAX(lsn)+1` 不是严格单调**，两个并发 writer 可能撞号；EverOS 自己也承认。我们若以后做 CDC 再 `BEGIN IMMEDIATE`。mtime 容差必须和对账器共用一个常量。

失败三态：`retryable=True` 自动再入队；`False` 等人改文件（改了会变 mtime）；`NULL` 这行没失败。内容变了重试计数清零。

### 9.7 MCP（模型那张脸）

只这些。不要把七组都变成 tool。`link` 第二版再给模型，避免乱连。`browse` 永远不要给模型当常用工具。

| 工具 | 对应 |
|---|---|
| `distilly_get` | `Person.get` / `prompt` |
| `distilly_ingest` | `Person.ingest`（必须带 subject_id） |
| `distilly_pending` | `Distilly.pending` |
| `distilly_commit` | `Distilly.commit` |
| `distilly_correct` | `Person.correct` |

1000 个人不能 `get` 一遍；模型只应对当前这个人 `get`。

---
