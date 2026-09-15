/**
 * `.eml` / `.mbox` reader — the Node port of `tools/email_parser.py`.
 *
 * What it keeps from the Python original: RFC 2047 encoded-words in headers,
 * per-part charset decoding, "prefer text/plain, fall back to text/html", and
 * mbox splitting with `>From` unescaping.
 *
 * What it does differently, on purpose:
 *   - a message is recorded whole (one anchored unit per message) with its
 *     sender, recipients and date, instead of being filtered by a `--target`
 *     heuristic and grouped into relationship categories — that judgement belongs
 *     to the model reading `knowledge/text/*`, and dropping messages silently
 *     would break the "nothing is skipped without a warning" rule;
 *   - attachments are named and counted in `warnings`, never decoded into text.
 */

import { decodeBuffer } from "../knowledge/anchors.mjs";
import { buildDocument, decodeEntities, recordsFromCharSpans, SourceFile, stripHtml } from "./common.mjs";

const MIME_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
const MBOX_FROM = /^From .*(?:\d{4}|\d{2}:\d{2})/;
const TEXTUAL = /^text\//i;

/** Decode RFC 2047 encoded-words (`=?utf-8?B?…?=`). */
export function decodeMimeWords(value) {
  if (typeof value !== "string" || !value.includes("=?")) return value;
  return value.replace(MIME_WORD, (match, charset, encoding, payload) => {
    try {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(payload, "base64")
          : Buffer.from(payload.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "binary");
      return decodeBuffer(new Uint8Array(bytes), { preferred: String(charset).toLowerCase() }).text;
    } catch {
      return match;
    }
  });
}

/** Split header block from body at the first blank line. */
function splitHeaders(text) {
  const match = /\r?\n\r?\n/.exec(text);
  if (!match) return { headerText: text, bodyText: "" };
  return { headerText: text.slice(0, match.index), bodyText: text.slice(match.index + match[0].length) };
}

/** Unfold `Subject: a\n b` continuation lines and collect duplicates. */
export function parseHeaders(headerText) {
  const headers = new Map();
  let current = null;
  for (const line of headerText.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers.set(current, `${headers.get(current)} ${line.trim()}`);
      continue;
    }
    const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    current = match[1].toLowerCase();
    const value = match[2];
    headers.set(current, headers.has(current) ? `${headers.get(current)}, ${value}` : value);
  }
  return headers;
}

export function contentTypeOf(headers) {
  const raw = headers.get("content-type") ?? "text/plain";
  const [type, ...params] = raw.split(";");
  const parsed = {};
  for (const param of params) {
    const match = /^\s*([A-Za-z-]+)\s*=\s*"?([^";]*)"?\s*$/.exec(param);
    if (match) parsed[match[1].toLowerCase()] = match[2];
  }
  return { type: type.trim().toLowerCase(), params: parsed };
}

function decodePartBody(bytes, encoding, charset) {
  const normalized = String(encoding ?? "7bit").toLowerCase();
  if (normalized === "base64") {
    return decodeBuffer(new Uint8Array(Buffer.from(bytes.toString("latin1").replace(/\s+/g, ""), "base64")), { preferred: charset }).text;
  }
  if (normalized === "quoted-printable") {
    const raw = bytes.toString("latin1");
    const decoded = raw
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return decodeBuffer(new Uint8Array(Buffer.from(decoded, "latin1")), { preferred: charset }).text;
  }
  return decodeBuffer(bytes, { preferred: charset }).text;
}

/** Recursively walk a MIME entity, collecting the text body and attachments. */
function walkPart(bytes, headers, out) {
  const { type, params } = contentTypeOf(headers);
  const encoding = headers.get("content-transfer-encoding");
  const charset = params.charset ? params.charset.toLowerCase() : undefined;
  const disposition = headers.get("content-disposition") ?? "";
  const filename = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition)?.[1] ?? params.name;

  if (type.startsWith("multipart/") && params.boundary) {
    const text = bytes.toString("latin1");
    const parts = text.split(`--${params.boundary}`);
    for (const part of parts.slice(1)) {
      if (/^--\s*$/.test(part.trim())) break; // closing boundary
      const trimmed = part.replace(/^\r?\n/, "");
      const { headerText, bodyText } = splitHeaders(trimmed);
      walkPart(Buffer.from(bodyText, "latin1"), parseHeaders(headerText), out);
    }
    return out;
  }

  if (filename || (!TEXTUAL.test(type) && type !== "message/rfc822")) {
    out.attachments.push({ filename: filename ?? `(${type})`, type, bytes: bytes.length });
    return out;
  }

  const decoded = decodePartBody(bytes, encoding, charset);
  if (type === "text/plain") out.plain.push(decoded);
  else if (type === "text/html") out.html.push(decoded);
  else out.other.push({ type, decoded });
  return out;
}

/**
 * Put an 8-bit header value back through UTF-8.
 *
 * `parseMessage` reads the message through a latin1 view so that byte offsets and
 * the mbox `>From` handling stay exact. That is right for the body — which is
 * decoded per part — but it leaves a raw UTF-8 `Subject:` looking like
 * `å¯¹è´¦å·®å¼`. Only values that actually carry high bytes are re-decoded, and a
 * value that is not valid UTF-8 keeps its bytes rather than gaining U+FFFD.
 */
