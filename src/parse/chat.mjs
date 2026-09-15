/**
 * chat.mjs — chat exports → one record per turn (speaker + time), or nothing.
 *
 * Supported shapes, each identified by a structural marker rather than by its
 * file name:
 *
 *  - **ChatGPT** `conversations.json` — an array whose objects carry
 *    `mapping` + `title` (the pre-2024 "chat_messages" shape is also accepted).
 *  - **Claude** `conversations.json` — an array whose objects carry
 *    `chat_messages` + `uuid`, with `sender: "human" | "assistant"`.
 *  - **Slack** export directory files — `users.json` + `channels.json`, or a
 *    per-channel `*.json` array whose entries carry `user`/`username` + `ts`.
 *  - **Telegram** `result.json` — `{name, type, messages: [...]}` with
 *    `from`/`from_id`, `date`/`date_unixtime` and `text` (a string or an array
 *    of `{type:"link"|"bold"|…, text}` fragments).
 *  - **Discord** — a `messages/*.json` array carrying `author` + `timestamp`.
 *
 * Everything else is reported as **not a recognised export format**, with the
 * markers that were looked for. There is no "best effort text dump" path: an
 * export whose shape we do not know may still hold a person's words, and
 * guessing which field is the speaker would put words in the wrong mouth.
 *
 * Timestamps are kept as the export wrote them (`ts` is a Slack epoch string,
 * `date_unixtime` is Telegram's) *and* normalised to ISO-8601 when the value is
 * unambiguous. An unparseable date is preserved verbatim and reported, never
 * silently replaced with the current time.
 */

import {
  SourceFile,
  UnrecognizedFormatError,
  buildDocument,
  findObjectArray,
  iterateObjects,
  parseJsonPayload,
  pick,
  recordsFromCharSpans,
  walkJsonLeaves,
} from "./common.mjs";

/* ------------------------------------------------------------------ */
/* shared text helpers                                                 */
/* ------------------------------------------------------------------ */

/** Render an export's message text field, whatever shape it has. */
function renderMessageText(value, warnings, context) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";

  // Telegram (and Telegram-derived tools) use an array of typed fragments.
  if (Array.isArray(value)) {
    const parts = [];
    let unsupported = 0;
    for (const fragment of value) {
      if (typeof fragment === "string") {
        parts.push(fragment);
        continue;
      }
      if (fragment && typeof fragment === "object") {
        if (typeof fragment.text === "string") {
          parts.push(fragment.text);
          continue;
        }
        if (fragment.type === "mention" && typeof fragment.text === "string") {
          parts.push(fragment.text);
          continue;
        }
        unsupported += 1;
      }
    }
    if (unsupported > 0) {
      warnings.push(`${context}: ${unsupported} text fragment(s) had no plain text (an emoji, an attachment or a poll) and were left out`);
    }
    return parts.join("");
  }
  if (typeof value === "object") {
    const nested = pick(value, ["text", "content", "body", "message"]);
    if (nested.key) return renderMessageText(nested.value, warnings, context);
    warnings.push(`${context}: the text field is an object with keys ${Object.keys(value).join(",") || "(none)"} and no recognisable text`);
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Normalise a timestamp to ISO-8601, or keep it verbatim.
 * Handles epoch seconds, epoch milliseconds, epoch microseconds, ISO strings and
 * the several date formats the exports use. Returns `{iso, raw, inferredUnit}`.
 */
export function normaliseTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return { iso: null, raw: null, inferredUnit: null };
  }
  const raw = String(value);

  // Slack sends seconds.microseconds as a string. The integer part is the
  // Unix second; the fraction is sub-second precision we deliberately drop,
  // because every consumer downstream wants a stable ISO instant.
  if (/^\d{9,19}\.\d+$/.test(raw)) {
    const seconds = Number(raw.split(".")[0]);
    return { iso: new Date(seconds * 1000).toISOString(), raw, inferredUnit: "seconds-fraction" };
  }

  if (/^\d{9,19}$/.test(raw)) {
    const numeric = Number(raw);
    // Slack uses seconds (10 digits), Discord ISO, Telegram both seconds and
    // millisecond strings, some tools microseconds.
    if (raw.length >= 16) {
      return { iso: new Date(numeric / 1000).toISOString(), raw, inferredUnit: "microseconds" };
    }
    if (raw.length >= 13) {
      return { iso: new Date(numeric).toISOString(), raw, inferredUnit: "milliseconds" };
    }
    return { iso: new Date(numeric * 1000).toISOString(), raw, inferredUnit: "seconds" };
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(raw)) {
    const normalised = raw.includes("T") ? raw : raw.replace(" ", "T");
    const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalised) ? normalised : `${normalised}Z`;
    const date = new Date(withZone);
    if (!Number.isNaN(date.getTime())) {
      return { iso: date.toISOString(), raw, inferredUnit: "iso" };
    }
  }

  return { iso: null, raw, inferredUnit: null };
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

