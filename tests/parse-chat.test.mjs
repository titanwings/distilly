/**
 * `parse/chat.mjs` — every supported chat export into per-turn anchored records,
 * and a loud refusal for everything else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KnowledgeStore } from "../src/knowledge/store.mjs";
import { loadLedger, recordDocument, resolveLedgerAnchor } from "../src/knowledge/ledger.mjs";
import { SourceFile, UnrecognizedFormatError } from "../src/parse/common.mjs";
import {
  detectChatFormat,
  lineariseChatGptMapping,
  normaliseTimestamp,
  parseChat,
  readSlackUsers,
} from "../src/parse/chat.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "parse", "chat");
const FIXED_TIME = "2024-06-07T08:09:10.000Z";

function load(name) {
  const path = join(FIXTURES, name);
  return new SourceFile({ path, raw: new Uint8Array(readFileSync(path)) });
}

function loadSlackUsers() {
  return readFileSync(join(FIXTURES, "slack-users.json"), "utf8");
}

function record(document) {
  const store = new KnowledgeStore(mkdtempSync(join(tmpdir(), "distilly-chat-")));
  const ledger = loadLedger(store);
  const result = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });
  return { store, ledger, result };
}

/* ---------------------------------------------------------------- */
/* detection                                                         */
/* ---------------------------------------------------------------- */

test("each supported export is identified by its structure, with reasons", () => {
  const cases = [
    ["chatgpt-conversations.json", "chatgpt-export", /mapping/],
    ["claude-conversations.json", "claude-export", /chat_messages/],
    ["slack-messages.json", "slack-messages", /ts \+ user/],
    ["slack-users.json", "slack-users", /user objects/],
    ["telegram-result.json", "telegram-export", /messages\[\]/],
    ["discord-messages.json", "discord-messages", /author \+ timestamp/],
    ["instagram-message_1.json", "instagram-messages", /sender_name/],
  ];
  for (const [name, format, reasonPattern] of cases) {
    const detected = detectChatFormat(load(name));
    assert.equal(detected.format, format, name);
    assert.ok(
      detected.reasons.some((reason) => reasonPattern.test(reason)),
      `${name}: reasons must explain the decision, saw ${JSON.stringify(detected.reasons)}`,
    );
  }
});

test("an unknown or prose payload is refused with the markers that were looked for", () => {
  assert.throws(() => detectChatFormat(load("not-a-chat.txt")), UnrecognizedFormatError);
  assert.throws(() => detectChatFormat(load("unknown-shape.json")), (error) => {
    assert.ok(error instanceof UnrecognizedFormatError);
    assert.match(error.message, /not a recognised chat export/);
    assert.match(error.message, /Looked for: ChatGPT/);
    assert.match(error.message, /No guess was made/);
    return true;
  });
});

test("an empty file is refused rather than treated as an empty conversation", () => {
  assert.throws(() => parseChat(load("empty.json")), UnrecognizedFormatError);
});

test("a Slack users.json is a support file, not a conversation", () => {
  assert.throws(() => parseChat(load("slack-users.json")), /support file, not a conversation/);
});

/* ---------------------------------------------------------------- */
/* timestamps                                                        */
/* ---------------------------------------------------------------- */

test("timestamps are normalised when unambiguous and kept verbatim otherwise", () => {
  assert.equal(normaliseTimestamp("1700000100.000100").inferredUnit, "fractional-seconds");
  assert.equal(normaliseTimestamp("1700000100.000100").raw, "1700000100.000100");
  assert.equal(normaliseTimestamp(1700000000000).iso, "2023-11-14T22:13:20.000Z");
  assert.equal(normaliseTimestamp("1700000000000000").inferredUnit, "microseconds");
  assert.equal(normaliseTimestamp("2024-02-03T04:05:06.000Z").iso, "2024-02-03T04:05:06.000Z");
  assert.equal(normaliseTimestamp("2024-02-03 04:05:06").iso, "2024-02-03T04:05:06.000Z");
  const unknown = normaliseTimestamp("last Tuesday");
  assert.equal(unknown.iso, null);
  assert.equal(unknown.raw, "last Tuesday");
  assert.equal(normaliseTimestamp(null).raw, null);
});

/* ---------------------------------------------------------------- */
/* ChatGPT                                                           */
/* ---------------------------------------------------------------- */

test("a ChatGPT mapping is linearised in conversation order", () => {
  const document = parseChat(load("chatgpt-conversations.json"));
  assert.equal(document.format, "chatgpt-export");
  assert.equal(document.kind, "chat-thread");
  assert.deepEqual(document.entries.map((entry) => entry.kind), ["turn", "turn", "turn"]);
  assert.deepEqual(document.meta.speakers, ["user", "assistant"]);
  assert.equal(document.entries[0].text, "How would you key a build cache?");
  assert.equal(document.entries[2].text, "And the lockfile?", "the multimodal turn keeps its text part");
});

