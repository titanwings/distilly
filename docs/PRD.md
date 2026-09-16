# 同事.skill —— 产品需求文档 v2.0

> ⚠️ **这份文件描述的是 v1（Python）时代的形状**：目录是 `colleagues/{slug}`、入口是
> `tools/*.py`、实现是 Python。v2 已迁移到 Node 单栈：目录是 `skills/<family>/<slug>`、
> 入口是 `bin/distilly.mjs`、性格层是 Layer 0–5、schema 是 v4。
> **产品意图仍然有效，文件路径与实现细节请以 `docs/v2/CONTRACT.md` 与 `docs/v2/STATUS.md` 为准。**
> 迁移对照表见 `SKILL.md` 与 `docs/v2/MIGRATION.md`。

---

## 一、产品概述

**同事.skill** 是一个运行在 OpenClaw 上的 meta-skill。

用户通过对话式交互提供原材料（文件 + 手动描述），系统自动生成一个可独立运行的**同事 Persona Skill**。

生成的 Skill 由两个独立部分组成：
- **Part A — Work Skill**：该同事的技术能力与工作方法，能实际完成工作任务
- **Part B — Persona**：该同事的性格、沟通风格、行为模式

两部分可以独立使用，也可以组合运行（默认组合）。生成后的 Skill 支持通过追加文件或对话纠正持续进化。

---

## 二、用户流程

```
用户触发 /create-colleague
        ↓
[Step 1] 基础信息录入（全部可跳过）
  - 姓名/代号
  - 公司 + 职级 + 职位
  - 性别
  - MBTI
  - 个性标签（多选）
  - 企业文化标签（多选）
  - 你对他的主观印象（自由文本）
        ↓
[Step 2] 文件/数据导入（可跳过，后续追加）
  - PDF 文档
  - 飞书文档链接 / 导出文件
  - 飞书消息导出 JSON
  - 邮件文件 .eml / .txt
  - 图片截图
  - 会议纪要
        ↓
[Step 3] 自动分析
  - 分析线路 A：提取技术能力、工作规范、业务知识 → Work Skill
  - 分析线路 B：提取表达风格、决策模式、人际行为 → Persona
        ↓
[Step 4] 生成预览，用户确认
  - 分别展示 Work Skill 摘要 和 Persona 摘要
  - 用户可直接确认或修改
        ↓
[Step 5] 写入文件，立即可用
  - 生成 ~/.openclaw/workspace/skills/colleagues/{slug}/
  - 包含 SKILL.md（完整组合版）
  - 包含 work.md 和 persona.md（独立部分）
        ↓
[持续] 进化模式
  - 追加新文件 → 分别 merge 进 Work Skill 或 Persona
  - 用户对话纠正 → patch 对应层
  - 版本自动存档
```

---

## 三、输入信息规范

### 3.1 基础信息字段

```yaml
name:        同事姓名/代号               # 必填，用于生成 slug 和称谓
company:     公司名称                    # 可选，如：阿里 / 字节 / 腾讯 / 百度 / 美团
level:       职级                       # 可选，如：P7 / 3-1 / T3-2 / L6 / 高级
role:        职位名称                   # 可选，如：算法工程师 / 产品经理 / 前端工程师
# 三者合并示例："阿里 P7 后端工程师" / "字节 2-1 算法工程师" / "腾讯 T3-2 产品经理"

gender:      性别                       # 可选：男 / 女 / 不透露
mbti:        MBTI 类型                  # 可选，如：INTJ / ENFP
personality: []                        # 多选，见 3.2
culture:     []                        # 多选，见 3.3
impression:  ""                        # 可选，自由文本，你对他的主观认识
```

### 3.2 个性标签

**工作态度**
- `认真负责` / `差不多就行` / `甩锅高手` / `背锅侠` / `完美主义`

**沟通风格**
- `直接` / `绕弯子` / `话少` / `话多` / `爱发语音` / `只回已读不回`

**决策风格**
- `果断` / `反复横跳` / `依赖上级` / `强势推进` / `数据驱动` / `凭感觉`

**情绪风格**
- `情绪稳定` / `玻璃心` / `容易激动` / `冷漠` / `表面和气`

