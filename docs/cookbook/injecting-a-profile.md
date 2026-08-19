# Cookbook: inject a profile into a host agent

## Choose a load path

| Method | Use | Do not use for |
|---|---|---|
| `Person.prompt()` / `get()` | This spawn or sub-agent | Long-lived skill discovery |
| `Person.install(host)` | Host skills directory | Ten temporary sub-agents |
| `Person.export(host)` | One process, one identity (`SOUL.md`) | Global `AGENTS.md` |

## Temporary sub-agents

1. Parent calls `get` or `prompt` and receives the full Markdown.
2. Parent puts that text in the child Task / instructions field.
3. Child does not need MCP. Do not ask ten children to `get` again.
4. Do not write the persona into the repository `AGENTS.md`.

## Host wrapper

Keep one neutral body. Each `HostInjector` only adds the host's lead-in. Do not distill a Claude copy and a Codex copy.

## Verify

A product skill or binding test must fail if the injector writes a global instruction file. Manual check: spawn one child, confirm the profile text is in that child's prompt only.
