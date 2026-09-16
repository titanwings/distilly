# PR-16 · Discord 与 Notion 两个采集渠道

- 分支：`ds/16-discord-notion`（本地，已合并进 `dot-skill-test`）
- 交付：`src/collect/kit.mjs`、`src/collect/discord.mjs`、`src/collect/notion.mjs`、
  `src/parse/chat.mjs`（透传 method / 凭据来源 / 认 `author.username`）、
  `src/commands/credentialed.mjs`、`tests/collect-discord-notion.test.mjs`

## 1. 为什么

`CONTRACT.md` §1 的采集命令行写着 8 个渠道，此前只实现 4 个（飞书/Slack/钉钉/X）。
未实现的两个渠道此前回 `collect/planned-channel` 并写明所需凭据——诚实，但仍是缺口。
这一轮把 Discord（bot token）与 Notion（内部集成 token）补上，`PENDING_CHANNELS`
从 4 条缩到 2 条（reddit / gmail）。

## 2. 三条纪律，与已有渠道一致

| 纪律 | 实现 |
| --- | --- |
| 只读 | Discord 读 API 全是 GET，白名单就只列 GET；Notion 的读路径几乎全是 POST（search / 数据库查询），白名单**显式**列出这两个 POST 并拒绝其它一切。越权动词在建立连接之前被拒 |
| 凭据不进回执 | 只允许出现配置文件名（`discord_config.json` / `notion_config.json`）；`redact`/`scrub` 覆盖回执的每个字段（含嵌套数组） |
| 逐字入库 + 可派生 | 原始页 verbatim 落 `knowledge/raw/<channel>/`，同一次采集把它变成带锚点正文（Discord 交给**已有的导出解析器**，Notion 走段落化），一页/一页一个账本条目 |

分页与限流：Discord 用 `before` 游标（一页不足 page size 即结束），429 读 body 里的
`retry_after`（**秒**）退避——测试断言睡的是 1500ms；Notion 用 `next_cursor`。
两处都支持断点续采（游标写在 `$DISTILLY_HOME/state/`）。

## 3. 顺带修好的两处解析器透传

- `parseChat` 现在尊重调用方的 `method` 与 `credentialed/credential_source/credential_file`：
  导出来的是 `user-export`，API 采集来的是 `api-bot-token`——否则采集来的页面会在账本里
  冒充用户导出。
- 说话人取名认 REST 的 `author.username`（导出用 `name`，API 用 `username`）：
  同一批消息无论是下载的还是采集的，人名一致（`林工` 而不是 `u1`）。
- 顺带的一致性变化：chat 的正文文件名现在随 harvest 的 source 标签（默认取输入目录名），
  与其它格式一致；`--source chat` 可恢复旧名。

## 4. 怎么验

```bash
node --test tests/collect-discord-notion.test.mjs   # 10 条
node --test tests/*.test.mjs                        # 364 pass / 0 fail
node bin/distilly.mjs doctor                        # Planned channels: collect reddit, collect gmail
```

测试覆盖：两页分页（游标串接 + 逐字字节 + 锚点正文 + 一页一条目）、429 退避毫秒数、
缺凭据零写入、写动词被拒、Notion 页面 → 段落（跳过块点名）、Notion 白名单（两个 POST 放行、
`POST /v1/pages` 与 `PATCH` 拒绝）、页面 id 从 URL 解析与坏 id 响亮失败、空页面不算空文档、
kit 的脱敏与凭据查找（环境变量 / 配置文件 / legacy 路径 / 非法 JSON）。

## 5. 已知缺口

- **reddit / gmail 仍未实现**（各自需要什么写在 `PENDING_CHANNELS`，`doctor` 会列出）。
- Discord 的线程/回复关系、Notion 的数据库行查询（白名单已放行 `POST
  /v1/databases/{id}/query`，但 CLI 尚未暴露 `--database-id`）留待后续。
- Discord 附件、Notion 的图片与嵌入块不anchored，按类型计入 warnings。