function scalar(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.map((item) => scalar(item)).join(", ");
  if (typeof value === "object") return "";
  return String(value);
}

function truncate(value, limit = 120) {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/* ------------------------------------------------------------------ */
/* format detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Which chat export is this file?
 *
 * Detection is structural and returns the reasons it decided, so a receipt can
 * say *why* a file was read as ChatGPT rather than Telegram.
 *
 * @param {SourceFile} file
 * @returns {{format: string|null, reasons: string[], value?: unknown, shape: object}}
 */
export function detectChatFormat(file) {
  const reasons = [];
  let parsed;
  try {
    parsed = parseJsonPayload(file);
  } catch (error) {
    // A Slack `users.json` and a Discord `messages/*.json` are still JSON, so a
    // parse failure here is fatal for every format.
    throw new UnrecognizedFormatError(
      `${file.label} is not a recognised chat export: ${error.message}`,
      { path: file.path },
    );
  }
  const value = parsed.value;
  const shape = { root: Array.isArray(value) ? "array" : typeof value, length: Array.isArray(value) ? value.length : null };

  if (!Array.isArray(value) && (value === null || typeof value !== "object")) {
    throw new UnrecognizedFormatError(
      `${file.label} is not a recognised chat export: the JSON root is ${typeof value} (${truncate(stableJson(value), 40)}), expected an array or an object`,
      { path: file.path },
    );
  }

  // ---- Telegram result.json -------------------------------------------
  if (!Array.isArray(value) && Array.isArray(value.messages)) {
    const sample = value.messages.find((item) => item && typeof item === "object") ?? {};
    if ("from" in sample || "from_id" in sample || "date_unixtime" in sample || "date" in sample) {
      reasons.push("object root with a messages[] array whose entries carry Telegram's from/date fields");
      if (typeof value.name === "string") reasons.push(`chat name: ${truncate(value.name, 60)}`);
      return { format: "telegram-export", reasons, value, shape };
    }
    reasons.push("object root with a messages[] array, but the entries carry none of Telegram's fields");
  }

  if (Array.isArray(value)) {
    const objects = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    const sample = objects[0] ?? {};
    const keys = new Set(objects.slice(0, 5).flatMap((item) => Object.keys(item)));

    // ---- Slack channels.json (channel index) --------------------------
    if (objects.length > 0 && objects.every((item) => "id" in item && "name" in item && !("messages" in item))) {
      reasons.push("array of channel objects with id+name (Slack channels.json)");
      return { format: "slack-channels", reasons, value, shape };
    }

    // ---- Slack users.json ---------------------------------------------
    if (
      objects.length > 0 &&
      objects.every((item) => "id" in item && ("profile" in item || "real_name" in item || "is_bot" in item)) &&
      !("ts" in sample)
    ) {
      reasons.push("array of user objects with id+profile/real_name (Slack users.json)");
      return { format: "slack-users", reasons, value, shape };
    }

    // ---- Slack channel messages ---------------------------------------
    if (objects.length > 0 && objects.some((item) => "ts" in item) && objects.some((item) => "user" in item || "username" in item || "bot_id" in item || "text" in item)) {
      reasons.push("array of message objects with ts + user/username/text (Slack channel export)");
      return { format: "slack-messages", reasons, value, shape };
    }

    // ---- Discord messages ---------------------------------------------
    if (objects.length > 0 && objects.some((item) => "author" in item) && objects.some((item) => "timestamp" in item || "id" in item)) {
      reasons.push("array of message objects with author + timestamp (Discord messages export)");
      return { format: "discord-messages", reasons, value, shape };
    }

    // ---- ChatGPT conversations.json -----------------------------------
    if (objects.length > 0 && objects.some((item) => "mapping" in item)) {
      reasons.push("array of conversation objects carrying a mapping (ChatGPT conversations.json)");
      if (keys.has("create_time")) reasons.push("entries also carry create_time");
      return { format: "chatgpt-export", reasons, value, shape };
    }
    if (objects.length > 0 && objects.some((item) => "chat_messages" in item) && keys.has("title")) {
      reasons.push("array of conversation objects carrying chat_messages + title (ChatGPT 2023 export)");
      return { format: "chatgpt-export", reasons, value, shape };
    }

    // ---- Claude conversations.json ------------------------------------
    if (objects.length > 0 && objects.some((item) => Array.isArray(item.chat_messages)) && objects.some((item) => "uuid" in item)) {
      reasons.push("array of conversation objects carrying chat_messages + uuid (Claude conversations.json)");
      return { format: "claude-export", reasons, value, shape };
    }

    // ---- Instagram / Facebook message dumps ---------------------------
    const instagram = findObjectArray(value, ["sender_name", "timestamp_ms"], { minLength: 1 });
    if (instagram) {
      reasons.push(`array of message objects with sender_name + timestamp_ms at ${instagram.path.join(".") || "<root>"} (Instagram/Facebook messages)`);
      const participants = objects.find((item) => Array.isArray(item.participants));
      if (participants) reasons.push(`conversation lists participants: ${participants.participants.map((p) => p?.name).filter(Boolean).join(", ")}`);
      return { format: "instagram-messages", reasons, value, shape };
    }
  } else {
    // ---- object-rooted containers -------------------------------------
    const nested = pick(value, ["conversations", "chats", "messages", "records", "data"]);
    if (nested.key && Array.isArray(nested.value)) {
      const inner = nested.value.filter((item) => item && typeof item === "object");
      if (inner.some((item) => "mapping" in item)) {
        reasons.push(`object root with ${nested.key}[] carrying a mapping (ChatGPT conversations.json)`);
        return { format: "chatgpt-export", reasons, value: nested.value, shape: { ...shape, wrapped: nested.key } };
      }
      if (inner.some((item) => Array.isArray(item.chat_messages))) {
        reasons.push(`object root with ${nested.key}[] carrying chat_messages (Claude conversations.json)`);
        return { format: "claude-export", reasons, value: nested.value, shape: { ...shape, wrapped: nested.key } };
      }
      reasons.push(`object root with a ${nested.key}[] array, but its entries match no known export`);
    }
  }

  throw new UnrecognizedFormatError(
    `${file.label} is not a recognised chat export. Looked for: ChatGPT mapping[]/chat_messages[], Claude chat_messages[]+uuid, Slack channels.json/users.json/channel messages (ts+user), Telegram result.json {messages[]}, Discord author+timestamp. Found: ${describesShape(value, shape)}. No guess was made.`,
    { path: file.path, shape },
  );
}

function describesShape(value, shape) {
  if (Array.isArray(value)) {
    const sample = value.find((item) => item && typeof item === "object" && !Array.isArray(item));
    const keys = sample ? Object.keys(sample).slice(0, 12).join(",") : "(no object entries)";
    return `an array of ${value.length} item(s); the first object has keys [${keys}]`;
  }
  if (value && typeof value === "object") {
    return `an object with keys [${Object.keys(value).slice(0, 12).join(",")}]`;
  }
  return `a JSON ${shape.root}`;
}

/* ------------------------------------------------------------------ */
/* ChatGPT                                                             */
/* ------------------------------------------------------------------ */

/**
 * Walk a ChatGPT `mapping` (a node graph, not a list) into a linear turn list.
 *
 * The mapping is a tree keyed by node id with `parent`/`children`; the
 * conversation is the path from the root to a leaf. When a message has several
 * children the export contains an edited branch — only one is on the live path,
 * so the others are reported rather than merged, because merging two versions of
 * the same answer fabricates a reply that was never sent.
 */
export function lineariseChatGptMapping(mapping, warnings, conversationLabel) {
  if (!mapping || typeof mapping !== "object") return { turns: [], branches: 0, roots: 0 };
  const nodes = Object.entries(mapping);
  const childrenOf = new Map();
  const hasParent = new Set();
  for (const [id, node] of nodes) {
    const children = Array.isArray(node?.children) ? node.children : [];
    childrenOf.set(id, children);
    for (const child of children) hasParent.add(child);
  }
  const roots = nodes.map(([id]) => id).filter((id) => !hasParent.has(id));
  if (roots.length === 0) {
    warnings.push(`${conversationLabel}: the mapping has no root node (every node has a parent), so no turns could be ordered`);
    return { turns: [], branches: 0, roots: 0 };
  }
  if (roots.length > 1) {
    warnings.push(`${conversationLabel}: the mapping has ${roots.length} root nodes; only the first was followed`);
  }

  const turns = [];
  let branches = 0;
  const visited = new Set();
  const walk = (id, depth) => {
    if (visited.has(id) || depth > 100_000) return;
    visited.add(id);
    const node = mapping[id];
    const children = childrenOf.get(id) ?? [];
    if (children.length > 1) {
      branches += 1;
      warnings.push(`${conversationLabel}: node ${id} has ${children.length} children (an edited branch); only the first path was recorded`);
    }
    const message = node?.message;
    if (message) turns.push({ nodeId: id, depth, message });
    for (const child of children) walk(child, depth + 1);
  };
  walk(roots[0], 0);
  return { turns, branches, roots: roots.length };
}

function chatGptSpeaker(message) {
  const role = message?.author?.role;
  if (typeof role === "string" && role !== "") return role;
  if (typeof message?.role === "string" && message.role !== "") return message.role;
  return null;
}

function chatGptText(message, warnings, label) {
  const content = message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  const parts = content.parts;
  if (Array.isArray(parts)) {
    const pieces = [];
    let nonText = 0;
    for (const part of parts) {
      if (typeof part === "string") pieces.push(part);
      else if (part && typeof part === "object" && typeof part.text === "string") pieces.push(part.text);
      else if (part && typeof part === "object" && part.content_type === "image_asset_pointer") nonText += 1;
      else nonText += 1;
    }
    if (nonText > 0) warnings.push(`${label}: ${nonText} non-text content part(s) (an image, a tool call or a code attachment) were left out`);
    return pieces.join("\n");
  }
  if (typeof content.text === "string") return content.text;
  return "";
}

/* ------------------------------------------------------------------ */
/* Slack                                                               */
/* ------------------------------------------------------------------ */

/**
 * Build `userId -> display name` from a Slack `users.json`.
 * Returns an empty map (with a warning) when the file is missing or unreadable:
 * a missing name map degrades labels, it does not invalidate the messages.
 */
export function readSlackUsers(usersText, warnings, label) {
  const names = new Map();
  if (!usersText) {
    warnings.push(`${label}: no users.json was supplied, so Slack user ids (U123…) could not be resolved to names`);
    return names;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(usersText).trim());
  } catch (error) {
    warnings.push(`${label}: users.json could not be parsed (${error.message}); Slack user ids were left unresolved`);
    return names;
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.members) ? parsed.members : [];
  for (const user of list) {
    if (!user || typeof user !== "object" || typeof user.id !== "string") continue;
    const profile = user.profile ?? {};
    const name = profile.display_name || profile.real_name || user.real_name || user.name || null;
    if (name) names.set(user.id, name);
  }
  if (names.size === 0) warnings.push(`${label}: users.json held no resolvable display names`);
  return names;
}

