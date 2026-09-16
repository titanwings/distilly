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
import { detectFeishuFormat, parseFeishu } from "../parse/feishu.mjs";

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
      accept: (file, extension) => {
        if (EXTENSIONS.has(extension)) return true;
        // A Feishu manual log is plain text with no self-describing shape, so it
        // is accepted only when the caller says what it is. The refusal has to
        // name the flag, otherwise the only way forward is guessing.
        if (extension === ".txt" && options.format === "feishu-text") return true;
        if (extension === ".txt") {
          return "a .txt log needs an explicit --format feishu-text (the shape cannot be detected from the text alone)";
        }
        return `not a chat export (expected .json, got ${extension || "(none)"})`;
      },
      parser: (source, { file }) => {
        // A Feishu page export is JSON too, and `parseChat`'s detector names the
        // shape (`feishu-export`) without owning a parser for it — so
        // `parse-chat <feishu.json>` used to fail with "format feishu-export has
        // no parser". Ask the Feishu detector first, exactly as `harvest` does;
        // the verdict is `format`, not the wrapper object.
        const feishu = options.format ? { format: options.format } : detectFeishuFormat(source);
        if (feishu?.format) {
          return parseFeishu(source, { source: options.source ?? "feishu", method: "user-export", format: feishu.format });
        }
        return parseChat(source, {
          source: options.source ?? "chat",
          method: "user-export",
          users: siblingUsers(file, options.users) ?? undefined,
          channelName: file.replace(EXTENSIONS.has(".json") ? /\.json$/i : /$^/, ""),
        });
      },
    });
  },
});
