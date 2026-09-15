/**
 * `knowledge/ledger.mjs` — append-only `index.json`, idempotent by content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeStore } from "../src/knowledge/store.mjs";
import {
  LEDGER_SCHEMA_VERSION,
  anchorIndex,
  anchorOwners,
  appendEntry,
  buildEntry,
  emptyLedger,
  findBySha256,
  getEntry,
  lastId,
  ledgerStats,
  loadLedger,
  nextId,
  recordDocument,
  renderLedger,
  resolveLedgerAnchor,
  saveLedger,
  ledgerSha256,
} from "../src/knowledge/ledger.mjs";
import { SourceFile, buildDocument } from "../src/parse/common.mjs";

const FIXED_TIME = "2024-03-04T05:06:07.000Z";

function makeStore() {
  return new KnowledgeStore(mkdtempSync(join(tmpdir(), "distilly-ledger-")));
}

function chatDocument(text, options = {}) {
  const raw = Buffer.from(text, "utf8");
  const file = new SourceFile({ path: options.path ?? "/tmp/export.json", raw });
  const records = options.records ?? text.trim().split(/\n{2,}/).map((line) => ({ text: line, kind: "turn" }));
  return buildDocument({
    parser: options.parser ?? "chat",
    format: options.format ?? "chatgpt-export",
    kind: options.kind ?? "chat",
    method: options.method ?? "user-export",
    source: options.source ?? "export",
    files: [file],
    records,
    warnings: options.warnings,
  });
}

test("a fresh ledger is an array with no entries", () => {
  const ledger = emptyLedger();
  assert.ok(Array.isArray(ledger));
  assert.equal(ledger.length, 0);
  assert.equal(renderLedger(ledger), "[]\n");
});

test("index.json is written as a top-level JSON array", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  recordDocument(store, ledger, chatDocument("hello\n"), { fetched_at: FIXED_TIME });
  saveLedger(store, ledger);
  const parsed = JSON.parse(readFileSync(store.ledgerPath, "utf8"));
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "k0001");
  assert.equal(parsed[0].sha256.length, 64);
});

test("an entry carries every field the contract freezes", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const result = recordDocument(store, ledger, chatDocument("hello there\n"), { fetched_at: FIXED_TIME });
  const entry = result.entry;
  for (const field of ["id", "kind", "origin", "fetched_at", "bytes", "sha256", "credentialed", "method", "warnings"]) {
    assert.ok(Object.hasOwn(entry, field), `entry must carry ${field}`);
  }
  assert.equal(entry.fetched_at, FIXED_TIME, "the clock is never read implicitly");
  assert.equal(entry.credentialed, false, "a zero-credential parse never claims a credential");
  assert.equal(entry.method, "user-export");
  assert.equal(entry.bytes, Buffer.byteLength("hello there\n"));
});

test("anchors are a flat string list with resolvable detail", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const document = chatDocument("first turn\n\nsecond turn\n", {
    records: [{ text: "first turn", kind: "turn" }, { text: "second turn", kind: "turn" }],
  });
  const { entry } = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });

  assert.deepEqual(entry.anchors, ["k0001", "k0002", "k0001:t1", "k0001:t2"]);
  assert.ok(entry.anchors.every((anchor) => typeof anchor === "string"));
  assert.equal(entry.anchor_detail.length, 4);
  assert.equal(entry.units.length, 2, "one paragraph anchor per turn");
  for (const unit of entry.units) assert.equal(unit.id, unit.anchor);
});

test("a long document continues the numbering instead of reusing ids", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const records = Array.from({ length: 6 }, (_, index) => ({ text: `turn ${index + 1}`, kind: "turn" }));
  const document = chatDocument(records.map((record) => record.text).join("\n\n"), { records });
  const { entry } = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME, maxParagraphs: 2 });
  assert.ok(entry.anchors.includes("k0001:t6"), `expected six sub-anchors, saw ${entry.anchors.join(",")}`);
});

test("re-importing identical bytes appends nothing", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const document = chatDocument("hello\n");
  const first = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });
  const before = renderLedger(ledger);
  const second = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });

  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  assert.equal(second.id, first.id);
  assert.match(second.reason, /identical bytes already recorded as k0001/);
  assert.equal(ledger.length, 1);
  assert.equal(renderLedger(ledger), before, "a duplicate import must not change a single byte");
});

test("the same file imported under a different source is a separate entry", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const document = chatDocument("hello\n");
  recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });
  recordDocument(store, ledger, { ...document, source: "other" }, { fetched_at: FIXED_TIME });
  assert.equal(ledger.length, 2);
  assert.equal(findBySha256(ledger, ledger[0].sha256).length, 2);
});

test("two runs over the same input produce byte-identical index.json", () => {
  const first = makeStore();
  const second = makeStore();
  for (const store of [first, second]) {
    const ledger = loadLedger(store);
    recordDocument(store, ledger, chatDocument("alpha\n\nbeta\n"), { fetched_at: FIXED_TIME });
    recordDocument(store, ledger, chatDocument("gamma\n", { path: "/tmp/second.json" }), { fetched_at: FIXED_TIME });
    saveLedger(store, ledger);
  }
  const a = readFileSync(first.ledgerPath);
  const b = readFileSync(second.ledgerPath);
  assert.ok(a.equals(b), "same input, same bytes");
  assert.equal(ledgerSha256(loadLedger(first)), ledgerSha256(loadLedger(second)));
});

test("ids are monotonic and never reused after the highest entry", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  assert.equal(nextId(ledger), "k0001");
  recordDocument(store, ledger, chatDocument("one\n"), { fetched_at: FIXED_TIME });
  assert.equal(lastId(ledger), 1);
  assert.equal(nextId(ledger), "k0002");
  recordDocument(store, ledger, chatDocument("two\n", { path: "/tmp/b.json" }), { fetched_at: FIXED_TIME });
  assert.equal(nextId(ledger), "k0003");
  assert.equal(getEntry(ledger, "k0001").id, "k0001");
  assert.equal(getEntry(ledger, "nope"), null);
});

test("an anchor from any paragraph resolves through the ledger", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const document = chatDocument("one\n\ntwo\n", {
    records: [{ text: "one", kind: "turn" }, { text: "two", kind: "turn" }],
  });
  const { entry } = recordDocument(store, ledger, document, { fetched_at: FIXED_TIME });
  const bytes = store.readRaw("export", "export.json");
  const rawOf = (anchor) => {
    const resolved = resolveLedgerAnchor(ledger, anchor);
    assert.ok(resolved, `${anchor} must resolve`);
    return Buffer.from(bytes).subarray(resolved.byteStart, resolved.byteEnd).toString("utf8");
  };

  for (const anchor of ["k0001", "k0002", "k0001:t1", "k0001:t2"]) {
    const resolved = resolveLedgerAnchor(ledger, anchor);
    assert.equal(resolved.entry.id, entry.id);
    assert.equal(resolved.bytes, undefined, "the ledger stores offsets, not payloads");
    assert.equal(Number.isInteger(resolved.byteStart), true);
  }
  assert.equal(rawOf("k0001"), "one");
  assert.equal(rawOf("k0002"), "two");
  assert.equal(rawOf("k0001:t1"), "one", "a sub-anchor points at its own turn");
  assert.equal(rawOf("k0001:t2"), "two");
  assert.equal(resolveLedgerAnchor(ledger, "k0999"), null);
  assert.equal(resolveLedgerAnchor(ledger, "garbage"), null);
});

test("anchorIndex and anchorOwners expose the whole namespace", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  recordDocument(store, ledger, chatDocument("one\n\ntwo\n", {
    records: [{ text: "one", kind: "turn" }, { text: "two", kind: "turn" }],
  }), { fetched_at: FIXED_TIME });
  const index = anchorIndex(ledger);
  for (const anchor of ["k0001", "k0002", "k0001:t1", "k0001:t2"]) {
    assert.ok(index.has(anchor), `${anchor} missing from the index`);
  }
  const owners = anchorOwners(ledger);
  assert.equal(owners.get("k0002").id, "k0001");
  assert.equal(owners.get("k0001:t2").id, "k0001");
});

test("a document that parses to nothing keeps its raw bytes and creates no entry", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const result = recordDocument(store, ledger, chatDocument("   \n\n  \n"), { fetched_at: FIXED_TIME });
  assert.equal(result.entry, null);
  assert.equal(ledger.length, 0);
  assert.match(result.reason, /raw bytes retained/);
  assert.equal(store.listRaw("export").length, 1, "the raw file is still on disk");
  assert.equal(result.written.text, null, "no text file is written for empty content");
});

test("recordDocument refuses to invent a timestamp", () => {
  const store = makeStore();
  assert.throws(() => recordDocument(store, loadLedger(store), chatDocument("x\n"), {}), /fetched_at/);
});

test("buildEntry rejects a non-paragraph id", () => {
  const store = makeStore();
  const document = chatDocument("x\n");
  assert.throws(() => buildEntry(document, { id: "k0001:t1", fetched_at: FIXED_TIME }), TypeError);
  assert.throws(() => buildEntry(document, { id: "nope", fetched_at: FIXED_TIME }), TypeError);
});

test("appendEntry reports the duplicate instead of silently dropping it", () => {
  const ledger = emptyLedger();
  const entry = { id: "k0001", sha256: "a".repeat(64), origin: "x", entries: [] };
  assert.equal(appendEntry(ledger, entry).appended, true);
  const again = appendEntry(ledger, { ...entry, id: "k0002" });
  assert.equal(again.appended, false);
  assert.equal(again.duplicateOf.id, "k0001");
  assert.equal(ledger.length, 1);
  assert.equal(appendEntry(ledger, { ...entry, id: "k0003" }, { allowDuplicate: true }).appended, true);
  assert.equal(ledger.length, 2);
});

test("a malformed ledger fails loudly instead of starting over", () => {
  const store = makeStore();
  store.ensure();
  writeFileSync(store.ledgerPath, "{ not json", "utf8");
  assert.throws(() => loadLedger(store), /not valid JSON/);
  writeFileSync(store.ledgerPath, JSON.stringify({ hello: "world" }), "utf8");
  assert.throws(() => loadLedger(store), /neither an array nor an object with entries/);
  writeFileSync(store.ledgerPath, JSON.stringify([{ no: "id" }]), "utf8");
  assert.throws(() => loadLedger(store), /entry without an id/);
  writeFileSync(store.ledgerPath, "", "utf8");
  assert.equal(loadLedger(store).length, 0, "an empty file is an empty ledger");
});

test("an older {version, entries} envelope still loads", () => {
  const store = makeStore();
  store.ensure();
  writeFileSync(
    store.ledgerPath,
    JSON.stringify({ version: LEDGER_SCHEMA_VERSION, encoder: "old", entries: [{ id: "k0001", anchors: [] }] }),
    "utf8",
  );
  const ledger = loadLedger(store);
  assert.equal(ledger.length, 1);
  assert.ok(Array.isArray(ledger));
  assert.equal(renderLedger(ledger).startsWith("["), true, "but it is re-rendered as an array");
});

test("ledgerStats summarises kinds, methods and anchors", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  recordDocument(store, ledger, chatDocument("one\n\ntwo\n"), { fetched_at: FIXED_TIME });
  recordDocument(store, ledger, chatDocument("mail\n", { kind: "email", method: "local-file", path: "/tmp/a.eml" }), { fetched_at: FIXED_TIME });
  const stats = ledgerStats(ledger);
  assert.equal(stats.entries, 2);
  assert.equal(stats.byKind.chat, 1);
  assert.equal(stats.byKind.email, 1);
  assert.equal(stats.byMethod["user-export"], 1);
  assert.equal(stats.credentialed, 0);
  assert.ok(stats.anchors >= 3);
});

test("the text file carries the paragraph anchors and the ledger points at it", () => {
  const store = makeStore();
  const ledger = loadLedger(store);
  const { entry } = recordDocument(store, ledger, chatDocument("one\n\ntwo\n"), { fetched_at: FIXED_TIME });
  const text = readFileSync(join(store.knowledgeRoot, entry.locations.text), "utf8");
  assert.match(text, /^\[k0001\] one/);
  assert.match(text, /\[k0002\] two/);
  assert.equal(entry.locations.raw.startsWith("raw/"), true);
});