/* ------------------------------------------------------------------ */
/* record building                                                     */
/* ------------------------------------------------------------------ */

/**
 * Turn a list of `{speaker, timestamp, text, marker}` into records whose byte
 * ranges point back at the export.
 *
 * The byte range of a turn is deliberately the range of its **message object**
 * (or, when only a value node can be located, of its text value), found by
 * searching the raw payload for the marker string the export wrote. When the
 * marker cannot be located the record reports `null` and says so: a wrong offset
 * is worse than a missing one.
 */
function turnsToRecords(file, turns, warnings, label) {
  const slices = [];
  for (const turn of turns) {
    const text = turn.text.trim();
    if (text === "") continue;
    const located = locateTurn(file, turn);
    if (!located) {
      warnings.push(`${label}: the raw location of a turn (${truncate(turn.speaker ?? "unknown", 20)} @ ${truncate(turn.timestamp ?? "?", 24)}) could not be found in the payload; its anchor reports no byte offset`);
    }
    slices.push({
      text,
      // `recordsFromCharSpans` needs character offsets into `file.text`; `-1`
      // marks "not located", which becomes a `null` byte range.
      charStart: located ? located.charStart : 0,
      charEnd: located ? located.charEnd : 0,
      kind: "turn",
      label: [turn.speaker ?? "unknown", turn.timestamp ?? null].filter(Boolean).join(" · "),
      // The rendered paragraph carries `<at> <speaker>：`; the derivation reads that
      // text, so both have to survive the trip from the parser to the renderer.
      speaker: turn.speaker ?? null,
      at: turn.timestamp ?? null,
      located: Boolean(located),
    });
  }
  return slices.map((slice) => {
    const record = {
      kind: slice.kind,
      text: slice.text,
      label: slice.label,
      file: file.name,
      // Attribution rides on the record; the renderer reads it off the segment.
      speaker: slice.speaker ?? null,
      at: slice.at ?? null,
    };
    if (slice.located) {
      record.byteStart = file.charToByte(slice.charStart);
      record.byteEnd = file.charToByte(slice.charEnd);
    } else {
      record.byteStart = null;
      record.byteEnd = null;
    }
    return record;
  });
}

