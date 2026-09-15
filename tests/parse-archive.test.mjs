/**
 * Archive reader: X exports parsed here, everything else routed to the parser that
 * owns it, and unrecognised members named in warnings.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crc32 } from "../src/parse/common.mjs";
import { classifyMember, parseArchive, parseCsv, parseXMember } from "../src/parse/archive.mjs";

const BIN = join(import.meta.dirname, "..", "bin", "distilly.mjs");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-archive-"));
}

function zipStore(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const crc = crc32(new Uint8Array(data));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

const TWEETS = `window.YTD.tweets.part0 = [
  {"tweet": {"id_str": "1", "created_at": "Mon Mar 02 10:00:00 +0000 2024", "full_text": "第一笔对账差异"}},
  {"tweet": {"id_str": "2", "created_at": "Tue Mar 03 10:00:00 +0000 2024", "full_text": "今天把差异表发出来了"}}
]`;
const DMS = `window.YTD.direct_messages.part0 = [
  {"dmConversation": {"conversationId": "c1", "messages": [
    {"messageCreate": {"createdAt": "2024-03-02T10:00:00Z", "senderId": "u1", "text": "我先把流水拉出来"}}
  ]}}
]`;
const MBOX = [
  "From alice@example.com Mon Mar 02 10:00:00 2024",
  "From: Alice <alice@example.com>",
  "Subject: 对账",
  "",
  "邮件里的差异说明",
  "",
].join("\n");

function writeXArchive(root) {
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "data", "tweets.js"), TWEETS, "utf8");
  writeFileSync(join(root, "data", "direct-messages.js"), DMS, "utf8");
  writeFileSync(join(root, "Connections.csv"), "First Name,Company\nLin,Acme\n", "utf8");
  writeFileSync(join(root, "notes.bin"), "binary-ish", "utf8");
  return root;
}

test("classifyMember routes by name and extension", () => {
  assert.deepEqual(classifyMember("data/tweets.js"), { parser: "x", format: "tweets" });
  assert.equal(classifyMember("data/direct-messages.js").format, "dms");
  assert.equal(classifyMember("Takeout/Mail/inbox.mbox").parser, "email");
  assert.equal(classifyMember("result.json").parser, "chat");
  assert.equal(classifyMember("report.docx").parser, "office");
  assert.equal(classifyMember("subs/ep1.srt").parser, "subtitle");
  assert.equal(classifyMember("Connections.csv").parser, "csv");
  assert.equal(classifyMember("photo.jpg").parser, "unsupported");
});

test("X members parse into tweet and dm records", () => {
  const tweets = parseXMember("data/tweets.js", Buffer.from(TWEETS, "utf8"));
  assert.equal(tweets.length, 2);
  assert.equal(tweets[0].kind, "tweet");
  assert.match(tweets[0].text, /第一笔对账差异/);
  const dms = parseXMember("data/direct-messages.js", Buffer.from(DMS, "utf8"));
  assert.equal(dms.length, 1);
  assert.match(dms[0].text, /我先把流水拉出来/);
});

test("a directory archive mixes members and names what it skipped", () => {
  const root = tempDir();
  try {
    writeXArchive(root);
    const document = parseArchive(root);
    const texts = document.entries.map((entry) => entry.text);
    assert.ok(texts.some((text) => text.includes("第一笔对账差异")), "tweets travel");
    assert.ok(texts.some((text) => text.includes("我先把流水拉出来")), "dms travel");
    assert.ok(texts.some((text) => text.includes("First Name=Lin")), "csv travels");
    assert.ok(
      document.warnings.some((warning) => warning.code === "archive/unsupported-member" && String(warning.message).includes("notes.bin")),
      "an unrecognised member must be named",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a zip archive delegates .mbox members to the email reader", () => {
  const zip = zipStore([
    ["data/tweets.js", TWEETS],
    ["Takeout/Mail/inbox.mbox", MBOX],
  ]);
  const document = parseArchive(zip);
  const texts = document.entries.map((entry) => entry.text);
  assert.ok(texts.some((text) => text.includes("第一笔对账差异")));
  assert.ok(texts.some((text) => text.includes("邮件里的差异说明")), "the mbox member is parsed by the email reader");
});

test("an archive with nothing readable is refused loudly", () => {
  const zip = zipStore([["photo.jpg", "not really a jpeg"]]);
  assert.throws(() => parseArchive(zip), /no member produced readable text/);
});

test("parseCsv handles quoted fields and doubled quotes", () => {
  const rows = parseCsv('Name,Note\n"Doe, Jane","He said ""hi"""\n');
  assert.deepEqual(rows, [["Name", "Note"], ["Doe, Jane", 'He said "hi"']]);
});

test("the CLI records an archive and is idempotent", () => {
  const root = tempDir();
  try {
    const archive = writeXArchive(join(root, "x-archive"));
    const run = () => {
      const result = spawnSync(
        process.execPath,
        [BIN, "parse-archive", archive, "--person", "lin-gong", "--base-dir", root, "--json"],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    };

    const first = run();
    assert.equal(first.command, "parse-archive");
    assert.equal(first.ok, true);
    assert.equal(first.entries[0].appended, true);
    assert.ok(first.anchors.total >= 3);

    const ledger = join(root, "skills", "colleague", "lin-gong", "knowledge", "index.json");
    const before = readFileSync(ledger, "utf8");
    assert.equal(run().entries[0].appended, false);
    assert.equal(readFileSync(ledger, "utf8"), before);

    const text = readFileSync(join(root, "skills", "colleague", "lin-gong", "knowledge", "text", "archive.md"), "utf8");
    assert.match(text, /第一笔对账差异/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
