/**
 * `parse/subtitle.mjs` — `.srt` / `.vtt` into per-cue anchored records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { KnowledgeStore } from "../src/knowledge/store.mjs";
import { loadLedger, recordDocument, resolveLedgerAnchor } from "../src/knowledge/ledger.mjs";
import { SourceFile, UnrecognizedFormatError } from "../src/parse/common.mjs";
import { detectSubtitleFormat, formatTimecode, parseSubtitle, parseTimecode } from "../src/parse/subtitle.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "parse", "subtitle");

function load(name, options = {}) {
  const path = join(FIXTURES, name);
  return new SourceFile({ path, raw: new Uint8Array(readFileSync(path)), ...options });
}

/** Run a parsed document through the ledger so anchors can be resolved. */
function record(document) {
  const store = new KnowledgeStore(mkdtempSync(join(tmpdir(), "distilly-sub-")));
  const ledger = loadLedger(store);
  const result = recordDocument(store, ledger, document, { fetched_at: "2024-01-01T00:00:00.000Z" });
  return { store, ledger, result };
}

test("timecodes round-trip through parse/format", () => {
  assert.equal(parseTimecode("00:00:01,500"), 1500);
  assert.equal(parseTimecode("01:02:03.004"), 3_723_004);
  assert.equal(parseTimecode("1:02:03,4"), 3_723_400, "a single-digit fraction is tenths");
  assert.equal(parseTimecode("nonsense"), null);
  assert.equal(formatTimecode(3_723_004), "01:02:03.004");
  assert.equal(formatTimecode(0), "00:00:00.000");
  assert.equal(formatTimecode(Number.NaN), null);
});

test("a SubRip file is detected and yields one record per cue", () => {
  const file = load("interview.srt");
  const detected = detectSubtitleFormat(file);
  assert.equal(detected.format, "srt");
  assert.match(detected.reasons[0], /SubRip timecode/);

  const document = parseSubtitle(file);
  assert.equal(document.format, "srt");
  assert.equal(document.kind, "subtitle");
  assert.equal(document.entries.length, 3);
  assert.deepEqual(document.entries.map((entry) => entry.kind), ["cue", "cue", "cue"]);
  assert.equal(document.entries[0].text, "大家好，今天我们聊聊构建系统。");
});

test("a cue's byte range contains its own text and not the next cue's index", () => {
  const file = load("interview.srt");
  const raw = Buffer.from(file.raw);
  const document = parseSubtitle(file);

  for (const entry of document.entries) {
    const slice = raw.subarray(entry.byteStart, entry.byteEnd).toString("utf8");
    for (const line of entry.text.split("\n")) {
      assert.ok(slice.includes(line), `${JSON.stringify(line)} must appear in ${JSON.stringify(slice)}`);
    }
  }
  const first = document.entries[0];
  const firstSlice = raw.subarray(first.byteStart, first.byteEnd).toString("utf8");
  assert.equal(firstSlice.includes("2\n"), false, "cue 1 must not swallow cue 2's index");
  assert.match(firstSlice, /00:00:01,000 --> 00:00:03,500/, "the timecode line is part of the range");
});

test("WebVTT voice spans and Name: prefixes are the only speaker claims", () => {
  const document = parseSubtitle(load("talk.vtt"));
  assert.equal(document.format, "vtt");
  assert.deepEqual(document.meta.speakers, ["Alice", "Bob"]);
  assert.equal(document.meta.timecodes[0].speaker, "Alice");
  assert.equal(document.meta.timecodes[1].speaker, "Bob");
  assert.equal(document.entries.length, 2, "a cue with no text is not a record");
});

test("WebVTT cue settings, NOTE blocks and headers are dropped with a warning", () => {
  const document = parseSubtitle(load("talk.vtt"));
  const text = document.entries.map((entry) => entry.text).join("\n");
  assert.equal(/align:|position:|Kind:|Language:/.test(text), false);
  assert.equal(text.includes("synthetic; no real conversation"), false, "NOTE content is a comment");
  assert.ok(document.warnings.some((warning) => warning.includes("NOTE block")));
  assert.ok(document.warnings.some((warning) => warning.includes("header/metadata")));
  assert.ok(document.warnings.some((warning) => warning.includes("has no text")), "the empty cue is reported");
});

test("a subtitle with no speaker information says so", () => {
  const document = parseSubtitle(load("interview.srt"));
  assert.deepEqual(document.meta.speakers, ["Lin"], "only the strict `Name:` prefix is claimed");
  const anonymous = parseSubtitle(load("crlf.srt"));
  assert.ok(anonymous.warnings.some((warning) => warning.includes("no speaker could be read")));
});

test("CRLF payloads parse and their byte ranges stay exact", () => {
  const file = load("crlf.srt");
  const document = parseSubtitle(file);
  assert.equal(document.entries.length, 2);
  assert.deepEqual(document.entries.map((entry) => entry.text), ["CRLF cue text.", "Second cue."]);
  const raw = Buffer.from(file.raw);
  const slice = raw.subarray(document.entries[0].byteStart, document.entries[0].byteEnd).toString("utf8");
  assert.ok(slice.includes("CRLF cue text."));
  assert.equal(slice.endsWith("\r"), false, "the anchor must not end mid-CRLF");
  assert.ok(slice.includes("CRLF cue text."));
});

