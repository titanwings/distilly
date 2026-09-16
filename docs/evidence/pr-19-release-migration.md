# PR-19 · 迁移把旧内容导入证据脊柱 + 发布检查

- 分支：`dot-skill-test`（本地集成分支）
- 交付：`src/skill/migrate.mjs`（legacy 导入）、`src/commands/{migrate,harvest}.mjs`、
  `scripts/check_release.mjs`（新）、`tests/{schema-migration,release-check}.test.mjs`、CI、审计

## 1. 迁移的缺口（做发布检查时发现的真实缺陷）

`skill migrate` 原来只做三件事：建 v4 目录、写一个**空**账本、改 `schema_version`。
v3 skill 的材料在 `knowledge/{docs,messages,emails}/` 里——迁移之后它们仍在原地，
账本 0 条、`knowledge/text/` 是空的，**派生层依然看不到任何证据**。也就是说"迁移成功"
只体现在目录形状上。

现在迁移会把旧内容导入证据脊柱（复用 `harvest` 的解析分发，`documentFor` 改为导出）：

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 账本条目 | 0 | **2**（`k0001` / `k0002`，各带 `locations.raw` + `locations.text`） |
| `knowledge/text/` | 空 | 两份带 `[k0001]` 锚点的正文（消息日志保留 `老周：` 前缀） |
| `retrospect` | 无输入 | 产出 7 个派生文件（3 条可引用段落，低于最低样本 → 如实给"样本不足"） |
| 第二次迁移 | 0 changed | 0 changed（幂等） |
| 旧文件 | 原地 | **原地保留，不删不改**（指纹比对断言） |

细节：`origin` 用旧文件的路径，所以重复迁移按 sha256+origin 去重；
解析不了的文件进 `skipped` 并在 actions 里点名（不静默）；`migrateSkillDir` 的返回值
补齐 `imported: {files, entries, skipped}`——"已是最新"的早返回过去缺这个字段，
调用方得特判。

## 2. 发布检查（STATUS 里承诺过、一直缺席）

`scripts/check_release.mjs`：7 项发布卫生检查，每项都写出它读到了什么。

| # | 检查 | 现状 |
| --- | --- | --- |
| 1 | 版本三处一致（`package.json` / `--version` / `SKILL.md`）；`--tag` 时校验 tag | 1.0.0 / 1.0.0 / 1.0.0 |
| 2 | `SCHEMA_VERSION=4` + 账本 v2 + 迁移脚本在 + 幂等断言 | ✅ |
| 3 | 安装器携带 evidence spine（`knowledge/raw`、`knowledge/text`、`evidence`、`views`） | ✅ |
| 4 | 零运行时依赖 + 无 Python 残留 | dependencies 0 / tracked .py 0 |
| 5 | 生成物与源同步（模板 `--check` + 拼音表在） | ✅ |
| 6 | 门禁齐备且 CI 会跑（`node --test` / acceptance / prompt-lint / audit） | ✅ |
| 7 | 发布的文档都在（CONTRACT / ACCEPTANCE / STATUS / MIGRATION / IDENTITY / README） | 6/6 |

接进 CI（test job）与审计（16 → **17** 条），并有 2 条测试：全过；以及
`--tag v9.9.9` **必须失败**（证明它真的会红）。

## 3. 怎么验

```bash
node scripts/check_release.mjs                      # 7/7
node --test tests/*.test.mjs                        # 378 pass / 0 fail
node scripts/audit-objective.mjs --skip-acceptance  # 17/17
node bin/distilly.mjs skill migrate --base-dir <v3-skill>   # 导入旧内容，跑两次幂等
```

命令与产物原文：`dst-evidence/screenshots/pr-19-release-migration/migration-and-release.txt`。

## 4. 已知缺口

- 发布检查不校验 CHANGELOG（仓库没有该文件；要发版时再决定是否引入）。
- 迁移导入的是"文件形态"的旧内容；v3 时代若把材料直接写在 `persona.md`/`work.md` 里，
  那些是**生成物**而不是语料，迁移不会把它们当证据（这是有意的：正文由作者写，不是采集来的）。
