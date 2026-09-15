/**
 * `parse-chat` and `parse-subtitle`: the two contract commands that were listed
 * as PLANNED long after their parsers landed, so the CLI told users "not
 * implemented" for a working module. These tests pin the command surface —
 * receipt shape, ledger effect, idempotency, refusal by name — rather than the
 * parsing itself, which `parse-chat.test.mjs` / `parse-subtitle.test.mjs` cover.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseReceipt, runCli } from "./helpers/cli.mjs";
import { PLANNED, resolveCommand } from "../src/commands/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CHAT = join(here, "fixtures", "parse", "chat", "chatgpt-conversations.json");
const SLACK = join(here, "fixtures", "parse", "chat", "slack-messages.json");
const SLACK_USERS = join(here, "fixtures", "parse", "chat", "slack-users.json");
const SUBTITLE = join(here, "fixtures", "parse", "subtitle", "interview.srt");

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "dst-parse-cmd-"));
  return { root, personDir: join(root, "skills", "colleague", "demo") };
}

test("both commands are registered and no longer reported as planned", () => {
  assert.equal(resolveCommand("parse-chat").name, "parse-chat");
  assert.equal(resolveCommand("parse-subtitle").name, "parse-subtitle");
  assert.equal("parse-chat" in PLANNED, false);
  assert.equal("parse-subtitle" in PLANNED, false);
});

test("parse-chat records one ledger entry and is idempotent", () => {
  const { root, personDir } = tempRoot();
  try {
    const first = runCli(["parse-chat", CHAT, "--person", "demo", "--base-dir", root, "--json"]);
    assert.equal(first.status, 0, first.stderr);
    const receipt = parseReceipt(first.stdout);
    assert.equal(receipt.command, "parse-chat");
    assert.equal(receipt.ok, true);
    assert.equal(receipt.person, "demo");
    assert.equal(receipt.entries.length, 1);
    assert.equal(receipt.entries[0].appended, true);
    assert.ok(receipt.anchors.total > 0, "the dialogue must be anchored");
    assert.ok(existsSync(join(personDir, "knowledge", "index.json")));
    assert.ok(existsSync(join(personDir, "knowledge", "text", "chat.md")));

    // Identical bytes are recorded once: the ledger keeps its length and reports
    // the repeat instead of duplicating anchors.
    const before = readFileSync(join(personDir, "knowledge", "index.json"), "utf8");
    const second = runCli(["parse-chat", CHAT, "--person", "demo", "--base-dir", root, "--json"]);
    assert.equal(second.status, 0);
    const repeat = parseReceipt(second.stdout);
    assert.equal(repeat.entries[0].appended, false);
    assert.equal(readFileSync(join(personDir, "knowledge", "index.json"), "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parse-chat resolves Slack ids from a sibling users.json", () => {
  const { root, personDir } = tempRoot();
  try {
    // The fixture directory ships users.json next to the messages file, which is
    // exactly how a Slack export arrives, so no --users flag should be needed.
    assert.equal(resolve(SLACK_USERS), resolve(dirname(SLACK), "users.json"));
    const result = runCli(["parse-chat", SLACK, "--person", "demo", "--base-dir", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = parseReceipt(result.stdout);
    assert.equal(receipt.ok, true);
    const text = readFileSync(join(personDir, "knowledge", "text", "chat.md"), "utf8");
    assert.equal(/U0[A-Z0-9]+/.test(text), false, `unresolved Slack id in:\n${text.slice(0, 400)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parse-subtitle records cues with timecodes and refuses anything else by name", () => {
  const { root, personDir } = tempRoot();
  try {
    const result = runCli(["parse-subtitle", SUBTITLE, "--person", "demo", "--base-dir", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = parseReceipt(result.stdout);
    assert.equal(receipt.command, "parse-subtitle");
    assert.equal(receipt.entries.length, 1);
    const text = readFileSync(join(personDir, "knowledge", "text", "subtitle.md"), "utf8");
    assert.match(text, /^\[k0001\] /m, "paragraph anchors use the contract's bracket form");
    assert.equal(text.includes("-->"), false, "timecodes are metadata, not body text");

    const wrong = runCli(["parse-subtitle", CHAT, "--person", "demo", "--base-dir", root, "--json"]);
    assert.equal(wrong.status, 1, "a chat export is not a subtitle");
    const refused = parseReceipt(wrong.stdout);
    assert.equal(refused.ok, false);
    assert.equal(refused.entries.length, 0);
    assert.match(refused.warnings.join("\n"), /not a subtitle file \(expected \.srt\/\.vtt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a usage error returns exit 2 with the remedy, not a thrown stack", () => {
  for (const command of ["parse-chat", "parse-subtitle"]) {
    const missingPerson = runCli([command, CHAT, "--json"]);
    assert.equal(missingPerson.status, 2, `${command} without --person`);
    assert.match(parseReceipt(missingPerson.stdout).error.message, /--person is required/);

    const unknown = runCli([command, CHAT, "--person", "demo", "--nope", "--json"]);
    assert.equal(unknown.status, 2, `${command} with an unknown flag`);
    assert.match(parseReceipt(unknown.stdout).error.message, /unknown option: --nope/);
  }
});
