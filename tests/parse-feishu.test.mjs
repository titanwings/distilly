/**
 * `parse/feishu.mjs` — Feishu / Lark message exports, ported from
 * `tools/feishu_parser.py`.
 *
 * The Python tool filtered by person and printed three buckets; the pipeline
 * moved both jobs elsewhere (`harvest --person`, `retrospect`). What is tested
 * here is therefore the part that really is about the format: which shapes are
 * recognised, which field aliases are read, what happens to wordless turns, and
 * whether the messages end up anchored in the ledger.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KnowledgeStore } from "../src/knowledge/store.mjs";
import { loadLedger, recordDocument, resolveLedgerAnchor } from "../src/knowledge/ledger.mjs";
import { SourceFile } from "../src/parse/common.mjs";
import { detectChatFormat, parseChat } from "../src/parse/chat.mjs";
import { detectFeishuFormat, parseFeishu } from "../src/parse/feishu.mjs";
import { runCli, parseReceipt } from "./helpers/cli.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "parse", "feishu");
const FIXED_TIME = "2024-06-07T08:09:10.000Z";

const load = (name) => new SourceFile({ path: join(FIXTURES, name), raw: new Uint8Array(readFileSync(join(FIXTURES, name))) });

function record(document) {
  const store = new KnowledgeStore(mkdtempSync(join(tmpdir(), "distilly-feishu-")));
  const ledger = loadLedger(store);
  const result = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });
  return { store, ledger, result };
}

test("the JSON export is detected and every alias is read", () => {
  const file = load("messages.json");
  const detected = detectFeishuFormat(file);
  assert.equal(detected.format, "feishu-export");
  assert.match(detected.reasons.join(" "), /sender_name/);

  const document = parseFeishu(file, {});
  assert.equal(document.format, "feishu-export");
  assert.equal(document.kind, "message");
  const texts = document.entries.map((entry) => entry.text);
  assert.deepEqual(texts, [
    "这个方案我同意，但灰度要分批。", // sender_name + content
    "收到", // sender{name} + content{text}
    "第一部分 第二部分", // content[] parts are joined
    "先看数据，再看日志。", // `message` alias for content
  ]);
});

test("a wordless turn is named in warnings, never anchored", () => {
  const document = parseFeishu(load("messages.json"), {});
  assert.equal(document.entries.length, 4, "the [图片] turn must not become an anchor");
  assert.equal(
    document.warnings.some((warning) => /1 turn\(s\) carried no words/.test(warning.message ?? warning)),
    true,
    JSON.stringify(document.warnings),
  );
});

test("an object-wrapped export (code/data) is read, and so is the manual log", () => {
  const wrapped = parseFeishu(load("wrapped.json"), {});
  assert.equal(wrapped.entries.length, 2);
  assert.match(wrapped.entries[0].text, /先别改代码/);

  const log = load("log.txt");
  assert.equal(detectFeishuFormat(log).format, "feishu-text");
  const parsed = parseFeishu(log, { format: "feishu-text" });
  assert.deepEqual(parsed.entries.map((entry) => entry.text), ["先看数据，再看日志。", "同意，灰度分批。"]);
  assert.equal(parsed.entries.length, 2, "the [语音] line is skipped");
  assert.equal(
    parsed.warnings.some((warning) => /carried no words/.test(warning.message ?? warning)),
    true,
  );
});

test("detection refuses unrelated JSON instead of guessing", () => {
  const unrelated = load("not-feishu.json");
  assert.deepEqual(detectFeishuFormat(unrelated), {
    format: null,
    reasons: ["JSON root holds no message array (messages/records/data)"],
  });
  assert.throws(() => parseFeishu(unrelated, {}), /is not a Feishu export/);
  // A prose file is not a chat log either (fewer than 80% log-shaped lines).
  const prose = new SourceFile({ path: "/tmp/prose.txt", raw: new Uint8Array(Buffer.from("这是一段说明文字。\n还有第二行。\n", "utf8")) });
  assert.equal(detectFeishuFormat(prose).format, null);
});

test("the chat dispatcher claims Feishu last, so Instagram keeps its own shape", () => {
  // Both use `sender_name`; only Instagram carries `timestamp_ms` on every item.
  assert.equal(detectChatFormat(load("messages.json")).format, "feishu-export");
  const instagram = new SourceFile({
    path: "/tmp/instagram.json",
    raw: new Uint8Array(
      Buffer.from(JSON.stringify([{ sender_name: "张三", timestamp_ms: 1_700_000_000_000, content: "hi" }]), "utf8"),
    ),
  });
  assert.equal(detectChatFormat(instagram).format, "instagram-messages");
});

test("messages reach the ledger, anchors resolve, and a repeat changes nothing", () => {
  const document = parseFeishu(load("messages.json"), { source: "feishu" });
  const first = record(document);
  assert.equal(first.result.appended, true);
  const units = first.ledger[0].units;
  assert.equal(units.length, 4);
  for (const unit of units) {
    const resolved = resolveLedgerAnchor(first.store, first.ledger, unit.anchor);
    assert.ok(resolved, `${unit.anchor} must resolve back to the raw bytes`);
  }

  const textRoot = join(first.store.root, "knowledge", "text");
  const [name] = readdirSync(textRoot);
  const body = readFileSync(join(textRoot, name), "utf8");
  for (const line of body.split("\n")) {
    if (line.trim() !== "") assert.match(line, /^\[k\d{4}\] /, "paragraph anchors use the contract form");
  }

  // Identical bytes do not create a second entry.
  const second = record(parseFeishu(load("messages.json"), { source: "feishu" }));
  assert.equal(second.ledger.length, first.ledger.length);
});

test("cli: parse-chat records a Feishu export and needs --format for a .txt log", () => {
  const root = mkdtempSync(join(tmpdir(), "distilly-feishu-cli-"));
  const exportPath = join(FIXTURES, "messages.json");
  const ok = runCli(["parse-chat", exportPath, "--person", "demo", "--base-dir", root, "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const receipt = parseReceipt(ok.stdout);
  assert.equal(receipt.command, "parse-chat");
  assert.equal(receipt.ok, true);
  assert.ok(receipt.anchors.total >= 4);

  const logPath = join(FIXTURES, "log.txt");
  const refused = runCli(["parse-chat", logPath, "--person", "demo", "--base-dir", root, "--json"]);
  assert.equal(refused.status, 1);
  assert.match(parseReceipt(refused.stdout).warnings.join("\n"), /needs an explicit --format feishu-text/);

  const forced = runCli(["parse-chat", logPath, "--format", "feishu-text", "--person", "demo", "--base-dir", root, "--json"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(parseReceipt(forced.stdout).entries.length, 1);
});
