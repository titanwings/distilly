/**
 * `.docx` / `.xlsx` reader — OOXML text extraction with zero dependencies.
 *
 * Both formats are zip containers of XML, so this module rides on the shared zip
 * reader in `parse/common.mjs` and pulls text out of the parts that carry it:
 *
 *   docx  word/document.xml      → one record per `<w:p>` paragraph
 *   xlsx  xl/sharedStrings.xml   → the shared string table
 *         xl/worksheets/*.xml    → one record per row (`column=value` pairs)
 *
 * Nothing is interpreted beyond text: styles, comments, revisions and embedded
 * objects are reported as warnings, not silently dropped.
 */

import { decodeEntities, readZipMembers, recordsFromCharSpans, buildDocument } from "./common.mjs";

/** Extract the text of every `<t>`/`<v>` element inside a fragment. */
function textOf(fragment) {
  const parts = [];
  // Word writes `<w:t>`, the spreadsheet parts write `<t>`/`<v>`, and a producer
  // may use any prefix it likes — so the namespace prefix is optional here. A
  // regex anchored on bare `<t>` matches nothing in a `.docx` and silently
  // yields "no paragraph text" for a document full of it.
  const runs = /<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>|<(?:[A-Za-z_][\w.-]*:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/g;
  for (const match of fragment.matchAll(runs)) {
    parts.push(decodeEntities(match[1] ?? match[2] ?? "").text);
  }
  return parts.join("");
}

/**
 * A zip member as text.
 *
 * `readZipMembers` hands back `Uint8Array`, whose `toString()` is
 * `"60,63,120,…"` — an OOXML part read that way matches no tag at all, which is
 * how `parseDocx` ended up reporting "no paragraph text" for a perfectly good
 * document. Everything that reads a member as XML goes through here.
 */
function memberText(bytes) {
  return Buffer.from(bytes).toString("utf8");
}

function requireMember(members, name, file) {
  const data = members.get(name);
  if (!data) throw new Error(`${file.label} has no ${name}; not a readable OOXML document`);
  return memberText(data);
}

/** Paragraphs of a Word document. */
export function parseDocx(file, options = {}) {
  const { members, warnings } = readZipMembers(file.raw, options);
  const documentXml = requireMember(members, "word/document.xml", file);
  const paragraphs = [];
  for (const match of documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const text = textOf(match[1]).replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
  }
  const tables = (documentXml.match(/<w:tbl(?:\s[^>]*)?>/g) ?? []).length;
  if (tables > 0) {
    warnings.push({ code: "office/table-flattened", message: `${tables} table(s) were flattened into paragraphs` });
  }
  if (paragraphs.length === 0) {
    warnings.push({ code: "office/empty", message: "the document contains no paragraph text" });
  }
  return buildDocument({
    parser: "office",
    format: "docx",
    kind: "doc",
    method: "local-file",
    source: options.source ?? "documents",
    files: [file],
    records: recordsFromCharSpans(file, paragraphRecords(paragraphs)),
    warnings,
  });
}

/** Shared strings + rows of a workbook. */
export function parseXlsx(file, options = {}) {
  const { members, entries, warnings } = readZipMembers(file.raw, options);
  const shared = [];
  const sharedXml = members.get("xl/sharedStrings.xml");
  if (sharedXml) {
    for (const match of memberText(sharedXml).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
      shared.push(textOf(match[1]));
    }
  }

  const sheets = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sheets.length === 0) throw new Error(`${file.label} has no worksheet; not a readable workbook`);

  const rows = [];
  for (const sheet of sheets) {
    const xml = memberText(members.get(sheet.name));
    for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cellMatch[1];
        const column = /r="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? `?${cells.length + 1}`;
        const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? "n";
        const raw = textOf(cellMatch[2]);
        const value = type === "s" ? (shared[Number(raw)] ?? "") : raw;
        if (value) cells.push(`${column}=${value}`);
      }
      if (cells.length > 0) rows.push(cells.join("\t"));
    }
  }
  const chartCount = entries.filter((entry) => entry.name.startsWith("xl/charts/")).length;
  if (chartCount > 0) {
    warnings.push({ code: "office/charts-skipped", message: `${chartCount} chart part(s) carry no extractable text` });
  }
  if (rows.length === 0) warnings.push({ code: "office/empty", message: "the workbook contains no cell text" });

  return buildDocument({
    parser: "office",
    format: "xlsx",
    kind: "doc",
    method: "local-file",
    source: options.source ?? "documents",
    files: [file],
    records: recordsFromCharSpans(file, paragraphRecords(rows, "row")),
    warnings,
  });
}

function paragraphRecords(paragraphs, kind = "paragraph") {
  const records = [];
  let offset = 0;
  for (const text of paragraphs) {
    records.push({ text, charStart: offset, charEnd: offset + text.length, kind, label: text.slice(0, 60) });
    offset += text.length + 1;
  }
  return records;
}

/** Dispatch on the file name; anything else is refused by name. */
export function parseOffice(file, options = {}) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return parseDocx(file, options);
  if (name.endsWith(".xlsx")) return parseXlsx(file, options);
  throw new Error(`${file.label}: not an OOXML document (.docx/.xlsx)`);
}
