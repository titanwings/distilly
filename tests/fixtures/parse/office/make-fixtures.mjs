/**
 * make-fixtures.mjs — build the `.docx` / `.xlsx` fixtures for `parse/office.mjs`.
 *
 * The fixtures are binary containers, so they are **generated, never committed by
 * hand**: a hand-edited blob has no reviewable diff, and a regenerated one would
 * drift from whatever a library happened to emit that day. This script writes the
 * zip bytes itself — local file headers, central directory and EOCD — with a
 * fixed DOS timestamp, so re-running it produces byte-identical files.
 *
 * Only `node:zlib` (`deflateRawSync`) and `node:fs` are used; the CRC-32 comes
 * from `src/parse/common.mjs`, which is the same table the reader verifies
 * against — a generator with its own CRC implementation could agree with itself
 * and still produce members the reader rejects.
 *
 * `buildZip` / `docxParts` / `xlsxParts` are exported so the test file can build
 * ad-hoc containers (a header+footer document, a protected workbook) without
 * adding another opaque blob to the repository.
 *
 * Usage: `node tests/fixtures/parse/office/make-fixtures.mjs`
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

import { crc32 } from "../../../../src/parse/common.mjs";

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
/** 1980-01-01T00:00:00, the earliest timestamp DOS can express. Fixed so the
 *  containers hash identically on every machine and every run. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;
/** `0x0800`: member names are UTF-8. Nothing here leaves ASCII, but saying so
 *  keeps the reader from falling back to its Latin-1 path. */
const ZIP_FLAG_UTF8 = 0x0800;

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/* ------------------------------------------------------------------ */
/* zip writer                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build a zip container from `{name, text|data}` members.
 *
 * Deflate is deterministic for a given zlib build, and every other field is a
 * constant, so the resulting bytes are stable. The writer deliberately supports
 * only what the fixtures need: no zip64, no directories, no encryption.
 *
 * @param {Array<{name: string, text?: string, data?: Uint8Array, method?: number}>} files
 * @param {{dosDate?: number, dosTime?: number, comment?: string}} [options]
 * @returns {Buffer}
 */
export function buildZip(files, options = {}) {
  const dosDate = options.dosDate ?? DOS_DATE;
  const dosTime = options.dosTime ?? DOS_TIME;
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = file.data ? Buffer.from(file.data) : Buffer.from(file.text ?? "", "utf8");
    const method = file.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(ZIP_LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(ZIP_CENTRAL_SIG, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30); // extra field length
    entry.writeUInt16LE(0, 32); // comment length
    entry.writeUInt16LE(0, 34); // disk number start
    entry.writeUInt16LE(0, 36); // internal attributes
    entry.writeUInt32LE(0, 38); // external attributes
    entry.writeUInt32LE(offset, 42);

    parts.push(local, name, body);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }

  const centralBody = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with the central directory
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBody.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return Buffer.concat([...parts, centralBody, eocd, comment]);
}

/* ------------------------------------------------------------------ */
/* OOXML parts                                                         */
/* ------------------------------------------------------------------ */

function contentTypesXml(overrides) {
  return [
    XML_DECL,
    `<Types xmlns="${CONTENT_TYPES_NS}">`,
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    ...overrides.map((part) => `  <Override PartName="${part.name}" ContentType="${part.contentType}"/>`),
    "</Types>",
    "",
  ].join("\n");
}

/**
 * Assemble the members of a WordprocessingML package.
 *
 * `header`/`footer`/`footnotes` are optional: when absent the corresponding part
 * and relationship simply do not exist, which is what a document without them
 * looks like.
 *
 * @param {{document: string, header?: string, footer?: string, footnotes?: string,
 *          extra?: Array<{name: string, text?: string, data?: Uint8Array}>}} input
 */