test("an edited branch is not merged into the live path", () => {
  const mapping = {
    root: { id: "root", parent: null, children: ["a"], message: null },
    a: { id: "a", parent: "root", children: ["b", "c"], message: { author: { role: "user" }, content: { parts: ["live question"] } } },
    b: { id: "b", parent: "a", children: [], message: { author: { role: "assistant" }, content: { parts: ["live answer"] } } },
    c: { id: "c", parent: "a", children: [], message: { author: { role: "assistant" }, content: { parts: ["discarded answer"] } } },
  };
  const warnings = [];
  const linear = lineariseChatGptMapping(mapping, warnings, "test");
  assert.equal(linear.turns.length, 2, "only the live path is recorded");
  assert.equal(linear.branches, 1);
  assert.ok(warnings.some((warning) => warning.includes("edited branch")));
});

test("a ChatGPT multimodal turn reports the parts it left out", () => {
  const document = parseChat(load("chatgpt-conversations.json"));
  assert.ok(document.warnings.some((warning) => warning.includes("non-text content part")));
});

/* ---------------------------------------------------------------- */
/* Claude                                                           */
/* ---------------------------------------------------------------- */

test("a Claude export keeps human/assistant turns and their timestamps", () => {
  const document = parseChat(load("claude-conversations.json"));
  assert.equal(document.format, "claude-export");
  assert.equal(document.entries.length, 3);
  assert.deepEqual(document.meta.speakers, ["human", "assistant"]);
  assert.equal(document.meta.firstTimestamp, "2024-02-03T04:05:06.000Z");
  assert.match(document.entries[2].text, /That matches what I expected/);
});

/* ---------------------------------------------------------------- */
/* Slack                                                            */
/* ---------------------------------------------------------------- */

test("Slack user ids resolve to display names from users.json", () => {
  const document = parseChat(load("slack-messages.json"), { users: loadSlackUsers(), channelName: "general" });
  assert.equal(document.format, "slack-messages");
  assert.deepEqual(document.meta.speakers, ["Alice Example", "Bob Sample", "deploybot"]);
  assert.equal(document.entries[0].text, "Standup in five minutes.");
});

test("Slack channel events and empty messages are skipped with a reason", () => {
  const document = parseChat(load("slack-messages.json"), { users: loadSlackUsers(), channelName: "general" });
  assert.equal(document.entries.length, 3, "5 messages, minus a join event and an empty one");
  assert.ok(document.warnings.some((warning) => warning.includes("channel events")));
  assert.ok(document.warnings.some((warning) => warning.includes("had no text")));
});

test("a missing users.json degrades labels instead of failing", () => {
  const warnings = [];
  const users = readSlackUsers(null, warnings, "slack.json");
  assert.equal(users.size, 0);
  assert.ok(warnings.some((warning) => warning.includes("no users.json")));

  const document = parseChat(load("slack-messages.json"), { channelName: "general" });
  assert.equal(document.entries.length, 3, "messages still parse");
  assert.ok(document.meta.speakers.includes("U01SYNTH"), "the raw id is kept rather than invented");
  assert.ok(document.warnings.some((warning) => warning.includes("no users.json")));

  const broken = readSlackUsers("{ not json", warnings, "slack.json");
  assert.equal(broken.size, 0);
  assert.ok(warnings.some((warning) => warning.includes("could not be parsed")));
});

/* ---------------------------------------------------------------- */
/* Telegram / Discord / Instagram                                   */
/* ---------------------------------------------------------------- */

test("Telegram rich-text fragments are joined and service messages skipped", () => {
  const document = parseChat(load("telegram-result.json"));
  assert.equal(document.format, "telegram-export");
  assert.equal(document.entries.length, 2);
  assert.equal(document.entries[1].text, "It should refuse instead.");
  assert.ok(document.warnings.some((warning) => warning.includes("service message")));
  assert.ok(document.warnings.some((warning) => warning.includes("carried no text")));
  assert.equal(document.meta.chatName, "Synthetic team chat");
});

test("a Telegram turn built from fragments reports an envelope range", () => {
  const document = parseChat(load("telegram-result.json"));
  const second = document.entries[1];
  const raw = Buffer.from(load("telegram-result.json").raw);
  const slice = raw.subarray(second.byteStart, second.byteEnd).toString("utf8");
  assert.ok(slice.includes("It should"), slice);
  assert.ok(slice.includes("refuse"), slice);
  assert.ok(slice.includes("instead."), slice);
});

test("Discord bot messages are excluded and nicknames win over handles", () => {
  const document = parseChat(load("discord-messages.json"));
  assert.equal(document.format, "discord-messages");
  assert.equal(document.entries.length, 2);
  assert.equal(document.entries[0].label.startsWith("Alice Example"), true);
  assert.equal(document.entries[0].label.includes("bob"), false);
  assert.ok(document.warnings.some((warning) => warning.includes("bot message")));
});

