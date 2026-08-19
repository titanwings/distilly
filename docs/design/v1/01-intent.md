> 摘自 [system-v1.md](../system-v1.md)。全文以父文件为准；改规格先改父文件再改本章。

## 1. 我们现在想做什么（用你的原意，不是一句 slogan）

起点不是「做 SDK」。起点是：

Colleague Skill 只针对同事，**scope 太小**。要把它做成 **所有 Agent 自带的 profile**。别人要知道这是我们做的、会持续维护；以后所有 agent 都用这套 profile。

你当时要的产品面（2026-08-18 原话结构）：

1. **前端面板与 Marketplace**
   给每个 agent 建 profile。在我们自己的窗口里，从 marketplace 选一个 profile 加载进来。
2. **用户自定义**
   前端里改。可以有自己的 agent、自己的「同事」这类角色。材料可以从桌面浏览记录等加载。**选择权给用户**，不由我们设采集限制（Agent 权限比普通软件大）。
3. **Evolving 与版本**
   持续改人物性格，做好版本。用户自选加载哪一版。血缘必须在**版本粒度**看得见：这一百个源里有哪些。
4. **Bot**
   你当时就说 **Bot 可以先做**。Bot 需要人物性格，用户 @ 交互。每个 bot 提前内置我们蒸出来的真人性格，不要 bot 自己编一份。
5. **先适配 Codex 和 Claude Code**，再铺开。要有前端面板（ChatCut 那种嵌在 Codex 里的窗口）。

后来定位收成一句话，但上面五条没有作废，只是分了版次：

**distilly = 用客观蒸馏，从已有事实生成可追溯的 personal memory / profile layer，再用 Agent SDK 接到 coding agent 和 bot。**

不是再做一个 Claude skill。Skill / `SKILL.md` / Hermes `SOUL.md` 都是投影。真相是引擎里的人、材料、版本、关系。

和 EverOS 的关系（纠正过一次）：真正对标的是它的 **profile 线**（单份画像、持续覆写），不是 episode 流水账。EverOS 只给使用者本人做一份、覆写就没了；我们做成 **多主体、可追溯、可修正、可分享**，默认还不用单独 API key。

记谁：所有人。同事 / 关系 / 名人 / 动漫 / **self**。`self` 与他人共用同一套模型，只是 id 特殊。

材料：宿主扒网、电脑操作截飞书；用户喂文件；用户 self-correct。我们不替用户设「不准采飞书」。

---
