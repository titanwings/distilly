# 语料来源与许可 / Source and licence

| 项 | 值 |
| --- | --- |
| 标题 | House Proceeding 07-29-09 (U.S. House of Representatives floor proceedings) |
| 说话人 | 真实在任议员（THE SPEAKER PRO TEMPORE、MR. LEWIS、MR. CAMP、MR. OBERSTAR、MR. MCDERMOTT、MR. NEAL、MR. FLAKE、MR. BLUMENAUER …） |
| 来源 URL | https://archive.org/details/mv_house_proceeding_07-29-09_02 |
| 字幕文件 | https://archive.org/download/mv_house_proceeding_07-29-09_02/mv_house_proceeding_07-29-09_02.srt |
| 发布者 | C-SPAN / archive.org `us_congress` 合集 |
| 许可 | Public domain（存档页标注 `http://creativecommons.org/licenses/publicdomain/`；美国联邦政府的作品依 17 U.S.C. §105 不受版权保护） |
| 获取日期 | 2026-09-15 |
| 大小 | 84 860 B，1 346 条 cue，时间跨度 00:00:00 → 00:47:26 |
| SHA-256 | 见 `git log` 首次提交；文件原样入库，未做任何改写 |

## 为什么用它

`tests/fixtures/public-corpus/README.md` 要求验收语料「许可清晰、**不是真人私聊**、小、含多说话人与时间跨度」。
这份材料同时满足：真实人声、多个具名说话人、47 分钟跨度、公共领域、84 KB。
它与 `synthetic-interview/` 的区别是**真实**：合成语料只能验证「流程正确」，
这份能验证「在真实语音转写的噪音下仍然正确」——例如首条 cue 是转写工具写下的
`starttime 1248896221.592` 头部、大小写全大写、句子被切成 3 秒一行。

## 未做的事

原样使用：没有去重、没有规整大小写、没有重切句子。锚点指向的就是这份文件里
的字节，改动它等于改动证据。