test("an Instagram/Facebook DM dump keeps participants and skips media-only rows", () => {
  const document = parseChat(load("instagram-message_1.json"));
  assert.equal(document.format, "instagram-messages");
  assert.equal(document.entries.length, 2);
  assert.deepEqual(document.meta.participants, ["Alice Example", "Bob Sample"]);
  assert.equal(document.meta.conversations[0].participants.join(","), "Alice Example,Bob Sample");
});

/* ---------------------------------------------------------------- */
/* byte discipline                                                   */
/* ---------------------------------------------------------------- */

test("every located turn's byte range contains the text it claims", () => {
  for (const [name, options] of [
    ["chatgpt-conversations.json", {}],
    ["claude-conversations.json", {}],
    ["slack-messages.json", { users: loadSlackUsers() }],
    ["telegram-result.json", {}],
    ["discord-messages.json", {}],
    ["instagram-message_1.json", {}],
  ]) {
    const file = load(name);
    const raw = Buffer.from(file.raw);
    const document = parseChat(file, options);
    for (const entry of document.entries) {
      if (entry.byteStart === null) continue;
      const slice = raw.subarray(entry.byteStart, entry.byteEnd).toString("utf8");
      // A turn assembled from fragments is not contiguous in the payload, so the
      // check is that the range holds at least one of its own fragments — never
      // that it holds text from somewhere else.
      const fragments = entry.text.split(/\s+/).filter((word) => word.length > 3);
      const found = fragments.some((fragment) => slice.includes(fragment));
      assert.ok(found, `${name}: ${JSON.stringify(entry.text.slice(0, 40))} must be represented in ${JSON.stringify(slice.slice(0, 120))}`);
      assert.ok(slice.length <= entry.text.length * 4 + 200, `${name}: the range must not swallow a neighbour (${slice.length} bytes)`);
    }
  }
});

test("a turn that cannot be located reports no byte offset instead of a wrong one", () => {
  const payload = JSON.stringify({
    name: "synthetic",
    type: "private_group",
    messages: [
      { id: 1, type: "message", date_unixtime: "1700000000", from: "Alice", text: "a" },
      { id: 2, type: "message", date_unixtime: "1700000001", from: "Bob", text: "a" },
    ],
  });
  const file = new SourceFile({ path: "/tmp/tg.json", raw: Buffer.from(payload, "utf8") });
  const document = parseChat(file);
  assert.equal(document.entries.length, 2);
  assert.equal(document.entries[0].byteStart, null, "an ambiguous short needle is not guessed");
  assert.ok(document.warnings.some((warning) => warning.includes("could not be located")));
  assert.equal(document.meta.unlocatedTurns, 2);
});

/* ---------------------------------------------------------------- */
/* ledger integration                                               */
/* ---------------------------------------------------------------- */

test("turn anchors resolve back to the export bytes", () => {
  const document = parseChat(load("chatgpt-conversations.json"));
  const { store, ledger } = record(document);
  const raw = store.readRaw("chat", "chatgpt-conversations.json");

  const turn = resolveLedgerAnchor(ledger, "k0001:t1");
  assert.ok(turn, "k0001:t1 must resolve");
  assert.equal(turn.kind, "turn");
  assert.equal(Buffer.from(raw).subarray(turn.byteStart, turn.byteEnd).toString("utf8"), "How would you key a build cache?");

  const second = resolveLedgerAnchor(ledger, "k0001:t2");
  assert.equal(second.text, "Include the toolchain version in the cache key.");
  assert.equal(Buffer.from(raw).subarray(second.byteStart, second.byteEnd).toString("utf8"), second.text);

  const paragraph = resolveLedgerAnchor(ledger, "k0002");
  assert.ok(paragraph.text.includes("Include the toolchain version"));
});

test("each turn becomes its own paragraph anchor", () => {
  const document = parseChat(load("claude-conversations.json"));
  const { result } = record(document);
  assert.equal(result.units.length, 3);
  assert.deepEqual(result.entry.anchors.filter((anchor) => !anchor.includes(":")), ["k0001", "k0002", "k0003"]);
  assert.deepEqual(result.entry.anchors.filter((anchor) => anchor.includes(":")), ["k0001:t1", "k0001:t2", "k0001:t3"]);
});

test("a second import of the same export adds no ledger entry", () => {
  const document = parseChat(load("discord-messages.json"));
  const store = new KnowledgeStore(mkdtempSync(join(tmpdir(), "distilly-chat-dup-")));
  const ledger = loadLedger(store);
  const first = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });
  const second = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });
  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  assert.equal(ledger.length, 1);
  assert.equal(second.id, first.id);
});

test("parsing is deterministic: two runs produce identical documents", () => {
  for (const name of ["chatgpt-conversations.json", "claude-conversations.json", "telegram-result.json", "discord-messages.json"]) {
    const first = JSON.stringify(parseChat(load(name)));
    const second = JSON.stringify(parseChat(load(name)));
    assert.equal(first, second, name);
  }
});
