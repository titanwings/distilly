/**
 * `distilly note` — the last entry in `CONTRACT.md` §1: material the model read
 * itself, registered with `method: "model-read"`.
 *
 * The command's whole value is honesty: the text is stored verbatim and anchored,
 * and every surface (receipt, ledger entry, warning) says it is model-mediated
 * rather than a first-hand capture. These tests pin that, plus the ordinary spine
 * guarantees — anchors resolve, a repeat changes nothing, empty input is refused.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLANNED } from "../src/commands/index.mjs";
import { loadLedger, resolveLedgerAnchor } from "../src/knowledge/ledger.mjs";
import { KnowledgeStore } from "../src/knowledge/store.mjs";
import { noteDocument, parseNoteArgs, PROVENANCE_NOTE } from "../src/commands/note.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(HERE, "bin", "distilly.mjs");

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "dst-note-"));
  return { root, work: join(root, "work") };
}

function run(args, { cwd, input } = {}) {
  const result = spawnSync("node", [BIN, ...args], { encoding: "utf8", cwd, input });
  const start = (result.stdout ?? "").indexOf("{");
  const receipt = start === -1 ? null : JSON.parse(result.stdout.slice(start));
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", receipt };
}

function personDir(box, slug = "demo") {
  return join(box.work, "skills", "colleague", slug);
}

test("the frozen contract's command list is now fully implemented", () => {
  assert.deepEqual(Object.keys(PLANNED), [], "PLANNED must be empty once every contract command exists");
  const doctor = run(["doctor", "--json"]);
  assert.equal(doctor.status, 0);
  assert.deepEqual(doctor.receipt.unavailable, []);
});

test("note records the text verbatim, with anchors and model-read provenance", () => {
  const box = sandbox();
  const source = join(box.root, "reading.md");
  const text = "第一段：页面说回滚段是评审检查点。\n第二段：我不确定作者是谁。\n";
  writeFileSync(source, text, "utf8");

  const result = run(["note", "--from", source, "--person", "demo", "--base-dir", box.work, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = result.receipt;
  assert.equal(receipt.command, "note");
  assert.equal(receipt.ok, true);
  assert.equal(receipt.model_read, true);
  assert.equal(receipt.provenance, PROVENANCE_NOTE);
  assert.ok(receipt.anchors.total >= 2);
  assert.ok(receipt.outputs.some((output) => output.kind === "raw"));
  assert.ok(receipt.outputs.some((output) => output.kind === "text"));

  const dir = personDir(box);
  const [name] = readdirSync(join(dir, "knowledge", "text"));
  const body = readFileSync(join(dir, "knowledge", "text", name), "utf8");
  assert.match(body, /^\[k0001\] 第一段：页面说回滚段是评审检查点。$/m);

  // The raw payload is the note itself, byte for byte.
  const rawDir = join(dir, "knowledge", "raw", "note");
  const [rawName] = readdirSync(rawDir);
  assert.equal(readFileSync(join(rawDir, rawName), "utf8"), text);

  const ledger = loadLedger(new KnowledgeStore(dir));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].method, "model-read");
  assert.equal(ledger[0].credentialed, false);
  assert.equal(ledger[0].kind, "note");
  assert.equal(ledger[0].locations.text.startsWith("text/"), true);
  assert.ok(ledger[0].warnings.includes(PROVENANCE_NOTE), "the entry itself must say it is model-mediated");
  for (const unit of ledger[0].units) {
    const resolved = resolveLedgerAnchor(ledger, unit.anchor);
    assert.ok(resolved, `${unit.anchor} must resolve`);
    assert.equal(typeof resolved.byteStart, "number");
  }
});

test("a second identical note changes nothing", () => {
  const box = sandbox();
  const source = join(box.root, "reading.md");
  writeFileSync(source, "同一段文字。\n", "utf8");
  assert.equal(run(["note", "--from", source, "--person", "demo", "--base-dir", box.work, "--json"]).status, 0);
  const before = readFileSync(join(personDir(box), "knowledge", "index.json"), "utf8");
  const again = run(["note", "--from", source, "--person", "demo", "--base-dir", box.work, "--json"]);
  assert.equal(again.status, 0);
  assert.equal(again.receipt.appended, false);
  assert.equal(readFileSync(join(personDir(box), "knowledge", "index.json"), "utf8"), before);
});

test("--from - reads stdin, and empty input is refused rather than recorded", () => {
  const box = sandbox();
  const piped = run(["note", "--from", "-", "--person", "demo", "--base-dir", box.work, "--source", "piped", "--json"], {
    input: "从管道来的一段。\n",
  });
  assert.equal(piped.status, 0, piped.stderr);
  assert.equal(piped.receipt.ok, true);
  assert.equal(readFileSync(join(personDir(box), "knowledge", "text", "piped.md"), "utf8").includes("从管道来的一段。"), true);

  const empty = run(["note", "--from", "-", "--person", "demo", "--base-dir", box.work, "--json"], { input: "   \n" });
  assert.equal(empty.status, 1);
  assert.equal(empty.receipt.ok, false);
  assert.match(empty.receipt.error.code, /note\/empty/);
  assert.equal(empty.receipt.entry, undefined, "an empty note must not create an entry");
});

test("usage errors are loud, and a missing file never becomes an empty note", () => {
  assert.match(parseNoteArgs([]).error, /--from <file\|-> is required/);
  assert.match(parseNoteArgs(["--from", "x"]).error, /--person is required/);
  assert.match(parseNoteArgs(["--from", "x", "--person", "p", "--kind", "sheet"]).error, /--kind must be note or doc/);
  assert.match(parseNoteArgs(["--from", "x", "--person", "p", "--nope"]).error, /unknown option: --nope/);

  const box = sandbox();
  const missing = run(["note", "--from", join(box.root, "nope.md"), "--person", "demo", "--base-dir", box.work, "--json"]);
  assert.equal(missing.status, 2);
  assert.match(missing.receipt.error.code, /note\/input/);
  assert.equal(existsSync(join(box.work, "skills")), false, "nothing may be written for an unreadable input");
});

test("--kind doc records a document-shaped entry, and noteDocument keeps offsets exact", () => {
  const box = sandbox();
  const source = join(box.root, "spec.md");
  writeFileSync(source, "需求：回滚必须可执行。\n验收：一万笔三分钟内跑完。\n", "utf8");
  const result = run(["note", "--from", source, "--person", "demo", "--base-dir", box.work, "--kind", "doc", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const ledger = loadLedger(new KnowledgeStore(personDir(box)));
  assert.equal(ledger[0].kind, "doc");

  const document = noteDocument({ text: "甲。\n乙。\n", name: "inline.md" });
  assert.equal(document.entries.length, 2);
  assert.equal(document.content.slice(document.segments[0].charStart, document.segments[0].charEnd), "甲。");
  assert.equal(document.entries[0].byteStart, 0);
  assert.equal(document.warnings.includes(PROVENANCE_NOTE), true);
});
