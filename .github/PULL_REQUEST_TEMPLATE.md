<!--
Thanks for contributing to colleague.skill! 感谢你的贡献！
Please fill out the sections below. 请填写下方各部分。
-->

## Summary / 摘要

<!-- What does this PR do? One or two sentences. / 这个 PR 做了什么？一两句话说明。 -->

## Changes / 变更

<!-- Bullet list of notable changes. / 主要改动列表。 -->
-
-

## Motivation / 动机

<!-- Why is this change needed? Link related issues. / 为什么需要这个改动？关联 issue。 -->
Closes #

## Testing / 测试

<!-- How did you verify this works? Commands, screenshots, or manual steps. / 你是怎么验证的？命令、截图或手动步骤。 -->
- [ ] `python3 scripts/verify_agent_notes.py` passed
- [ ] `python3 -m compileall -q tools scripts` passed
- [ ] `python3 -m unittest discover -s tests -p 'test_*.py'` passed
- [ ] Manually tested: <!-- describe -->

## Checklist / 检查清单

- [ ] I read [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] Non-trivial change includes an [Agent Note](../.agents/notes/README.md) (or this PR is mechanical / local-only)
- [ ] Product change was read against [docs/design/](../docs/design/README.md) (not architecture.md alone)
- [ ] Review followed [docs/process/code-review.md](../docs/process/code-review.md)
- [ ] Docs updated if behavior changed (design parent + chapter, or live-tree architecture)
- [ ] `python3 scripts/verify_agent_notes.py` passed when notes or standing docs changed
- [ ] No secrets, tokens, or personal data committed
- [ ] New dependencies added to `requirements.txt` (if any)
- [ ] Tests added/updated for new functionality (or reason explained above)

## Screenshots / 截图 (optional)

<!-- Drop images here if UI or output changed. / 如果有 UI 或输出变化，贴图。 -->