/**
 * Find the payload characters a turn came from.
 *
 * `anchor` is the longest distinctive substring the export contains for that
 * turn (the message text). Searching for it is exact when the text is unique and
 * conservative when it is not: an ambiguous match is reported as unlocatable
 * rather than guessed at.
 */
function locateTurn(file, turn) {
  const needle = turn.locateBy ?? turn.text.trim().slice(0, 200);
  if (!needle) return null;
  const first = file.text.indexOf(needle);
  if (first === -1) return null;
  if (file.text.indexOf(needle, first + 1) !== -1 && !turn.locateBy) return null;
  return { charStart: first, charEnd: first + needle.length };
}

/* ------------------------------------------------------------------ */
/* per-format parsers                                                  */
/* ------------------------------------------------------------------ */

function parseChatGpt(file, value, warnings) {
  const conversations = Array.isArray(value) ? value : [value];
  const turns = [];
  const meta = { conversations: [], branches: 0 };

  conversations.forEach((conversation, index) => {
    const label = `conversation ${index + 1}${conversation?.title ? ` (${truncate(conversation.title, 40)})` : ""}`;
    let linear;
    if (conversation?.mapping && typeof conversation.mapping === "object") {
      linear = lineariseChatGptMapping(conversation.mapping, warnings, label);
    } else if (Array.isArray(conversation?.chat_messages)) {
      linear = {
        turns: conversation.chat_messages.map((message, position) => ({ nodeId: `chat_messages[${position}]`, depth: position, message })),
        branches: 0,
        roots: 1,
      };
    } else {
      warnings.push(`${label}: has neither a mapping nor chat_messages and was skipped`);
      return;
    }

    meta.branches += linear.branches;
    let kept = 0;
    for (const { message } of linear.turns) {
      const speaker = chatGptSpeaker(message);
      const timestamp = normaliseTimestamp(message?.create_time ?? message?.update_time ?? null);
      const text = chatGptText(message, warnings, label);
      const role = speaker ?? "";
      if (text.trim() === "") {
        // An empty assistant turn is a tool call or a placeholder; it is not
        // dialogue, but it is also not nothing — say so.
        if (message?.content) warnings.push(`${label}: a ${role || "unknown-role"} turn has no text and was not anchored`);
        continue;
      }
      turns.push({
        speaker: role || "unknown",
        timestamp: timestamp.iso ?? null,
        text,
        locateBy: text.trim().slice(0, 200),
      });
      kept += 1;
    }
    meta.conversations.push({
      title: typeof conversation?.title === "string" ? conversation.title : null,
      id: conversation?.id ?? conversation?.conversation_id ?? null,
      createTime: normaliseTimestamp(conversation?.create_time ?? null).iso,
      turns: kept,
      linearNodes: linear.turns.length,
      branched: linear.branches > 0,
    });
  });

  return { turns, meta };
}

