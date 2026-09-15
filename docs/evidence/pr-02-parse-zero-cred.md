# PR-02 · 零凭据解析：`knowledge/` 账本 + 锚点 + chat/subtitle/archive 解析

- 分支：`ds/02-parse-zero-cred`（6 个提交，已本地合并进 `dot-skill-test`）
- 依赖：契约（`docs/v2/CONTRACT.md`，由 #01 冻结）
- 交付：31 个文件 / +5 905 行

## 1. 变更

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | `05ff594` | 冻结 v2 契约：磁盘布局、回执形状、密钥纪律、computer-use 同意 |
| 2 | `6f95373` | `src/knowledge/store.mjs`：`knowledge/raw/` 字节保险库（逐字落盘 + 读回校验 + 路径逃逸拒绝） |
| 3 | `66bc96f` | `src/knowledge/{anchors,ledger}.mjs`：段落锚点分配、只增账本、`units`/`anchor_detail`、去重（sha256 + origin） |
| 4 | `34e20a3` | `src/parse/subtitle.mjs`：`.srt`/`.vtt` → 一条 cue 一个锚点单元（含说话人、时间码、字节区间） |
| 5 | `1fd53af` | `src/parse/common.mjs`：零依赖读共享 zip 容器（中央目录、CRC 校验、成员流式解压） |
| 6 | `6c42d88` | `src/parse/chat.mjs`：ChatGPT / Claude / Slack / Telegram / Discord / Instagram 导出，其余按名拒绝 |

新增文件：`src/knowledge/{store,anchors,ledger}.mjs`、`src/parse/{common,chat,subtitle}.mjs`、
`tests/{knowledge-store,knowledge-anchors,knowledge-ledger,parse-chat,parse-subtitle}.test.mjs`、
`tests/fixtures/parse/{chat,subtitle}/**`、`.gitattributes`（夹具按字节保真，禁换行转换）。

## 2. 磁盘契约（这一条定下来，后面所有分支都按它写）

```
skills/<family>/<slug>/knowledge/
  raw/<source>/…            原样字节，只增不改
  text/<source>.md          归一化正文，段落锚点 [k0012] / [k0012:t3]
  index.json                账本：{id,kind,origin,fetched_at,bytes,sha256,credentialed,method,warnings[]}
```

- **锚点必须能回指**：`resolveLedgerAnchor(ledger, anchor)` 返回文本与字节区间；
  容器里读出来的文本（OOXML 成员、去标签的 HTML）标 `synthetic` 且**报 null 字节区间**，不伪造偏移。
- **幂等**：同一份字节（sha256 相同且 origin 相同）重复导入不新增条目。
- **响亮拒绝**：不认识的格式按文件名进 warnings，不静默跳过。

## 3. 验收（当前树，可复算）

```bash
node --test tests/knowledge-store.test.mjs tests/knowledge-anchors.test.mjs \
            tests/knowledge-ledger.test.mjs tests/parse-chat.test.mjs tests/parse-subtitle.test.mjs
node scripts/acceptance.mjs      # harvest / 账本 / 幂等 / 锚点回指四个阶段
```

`scripts/acceptance.mjs` 里与本条直接相关的断言：回执形状（sha256 + 字节数）、
重复 harvest 幂等、账本里有锚点、派生结论锚点全部可回指。

## 4. 后续修复（合并后由集成轮补上，见后续 PR 文档）

- `assignAnchorsToText` 曾把段落渲染成 `k0012 text`（无方括号），而本条的读者要求
  `[k0012] text`：派生层因此恒为空。修法与前后对比见
  `docs/evidence/pr-09-evidence-spine-blind-test.md`。
- 归一化正文曾丢掉说话人与时间（本条的 parser 有元数据，但没进正文）：修法与前后对比见
  `docs/evidence/pr-11-attribution.md`。

## 5. 回滚

- `src/knowledge/**` 与 `src/parse/**` 是后面所有解析命令的地基：回滚本条会让
  `harvest` / `parse-*` / `retrospect` 全部失效，需回滚到 #01 的 CLI 骨架状态。
- `.gitattributes` 的字节保真规则不要单独 revert：夹具在 CRLF 平台上会被改写，测试随之漂移。