function decodeHeaderValue(value) {
  if (!value || !/[\u0080-\u00ff]/.test(value)) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "latin1"));
  } catch {
    return value;
  }
}

/** One message → `{ headers, from, to, subject, date, body, attachments, warnings }`. */
export function parseMessage(rawBytes) {
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  const normalised = Buffer.from(bytes).toString("latin1").replace(/\r\n/g, "\n").replace(/^>From /gm, "From ");
  const { headerText, bodyText } = splitHeaders(normalised);
  const headers = parseHeaders(headerText);
  const collected = walkPart(Buffer.from(bodyText, "latin1"), headers, { plain: [], html: [], other: [], attachments: [] });

  const warnings = [];
  let body = collected.plain.join("\n\n").trim();
  if (!body && collected.html.length > 0) {
    // `stripHtml` already decodes entities and collapses whitespace; wrapping it in
    // another `decodeEntities` fed it an object and produced "[object Object]".
    body = stripHtml(collected.html.join("\n\n")).text.trim();
    warnings.push({ code: "email/html-only", message: "no text/plain part; the HTML alternative was stripped to text" });
  }
  if (!body) {
    warnings.push({ code: "email/empty-body", message: "no textual body found; only attachments were present" });
  }
  for (const attachment of collected.attachments) {
    warnings.push({
      code: "email/attachment-skipped",
      message: `attachment not parsed: ${attachment.filename} (${attachment.type}, ${attachment.bytes} bytes)`,
    });
  }
  if (collected.other.length > 0) {
    warnings.push({
      code: "email/non-text-part",
      message: `${collected.other.length} non-text part(s) ignored: ${collected.other.map((p) => p.type).join(", ")}`,
    });
  }

  return {
    headers,
    from: decodeMimeWords(decodeHeaderValue(headers.get("from") ?? "")).trim(),
    to: decodeMimeWords(decodeHeaderValue(headers.get("to") ?? "")).trim(),
    cc: decodeMimeWords(decodeHeaderValue(headers.get("cc") ?? "")).trim(),
    subject: decodeMimeWords(decodeHeaderValue(headers.get("subject") ?? "")).trim(),
    date: (headers.get("date") ?? "").trim(),
    message_id: (headers.get("message-id") ?? "").trim(),
    body,
    attachments: collected.attachments,
    warnings,
  };
}

/**
 * Split an mbox into per-message byte ranges.
 * A separator is a line starting with `From ` that also carries a date or time —
 * which is what keeps a body line like "From now on…" from splitting a message.
 */
export function splitMbox(text) {
  const lines = text.split("\n");
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (index === 0 || MBOX_FROM.test(lines[index])) {
      if (MBOX_FROM.test(lines[index]) || index === 0) starts.push(index);
    }
  }
  const ranges = [];
  for (let index = 0; index < starts.length; index += 1) {
    const from = starts[index];
    const header = lines[from];
    if (!MBOX_FROM.test(header) && index > 0) continue;
    const to = index + 1 < starts.length ? starts[index + 1] : lines.length;
    const bodyLines = index === 0 && MBOX_FROM.test(header) ? lines.slice(from + 1, to) : lines.slice(from + 1, to);
    ranges.push({ header, text: bodyLines.join("\n") });
  }
  return ranges.filter((range) => range.text.trim().length > 0);
}

/** Read an `.eml` or `.mbox` `SourceFile` into a ledger document. */
export function parseEmail(file, options = {}) {
  const name = file.name.toLowerCase();
  const warnings = [];
  const messages = [];

  if (name.endsWith(".mbox") || /^From .*\d{4}/m.test(file.text.slice(0, 4096)) && name.endsWith(".mbx")) {
    const ranges = splitMbox(file.text);
    if (ranges.length === 0) {
      throw new Error(`${file.label} looks like an mbox but contains no "From " separator`);
    }
    for (const range of ranges) messages.push(parseMessage(Buffer.from(range.text, "utf8")));
  } else {
    messages.push(parseMessage(file.raw));
  }

  const records = [];
  const labels = [];
  let cursor = 0;
  for (const message of messages) {
    const heading = [message.date, message.from, message.subject].filter(Boolean).join(" · ") || "(no headers)";
    const text = message.body || "(no textual body)";
    labels.push(`${heading}\n${text}`);
    for (const warning of message.warnings) {
      warnings.push({ code: warning.code, message: `${heading || file.label}: ${warning.message}` });
    }
  }
  const content = labels.join("\n\n");

  // Anchor one unit per message so a citation points at a single email.
  let offset = 0;
  for (const label of labels) {
    const start = offset;
    const end = offset + label.length;
    records.push({ text: label, charStart: start, charEnd: end, kind: "message", label: label.split("\n")[0] });
    offset = end + 2; // labels joined with a blank line
    void cursor;
  }

  const spanRecords = recordsFromCharSpans(file, records.map((record) => ({
    text: record.text,
    charStart: record.charStart,
    charEnd: record.charEnd,
    kind: record.kind,
    label: record.label,
  })));

  return buildDocument({
    parser: "email",
    format: name.endsWith(".mbox") ? "mbox" : "eml",
    kind: "email",
    method: "local-file",
    source: options.source ?? "email",
    files: [file],
    records: spanRecords,
    warnings,
  });
}

export { SourceFile };