function parseClaude(value, warnings) {
  const conversations = Array.isArray(value) ? value : [value];
  const turns = [];
  const meta = { conversations: [] };

  conversations.forEach((conversation, index) => {
    const label = `conversation ${index + 1}${conversation?.name ? ` (${truncate(conversation.name, 40)})` : ""}`;
    const messages = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : null;
    if (!messages) {
      warnings.push(`${label}: has no chat_messages array and was skipped`);
      return;
    }
    let kept = 0;
    for (const message of messages) {
      const sender = typeof message?.sender === "string" ? message.sender : null;
      if (sender === null) warnings.push(`${label}: a message has no sender field; it is recorded as "unknown" rather than guessed`);
      const timestamp = normaliseTimestamp(message?.created_at ?? message?.updated_at ?? null);
      let text = "";
      if (typeof message?.text === "string") {
        text = message.text;
      } else if (Array.isArray(message?.content)) {
        text = renderMessageText(message.content, warnings, label);
      } else if (typeof message?.content === "string") {
        text = message.content;
      }
      if (text.trim() === "") continue;
      turns.push({
        speaker: sender ?? "unknown",
        timestamp: timestamp.iso ?? null,
        text,
        locateBy: text.trim().slice(0, 200),
      });
      kept += 1;
    }
    meta.conversations.push({
      title: typeof conversation?.name === "string" ? conversation.name : null,
      uuid: conversation?.uuid ?? null,
      createTime: normaliseTimestamp(conversation?.created_at ?? null).iso,
      turns: kept,
    });
  });

  return { turns, meta };
}