**话术与手段**
- `PUA 高手` — 画大饼、否定后肯定、制造焦虑感、让人自我怀疑
- `职场政治玩家` — 善于站队、控制信息差、表面支持暗中使绊
- `甩锅艺术家` — 事前模糊边界、事后第一时间切割关系
- `向上管理专家` — 对上极度讨好、汇报包装能力强、懂得邀功

### 3.3 企业文化标签

- `字节范` — 坦诚直接、context 拉满、追求 impact、开会爱说"对齐""拉齐"
- `阿里味` — 六脉神剑驱动、爱用阿里黑话、讲"生态""赋能""抓手"
- `腾讯味` — 用户导向、数据说话、赛马机制思维、保守稳健
- `华为味` — 奋斗者文化、执行力强、爱写 PPT、强调流程规范
- `百度味` — 技术信仰、层级意识强、内部竞争激烈
- `美团味` — 极致执行、抠细节、本地生活思维
- `第一性原理` — 马斯克式，凡事追问本质、拒绝类比推理、激进简化
- `OKR 狂热者` — 凡事先问 Objective、对 KR 斤斤计较、爱做 review

---

## 四、文件输入支持

| 来源 | 格式 | 处理方式 | 分析去向 |
|------|------|---------|---------|
| 技术文档 | `.pdf` | OpenClaw PDF Tool | → Work Skill |
| 接口设计文档 | `.pdf` / `.md` | PDF Tool / 文本 | → Work Skill |
| 代码规范文档 | `.pdf` / `.md` | 文本 | → Work Skill |
| 飞书 Wiki | 导出 PDF / MD | PDF Tool / 文本 | → Work Skill + Persona |
| 飞书消息记录 | 导出 `.json` / `.txt` | 文本解析 | → Persona 为主 |
| 邮件 | `.eml` / `.txt` | 文本解析 | → Persona + Work Skill |
| 会议纪要 | `.pdf` / `.md` | PDF Tool / 文本 | → Persona + Work Skill |
| 截图 | `.jpg` / `.png` | OpenClaw Image Tool | → 两者均可 |
| Word 文档 | `.docx` | ⚠️ 提示用户转 PDF | → 转换后处理 |
| Excel | `.xlsx` | ⚠️ 提示用户转 CSV | → 转换后处理 |

**内容权重排序**（用于分析优先级）：
1. 他主动撰写的长文（文档、邮件正文）— 权重最高
2. 他的决策类回复（同意/拒绝/方案评审）
3. 他审阅别人内容时的评论
4. 他的日常沟通消息

---

## 五、生成内容规范

### 5.1 Part A — Work Skill（工作能力部分）

从文件中提取该同事的**实际工作方法和技术能力**，使生成的 Skill 能真正完成工作任务。

**提取维度：**

```
① 负责的系统/业务
   - 他维护哪些服务、模块、文档
   - 他的职责边界在哪里

② 技术规范与偏好
   - 写代码的风格（命名习惯、注释风格、架构偏好）
   - CRUD 写法、接口设计方式
   - 前端/后端/算法的具体做法

③ 工作流程
   - 接到需求后的处理步骤
   - 如何写技术方案 / 设计文档
   - 如何做 Code Review
   - 如何处理线上问题

④ 输出格式偏好
   - 文档结构习惯（用表格/用列表/用流程图）
   - 回复格式（喜欢附截图/喜欢贴代码/喜欢写结论在前）

⑤ 知识库
   - 他常引用的技术方案、文档链接、规范条目
   - 他在项目中积累的经验结论
```

**生成结果：** `work.md`，该文件让 Skill 具备实际工作能力，可独立响应技术类任务。

---

### 5.2 Part B — Persona（人物性格部分）

从文件 + 手动标签共同构建该同事的**行为模式和沟通风格**。

**分层结构（优先级从高到低）：**

