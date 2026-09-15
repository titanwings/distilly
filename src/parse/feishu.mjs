/**
 * feishu.mjs — Feishu / Lark **message exports** → per-message records.
 *
 * Ported from `tools/feishu_parser.py` (251 lines). The Python tool was a
 * *filter and formatter*: it read an export, kept only the target person's
 * messages and printed three buckets (long / decision / daily). In this pipeline
 * the person filter belongs to the Skill (`harvest --person`) and the bucketing
 * belongs to the derivation (`retrospect`), so the port keeps what is actually
 * about *reading the format* and drops the presentation half:
 *
 *   - both shapes the export comes in: a JSON array, or an object wrapping one
 *     under `messages` / `records` / `data`;
 *   - the field aliases the tool accepted (`sender_name|sender|from|user_name`,
 *     `content|text|message|body`, `timestamp|create_time|time`), including a
 *     nested `content` object or a list of parts;
 *   - the manual TXT log (`2024-01-01 10:00 张三：消息内容`) — opt-in by format,
 *     because guessing a chat out of arbitrary prose would misread documents;
 *   - placeholder turns (`[图片]`, `[文件]`, `[语音]`, `[撤回了一条消息]`) are
 *     **skipped with a warning**, never silently dropped;
 *   - every message keeps its anchor, its sender and its timestamp when the
 *     export carries one, so speaker-scoped derivation works on Feishu too.
 *
 * Zero dependencies, no network: this only reads bytes it is handed.
 */

import { buildDocument, recordsFromCharSpans, stableJson, truncate } from "./common.mjs";

/** The aliases `tools/feishu_parser.py` accepted, in its order. */
const SENDER_KEYS = ["sender_name", "sender", "from", "user_name"];
const CONTENT_KEYS = ["content", "text", "message", "body"];
const TIMESTAMP_KEYS = ["timestamp", "create_time", "time"];

/** Turns that carry no words: named so the warning can say how many were skipped. */
export const FEISHU_PLACEHOLDERS = ["[图片]", "[文件]", "[语音]", "[视频]", "[撤回了一条消息]", "[表情]"];

/** `2024-01-01 10:00 张三：消息内容` — the hand-kept log format. */
const TXT_LINE = /^(?<time>\d{4}[-/]\d{1,2}[-/]\d{1,2}[\s\d:]*)\s+(?<sender>.+?)[:：]\s*(?<content>.+)$/;

function firstKey(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

/** `content` may be a string, `{text|content}`, or a list of parts. */
function flattenContent(content) {
  if (typeof content === "string") {
    // The open API hands back `body.content` as a **JSON-encoded string**
    // ("{\"text\": \"…\"}"). Returning it verbatim puts the envelope into the
    // person's knowledge base — the paragraph reads `林工：{"text": "…"}` instead of
    // what was actually said.
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === "object") return flattenContent(parsed);
      } catch {
        // Not JSON after all: the string is the message.
      }
    }
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" ? (part.text ?? part.content ?? "") : String(part ?? "")))
      .filter((text) => text !== "")
      .join(" ");
  }
  if (content && typeof content === "object") {
    const nested = firstKey(content, ["text", "content"]);
    return nested === null ? "" : flattenContent(nested);
  }
  return "";
}

/** A `sender` may be a display name or an object with one. */
function flattenSender(sender) {
  if (typeof sender === "string") return sender;
  if (sender && typeof sender === "object") {
    const name = firstKey(sender, ["name", "sender_name", "user_name", "id", "open_id"]);
    return name === null ? "" : String(name);
  }
  return "";
}

function unwrap(value, depth = 0) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== "object" || depth > 3) return null;
  for (const key of ["messages", "records", "data", "items"]) {
    if (Array.isArray(value[key])) return value[key];
    // The open-platform paging shape is { code, msg, data: { has_more, items } } —
    // the array sits one level below `data`, so one look is not enough.
    const inner = unwrap(value[key], depth + 1);
    if (inner !== null) return inner;
  }
  return null;
}

/**
 * @param {SourceFile} file
 * @returns {{format: string, reasons: string[], value: unknown}}
 */