function parseSlackMessages(value, warnings, users, channelName) {
  const list = Array.isArray(value) ? value : [];
  const turns = [];
  const skipped = { subtypes: 0, joins: 0, empty: 0 };
  let previousDay = null;

  for (const message of list) {
    if (!message || typeof message !== "object") continue;
    const subtype = typeof message.subtype === "string" ? message.subtype : null;
    if (subtype && subtype !== "thread_broadcast" && subtype !== "file_share") {
      // Channel joins, topic changes, bot noise: not what the person said.
      skipped.subtypes += 1;
      continue;
    }
    const timestamp = normaliseTimestamp(message.ts ?? null);
    const speakerId = message.user ?? message.bot_id ?? null;
    const speaker = (speakerId && users.get(speakerId)) || message.username || message.user_profile?.display_name || speakerId || "unknown";
    const text = renderMessageText(message.text, warnings, `Slack ${channelName}`);
    if (text.trim() === "") {
      skipped.empty += 1;
      continue;
    }
    const day = timestamp.iso ? timestamp.iso.slice(0, 10) : null;
    if (day && day !== previousDay) previousDay = day;
    turns.push({
      speaker,
      timestamp: timestamp.iso ?? timestamp.raw,
      text,
      locateBy: text.trim().slice(0, 120),
      channel: channelName,
    });
  }

  if (skipped.subtypes > 0) warnings.push(`Slack ${channelName}: ${skipped.subtypes} message(s) were channel events (join/leave/topic/bot) rather than dialogue and were skipped`);
  if (skipped.empty > 0) warnings.push(`Slack ${channelName}: ${skipped.empty} message(s) had no text (an upload or a reaction) and were not anchored`);
  return { turns, skipped };
}

