# PR-17 · Reddit 与 Gmail：契约的采集渠道全部实现

- 分支：`ds/17-reddit-gmail`（本地，已合并进 `dot-skill-test`）
- 交付：`src/collect/reddit.mjs`、`src/collect/gmail.mjs`、`src/parse/email.mjs`（透传 method/凭据来源）、
  `src/commands/credentialed.mjs`（渠道注册 + 待实现表清空）、`tests/collect-reddit-gmail.test.mjs`
- 依赖：`src/collect/kit.mjs`（PR-16 抽出的共享管道）

## 1. 结果

`CONTRACT.md` §1 列了 8 个采集渠道，此前 6 个。这一轮补上最后两个，
**`PENDING_CHANNELS` 清空**：`doctor` 打印 `Planned channels：none`，
审计的渠道行从"仍未移植"变成"契约的采集渠道全部实现"。

| 渠道 | 鉴权 | 只读保证 | 分页 | 归一化 |
| --- | --- | --- | --- | --- |
| `collect reddit --target <subreddit\|username> [--kind user]` | OAuth client credential（`POST /api/v1/access_token`，Basic 头） | 白名单只有这一个 POST + 四个 GET 前缀；`/api/submit`、`/api/vote` 一类在建连前被拒 | `after` 游标（Listing 的 `data.after`） | 评论 → `ISO 作者：正文` 锚点段落 |
| `collect gmail [--query <搜索>]` | OAuth refresh token（`POST /token` 换 access token） | 白名单只有这一个 POST + `/gmail/v1/users/` 的 GET | `nextPageToken`，`--max-messages` 封顶 | **raw MIME 交给已有的邮件解析器** |

## 2. 两处值得记录的设计

- **Gmail 不重写邮件解析**：取回 `format=raw` 的 MIME 字节，直接构造 `SourceFile` 交给
  `parseEmail`——头部 RFC 2047 解码、按段 charset、`text/plain` 优先回退 HTML、
  附件只登记并进 warnings，全部与本地 `.eml` 同一条实现。access token 中途过期时
  自动再换一次并继续（测试断言换了两次、运行未中断）。
- **Reddit 的占位符不当成发言**：`[deleted]` / `[removed]` / `more` 逐类跳过并在 warnings 点名，
  绝不把平台占位符锚成"某人说过的话"。

## 3. 顺带修好的一处透传

`parseEmail` 现在像 `parseChat` 一样尊重调用方的 `method` 与
`credentialed/credential_source/credential_file`：本地 `.eml` 是 `local-file`，
Gmail 取回的是 `api-oauth-refresh`，账本条目因此不会互相冒充。

## 4. 怎么验

```bash
node --test tests/collect-reddit-gmail.test.mjs   # 7 条
node --test tests/*.test.mjs                      # 371 pass / 0 fail
node bin/distilly.mjs doctor                      # Planned channels: none
node scripts/audit-objective.mjs --skip-acceptance # 16/16（渠道行不再是缺口）
```

测试覆盖：两页 `after` 游标 + Basic/Bearer 两条鉴权路径 + 逐字字节 + 锚点段落、
占位符与 `more` 跳过、401 响亮失败且零写入、写动词被拒、Gmail 刷新流程与 raw MIME
交给邮件解析器（断言 subject / 发件人 / 正文都进了正文）、access token 过期自动重换、
凭据被拒零写入、渠道表已满。

## 5. 已知缺口

- **推送与 PR 仍未执行**（用户冻结）；解冻后的清单在 `dst-evidence/PR-BODIES/PR-PLAN.md`。
- 各渠道的细粒度能力仍有取舍：Reddit 未取 submission（只有评论），
  Gmail 未处理 `format=full` 的结构化正文（raw 已覆盖），
  Discord 线程/回复关系、Notion 数据库行查询的 CLI 入口（白名单已放行）留待后续。
- 采集到的语料仍受渠道本身限制（例如飞书开放平台页只有 `sender.id`）；跨渠道身份靠
  `identity.json` 显式声明（PR-15）。
