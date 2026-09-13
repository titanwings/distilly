> 本章由 [system-v3.md](../system-v3.md) 生成，属于当前生效的目标合同；当前已发布行为以 [architecture.md](../../architecture.md) 为准。请只编辑父文件，然后运行 `python3 scripts/sync_design_chapters.py`。

## 20. Correction、演化、审核与回滚

### 20.1 CorrectionService

~~~ts
export declare class CorrectionService {
  correct(
    input: CorrectInput,
    actor: ActorContext,
    context: MutationContext,
  ): Promise<CommitResult>;
}
~~~

Correction 是完整产品 mutation，不是 ingest + commit 两次提交。它保留以下 deterministic semantics：

1. boundary 把 CorrectionDraft 规范化为 AcceptedCorrection；text 经 material-text-v1，facet 缺省 `corrections.unassigned`，supersedes unique UTF-8 sorted，optional baseCandidateVersionId 只指向当前 active candidate。
2. 根据可信 actor 生成 direct_user 或 relayed provenance；正文通过通用 BlobStore put，MaterialId 仍绑定 request-stable correction source identity 与 provenance。
3. 从 current 或 exact active candidate 读取内容基线，应用一条 full-body user_asserted replacement claim；explicit targets 全部 supersededBy 同一 replacement。missing/already-superseded/duplicate/cycle invalid_input。
4. 以 transaction-time current 做 QualityGate before；candidate 只作为内容 baseline。supersedes 产生 correction_conflict，非 user actor 产生 relayed_correction，其余 mechanical reasons 与普通 commit 共用。
5. 派生 generation+1、完整 subject material membership、fresh no-lease pending、VersionId/Profile/prompt、current 或 suspended disposition。correction version 的 membership 只包含选定内容基线（current 或 exact active candidate）的 membership 与本次 correction material；其 materialSetHash、materialCount 和 quality 均由该版本集合派生。仅已 ingest、尚未进入内容基线的 research 继续留在 subject 集合中，pending 相对新的 current version membership 计算差集，不得因 correction 或后续 promote 被视为已蒸馏；只有无未处理材料时才允许 zero-delta pending。替代 candidate 时记录 derivedFromCandidateVersionId 并把旧 candidate 标 rejected。
6. 在一个 SQLite transaction 内重新校验 RequestId、subject revision、current/candidate 与 targets，然后提交 correction material reference、claim/evidence/version/membership、pointer/status、pending、stable result 与 events。

transaction commit 是唯一产品提交点；projection 在 LSN 后追赶。没有 CorrectionTransactionRecord、correction/version staging、`.deleting`、target-first recovery 或 correction-specific cleanup。precondition/validation failure 使 transaction 不发生或 rollback；已 put 但未引用的 blob 由通用 GC 处理。

### 20.2 ReviewService

~~~ts
export interface ReviewService {
  promote(
    input: PromoteVersionInput,
    actor: ActorContext,
    context: MutationContext,
  ): Promise<VersionSummary>;
  reject(
    input: RejectVersionInput,
    actor: ActorContext,
    context: MutationContext,
  ): Promise<VersionSummary>;
  rollback(
    input: RollbackVersionInput,
    actor: ActorContext,
    context: MutationContext,
  ): Promise<VersionSummary>;
}
~~~

promote/reject 在一个 SQLite transaction 中以 subject + active candidate revision 做 CAS：

- candidate 必须由 suspended disposition 创建、仍是唯一 active suspended、parentId 等于 transaction-time current；
- promote 把 previous current 变 historical、candidate 变 current，并相对新 current 重算 pending delta；
- reject 把 candidate 变 rejected，current 与现有 pending保持；
- operation/result、reason 与 event在同一transaction提交。

rollback 只接受同 subject 的 verified historical target和非空 reason。它不会把 pointer倒回旧 row，而是在一个 transaction 中创建新的 immutable current descendant：parent 是 transaction-time current，creation 记录 targetVersionId，claims/material membership/quality/render metadata复制目标的 immutable语义，actor/time/VersionId为本次 mutation，pending相对新current重排。active suspended 返回 review_conflict；current/suspended/rejected target invalid_input。

相同 RequestId exact replay返回stored result；不同input/actor conflict。两个并发动作由单writer顺序和transaction revision决定唯一合法终态，不需要ReviewDecisionTransactionRecord、RollbackTransactionRecord、version staging或恢复分支。

### 20.3 显式 redistill

redistill 是用户或后台 executor 显式要求“同一材料集重新蒸”。它必须记录：

- reason；
- executor 与 model metadata；
- promptVersion / draftSchemaVersion；
- baseVersionId；
- materialSetHash。

它创建新 job，不复用 ingest(auto)。commit 仍走同一 EvidenceResolver、patch、quality、version transaction。相同 material set 的 ordinary ingest 不触发 redistill。

### 20.4 编辑与删除

- displayName、aliases、identity hints 是 subject metadata，可以由用户编辑并以一个 transaction记 operation/event；历史 version 保留 version-time displayName。
- claim 不支持原地编辑；用户 correction 产生新 immutable version。
- reject 不删除 candidate。
- archive 只改 lifecycle。
- purge 是显式 privacy mutation；先原子移除数据库引用并写 content-free tombstone，再由generic GC物理删除零引用blob。
- renderer-only upgrade 产生新 immutable version或重建非权威export，取决于语义是否改变；不能静默改历史VersionId。

### 20.5 材料撤回

withdraw material 必须由用户显式发起。一个 transaction：

1. 校验 material属于subject且操作允许；
2. 从current material membership移除引用并generation+1；
3. 创建pending job或按产品规则要求review；
4. 写operation/event并提交。

已有历史 version 的 membership 与 lineage仍不可变；如果隐私要求删除正文，相关历史版本必须一起purge或变为明确不可读tombstone，不能留下指向已删blob的“正常版本”。doctor/backup/export必须清楚显示这种状态。

---
