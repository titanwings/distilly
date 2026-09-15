/**
 * `knowledge/anchors.mjs` — encoding detection, byte-faithful normalisation and
 * the global monotonic anchor space.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assignAnchors,
  assignAnchorsToText,
  conservationReport,
  decodeBuffer,
  detectBom,
  detectEncoding,
  formatAnchor,
  formatSubAnchor,
  isValidUtf8,
  normalizeWithMap,
  parseAnchor,
  resolveAnchor,
  verifyByteConservation,
} from "../src/knowledge/anchors.mjs";

const utf8 = (text) => Buffer.from(text, "utf8");

test("formatAnchor pads to four digits and grows past 9999", () => {
  assert.equal(formatAnchor(1), "k0001");
  assert.equal(formatAnchor(12), "k0012");
  assert.equal(formatAnchor(9999), "k9999");
  assert.equal(formatAnchor(10000), "k10000");
  assert.throws(() => formatAnchor(0), TypeError);
  assert.throws(() => formatAnchor(1.5), TypeError);
});

test("formatSubAnchor and parseAnchor round-trip", () => {
  assert.equal(formatSubAnchor("k0007", 3), "k0007:t3");
  assert.throws(() => formatSubAnchor("k0007:t3", 1), TypeError);
  assert.throws(() => formatSubAnchor("nope", 1), TypeError);

  assert.deepEqual(parseAnchor("k0012"), {
    id: "k0012", index: 12, kind: "para", subAnchor: null, subIndex: null, canonical: true,
  });
  assert.deepEqual(parseAnchor("k0012:t3"), {
    id: "k0012", index: 12, kind: "sub", subAnchor: "t3", subIndex: 3, canonical: true,
  });
  assert.equal(parseAnchor("k0012:t0"), null);
  assert.equal(parseAnchor("K0012"), null);
  assert.equal(parseAnchor("k12"), null);
  assert.equal(parseAnchor(""), null);
  assert.equal(parseAnchor(null), null);
});

test("BOM detection covers UTF-8, UTF-16 and UTF-32", () => {
  assert.equal(detectBom(Buffer.from([0xef, 0xbb, 0xbf, 0x41])).label, "utf-8");
  assert.equal(detectBom(Buffer.from([0xff, 0xfe, 0x41, 0x00])).label, "utf-16le");
  assert.equal(detectBom(Buffer.from([0xfe, 0xff, 0x00, 0x41])).label, "utf-16be");
  assert.equal(detectBom(Buffer.from([0xff, 0xfe, 0x00, 0x00])).label, "utf-32le");
  assert.equal(detectBom(Buffer.from("plain", "utf8")), null);
});

test("a UTF-8 BOM is stripped and does not become a paragraph", () => {
  const anchored = assignAnchors(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8("你好\n")]));
  assert.equal(anchored.units.length, 1);
  assert.equal(anchored.units[0].text, "你好");
  // The BOM occupies bytes 0..3 and is not claimed by the paragraph.
  assert.equal(anchored.units[0].byteStart, 3);
  assert.equal(anchored.units[0].byteEnd, 9);
});

test("GBK, Big5 and Shift_JIS payloads decode when the caller opts in", () => {
  const cases = [
    ["gbk", Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), "你好"],
    ["big5", Buffer.from([0xa7, 0x41, 0xa6, 0x6e]), "你好"],
    ["shift_jis", Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]), "テスト"],
  ];
  for (const [label, bytes, expected] of cases) {
    // `preferred` is how a parser passes a declared charset.
    const decoded = decodeBuffer(bytes, { preferred: label });
    assert.equal(decoded.text, expected, `${label} text`);
    assert.equal(decoded.label, label, `${label} detected label`);
    assert.equal(decoded.lossy, true, `${label} must be flagged as a guess`);
    assert.ok(decoded.warnings.length > 0, `${label} must warn about the guess`);
    assert.deepEqual(decodeBuffer(bytes, { preferred: label }), decoded, `${label} is deterministic`);
  }
  // 0x88 0x82 is a GBK pair that neither Big5 nor Shift_JIS can decode, so the
  // opt-in auto-detection chain can settle on GBK without guessing.
  const uniqueGbk = Buffer.from([0x88, 0x82]);
  const auto = decodeBuffer(uniqueGbk, { legacyFallback: true });
  assert.equal(auto.text, "垈");
  assert.equal(auto.label, "gbk");
  assert.equal(auto.lossy, true);

  // GBK and Big5 both decode the same CJK bytes, so auto-detection must refuse
  // and say why rather than pick one.
  const ambiguous = decodeBuffer(Buffer.from([0xa7, 0x41, 0xa6, 0x6e]), { legacyFallback: true });
  assert.equal(ambiguous.ok, false);
  assert.deepEqual(ambiguous.ambiguous, ["gbk", "big5", "shift_jis"]);
  assert.ok(ambiguous.error.includes("instead of letting us guess"));
  assert.equal(ambiguous.text.includes("你"), false);
  assert.equal(detectEncoding(Buffer.from([0xc4, 0xe3]), { preferred: "gbk" }).decoded, "你");
});

test("legacy encodings are never guessed without an explicit opt-in", () => {
  // Two GBK characters. GBK would happily decode this, but so would several
  // other codecs, so the default must refuse and report the replacement.
  const gbkBytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  const conservative = decodeBuffer(gbkBytes);
  assert.equal(conservative.label, "utf-8");
  // 3, not the original's 2: Node's UTF-8 decoder emits one U+FFFD per maximal
  // invalid subsequence, and `c4` / `e3 ba` / `c3` are three of them. The
  // recovered expectation disagreed with the decoder it was written against, so
  // the measured value is pinned instead of the number.
  assert.equal(conservative.replaced, 3);
  assert.equal(conservative.text.includes("你"), false);
  assert.deepEqual(conservative.attempted, ["utf-8"]);
  assert.ok(conservative.warnings.some((warning) => warning.includes("U+FFFD")));
});

test("invalid UTF-8 falls back to replacement and says how many", () => {
  const bytes = Buffer.from([0x41, 0xff, 0x42, 0x80, 0x43]);
  const decoded = decodeBuffer(bytes);
  assert.equal(decoded.text.startsWith("A"), true);
  assert.equal(decoded.replaced, 2);
  assert.ok(decoded.warnings.some((warning) => warning.includes("U+FFFD")));
  // Latin-1 is never silently assumed: a lone 0xff is not 'ÿ'.
  assert.equal(decoded.text.includes("ÿ"), false);
});

test("isValidUtf8 rejects overlong and truncated sequences", () => {
  assert.equal(isValidUtf8(utf8("ok")), true);
  assert.equal(isValidUtf8(Buffer.from([0xc0, 0xaf])), false);
  assert.equal(isValidUtf8(Buffer.from([0xe4, 0xbd])), false);
  assert.equal(isValidUtf8(Buffer.from([0xed, 0xa0, 0x80])), false);
});

test("normalizeWithMap keeps a gapless character → byte mapping for CRLF", () => {
  const bytes = utf8("a\r\nb\rc\n");
  const normalized = normalizeWithMap(bytes);
  assert.equal(normalized.text, "a\nb\nc\n");
  // "a" → byte 0, the LF that replaced CRLF → bytes 1..3, "b" → byte 3.
  assert.equal(normalized.charStart[0], 0);
  assert.equal(normalized.charEnd[0], 1);
  assert.equal(normalized.charStart[1], 1);
  assert.equal(normalized.charEnd[1], 3);
  assert.equal(normalized.charStart[2], 3);
  assert.equal(normalized.unmappedTail, 0);
});

test("multi-byte characters map to their full byte width", () => {
  const bytes = utf8("你好\n");
  const normalized = normalizeWithMap(bytes);
  assert.equal(normalized.text, "你好\n");
  assert.equal(normalized.charStart[0], 0);
  assert.equal(normalized.charEnd[0], 3);
  assert.equal(normalized.charStart[1], 3);
  assert.equal(normalized.charEnd[1], 6);
  assert.equal(normalized.charStart[2], 6);
  assert.equal(normalized.charEnd[2], 7);
});

test("a paragraph never straddles a blank line and always has visible text", () => {
  const anchored = assignAnchors(utf8("\n\n  \nfirst\ncontinued\n\n\nsecond\n"));
  assert.deepEqual(anchored.units.map((unit) => unit.text), ["first\ncontinued", "second"]);
  assert.deepEqual(anchored.units.map((unit) => unit.anchor), ["k0001", "k0002"]);
  for (const unit of anchored.units) {
    assert.match(unit.text, /\S/);
  }
});

test("assignAnchors on an empty payload yields no units and no fabricated text", () => {
  const anchored = assignAnchors(Buffer.alloc(0));
  assert.deepEqual(anchored.units, []);
  assert.equal(anchored.text, "");
});

test("assignAnchors on whitespace-only payload yields no units", () => {
  for (const payload of ["   ", "\n\n\n", "\t \r\n \t", "\u00a0\u00a0"]) {
    const anchored = assignAnchors(utf8(payload));
    assert.deepEqual(anchored.units, [], JSON.stringify(payload));
    assert.equal(anchored.text, "");
  }
});

test("a very long single line stays one paragraph inside maxBlocks", () => {
  const long = "x".repeat(200_000);
  const anchored = assignAnchors(utf8(`${long}\n`));
  assert.equal(anchored.units.length, 1);
  assert.equal(anchored.units[0].text.length, 200_000);
});

test("segments keep one paragraph per turn even without blank lines", () => {
  const content = "alice: hi\nbob: hello\nalice: bye";
  const spans = [
    { charStart: 0, charEnd: 9, label: "alice" },
    { charStart: 10, charEnd: 20, label: "bob" },
    { charStart: 21, charEnd: 31, label: "alice" },
  ];
  const anchored = assignAnchorsToText(content, { segments: spans, groupBy: "segment" });
  assert.deepEqual(anchored.units.map((unit) => unit.text), ["alice: hi", "bob: hello", "alice: bye"]);
});

test("startIndex continues an existing numbering", () => {
  const anchored = assignAnchorsToText("one\n\ntwo\n", { groupBy: "blank", startIndex: 7 });
  assert.deepEqual(anchored.units.map((unit) => unit.anchor), ["k0007", "k0008"]);
});

test("resolveAnchor returns the raw bytes a paragraph points at", () => {
  const bytes = utf8("alpha\n\nbeta\n");
  const anchored = assignAnchors(bytes);
  const record = { units: anchored.units.map((unit) => ({ ...unit, file: "raw/demo/a.txt" })), anchors: [] };
  const first = resolveAnchor("k0001", record, { bytes, bytesByFile: new Map([["raw/demo/a.txt", bytes]]) });
  assert.equal(first.text, "alpha");
  assert.equal(first.bytes.toString("utf8"), "alpha");
  const second = resolveAnchor("k0002", record, { bytes, bytesByFile: new Map([["raw/demo/a.txt", bytes]]) });
  assert.equal(second.bytes.toString("utf8"), "beta");
  assert.equal(resolveAnchor("k0009", record, { bytes }), null);
  assert.equal(resolveAnchor("nonsense", record, { bytes }), null);
});

test("resolveAnchor prefers an explicit sub-anchor over the parent paragraph", () => {
  const bytes = utf8("speaker A: hello\nspeaker B: hi\n");
  const record = {
    units: [{ anchor: "k0001", text: "speaker A: hello\nspeaker B: hi", byteStart: 0, byteEnd: 29, file: "f" }],
    anchors: [{ anchor: "k0001:t2", kind: "turn", text: "speaker B: hi", byteStart: 17, byteEnd: 30, file: "f" }],
  };
  const resolved = resolveAnchor("k0001:t2", record, { bytesByFile: new Map([["f", bytes]]) });
  assert.equal(resolved.kind, "turn");
  assert.equal(resolved.bytes.toString("utf8"), "speaker B: hi");
});

test("verifyByteConservation reports overlaps, empty units and out-of-range anchors", () => {
  const good = {
    units: [
      { anchor: "k0001", text: "a", byteStart: 0, byteEnd: 1, file: "f" },
      { anchor: "k0002", text: "b", byteStart: 2, byteEnd: 3, file: "f" },
    ],
    anchors: [],
  };
  assert.deepEqual(verifyByteConservation(good, { fileOrigins: new Map([["f", Buffer.alloc(4)]]) }).problems, []);

  const overlapping = {
    units: [
      { anchor: "k0001", text: "a", byteStart: 0, byteEnd: 4, file: "f" },
      { anchor: "k0002", text: "b", byteStart: 2, byteEnd: 5, file: "f" },
    ],
  };
  const problems = verifyByteConservation(overlapping, { fileOrigins: new Map([["f", Buffer.alloc(4)]]) }).problems;
  assert.equal(problems.length, 2);
  assert.ok(problems.some((problem) => problem.includes("inside")));
  assert.ok(problems.some((problem) => problem.includes("past the")));

  const blank = { units: [{ anchor: "k0001", text: "   ", byteStart: 0, byteEnd: 3, file: "f" }] };
  assert.ok(verifyByteConservation(blank).problems[0].includes("no non-whitespace"));
});

test("conservationReport accounts for every byte of a payload", () => {
  const bytes = utf8("alpha\n\nbeta\n");
  const anchored = assignAnchors(bytes);
  const report = conservationReport(new Map([["a.txt", bytes]]), [{ units: anchored.units.map((u) => ({ ...u, file: "a.txt" })) }]);
  assert.equal(report.length, 1);
  assert.equal(report[0].bytes, bytes.length);
  assert.equal(report[0].anchored, 9, "alpha + beta");
  assert.equal(report[0].unanchored, bytes.length - 9, "blank line separators are the only unanchored bytes");
});

test("anchors are byte-identical across two runs over the same input", () => {
  const bytes = utf8("# title\r\n\r\npara one\r\n\r\npara two\r\n");
  const first = JSON.stringify(assignAnchors(bytes));
  const second = JSON.stringify(assignAnchors(bytes));
  assert.equal(first, second);
});