export function detectFeishuFormat(file) {
  const reasons = [];
  const text = file.text ?? "";

  // The manual log: every non-empty line must look like `time sender：text`.
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length > 0) {
    const matching = lines.filter((line) => TXT_LINE.test(line)).length;
    if (matching / lines.length >= 0.8) {
      reasons.push(`${matching}/${lines.length} lines match "YYYY-MM-DD HH:MM sender：text" (manual Feishu log)`);
      return { format: "feishu-text", reasons, value: null };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(text.trim().replace(/^\uFEFF/, ""));
  } catch (error) {
    return { format: null, reasons: [`JSON is not parseable: ${error.message}`] };
  }
  const items = unwrap(parsed);
  if (!items || items.length === 0) {
    return { format: null, reasons: ["JSON root holds no message array (messages/records/data)"] };
  }
  const objects = items.filter((item) => item && typeof item === "object");
  if (objects.length === 0) {
    return { format: null, reasons: ["the array holds no message objects"] };
  }
  const keys = new Set(objects.slice(0, 20).flatMap((item) => Object.keys(item)));
  const hasSender = SENDER_KEYS.some((key) => keys.has(key));
  const hasContent = CONTENT_KEYS.some((key) => keys.has(key));
  if (!hasSender || !hasContent) {
    return {
      format: null,
      reasons: [
        `entries carry {${[...keys].slice(0, 8).join(", ")}}; expected a sender field ` +
          `(${SENDER_KEYS.join("/")}) and a content field (${CONTENT_KEYS.join("/")})`,
      ],
    };
  }
  reasons.push(`array of message objects with ${SENDER_KEYS.filter((key) => keys.has(key)).join("/")} + ${CONTENT_KEYS.filter((key) => keys.has(key)).join("/")}`);
  return { format: "feishu-export", reasons, value: items };
}

/**
 * @param {SourceFile} file
 * @param {{source?: string, method?: string, format?: string}} [options]
 */
export function parseFeishu(file, options = {}) {
  const detected = options.format
    ? { format: options.format, reasons: ["format supplied by the caller"], value: undefined }
    : detectFeishuFormat(file);
  // The detector answers "this is not Feishu" by returning `format: null`; the
  // refusal belongs here, where the caller asked for a parse. Without this guard
  // the loop below would run over `undefined` and throw a TypeError instead.
  if (detected.format === null) {
    throw new Error(`${file.label} is not a Feishu export: ${(detected.reasons ?? []).join("; ") || "unrecognised shape"}`);
  }
  const warnings = [];

  const spans = [];
  let placeholders = 0;
  let withoutTimestamp = 0;
  let withoutSender = 0;

  if (detected.format === "feishu-text") {
    const text = file.text ?? "";
    let cursor = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const lineStart = cursor;
      cursor += rawLine.length + 1;
      const line = rawLine.trim();
      if (line === "") continue;
      const match = TXT_LINE.exec(line);
      if (!match) {
        warnings.push(`line ${spans.length + 1} does not match the "time sender：text" form and was skipped: ${truncate(line, 40)}`);
        continue;
      }
      const content = match.groups.content.trim();
      if (FEISHU_PLACEHOLDERS.includes(content)) {
        placeholders += 1;
        continue;
      }
      const offset = rawLine.indexOf(match.groups.sender);
      spans.push({
        text: content,
        charStart: lineStart + offset,
        charEnd: lineStart + rawLine.length,
        kind: "message",
        speaker: match.groups.sender.trim(),
        at: match.groups.time.trim(),
        label: `${match.groups.time.trim()} ${match.groups.sender.trim()}`,
      });
    }
  } else {
    const document = file.text ?? "";
    for (const item of detected.value) {
      if (!item || typeof item !== "object") continue;
      const sender = flattenSender(firstKey(item, SENDER_KEYS));
      const content = flattenContent(firstKey(item, CONTENT_KEYS)).trim();
      const timestamp = firstKey(item, TIMESTAMP_KEYS);
      if (content === "" || FEISHU_PLACEHOLDERS.includes(content)) {
        placeholders += 1;
        continue;
      }
      if (sender === "") withoutSender += 1;
      if (timestamp === null) withoutTimestamp += 1;
      // The export does not carry byte offsets into the original file for every
      // alias, so each turn is located by its own text: `indexOf` from a moving
      // cursor keeps the anchors ordered and never invents an offset.
      const at = content.slice(0, 60);
      const index = document.indexOf(at, 0);
      spans.push({
        text: content,
        charStart: index,
        charEnd: index === -1 ? -1 : index + at.length,
        kind: "message",
        speaker: sender,
        at: timestamp === null ? "" : String(timestamp),
        label: sender === "" ? "message" : sender,
        synthetic: index === -1,
      });
    }
  }

  if (placeholders > 0) {
    warnings.push(`${placeholders} turn(s) carried no words (${FEISHU_PLACEHOLDERS.join(" ")} or empty) and were not anchored`);
  }
  if (withoutTimestamp > 0) {
    warnings.push(`${withoutTimestamp} turn(s) carried no timestamp, so time-based dimensions will skip them`);
  }
  if (withoutSender > 0) {
    warnings.push(`${withoutSender} turn(s) carried no sender, so speaker-scoped statistics will skip them`);
  }
  if (spans.length === 0) {
    throw new Error(`${file.label} is a Feishu export but holds no message with words`);
  }

  const records = recordsFromCharSpans(file, spans);
  return buildDocument({
    identity: options.identity,
    parser: "feishu",
    format: detected.format,
    kind: "message",
    method: options.method ?? "local-file",
    source: options.source ?? "feishu",
    files: [file],
    records,
    warnings,
    meta: { ...detected, shape: truncate(stableJson({ format: detected.format }), 80), turns: spans.length },
  });
}
