/**
 * Speaker and time must survive into `knowledge/text/*.md`.
 *
 * That file is the only thing the derivation reads: a speaker that stops at the
 * parser is invisible to `retrospect`, which is how `voice`/`relations` ended up
 * describing "the pair" instead of the person (see `docs/evidence/pr-10-blind-test-runs.md`).
 * The prefix is render-time markup, exactly like the `[k0012]` anchor, so the
 * "anchor text equals source bytes" invariant stays intact — both halves are
 * asserted here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseReceipt, runCli } from "./helpers/cli.mjs";
import { loadLedger, resolveLedgerAnchor } from "../src/knowledge/ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CHAT_FIXTURES = join(here, "fixtures", "parse", "chat");

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "dst-attribution-"));
}

/** A Slack export directory: messages.json + the users.json it ships with. */
function slackExport(root, messages = 12) {
  const dir = join(root, "corpus");
  mkdirSync(dir, { recursive: true });
  const base = 1_700_000_000;
  const rows = [];
  for (let index = 0; index < messages; index += 1) {
    const alice = index % 2 === 0;
    rows.push({
      type: "message",
      user: alice ? "U01" : "U02",
      text: alice ? `Alice line ${index}: 先看数据，再看日志，最后才看代码。` : `Bob line ${index}: 同意，不过灰度要分批。`,
      ts: `${base + index * 90}.000100`,
    });
  }
  writeFileSync(join(dir, "messages.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  copyFileSync(join(CHAT_FIXTURES, "slack-users.json"), join(dir, "users.json"));
  return dir;
}

function harvest(root, corpus, person = "conv", extra = []) {
  const result = runCli(["harvest", corpus, "--person", person, "--base-dir", root, "--json", ...extra]);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function textOf(root, person = "conv") {
  const dir = join(root, "skills", "colleague", person, "knowledge", "text");
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
}

test("the normalised markdown carries `<timestamp> <speaker>：`", () => {
  const root = tempRoot();
  try {
    harvest(root, slackExport(root));
    const [file] = textOf(root);
    assert.equal(file.name, "chat.md");
    // Names come from the sibling users.json the export ships with.
    assert.match(file.body, /^\[k0001\] 2023-11-14T22:13:20\.000Z Alice：Alice line 0/m);
    assert.match(file.body, /^\[k0002\] 2023-11-14T22:14:50\.000Z Bob：Bob line 1/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nothing is prefixed twice, and the paragraph text stays verbatim", () => {
  const root = tempRoot();
  try {
    const subtitle = join(here, "fixtures", "parse", "subtitle", "interview.srt");
    harvest(root, subtitle, "sub");
    const [file] = textOf(root, "sub");
    // This fixture's second cue already reads `Lin: …`; the renderer must not
    // turn it into `Lin：Lin: …`.
    assert.equal(file.body.includes("Lin：Lin:"), false, file.body.slice(0, 200));

    // The anchor's own text is still exactly the raw bytes: the prefix is markup.
    const ledger = loadLedger({ root: join(root, "skills", "colleague", "sub", "knowledge") });
    const unit = resolveLedgerAnchor(ledger, "k0002");
    assert.ok(unit, "k0002 must resolve");
    const raw = readFileSync(join(root, "skills", "colleague", "sub", "knowledge", "raw", "subtitle", "interview.srt"));
    assert.equal(raw.subarray(unit.byteStart, unit.byteEnd).toString("utf8"), unit.text);
    assert.equal(unit.text.startsWith("Lin"), true, `expected the cue text itself, got ${unit.text.slice(0, 40)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("attribution reaches the derivation: per-speaker voice stats and dated phases", () => {
  const root = tempRoot();
  try {
    harvest(root, slackExport(root));
    const retro = runCli(["retrospect", "--person", "conv", "--json"], { cwd: root });
    assert.equal(retro.status, 0, retro.stderr);
    const receipt = parseReceipt(retro.stdout);
    assert.deepEqual(receipt.warnings, [], "a clean chat corpus derives without warnings");
    assert.ok(receipt.anchors.cited > 0);

    const derived = join(root, "skills", "colleague", "conv", "evidence", "derived");
    const voice = JSON.parse(readFileSync(join(derived, "voice.json"), "utf8"));
    const length = voice.claims.find((claim) => claim.id === "voice.sentence_length");
    assert.ok(length, "sentence length must be derived");
    assert.equal(length.value.pooled, true, "the pooled number says that it pools speakers");
    assert.deepEqual(Object.keys(length.value.by_speaker).sort(), ["Alice", "Bob"]);
    assert.equal(length.value.by_speaker.Alice.samples, 6);
    for (const [speaker, stats] of Object.entries(length.value.by_speaker)) {
      assert.ok(stats.median > 0, `${speaker} needs a median`);
    }

    const stats = JSON.parse(readFileSync(join(derived, "stats.json"), "utf8"));
    assert.deepEqual(stats.claims.find((claim) => claim.id === "stats.participants").value, ["Alice", "Bob"]);

    // Timestamps reached the derivation too: the phases are time-based now.
    const timeline = JSON.parse(readFileSync(join(derived, "timeline.json"), "utf8"));
    const phase = timeline.claims.find((claim) => claim.id.startsWith("timeline.phase"));
    assert.equal(phase.value.basis, "time", "phases must be dated, not order-based");
    assert.match(phase.value.from, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two exports under one --source no longer overwrite each other's text", () => {
  const root = tempRoot();
  try {
    const corpus = slackExport(root);
    // A second chat document, same source bucket: this used to replace chat.md.
    const second = join(root, "second.json");
    const rows = JSON.parse(readFileSync(join(corpus, "messages.json"), "utf8"));
    writeFileSync(
      second,
      `${JSON.stringify(rows.map((row, index) => ({ ...row, text: `second export line ${index}` })), null, 2)}\n`,
      "utf8",
    );

    harvest(root, corpus);
    harvest(root, second, "conv", ["--source", "chat"]);

    const files = textOf(root);
    assert.equal(files.length, 2, `expected two text files, got ${files.map((file) => file.name).join(", ")}`);
    const bodies = files.map((file) => file.body).join("\n");
    assert.match(bodies, /Alice line 0/);
    assert.match(bodies, /second export line 0/);

    const ledger = loadLedger({ root: join(root, "skills", "colleague", "conv", "knowledge") });
    assert.equal(ledger.length, 2);
    for (const entry of ledger) {
      assert.ok(entry.locations.text, `${entry.id} must point at a text file`);
      for (const unit of entry.units ?? []) {
        assert.ok(resolveLedgerAnchor(ledger, unit.anchor), `${unit.anchor} must resolve`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
