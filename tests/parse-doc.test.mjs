/**
 * OOXML reader: docx paragraphs, xlsx rows with the shared string table, and the
 * honesty rules around parts that carry no text.
 *
 * Fixtures are real zip containers built in-process from stored entries, so the
 * reader is exercised against the format rather than a mock.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crc32, SourceFile } from "../src/parse/common.mjs";
import { parseDocx, parseOffice, parseXlsx } from "../src/parse/office.mjs";

const BIN = join(import.meta.dirname, "..", "bin", "distilly.mjs");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dst-doc-"));
}

/** Minimal ZIP writer: stored (uncompressed) entries, correct CRCs. */
function zipStore(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
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

function sourceFor(bytes, name) {
  return new SourceFile({ path: `/tmp/${name}`, raw: bytes });
}

const DOCX = zipStore([
  [
    "word/document.xml",
    `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:r><w:t>对账三笔差异</w:t></w:r></w:p>
      <w:p><w:r><w:t>先看</w:t></w:r><w:r><w:t>数据再改代码</w:t></w:r></w:p>
      <w:p><w:r><w:t></w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>表内文本</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`,
  ],
  ["word/styles.xml", "<w:styles/>"],
]);

const XLSX = zipStore([
  [
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst><si><t>流水号</t></si><si><t>金额</t></si><si><t>A-1</t></si><si><r><t>合计</t></r></si></sst>`,
  ],
  [
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>128.50</v></c></row>
      <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>128.50</v></c></row>
    </sheetData></worksheet>`,
  ],
  ["xl/charts/chart1.xml", "<chart/>"],
]);

test("docx paragraphs become records, tables are flagged", () => {
  const document = parseDocx(sourceFor(DOCX, "notes.docx"));
  assert.equal(document.format, "docx");
  assert.equal(document.entries.length, 3, "empty paragraphs are skipped");
  assert.match(document.entries[0].text, /对账三笔差异/);
  assert.match(document.entries[1].text, /先看数据再改代码/, "runs inside a paragraph are joined");
  assert.ok(document.warnings.some((warning) => warning.code === "office/table-flattened"));
  assert.equal(document.content.includes("表内文本"), true, "table text is still captured");
});

test("xlsx rows resolve shared strings and keep the column letter", () => {
  const document = parseXlsx(sourceFor(XLSX, "book.xlsx"));
  assert.equal(document.format, "xlsx");
  const rows = document.entries.map((entry) => entry.text);
  assert.equal(rows[0], "A=流水号\tB=金额");
  assert.equal(rows[1], "A=A-1\tB=128.50");
  assert.equal(rows[2], "A=合计\tB=128.50", "rich-text shared strings are flattened");
  assert.ok(document.warnings.some((warning) => warning.code === "office/charts-skipped"));
});

test("a container without the expected part is refused loudly", () => {
  const empty = zipStore([["docProps/core.xml", "<core/>"]]);
  assert.throws(() => parseDocx(sourceFor(empty, "broken.docx")), /word\/document\.xml/);
  assert.throws(() => parseXlsx(sourceFor(empty, "broken.xlsx")), /worksheet/);
  assert.throws(() => parseOffice(sourceFor(empty, "notes.txt")), /not an OOXML document/);
});

test("the CLI records paragraphs and is idempotent", () => {
  const root = tempDir();
  try {
    const file = join(root, "notes.docx");
    writeFileSync(file, DOCX);
    const run = () => {
      const result = spawnSync(
        process.execPath,
        [BIN, "parse-doc", file, "--person", "lin-gong", "--base-dir", root, "--json"],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    };

    const first = run();
    assert.equal(first.command, "parse-doc");
    assert.equal(first.ok, true);
    assert.equal(first.entries[0].appended, true);
    assert.ok(first.anchors.total >= 3);

    const ledger = join(root, "skills", "colleague", "lin-gong", "knowledge", "index.json");
    const before = readFileSync(ledger, "utf8");
    assert.equal(run().entries[0].appended, false);
    assert.equal(readFileSync(ledger, "utf8"), before);

    const text = readFileSync(join(root, "skills", "colleague", "lin-gong", "knowledge", "text", "documents.md"), "utf8");
    assert.match(text, /对账三笔差异/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file that is not OOXML is refused by name", () => {
  const root = tempDir();
  try {
    const file = join(root, "notes.txt");
    writeFileSync(file, "plain\n", "utf8");
    const result = spawnSync(process.execPath, [BIN, "parse-doc", file, "--person", "x", "--base-dir", root, "--json"], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    const receipt = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    assert.equal(receipt.ok, false);
    assert.ok(receipt.warnings.some((warning) => warning.includes("not an OOXML document")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
