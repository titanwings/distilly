/**
 * Cross-channel identity: one person, several handles.
 *
 * The multi-source corpus signs the same person `林工` in Slack and `ou_lin` in
 * Feishu. Without a map the derivation reports two participants and splits that
 * person's statistics between them — the blind test could only describe the corpus
 * "per channel" because of it. `identity.json` fixes that at record time, so every
 * anchor, statistic and citation names the person the same way.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseReceipt, runCli } from "./helpers/cli.mjs";
import { applyIdentity, canonicalSpeaker, loadIdentity } from "../src/knowledge/identity.mjs";
import { loadLedger } from "../src/knowledge/ledger.mjs";
import { KnowledgeStore } from "../src/knowledge/store.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const CORPUS = join(HERE, "tests", "fixtures", "public-corpus", "synthetic-multisource");

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "dst-identity-"));
  const mapPath = join(root, "identity.json");
  writeFileSync(
    mapPath,
    `${JSON.stringify(
      {
        people: [
          { name: "林工", handles: ["ou_lin"], note: "Slack 显示名 = 飞书 open_id" },
          { name: "小明", handles: ["ou_chen"] },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { root, mapPath, personDir: join(root, "skills", "colleague", "lin-gong") };
}

const textOf = (personDir) => {
  const dir = join(personDir, "knowledge", "text");
  const names = readFileSync(join(personDir, "knowledge", "index.json"), "utf8");
  const ledger = JSON.parse(names);
  return ledger.map((entry) => readFileSync(join(personDir, "knowledge", entry.locations.text), "utf8")).join("\n");
};

test("a map canonicalises handles at record time, and the ledger says so", () => {
  const box = sandbox();
  try {
    const harvested = runCli(["harvest", CORPUS, "--person", "lin-gong", "--base-dir", box.root, "--identity", box.mapPath, "--json"]);
    assert.equal(harvested.status, 0, harvested.stderr);
    const receipt = parseReceipt(harvested.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(existsSync(join(box.personDir, "identity.json")), true, "the map is installed into the Skill");

    const text = textOf(box.personDir);
    assert.match(text, /林工：评审前我把风险清单发群里/, "the Feishu handle becomes the canonical name");
    assert.equal(/ou_lin：|ou_chen：/.test(text), false, "no raw handle survives into the normalised text");

    const ledger = loadLedger(new KnowledgeStore(box.personDir));
    const feishu = ledger.find((entry) => entry.identity);
    assert.ok(feishu, "the entry records which handles it canonicalised");
    assert.deepEqual(feishu.identity.handles, ["ou_chen", "ou_lin"]);
    assert.equal(feishu.identity.turns, 16, "16 Feishu turns changed");
    assert.equal(feishu.identity.file, "identity.json");
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("the derivation then reports one participant per person", () => {
  const box = sandbox();
  try {
    assert.equal(runCli(["harvest", CORPUS, "--person", "lin-gong", "--base-dir", box.root, "--identity", box.mapPath, "--json"]).status, 0);
    const retro = runCli(["retrospect", "--person", "lin-gong", "--json"], { cwd: box.root });
    assert.equal(retro.status, 0, retro.stderr);

    const derived = join(box.personDir, "evidence", "derived");
    const stats = JSON.parse(readFileSync(join(derived, "stats.json"), "utf8"));
    const participants = stats.claims.find((claim) => claim.id === "stats.participants").value;
    assert.ok(participants.includes("林工"));
    assert.equal(participants.includes("ou_lin"), false, "the handle must not survive as its own participant");
    assert.equal(participants.includes("小明"), true, "the second person is canonicalised too");

    const voice = JSON.parse(readFileSync(join(derived, "voice.json"), "utf8"));
    const bySpeaker = voice.claims.find((claim) => claim.id === "voice.sentence_length").value.by_speaker;
    assert.ok(bySpeaker["林工"], `by_speaker: ${JSON.stringify(Object.keys(bySpeaker))}`);
    assert.equal("ou_lin" in bySpeaker, false);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("without a map nothing changes", () => {
  const box = sandbox();
  try {
    assert.equal(runCli(["harvest", CORPUS, "--person", "lin-gong", "--base-dir", box.root, "--json"]).status, 0);
    const text = textOf(box.personDir);
    assert.match(text, /ou_lin：/);
    const ledger = loadLedger(new KnowledgeStore(box.personDir));
    assert.equal(ledger.every((entry) => entry.identity === undefined), true);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("a bad map fails loudly and changes nothing", () => {
  const box = sandbox();
  try {
    const bad = join(box.root, "bad.json");
    writeFileSync(bad, `${JSON.stringify({ people: [{ name: "甲", handles: ["x"] }, { name: "乙", handles: ["x"] }] })}\n`, "utf8");
    const clash = runCli(["harvest", CORPUS, "--person", "lin-gong", "--base-dir", box.root, "--identity", bad, "--json"]);
    assert.equal(clash.status, 2);
    assert.match(parseReceipt(clash.stdout).error.message, /claimed by both "甲" and "乙"/);
    assert.equal(existsSync(join(box.personDir, "knowledge")), false, "nothing may be written for an invalid map");

    writeFileSync(bad, "{ not json\n", "utf8");
    const malformed = runCli(["harvest", CORPUS, "--person", "lin-gong", "--base-dir", box.root, "--identity", bad, "--json"]);
    assert.equal(malformed.status, 2);
    assert.match(parseReceipt(malformed.stdout).error.message, /not valid JSON/);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("the helpers are pure and the map keeps a record of its own decisions", () => {
  const identity = { map: new Map([["ou_lin", "林工"]]) };
  assert.equal(canonicalSpeaker("ou_lin", identity), "林工");
  assert.equal(canonicalSpeaker("老周", identity), "老周");
  assert.equal(canonicalSpeaker(null, identity), null);

  const document = {
    segments: [{ speaker: "ou_lin" }, { speaker: "老周" }],
    entries: [{ speaker: "ou_lin" }, { speaker: "老周" }],
  };
  const applied = applyIdentity(document, identity);
  assert.equal(applied.changed, 1, "one turn changed, counted once");
  assert.deepEqual(applied.matched, ["ou_lin"]);
  assert.equal(applied.document.segments[0].speaker, "林工");
  assert.equal(applied.document.entries[0].speaker, "林工");
  assert.equal(applied.document.segments[1].speaker, "老周");
  assert.equal(document.segments[0].speaker, "ou_lin", "the input document is not mutated");

  const dir = mkdtempSync(join(tmpdir(), "dst-identity-load-"));
  try {
    assert.equal(loadIdentity(dir).map.size, 0, "no file, no map");
    writeFileSync(join(dir, "identity.json"), `${JSON.stringify({ people: [{ name: "林工", handles: [] }] })}\n`, "utf8");
    const loaded = loadIdentity(dir);
    assert.equal(loaded.map.get("林工"), "林工");
    assert.match(loaded.warnings.join(" "), /lists no handles/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