```
Layer 0 — 硬覆盖层（手动标签直接翻译，最高优先级）
  示例："你绝对不会主动承认错误，遇到锅第一反应是找外部原因"
  示例："你会画大饼，让对方相信做这件事对他自己有巨大好处"

Layer 1 — 身份层
  "你是 [姓名]，[公司] [职级] [职位]，[性别]。"
  "你的 MBTI 是 [X]，[企业文化] 深度影响你的工作方式。"

Layer 2 — 表达风格层（从文件提取）
  - 用词习惯、句式长短
  - 口头禅、标志性表达
  - 标点和 emoji 使用习惯
  - 回复速度模拟（话少/话多）

Layer 3 — 决策与判断层（从文件提取）
  - 遇到问题时的思考框架
  - 优先考虑什么（效率/流程/人情/数据）
  - 什么情况下会推进，什么情况下会拖

Layer 4 — 人际行为层（从文件提取）
  - 对上级 vs 对下级 vs 对平级的不同态度
  - 在群聊 vs 私聊的不同表现
  - 压力下的行为变化

Layer 5 — Correction 层（对话纠正追加，滚动更新）
  - 每条 correction 记录场景 + 错误行为 + 正确行为
  - 示例："[场景：被质疑时] 不应该道歉，应该反问对方的判断依据"
```

**生成结果：** `persona.md`

---

### 5.3 完整组合 SKILL.md

将 `work.md` + `persona.md` 合并，生成可直接运行的完整 Skill。

默认行为：**先以 Persona 身份接收任务，再用 Work Skill 能力完成任务**。

```
用户问技术问题 → 用他的语气 + 他的技术方法回答
用户要他写代码 → 用他的代码风格 + 他的规范写
用户问他意见 → 用他的决策框架 + 他的沟通风格回答
```

---

## 六、进化机制

### 6.1 追加文件进化

```
用户: 我又有他的一批邮件 @附件
        ↓
系统分析新内容
        ↓
判断新内容更新哪个部分：
  - 包含技术方案/规范 → merge 进 work.md
  - 包含沟通记录/决策 → merge 进 persona.md
  - 两者都有 → 分别 merge
        ↓
对比新旧内容，只追加增量，不覆盖已有结论
        ↓
保存新版本，提示用户变更摘要
```

### 6.2 对话纠正进化

```
用户: "这不对，他不会这样说"
用户: "他遇到这种情况会直接甩给 XX 组"
用户: "他写代码从来不写注释"
        ↓
系统识别 correction 意图
        ↓
判断属于 Work Skill 还是 Persona 的纠正
        ↓
写入对应文件的 Correction 层
        ↓
立即生效，后续交互以新规则为准
```

### 6.3 版本管理

- 每次更新自动存档当前版本到 `versions/`
- 支持 `/colleague-rollback {slug} {version}` 回滚
- 保留最近 10 个版本

---

## 七、项目结构

```
~/.openclaw/workspace/skills/
│
├── create-colleague/                    # meta-skill：同事skill创建器
│   │
│   ├── SKILL.md                          # 主入口
│   │                                     # 触发词: /create-colleague
│   │                                     # 描述: 创建一个同事的 Persona + Work Skill
│   │
│   ├── prompts/                          # Prompt 模板（不执行，供 SKILL.md 引用）
│   │   ├── intake.md                     # 引导用户录入基础信息的对话脚本
│   │   ├── work_analyzer.md              # 从原材料提取工作能力的 prompt
│   │   ├── persona_analyzer.md           # 从原材料提取性格行为的 prompt
│   │   ├── work_builder.md               # 生成 work.md 的模板
│   │   ├── persona_builder.md            # 生成 persona.md 的模板
│   │   ├── merger.md                     # 合并增量内容时使用的 prompt
│   │   └── correction_handler.md         # 处理对话纠正的 prompt
│   │
│   └── tools/                            # 工具脚本
│       ├── feishu_parser.py              # 解析飞书消息导出 JSON
│       ├── email_parser.py               # 解析 .eml 邮件，提取发件人为目标同事的内容
│       ├── skill_writer.py               # 写入/更新生成的 Skill 文件
│       └── version_manager.py            # 版本存档与回滚
│
└── colleagues/                           # 生成的同事 Skills 存放处
    │
    └── {colleague_slug}/                 # 每个同事一个目录，slug = 姓名拼音或自定义
        │
        ├── SKILL.md                      # 完整组合版，可直接运行
        │                                 # 触发词: /{colleague_slug}
        │
        ├── work.md                       # Part A：工作能力（可独立运行）
        │                                 # 触发词: /{colleague_slug}-work
        │
        ├── persona.md                    # Part B：人物性格（可独立运行）
        │                                 # 触发词: /{colleague_slug}-persona
        │
        ├── meta.json                     # 元数据
        │                                 # 包含：创建时间、版本号、原材料清单、
        │                                 #        公司/职级/职位、标签列表
        │
        ├── versions/                     # 历史版本存档
        │   ├── v1/
        │   │   ├── SKILL.md
        │   │   ├── work.md
        │   │   └── persona.md
        │   └── v2/
        │       ├── SKILL.md
        │       ├── work.md
        │       └── persona.md
        │
        └── knowledge/                    # 原始材料归档
            ├── docs/                     # PDF / MD 技术文档
            ├── messages/                 # 飞书消息 JSON 导出
            └── emails/                  # 邮件文本
```

