# Distilly 安装说明

> Distilly 原名 **Colleague Skill / colleague-skill（原同事 Skill）**。当前创建器名称与安装目录均为 `distilly`。

---

<a id="existing-install-migration"></a>

## 从旧安装迁移

如果现有 clone 的目录仍叫 `dot-skill`，只执行 `git pull` 不会把宿主发现目录改名为 `distilly`；Codex 的旧目录 `~/.codex/skills/` 也不会自动迁移到当前的 `~/.agents/skills/`。请保留旧副本作为回退，先安装并验证新的 canonical 副本：

| 宿主 | 一次性迁移到 |
|------|--------------|
| Claude Code | `~/.claude/skills/distilly` 或项目 `.claude/skills/distilly` |
| OpenClaw | 从旧 clone 根目录运行 `python3 tools/install_openclaw_skill.py --force` |
| Hermes | 从旧 clone 根目录运行 `python3 tools/install_hermes_skill.py --force` |
| Codex | 从旧 clone 根目录运行 `python3 tools/install_codex_skill.py --force`，目标为 `~/.agents/skills/distilly` |
| DeepSeek Harness | 重新 clone 到 `~/.dsh/skills/distilly`、`$DSH_HOME/skills/distilly` 或项目 `.dsh/skills/distilly` |
| Pi coding agent | 重新 clone 到 `~/.pi/agent/skills/distilly` 或 `~/.agents/skills/distilly` |
| Grok Build | 重新 clone 到 `~/.grok/skills/distilly` 或 `~/.agents/skills/distilly` |
| OpenCode | 重新 clone 到 `~/.config/opencode/skills/distilly` 或项目 `.opencode/skills/distilly` |

用下文对应方式确认宿主已经发现 Distilly 后，再自行处理旧安装目录；安装器不会自动删除旧副本。`~/.colleague-skill/` 配置和旧人物 Skill metadata 的只读兼容回退也不会自动重命名宿主安装目录。

---

## 选择你的平台

### A. Claude Code（推荐）