export function docxParts(input) {
  const main = `word/document.xml`;
  const parts = [
    {
      name: "[Content_Types].xml",
      text: contentTypesXml([
        { name: `/${main}`, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" },
        ...(input.header ? [{ name: "/word/header1.xml", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" }] : []),
        ...(input.footer ? [{ name: "/word/footer1.xml", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" }] : []),
        ...(input.footnotes ? [{ name: "/word/footnotes.xml", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml" }] : []),
      ]),
    },
    {
      name: "_rels/.rels",
      text: [
        XML_DECL,
        `<Relationships xmlns="${PACKAGE_REL_NS}">`,
        `  <Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="${main}"/>`,
        "</Relationships>",
        "",
      ].join("\n"),
    },
    { name: main, text: input.document },
  ];
  if (input.header) parts.push({ name: "word/header1.xml", text: input.header });
  if (input.footer) parts.push({ name: "word/footer1.xml", text: input.footer });
  if (input.footnotes) parts.push({ name: "word/footnotes.xml", text: input.footnotes });
  for (const extra of input.extra ?? []) parts.push(extra);
  return parts;
}

/** A `<w:document>` wrapper with the namespaces every fixture body needs. */
export function docxDocument(bodyXml) {
  return [
    XML_DECL,
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">`,
    "  <w:body>",
    bodyXml,
    "    <w:sectPr/>",
    "  </w:body>",
    "</w:document>",
    "",
  ].join("\n");
}

/** A WordprocessingML part (`header`/`footer`/`footnotes`) around `bodyXml`. */
export function docxPart(rootTag, bodyXml) {
  return [
    XML_DECL,
    `<w:${rootTag} xmlns:w="${W_NS}" xmlns:r="${R_NS}">`,
    bodyXml,
    `</w:${rootTag}>`,
    "",
  ].join("\n");
}

/**
 * Assemble the members of a SpreadsheetML package.
 *
 * @param {{workbook: string, sheets: Array<{name: string, text: string}>,
 *          sharedStrings?: string, styles?: string, workbookRels?: string,
 *          extra?: Array<{name: string, text?: string, data?: Uint8Array}>}} input
 */
export function xlsxParts(input) {
  const parts = [
    {
      name: "[Content_Types].xml",
      text: contentTypesXml([
        { name: "/xl/workbook.xml", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" },
        ...input.sheets.map((sheet) => ({
          name: `/${sheet.name}`,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
        })),
        ...(input.sharedStrings ? [{ name: "/xl/sharedStrings.xml", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" }] : []),
        ...(input.styles ? [{ name: "/xl/styles.xml", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" }] : []),
      ]),
    },
    {
      name: "_rels/.rels",
      text: [
        XML_DECL,
        `<Relationships xmlns="${PACKAGE_REL_NS}">`,
        `  <Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="xl/workbook.xml"/>`,
        "</Relationships>",
        "",
      ].join("\n"),
    },
    { name: "xl/workbook.xml", text: input.workbook },
    { name: "xl/_rels/workbook.xml.rels", text: input.workbookRels ?? defaultWorkbookRels(input.sheets) },
    ...input.sheets.map((sheet) => ({ name: sheet.name, text: sheet.text })),
  ];
  if (input.sharedStrings) parts.push({ name: "xl/sharedStrings.xml", text: input.sharedStrings });
  if (input.styles) parts.push({ name: "xl/styles.xml", text: input.styles });
  for (const extra of input.extra ?? []) parts.push(extra);
  return parts;
}

function defaultWorkbookRels(sheets) {
  return [
    XML_DECL,
    `<Relationships xmlns="${PACKAGE_REL_NS}">`,
    ...sheets.map(
      (sheet, index) =>
        `  <Relationship Id="rId${index + 1}" Type="${R_NS}/worksheet" Target="${sheet.name.replace(/^xl\//, "")}"/>`,
    ),
    "</Relationships>",
    "",
  ].join("\n");
}

export function sheetXml(sheetDataXml) {
  return [
    XML_DECL,
    `<worksheet xmlns="${SHEET_NS}" xmlns:r="${R_NS}">`,
    "  <sheetData>",
    sheetDataXml,
    "  </sheetData>",
    "</worksheet>",
    "",
  ].join("\n");
}

export function workbookXml(sheets) {
  return [
    XML_DECL,
    `<workbook xmlns="${SHEET_NS}" xmlns:r="${R_NS}">`,
    '  <workbookPr date1904="0"/>',
    "  <sheets>",
    ...sheets.map((sheet, index) => `    <sheet name="${sheet.title}" sheetId="${index + 1}" r:id="${sheet.rid}"/>`),
    "  </sheets>",
    "</workbook>",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* the committed fixtures                                              */
/* ------------------------------------------------------------------ */

/** `simple.docx` — three paragraphs: entities, a hyperlink and a `w:br`. */
export function simpleDocx() {
  return buildZip(
    docxParts({
      document: docxDocument(
        [
          "    <w:p><w:r><w:t>Hello &amp; 中文。</w:t></w:r></w:p>",
          '    <w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="rId7"><w:r><w:t>the site</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> for details.</w:t></w:r></w:p>',
          "    <w:p><w:r><w:t>First line</w:t><w:br/><w:t>second line</w:t></w:r></w:p>",
        ].join("\n"),
      ),
    }),
  );
}

/** `table.docx` — a 2×3 table, nothing else. */
export function tableDocx() {
  const cell = (text) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const row = (...cells) => `    <w:tr>${cells.map(cell).join("")}</w:tr>`;
  return buildZip(
    docxParts({
      document: docxDocument(
        ["    <w:tbl>", row("Name", "Age", "City"), row("Ada", "36", "London"), "    </w:tbl>"].join("\n"),
      ),
    }),
  );
}

/** `empty.docx` — a valid package whose `document.xml` holds no readable text. */
export function emptyDocx() {
  return buildZip(
    docxParts({
      document: docxDocument('    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>'),
    }),
  );
}

/** `simple.xlsx` — two sheets, shared strings, a formula, a boolean, a date. */
export function simpleXlsx() {
  const sharedStrings = [
    XML_DECL,
    `<sst xmlns="${SHEET_NS}" count="6" uniqueCount="6">`,
    "  <si><t>Name</t></si>",
    "  <si><t>Age</t></si>",
    "  <si><t>Active</t></si>",
    "  <si><t>Ada</t></si>",
    "  <si><r><t>Bo</t></r><r><t>b</t></r></si>",
    "  <si><t>City</t></si>",
    "</sst>",
    "",
  ].join("\n");

  const styles = [
    XML_DECL,
    `<styleSheet xmlns="${SHEET_NS}">`,
    '  <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>',
    '  <cellXfs count="3">',
    '    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>',
    '    <xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>',
    '    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>',
    "  </cellXfs>",
    "</styleSheet>",
    "",
  ].join("\n");

  const people = sheetXml(
    [
      '    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
      '    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>36</v></c><c r="C2" t="b"><v>1</v></c></row>',
      '    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><f>B2*2</f><v>72</v></c><c r="C3" t="str"><f>CONCATENATE("a","b")</f><v>ab</v></c></row>',
    ].join("\n"),
  );

  const notes = sheetXml(
    [
      '    <row r="1"><c r="A1" t="inlineStr"><is><t>inline note</t></is></c><c r="B1" s="2"><v>2.5</v></c></row>',
      '    <row r="2"><c r="A2" s="1"><v>45000</v></c><c r="B2" t="b"><v>0</v></c></row>',
      '    <row r="3"><c r="A3" t="s"><v>99</v></c><c r="B3" t="e"><v>#DIV/0!</v></c></row>',
      '    <row r="4"/>',
    ].join("\n"),
  );

  return buildZip(
    xlsxParts({
      workbook: workbookXml([
        { title: "People", rid: "rId1" },
        { title: "Notes", rid: "rId2" },
      ]),
      sheets: [
        { name: "xl/worksheets/sheet1.xml", text: people },
        { name: "xl/worksheets/sheet2.xml", text: notes },
      ],
      sharedStrings,
      styles,
    }),
  );
}

/** `not-ooxml.zip` — a valid container with an unrelated member. */
export function notOoxmlZip() {
  return buildZip([
    { name: "notes/data.txt", text: "This is a zip, but not an OOXML package.\n" },
    { name: "notes/readme.md", text: "# Nothing to see\n" },
  ]);
}

/** `notes.txt` — prose, i.e. neither a container nor a PDF. */
export function notesTxt() {
  return Buffer.from(
    [
      "Meeting notes",
      "",
      "Nothing here is a zip container or a PDF, so the office parser must refuse it",
      "by name instead of returning an empty document.",
      "",
    ].join("\n"),
    "utf8",
  );
}

/** Every fixture as `name -> bytes`, in a fixed order. */
export function allFixtures() {
  const simple = simpleDocx();
  return new Map([
    ["simple.docx", simple],
    ["table.docx", tableDocx()],
    ["simple.xlsx", simpleXlsx()],
    ["empty.docx", emptyDocx()],
    // A damaged container: the first 200 bytes keep the local header and part of
    // the deflate stream, but the central directory is gone.
    ["truncated.docx", simple.subarray(0, 200)],
    ["not-ooxml.zip", notOoxmlZip()],
    ["notes.txt", notesTxt()],
  ]);
}

export function writeFixtures(directory = FIXTURE_DIR) {
  mkdirSync(directory, { recursive: true });
  const written = [];
  for (const [name, bytes] of allFixtures()) {
    const path = join(directory, name);
    writeFileSync(path, bytes);
    written.push({ name, path, bytes: bytes.length });
  }
  return written;
}

/** Read a fixture back, so callers (and a human) can eyeball that it changed. */
export function readFixture(name, directory = FIXTURE_DIR) {
  return new Uint8Array(readFileSync(join(directory, name)));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const written = writeFixtures();
  for (const file of written) {
    process.stdout.write(`${file.name}\t${file.bytes} bytes\n`);
  }
}