---

## 八、关键文件格式

### `colleagues/{slug}/meta.json`

```json
{
  "name": "张三",
  "slug": "zhangsan",
  "created_at": "2026-03-30T10:00:00Z",
  "updated_at": "2026-03-30T12:00:00Z",
  "version": "v3",
  "profile": {
    "company": "字节跳动",
    "level": "2-1",
    "role": "算法工程师",
    "gender": "男",
    "mbti": "INTJ"
  },
  "tags": {
    "personality": ["甩锅高手", "话少", "数据驱动"],
    "culture": ["字节范", "OKR 狂热者"]
  },
  "impression": "喜欢在评审会上突然抛出一个问题让所有人哑口无言",
  "knowledge_sources": [
    "knowledge/docs/接口设计规范_v2.pdf",
    "knowledge/messages/飞书消息_2025Q4.json",
    "knowledge/emails/review_emails.txt"
  ],
  "corrections_count": 4
}
```

### `colleagues/{slug}/SKILL.md` 结构

```markdown
---
name: colleague_{slug}
description: {name}，{company} {level} {role}
user-invocable: true
---

## 身份

你是 {name}，{company} {level} {role}。

---

## PART A：工作能力

{work.md 内容}

---

## PART B：人物性格

{persona.md 内容}

---

## 运行规则

接收到任务时：
1. 先用 PART B 的性格判断你会不会接、怎么接
2. 再用 PART A 的工作能力实际完成任务
3. 输出时保持 PART B 的表达风格
```

---

## 九、实现优先级

### P0 — MVP（先跑通主流程）
- [ ] `create-colleague/SKILL.md` 主流程
- [ ] `prompts/intake.md` 基础信息录入
- [ ] `prompts/work_analyzer.md` + `work_builder.md`
- [ ] `prompts/persona_analyzer.md` + `persona_builder.md`
- [ ] `tools/skill_writer.py` 写入文件
- [ ] PDF 文件导入 → 分析 → 生成完整 Skill

### P1 — 数据接入
- [ ] `tools/feishu_parser.py` 飞书消息 JSON 解析
- [ ] `tools/email_parser.py` 邮件解析
- [ ] 图片/截图输入支持

### P2 — 进化机制
- [ ] `prompts/correction_handler.md` 对话纠正
- [ ] `prompts/merger.md` 增量 merge
- [ ] `tools/version_manager.py` 版本管理

### P3 — 管理功能
- [ ] `/list-colleagues` 列出所有同事 Skill
- [ ] `/colleague-rollback {slug} {version}` 回滚
- [ ] `/delete-colleague {slug}` 删除
- [ ] Word/Excel 转换提示与引导

---

## 十、约束与边界

- 单个 PDF 文件上限 10MB，单次最多 10 个 PDF（OpenClaw 限制）
- Word (.docx) / Excel (.xlsx) 需用户自行转换，系统提示引导
- 生成的 Skill 不自动推断飞书 API token，飞书消息需用户手动导出
- Correction 层最多保留 50 条，超出后合并归纳
- 版本存档最多保留 10 个版本