function parseTelegram(file, value, warnings) {
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const turns = [];
  const skipped = { service: 0, empty: 0 };
  const chatName = typeof value.name === "string" ? value.name : file.name;

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.type && message.type !== "message") {
      skipped.service += 1;
      continue;
    }
    const timestamp = normaliseTimestamp(message.date_unixtime ?? message.date ?? null);
    const speaker = message.from ?? message.from_id ?? "unknown";
    const text = renderMessageText(message.text, warnings, `Telegram ${chatName}`);
    if (text.trim() === "") {
      skipped.empty += 1;
      continue;
    }
    turns.push({
      speaker: typeof speaker === "string" ? speaker : String(speaker),
      timestamp: timestamp.iso ?? timestamp.raw,
      text,
      locateBy: text.trim().slice(0, 200),
      replyTo: message.reply_to_message_id ?? null,
    });
  }

  if (skipped.service > 0) warnings.push(`Telegram ${chatName}: ${skipped.service} service message(s) (joins, pins, calls) were skipped`);
  if (skipped.empty > 0) warnings.push(`Telegram ${chatName}: ${skipped.empty} message(s) carried no text (media, stickers, polls) and were not anchored`);
  return {
    turns,
    meta: {
      chatName,
      chatType: value.type ?? null,
      chatId: value.id ?? null,
      messages: messages.length,
    },
  };
}

function parseDiscord(file, value, warnings) {
  const list = Array.isArray(value) ? value : [];
  const turns = [];
  const skipped = { empty: 0, bot: 0 };
  for (const message of list) {
    if (!message || typeof message !== "object") continue;
    const author = message.author ?? {};
    if (author.bot === true) {
      skipped.bot += 1;
      continue;
    }
    const timestamp = normaliseTimestamp(message.timestamp ?? null);
    const text = renderMessageText(message.content, warnings, "Discord");
    if (text.trim() === "") {
      skipped.empty += 1;
      continue;
    }
    turns.push({
      speaker: author.nickname || author.global_name || author.name || author.id || "unknown",
      timestamp: timestamp.iso ?? timestamp.raw,
      text,
      locateBy: text.trim().slice(0, 200),
      channel: message.channel_id ?? null,
    });
  }
  if (skipped.bot > 0) warnings.push(`Discord: ${skipped.bot} bot message(s) were skipped`);
  if (skipped.empty > 0) warnings.push(`Discord: ${skipped.empty} message(s) had no text (an attachment or an embed) and were not anchored`);
  return { turns };
}

function parseInstagram(value, warnings) {
  const matches = findObjectArray(value, ["sender_name", "timestamp_ms"], { minLength: 1 });
  const conversations = matches ? matches.items : [];
  const turns = [];
  const meta = { conversations: [] };

  // A DMs export wraps one conversation per file: participants sit beside the
  // messages array, so look one level up from wherever the array was found.
  const participants = findParticipantNames(value);

  conversations.forEach((conversation, index) => {
    const label = `conversation ${index + 1}`;
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [conversation];
    let kept = 0;
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const timestamp = normaliseTimestamp(message.timestamp_ms ?? null);
      const text = typeof message.content === "string" ? message.content : "";
      if (text.trim() === "") continue;
      turns.push({
        speaker: typeof message.sender_name === "string" ? message.sender_name : "unknown",
        timestamp: timestamp.iso ?? timestamp.raw,
        text,
        locateBy: text.trim().slice(0, 120),
      });
      kept += 1;
    }
    meta.conversations.push({
      title: conversation.title ?? null,
      participants: Array.isArray(conversation.participants) ? conversation.participants.map((p) => p?.name).filter(Boolean) : null,
      turns: kept,
    });
    if (kept === 0) warnings.push(`${label}: no message carried text`);
  });

  return { turns, meta: { ...meta, participants } };
}

