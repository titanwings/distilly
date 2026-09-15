/**
 * `.eml` / `.mbox` reader: headers, charsets, mbox splitting and the honesty rules
 * (attachments are named, never silently dropped).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SourceFile } from "../src/parse/common.mjs";
import { decodeMimeWords, parseEmail, parseMessage, splitMbox } from "../src/parse/email.mjs";

const BIN = join(import.meta.dirname, "..", "bin", "distilly.mjs");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-email-"));
}

function sourceFor(text, name = "mail.eml") {
  return new SourceFile({ path: `/tmp/${name}`, raw: Buffer.from(text, "utf8") });
}

const PLAIN = [
  "From: Alice <alice@example.com>",
  "To: Bob <bob@example.com>",
  "Subject: 对账差异",
  "Date: Mon, 02 Mar 2024 10:00:00 +0800",
  "",
  "昨天的对账差了三笔，我先按流水号排了一遍。",
  "From now on 我会把每日差异发给你。",
  "",
].join("\n");

test("RFC 2047 encoded-words decode in headers", () => {
  assert.equal(decodeMimeWords("=?UTF-8?B?5L2g5aW9?="), "你好");
  assert.equal(decodeMimeWords("plain subject"), "plain subject");
});

test("a plain UTF-8 message keeps its body and metadata", () => {
  const message = parseMessage(Buffer.from(PLAIN, "utf8"));
  assert.equal(message.subject, "对账差异");
  assert.match(message.from, /alice@example\.com/);
  assert.match(message.body, /对账差了三笔/);
  assert.match(message.body, /From now on/, "a body line starting with From must stay in the body");
  assert.deepEqual(message.warnings, []);
});

test("quoted-printable with a declared GBK charset decodes", () => {
  const eml = [
    "From: =?UTF-8?B?5p6X5bel?= <lin@example.com>",
    "Subject: =?UTF-8?B?5L2g5aW9?=",
    "Content-Type: text/plain; charset=gbk",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "=C4=E3=BA=C3",
    "",
  ].join("\n");
  const message = parseMessage(Buffer.from(eml, "utf8"));
  assert.equal(message.from.includes("林工"), true, `expected a decoded name, saw ${message.from}`);
  assert.equal(message.subject, "你好");
  assert.equal(message.body.trim(), "你好");
});

test("multipart/alternative prefers text/plain and falls back to stripped HTML", () => {
  const withPlain = [
    "From: a@example.com",
    "Content-Type: multipart/alternative; boundary=BB",
    "",
    "--BB",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "纯文本版本",
    "--BB",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>HTML 版本</p>",
    "--BB--",
    "",
  ].join("\n");
  const plain = parseMessage(Buffer.from(withPlain, "utf8"));
  assert.equal(plain.body.trim(), "纯文本版本");

  const htmlOnly = withPlain.replace("纯文本版本", "").replace("Content-Type: text/plain; charset=utf-8", "Content-Type: text/plain; charset=utf-8");
  const stripped = parseMessage(Buffer.from([
    "From: a@example.com",
    "Content-Type: multipart/alternative; boundary=BB",
    "",
    "--BB",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>HTML <b>版本</b></p>",
    "--BB--",
    "",
  ].join("\n"), "utf8"));
  assert.equal(stripped.body.trim(), "HTML 版本");
  assert.ok(stripped.warnings.some((warning) => warning.code === "email/html-only"));
  void htmlOnly;
});

test("attachments are named in warnings, never decoded and never dropped", () => {
  const eml = [
    "From: a@example.com",
    "Content-Type: multipart/mixed; boundary=MM",
    "",
    "--MM",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "正文",
    "--MM",
    "Content-Type: application/pdf; name=report.pdf",
    "Content-Disposition: attachment; filename=report.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQK",
    "--MM--",
    "",
  ].join("\n");
  const message = parseMessage(Buffer.from(eml, "utf8"));
  assert.equal(message.body.trim(), "正文");
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].filename, "report.pdf");
  assert.ok(message.warnings.some((warning) => warning.code === "email/attachment-skipped"));
  assert.ok(!message.body.includes("JVBERi0"), "attachment bytes must not leak into the body");
});

test("mbox splits only on real separators, not on body lines starting with From", () => {
  const mbox = [
    "From alice@example.com Mon Mar 02 10:00:00 2024",
    "Subject: one",
    "",
    "From now on, differently.",
    "",
    "From bob@example.com Mon Mar 02 11:00:00 2024",
    "Subject: two",
    "",
    "second body",
    "",
  ].join("\n");
  const ranges = splitMbox(mbox);
  assert.equal(ranges.length, 2, "a body line starting with From must not split the mailbox");
  assert.match(ranges[0].text, /From now on/);
  assert.match(ranges[1].text, /second body/);
});

test("the CLI records each message as an anchored unit, idempotently", () => {
  const root = tempDir();
  try {
    const mail = join(root, "inbox.mbox");
    writeFileSync(
      mail,
      [
        "From alice@example.com Mon Mar 02 10:00:00 2024",
        "From: Alice <alice@example.com>",
        "Subject: 第一封",
        "",
        "第一封正文",
        "",
        "From bob@example.com Mon Mar 02 11:00:00 2024",
        "From: Bob <bob@example.com>",
        "Subject: 第二封",
        "",
        "第二封正文",
        "",
      ].join("\n"),
      "utf8",
    );

    const run = () => {
      const result = spawnSync(
        process.execPath,
        [BIN, "parse-email", mail, "--person", "lin-gong", "--base-dir", root, "--json"],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    };

    const first = run();
    assert.equal(first.command, "parse-email");
    assert.equal(first.ok, true);
    assert.equal(first.entries.length, 1);
    assert.equal(first.entries[0].appended, true);
    assert.ok(first.anchors.total >= 2, `expected at least two anchor units, saw ${first.anchors.total}`);

    const ledgerPath = join(root, "skills", "colleague", "lin-gong", "knowledge", "index.json");
    const ledgerBefore = readFileSync(ledgerPath, "utf8");
    const second = run();
    assert.equal(second.entries[0].appended, false, "identical bytes must not be recorded twice");
    assert.equal(readFileSync(ledgerPath, "utf8"), ledgerBefore, "a duplicate import must not change the ledger");

    const text = readFileSync(join(root, "skills", "colleague", "lin-gong", "knowledge", "text", "email.md"), "utf8");
    assert.match(text, /第一封正文/);
    assert.match(text, /第二封正文/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a non-email file is refused by name", () => {
  const root = tempDir();
  try {
    const file = join(root, "notes.txt");
    writeFileSync(file, "not an email\n", "utf8");
    const result = spawnSync(process.execPath, [BIN, "parse-email", file, "--person", "x", "--base-dir", root, "--json"], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    const receipt = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    assert.equal(receipt.ok, false);
    assert.ok(receipt.warnings.some((warning) => warning.includes("not an .eml/.mbox file")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseEmail builds a document whose records are one per message", () => {
  const document = parseEmail(sourceFor(PLAIN), { source: "email" });
  assert.equal(document.kind, "email");
  assert.equal(document.format, "eml");
  assert.equal(document.records.length, 1);
  assert.equal(document.records[0].kind, "message");
});
