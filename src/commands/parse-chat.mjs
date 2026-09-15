/**
 * `distilly parse-chat` — chat exports into `knowledge/` (CONTRACT §1).
 *
 * ChatGPT / Claude / Slack / Telegram / Discord / Instagram exports, one turn per
 * anchored unit. A Slack export needs its `users.json` to resolve `U123…` ids:
 * pass `--users <users.json>`, or put it next to the messages file, which is how
 * the export ships. Without it the ids stay unresolved with a warning — a missing
 * name map degrades labels, it does not invalidate the conversation.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { register } from "./index.mjs";
import { parseCommonArgs, parseFailure, runParseCommand } from "./parse-shared.mjs";
import { parseChat } from "../parse/chat.mjs";

const EXTENSIONS = new Set([".json"]);

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly parse-chat <export.json...> --person <slug> [--base-dir <dir>] [--source <label>] [--users <users.json>] [--json]",
    "",
    "读取聊天导出：ChatGPT / Claude / Slack / Telegram / Discord / Instagram，一条消息一个锚点单元。",
    "Slack 的 `users.json` 与 `channels.json` 是支撑文件不是对话，会被点名拒绝；",
    "`--users` 或缺省的同目录 `users.json` 用来把 `U123…` 还原成人名。",
  ].join("\n"),
  en: [
    "Distilly parse-chat — read chat exports into knowledge/.",
    "",
    "ChatGPT / Claude / Slack / Telegram / Discord / Instagram, one message per anchored",
    "unit. Slack's `users.json` / `channels.json` are support files rather than dialogue and",
    "are refused by name; `--users` (or a sibling `users.json`) resolves `U123…` ids.",
  ].join("\n"),
};

/** The users.json a Slack export ships beside its channel files. */
function siblingUsers(filePath, explicit) {
  if (explicit) return existsSync(explicit) ? readFileSync(explicit, "utf8") : null;
  const candidate = join(dirname(filePath), "users.json");
  return existsSync(candidate) ? readFileSync(candidate, "utf8") : null;
}

register("parse-chat", {
  summary: "读取聊天导出 / read chat exports into knowledge/",
  usage: "distilly parse-chat <file.json...> --person <slug> [--base-dir <dir>] [--source <label>] [--users <users.json>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const parsed = parseCommonArgs(argv);
    if (parsed.error) return parseFailure("parse-chat", parsed.error, "parse-chat/usage");
    const { options, paths } = parsed;
    return runParseCommand({
      command: "parse-chat",
      options,
      paths,
      json,
      reporter,
      accept: (file, extension) =>
        EXTENSIONS.has(extension) ? true : `not a chat export (expected .json, got ${extension || "(none)"})`,
      parser: (source, { file }) =>
        parseChat(source, {
          source: options.source ?? "chat",
          method: "user-export",
          users: siblingUsers(file, options.users) ?? undefined,
          channelName: file.replace(EXTENSIONS.has(".json") ? /\.json$/i : /$^/, ""),
        }),
    });
  },
});