test("a UTF-8 BOM is skipped and the offsets still point at the payload", () => {
  const file = load("bom.srt");
  const document = parseSubtitle(file);
  assert.equal(document.entries.length, 1);
  assert.equal(document.entries[0].text, "BOM cue.");
  const raw = Buffer.from(file.raw);
  const slice = raw.subarray(document.entries[0].byteStart, document.entries[0].byteEnd).toString("utf8");
  assert.ok(slice.startsWith("1\n00:00:01,000"), `expected the index line, saw ${JSON.stringify(slice)}`);
  assert.ok(slice.includes("BOM cue."));
});

test("an empty, whitespace-only or prose file is not recognised", () => {
  for (const name of ["empty.srt", "whitespace.srt", "not-subtitles.srt"]) {
    assert.throws(() => parseSubtitle(load(name)), UnrecognizedFormatError, name);
  }
  assert.throws(() => parseSubtitle(load("not-subtitles.srt")), /not a recognised subtitle file/);
});

test("a WebVTT cue without the WEBVTT header is still recognised", () => {
  const file = new SourceFile({
    path: "/tmp/headerless.vtt",
    raw: Buffer.from("00:00:01.000 --> 00:00:02.000\nHeaderless cue.\n", "utf8"),
  });
  const document = parseSubtitle(file);
  assert.equal(document.format, "vtt");
  assert.equal(document.entries[0].text, "Headerless cue.");
});

test("a single cue spanning one very long line is anchored whole", () => {
  const long = "word ".repeat(60_000).trim();
  const file = new SourceFile({
    path: "/tmp/long.srt",
    raw: Buffer.from(`1\n00:00:00,000 --> 00:00:10,000\n${long}\n`, "utf8"),
  });
  const document = parseSubtitle(file);
  assert.equal(document.entries.length, 1);
  assert.equal(document.entries[0].text.length, long.length);
});

test("a duplicate cue index is reported, not silently renumbered", () => {
  const file = new SourceFile({
    path: "/tmp/dup.srt",
    raw: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nfirst\n\n1\n00:00:03,000 --> 00:00:04,000\nsecond\n", "utf8"),
  });
  const document = parseSubtitle(file);
  assert.equal(document.entries.length, 2);
  assert.ok(document.warnings.some((warning) => warning.includes("cue index 1 appears more than once")));
});

test("a backwards timecode is kept verbatim and reported", () => {
  const file = new SourceFile({
    path: "/tmp/back.srt",
    raw: Buffer.from("1\n00:00:05,000 --> 00:00:02,000\nbackwards\n", "utf8"),
  });
  const document = parseSubtitle(file);
  assert.equal(document.entries.length, 1);
  assert.ok(document.warnings.some((warning) => warning.includes("before it starts")));
  assert.equal(document.meta.timecodes[0].start, 5000);
  assert.equal(document.meta.timecodes[0].end, 2000);
});

test("a GBK subtitle decodes when the payload is valid Shift_JIS-free GBK", () => {
  const raw = Buffer.concat([Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n", "utf8"), Buffer.from([0x88, 0x82, 0x0a])]);
  // A declared charset always wins; without one the decoder refuses to choose
  // between GBK/Big5/Shift_JIS and reports U+FFFD instead (see anchors tests).
  const file = new SourceFile({ path: "/tmp/gbk.srt", raw, preferred: "gbk" });
  const document = parseSubtitle(file);
  assert.equal(document.fileEncoding, "gbk");
  assert.ok(document.entries[0].text.includes("垈"));
});

test("anchors produced by the ledger resolve back to the cue bytes", () => {
  const file = load("interview.srt");
  const document = parseSubtitle(file);
  const { store, ledger } = record(document);
  const raw = store.readRaw("subtitle", "interview.srt");

  const second = resolveLedgerAnchor(ledger, "k0001:t2");
  assert.ok(second, "k0001:t2 must resolve");
  assert.equal(second.kind, "cue");
  const slice = Buffer.from(raw).subarray(second.byteStart, second.byteEnd).toString("utf8");
  assert.ok(slice.includes("我先说结论"));
  assert.ok(slice.includes("工具链版本。"));

  const paragraph = resolveLedgerAnchor(ledger, "k0002");
  assert.ok(paragraph.text.includes("我先说结论"));
});

test("the text file lists one anchored paragraph per cue", () => {
  const document = parseSubtitle(load("crlf.srt"));
  const { result } = record(document);
  const text = readFileSync(result.written.text.path, "utf8");
  assert.match(text, /^\[k0001\] CRLF cue text\./);
  assert.match(text, /\[k0002\] Second cue\./);
  assert.equal(document.entries.length, 2, "the timecodes live in meta.timecodes, not in the prose");
});

test("parsing is deterministic: two runs produce identical documents", () => {
  const first = JSON.stringify(parseSubtitle(load("talk.vtt")));
  const second = JSON.stringify(parseSubtitle(load("talk.vtt")));
  assert.equal(first, second);
});