function findParticipantNames(value) {
  for (const { value: node } of iterateObjects(value, [], 0, 4)) {
    if (node && Array.isArray(node.participants)) {
      const names = node.participants.map((participant) => participant?.name).filter(Boolean);
      if (names.length > 0) return names;
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse a chat export.
 *
 * @param {SourceFile} file
 * @param {{format?: string, users?: string, channelName?: string}} [options]
 *   `users` is the text of a Slack `users.json`, supplied by `harvest` when the
 *   export is a directory.
 */
export function parseChat(file, options = {}) {
  const warnings = [];
  const detected = options.format
    ? { format: options.format, reasons: ["format supplied by the caller"], value: undefined }
    : detectChatFormat(file);

  if (detected.format === "slack-users" || detected.format === "slack-channels") {
    // These are support files, not conversations. They are real exports, but a
    // directory harvest reads them for names — treating them as dialogue would
    // put a member list into the knowledge base.
    throw new UnrecognizedFormatError(
      `${file.label} is a Slack ${detected.format === "slack-users" ? "users.json" : "channels.json"} support file, not a conversation; it is read for display names when a channel export is harvested`,
      { path: file.path, format: detected.format },
    );
  }

  const value = detected.value ?? parseJsonPayload(file).value;
  let turns;
  let meta;

  switch (detected.format) {
    case "chatgpt-export": {
      const result = parseChatGpt(file, value, warnings);
      turns = result.turns;
      meta = result.meta;
      break;
    }
    case "claude-export": {
      const result = parseClaude(value, warnings);
      turns = result.turns;
      meta = result.meta;
      break;
    }
    case "slack-messages": {
      const users = readSlackUsers(options.users, warnings, file.label);
      const result = parseSlackMessages(value, warnings, users, options.channelName ?? file.name);
      turns = result.turns;
      meta = { channel: options.channelName ?? null, messages: Array.isArray(value) ? value.length : 0, resolvedUsers: users.size };
      break;
    }
    case "telegram-export": {
      const result = parseTelegram(file, value, warnings);
      turns = result.turns;
      meta = result.meta;
      break;
    }
    case "discord-messages": {
      const result = parseDiscord(file, value, warnings);
      turns = result.turns;
      meta = { messages: Array.isArray(value) ? value.length : 0 };
      break;
    }
    case "instagram-messages": {
      const result = parseInstagram(value, warnings);
      turns = result.turns;
      meta = result.meta;
      break;
    }
    default:
      throw new UnrecognizedFormatError(
        `${file.label}: format ${detected.format} has no parser`,
        { path: file.path, format: detected.format },
      );
  }

  if (turns.length === 0) {
    throw new UnrecognizedFormatError(
      `${file.label} was read as ${detected.format} but no turn carried text; there is nothing to anchor`,
      { path: file.path, format: detected.format },
    );
  }

  const records = turnsToRecords(file, turns, warnings, file.label);
  const speakers = [...new Set(turns.map((turn) => turn.speaker))];
  const timestamps = turns.map((turn) => turn.timestamp).filter(Boolean).sort();
  const unlocated = records.filter((record) => record.byteStart === null).length;
  if (unlocated > 0) {
    warnings.push(`${unlocated} of ${records.length} turn(s) could not be located in the raw payload; their anchors carry text but no byte offset`);
  }

  return buildDocument({
    identity: options.identity,
    parser: "chat",
    format: detected.format,
    kind: meta?.conversations !== undefined ? "chat-thread" : "chat",
    method: "user-export",
    source: "chat",
    files: [file],
    records: turnsToRecords(file, turns, [], file.label),
    warnings,
    meta: {
      ...meta,
      turns: turns.length,
      speakers,
      firstTimestamp: timestamps[0] ?? null,
      lastTimestamp: timestamps[timestamps.length - 1] ?? null,
      detection: detected.reasons,
      unlocatedTurns: unlocated,
    },
    dropped: [
      { what: "system and tool turns", why: "only turns that carry dialogue text are anchored" },
      { what: "attachments and embeds", why: "the export stores them as ids, not as content" },
    ],
  });
}

export { SourceFile, UnrecognizedFormatError };