本项目遵循官方 [AgentSkills](https://agentskills.io) 标准，整个 repo 就是 skill 目录。克隆到 Claude skills 目录即可：

```bash
# ⚠️ 必须在 git 仓库根目录执行！
cd $(git rev-parse --show-toplevel)

# 方式 1：安装到当前项目
mkdir -p .claude/skills
git clone https://github.com/titanwings/distilly .claude/skills/distilly

# 方式 2：安装到全局（所有项目都能用）
git clone https://github.com/titanwings/distilly ~/.claude/skills/distilly
```

然后在 Claude Code 中输入 `/distilly` 即可启动。

兼容宿主：
- Claude Code
- OpenClaw
- Hermes
- Codex
- DeepSeek Harness
- Pi coding agent
- Grok Build
- OpenCode

各宿主的显式调用语法不同：

| 宿主 | 创建器命令 |
|------|------------|
| Claude Code | `/distilly` |
| Hermes | `/distilly` |
| OpenClaw | `/distilly`；未注册 native slash 时用 `/skill distilly` |
| Codex | `$distilly` 或在 `/skills` 中选择 |
| DeepSeek Harness | `/distilly` |
| Pi coding agent | `/skill:distilly` |
| Grok Build | `/distilly` |
| OpenCode | 由原生 Skill 工具按需加载，无独立 slash 命令 |

如果 Distilly 已经生成了某个人物 Skill，并且你希望它在某个宿主里直接可用，再执行对应安装器：

```bash
python3 tools/install_claude_generated_skill.py --skill-dir skills/{character}/{slug} --force
python3 tools/install_openclaw_generated_skill.py --skill-dir skills/{character}/{slug} --force
python3 tools/install_codex_generated_skill.py --skill-dir skills/{character}/{slug} --force
```

生成的 Skill 名称是 `{character}-{slug}`。在 Claude Code / Hermes / DeepSeek Harness / Grok Build 等 slash-name 宿主里，调用格式是：

```text
/{character}-{slug}
```

在 Codex 中用 `$` 调用：

```text
${character}-{slug}
```

在 Pi 中使用 `/skill:{character}-{slug}`。

Windows 上 Claude 安装器还会额外写入 `~/.claude/commands/{character}-{slug}.md`，用来绕过当前的 skill 发现问题。

生成的 Skill 会按 character family 写入：
- `colleague` → `./skills/colleague/`
- `relationship` → `./skills/relationship/`
- `celebrity` → `./skills/celebrity/`

如果目标 `{character}/{slug}` 已经存在，创建器会停止，不会改写原来的文件。请通过进化模式更新已有 Skill；使用 CLI 时改用 `--action update`，不要删除旧目录后重新创建。例外是命令明确提示本次创建失败、目录可能不完整：先检查该目录，只有确认它就是要丢弃的失败产物时才手动删除，然后重试 `create`。

用于宿主调用的 `SKILL.md` 已经自包含 Persona + Work。安装生成 Skill 时使用统一安装器；它只写入这一文件和 `.distilly-install.json`，不会复制可能含有私有原材料的整个生成目录。对于旧版下划线 frontmatter，安装器只在安装副本中规范为 `{character}-{slug}`，不会修改源 Skill：

```bash
python3 tools/install_generated_skill.py \
  --skill-dir "skills/{character}/{slug}" \
  --host <host> \
  --force
```

| 宿主 | `<host>` | 默认用户级目标 | 项目级 `--skills-dir` |
|------|----------|----------------|----------------------|
| Claude Code | `claude-code` | `~/.claude/skills/{character}-{slug}/SKILL.md` | `.claude/skills` |
| OpenClaw | `openclaw` | `~/.openclaw/workspace/skills/{character}-{slug}/SKILL.md` | 自定义 Skills 目录 |
| Hermes | `hermes` | `~/.hermes/skills/distilly-generated/{character}-{slug}/SKILL.md` | `.hermes/skills`（可信项目） |
| Codex | `codex` | `~/.agents/skills/{character}-{slug}/SKILL.md` | `.agents/skills` |
| DeepSeek Harness | `deepseek-harness` | `~/.dsh/skills/{character}-{slug}/SKILL.md` | `.dsh/skills` |
| Pi coding agent | `pi` | `~/.pi/agent/skills/{character}-{slug}/SKILL.md` | `.pi/skills` |
| Grok Build | `grok-build` | `~/.grok/skills/{character}-{slug}/SKILL.md` | `.grok/skills` |
| OpenCode | `opencode` | `~/.config/opencode/skills/{character}-{slug}/SKILL.md` | `.opencode/skills` |

---

### B. OpenClaw

```bash
python3 tools/install_openclaw_skill.py --force
```

或者继续使用 clone 方式：

```bash
git clone https://github.com/titanwings/distilly ~/.openclaw/workspace/skills/distilly
```

重启 OpenClaw session，用 `/distilly` 启动 Distilly；如果当前 channel 没有注册 native slash，使用 `/skill distilly`。

---

### C. Hermes

推荐直接用仓库内的安装器，把当前 repo 同步到 Hermes 的本地 skill 目录：

```bash
python3 tools/install_hermes_skill.py --force
hermes skills list | rg distilly
```

安装完成后，在 Hermes 中使用：

```text
/distilly
```

人物 Skill 用 `install_generated_skill.py --host hermes` 安装后，以 `/{character}-{slug}` 调用。项目级安装追加 `--skills-dir .hermes/skills`，并先在项目根目录运行 `hermes skills trust`。安装后新开 session，或用 `/reload-skills` 重新扫描。`~/.agents/skills` 不是 Hermes 默认目录；只有在 `~/.hermes/config.yaml` 的 `skills.external_dirs` 中显式配置后才会扫描。

如果只是预览安装目标，可以先跑：

```bash
python3 tools/install_hermes_skill.py --dry-run
```

---

### D. Codex

推荐直接用仓库内的安装器，把当前 repo 同步到 Codex 的本地 skill 目录：

```bash
python3 tools/install_codex_skill.py --force
```

或者继续使用 clone 方式：

```bash
git clone https://github.com/titanwings/distilly ~/.agents/skills/distilly
```

Codex 当前从 `~/.agents/skills/` 发现用户 Skill。安装后用 `$distilly` 显式调用，或通过 `/skills` 选择。生成后的人物 Skill 会以 `{character}-{slug}` 的技能名安装在 `~/.agents/skills/` 下。

---

### E. DeepSeek Harness

DeepSeek Harness 原生发现 filesystem skill，不需要额外插件清单或包装脚本。任选一种安装范围：

```bash
# 方式 1：安装到当前项目
mkdir -p .dsh/skills
git clone https://github.com/titanwings/distilly .dsh/skills/distilly

# 方式 2：安装到全局（所有项目都能用）
mkdir -p ~/.dsh/skills
git clone https://github.com/titanwings/distilly ~/.dsh/skills/distilly
```

如果设置了 `DSH_HOME`，全局目录对应为 `$DSH_HOME/skills/distilly`。安装后在 DeepSeek Harness 中输入 `/distilly`，或直接要求 Agent 启动 Distilly。

生成后的角色 Skill 使用 `install_generated_skill.py --host deepseek-harness` 安装；项目级安装追加 `--skills-dir .dsh/skills`。安装器会在副本中规范旧版 frontmatter。

---

### F. Pi coding agent

> 这里的 Pi 是 [pi.dev](https://pi.dev/docs/latest/skills) 的 coding agent。

```bash
# Pi 专用的用户目录
mkdir -p ~/.pi/agent/skills
git clone https://github.com/titanwings/distilly ~/.pi/agent/skills/distilly

# 或使用多宿主共享目录
mkdir -p ~/.agents/skills
git clone https://github.com/titanwings/distilly ~/.agents/skills/distilly
```

显式调用命令是 `/skill:distilly`，不是 `/distilly`。

生成的人物 Skill 使用 `install_generated_skill.py --host pi` 安装；项目级安装追加 `--skills-dir .pi/skills`，随后用 `/skill:{character}-{slug}` 调用。

---

### G. Grok Build

```bash
# Grok 专用的用户目录
mkdir -p ~/.grok/skills
git clone https://github.com/titanwings/distilly ~/.grok/skills/distilly

# 或使用多宿主共享目录
mkdir -p ~/.agents/skills
git clone https://github.com/titanwings/distilly ~/.agents/skills/distilly
```

Grok Build 会发现 Skill 目录中的 `SKILL.md`，显式调用命令为 `/distilly`。当前机器仍需安装 Python 和 Distilly 所需依赖。

生成的人物 Skill 使用 `install_generated_skill.py --host grok-build` 安装；项目级安装追加 `--skills-dir .grok/skills`，随后用 `/{character}-{slug}` 调用。

---

### H. OpenCode

OpenCode 原生发现用户级和项目级 Skill 目录：

```bash
# 用户级
git clone https://github.com/titanwings/distilly ~/.config/opencode/skills/distilly

# 项目级
mkdir -p .opencode/skills
git clone https://github.com/titanwings/distilly .opencode/skills/distilly
```

生成的人物 Skill 使用 `install_generated_skill.py --host opencode` 安装；项目级安装追加 `--skills-dir .opencode/skills`。目录规则见 [OpenCode Agent Skills](https://opencode.ai/docs/skills)。

---

### I. Grok Bot（预览）

Grok Bot 支持把书面流程或演示保存为 private Skill，然后在 Settings → Plugins 中启用，通过 `/` 菜单选择。

官方文档目前没有说明 Grok Bot 会扫描本地 Skill 目录，也没有说明可直接导入这个仓库的 `SKILL.md`。因此当前只能手工把 Distilly 流程迁移成 saved Skill；不应声称仓库可一键安装到 Grok Bot。

---

## 依赖安装

新配置统一写入 `~/.distilly/`。为了不破坏既有安装，当新配置不存在时，飞书、钉钉和 Slack 采集器仍会只读回退到 `~/.colleague-skill/`；之后再运行 `--setup` 会写入新目录。

```bash
# 安装 requirements.txt 中声明的 Python 依赖（Python 3.9+）
pip3 install -r requirements.txt

# 飞书浏览器方案（内部文档/需要登录权限的文档）
playwright install chromium  # 仅需安装 chromium，不需要完整 Chrome

# 飞书 MCP 方案（公司授权文档，通过 App Token 读取）
npm install -g feishu-mcp    # 需要 Node.js 16+
```

### 平台方案选择指南

| 场景 | 推荐方案 |
|------|---------|
| 飞书用户，有 App 权限 | `feishu_auto_collector.py` |
| 飞书内部文档（无 App 权限）| `feishu_browser.py` |
| 飞书手动指定链接 | `feishu_mcp_client.py` |
| 钉钉用户 | `dingtalk_auto_collector.py` |
| 钉钉消息采集失败 | 手动截图 → 上传图片 |
| Slack 用户 | `slack_auto_collector.py` |
| celebrity 公开 X 帖子研究 | `research/xquik_public_posts.py` |

**飞书自动采集初始化**：
```bash
python3 tools/feishu_auto_collector.py --setup
# 输入飞书开放平台的 App ID 和 App Secret
```

**钉钉自动采集初始化**：
```bash
python3 tools/dingtalk_auto_collector.py --setup
# 输入钉钉开放平台的 AppKey 和 AppSecret
# 首次运行加 --show-browser 参数以完成钉钉登录
```

**飞书 MCP 初始化**（手动指定链接时使用）：
```bash
python3 tools/feishu_mcp_client.py --setup
```

**飞书浏览器方案**（首次使用会弹窗登录，之后自动复用登录态）：
```bash
python3 tools/feishu_browser.py \
  --url "https://xxx.feishu.cn/wiki/xxx" \
  --show-browser    # 首次使用加这个参数，登录后不再需要
```

**Slack 自动采集初始化**：
```bash
pip3 install slack-sdk
python3 tools/slack_auto_collector.py --setup
# 按提示输入 Bot User OAuth Token（xoxb-...）
```

> Slack 详细配置见下方「[Slack 自动采集配置](#slack-自动采集配置)」章节

---

### 名人研究工具链（可选）

`celebrity` 类型可以从字幕、公开帖子候选和研究笔记一路整理到最终质量检查：

```bash
# 首次使用先安装字幕下载器
pip3 install yt-dlp

# 下载视频字幕
bash tools/research/download_subtitles.sh "<video-url>" "./tmp/subtitles"

# 字幕转文稿
python3 tools/research/srt_to_transcript.py "./tmp/subtitles/example.srt"

# 公开 X 帖子候选（可选）
python3 tools/research/xquik_public_posts.py \
  --username "<公开账号>" \
  --subject "<人物名称>" \
  --limit 20 \
  --output "/tmp/distilly-x-public-posts.json"

# 合并已经核对过的研究笔记
python3 tools/research/merge_research.py "./skills/celebrity/<slug>"

# 质量检查
python3 tools/research/quality_check.py "./skills/celebrity/<slug>/SKILL.md"

# 阅读后删除临时候选文件
rm "/tmp/distilly-x-public-posts.json"
```

`xquik_public_posts.py` 从当前 shell 读取 `XQUIK_API_KEY`，不要把密钥写入仓库或命令参数。Xquik 按返回帖子数量计费，运行前必须让用户确认 `--limit`。

工具只发起 1 次只读搜索请求，不自动翻页。输出是未经信任的候选证据，不是 research note。逐条核对作者、打开 permalink，只把相关内容做版权安全的转述后写入 `knowledge/research/raw/`，并保留具体来源 URL。阅读后删除临时 JSON，不要把它收进生成的 Skill。

Xquik 是独立第三方服务，与 X Corp. 无隶属关系。“Twitter”和“X”是 X Corp. 的商标。

---

## Slack 自动采集配置

### 前置条件

- Python 3.9+
- Slack Workspace（需要**管理员权限**安装 App，或联系管理员帮你安装）
- `pip3 install slack-sdk`

> **免费版 Workspace 限制**：只能访问最近 **90 天**的消息记录。付费版（Pro / Business+ / Enterprise）无此限制。

---

### 步骤 1：创建 Slack App

1. 前往 [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
2. 选择 **From scratch**
3. 填写 App Name（如 `distilly-bot`），选择目标 Workspace → **Create App**

---

### 步骤 2：配置 Bot Token Scopes

进入 **OAuth & Permissions** → **Bot Token Scopes** → **Add an OAuth Scope**，添加以下权限：

| Scope | 用途 |
|-------|------|
| `users:read` | 搜索用户列表（必需） |
| `channels:read` | 列出 public channels（必需） |
| `channels:history` | 读取 public channel 历史消息（必需） |
| `groups:read` | 列出 private channels（必需） |
| `groups:history` | 读取 private channel 历史消息（必需） |
| `mpim:read` | 列出群 DM（可选） |
| `mpim:history` | 读取群 DM 历史消息（可选） |
| `im:read` | 列出 DM（可选，需用户授权） |
| `im:history` | 读取 DM 历史消息（可选，需用户授权） |

---

### 步骤 3：安装 App 到 Workspace

1. 仍在 **OAuth & Permissions** 页面，点击 **Install to Workspace**
2. Workspace 管理员审批后，复制 **Bot User OAuth Token**（格式：`xoxb-...`）

---

### 步骤 4：将 Bot 加入目标频道

Bot 只能读取**它已加入**的频道。在 Slack 中，进入每个目标频道，输入：

```
/invite @your-bot-name
```

> 提示：如果你不知道目标同事在哪些频道，可以先不邀请，运行采集时脚本会告知 Bot 加入了哪些频道，再补充邀请。

---

### 步骤 5：运行配置向导

```bash
python3 tools/slack_auto_collector.py --setup
```

按提示粘贴 Bot Token，脚本会自动验证并保存到 `~/.distilly/slack_config.json`。如果新路径不存在，采集器仍会只读兼容旧的 `~/.colleague-skill/slack_config.json`。

配置成功后你会看到：
```
验证 Token ... OK
  Workspace：Your Company，Bot：distilly-bot

✅ 配置已保存到 /Users/you/.distilly/slack_config.json
```

---

### 步骤 6：采集同事数据

```bash
# 基本用法（输入同事的中文名或英文用户名）
python3 tools/slack_auto_collector.py --name "张三"
python3 tools/slack_auto_collector.py --name "john.doe"

# 指定输出目录
python3 tools/slack_auto_collector.py --name "张三" --output-dir ./knowledge/zhangsan

# 限制采集量（大 Workspace 建议先小量测试）
python3 tools/slack_auto_collector.py --name "张三" --msg-limit 500 --channel-limit 20
```

输出文件：
```
knowledge/张三/
├── messages.txt            # 按权重分类的消息记录
└── collection_summary.json # 采集摘要（用户信息、频道列表、时间）
```

---

### 常见报错与解决

| 报错 | 原因 | 解决 |
|------|------|------|
| `missing_scope: channels:history` | Bot Token 缺少权限 | 回到 api.slack.com → OAuth & Permissions 添加对应 Scope，重新安装 App |
| `invalid_auth` | Token 无效或已吊销 | 重新运行 `--setup` 配置新 Token |
| `not_in_channel` | Bot 未加入该频道 | 在 Slack 里 `/invite @bot` 邀请 Bot |
| 未找到用户 | 姓名拼写不对 | 改用英文用户名（如 `john.doe`）或 Slack display name |
| 消息只有 90 天 | 免费版限制 | 升级 Workspace 或手动补充截图 |
| 速率限制（429）| 请求太频繁 | 脚本会自动等待重试，无需手动处理 |

## 快速验证

```bash
cd <distilly-install-path>   # 例如 ~/.claude/skills/distilly 或 ~/.dsh/skills/distilly

# 测试飞书解析器
python3 tools/feishu_parser.py --help

# 测试 Slack 采集器
python3 tools/slack_auto_collector.py --help

# 测试邮件解析器
python3 tools/email_parser.py --help

# 测试 Hermes 安装器
python3 tools/install_hermes_skill.py --dry-run

# 测试 OpenClaw / Codex 安装器
python3 tools/install_openclaw_skill.py --dry-run
python3 tools/install_codex_skill.py --dry-run

# 测试 celebrity research toolchain
python3 tools/research/xquik_public_posts.py --help
python3 tools/research/srt_to_transcript.py --help
python3 tools/research/merge_research.py --help
python3 tools/research/quality_check.py --help

# 列出已有的人物 Skill
python3 tools/skill_writer.py --action list --base-dir ./skills/colleague
```

---

## 目录结构说明

本项目整个 repo 就是一个 skill 目录（AgentSkills 标准格式）：

```
distilly/               ← clone 到宿主的 skills/distilly/（例如 .claude/skills 或 .dsh/skills）
├── SKILL.md            # skill 入口（官方 frontmatter）
├── prompts/            # 分析和生成的 Prompt 模板
├── tools/              # Python 工具脚本
│   ├── install_hermes_skill.py   # Hermes 本地安装器
│   ├── install_openclaw_skill.py # OpenClaw 本地安装器
│   ├── install_codex_skill.py    # Codex 本地安装器
│   ├── install_openclaw_generated_skill.py # OpenClaw 角色 Skill 安装器
│   ├── install_codex_generated_skill.py    # Codex 角色 Skill 安装器
│   └── research/
│       └── xquik_public_posts.py           # 公开 X 帖子候选采集器
├── docs/               # 文档（PRD 等）
│
└── skills/             # Distilly 生成的人物 Skill（.gitignore 排除）
    └── {character}/
        └── {slug}/
            ├── SKILL.md        # 完整 Skill（Persona + Work）
            ├── work.md         # 仅工作能力
            ├── persona.md      # 仅人物性格
            ├── meta.json       # 元数据
            ├── versions/       # 历史版本
            └── knowledge/      # 原始材料归档
```
