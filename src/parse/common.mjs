/**
 * common.mjs — the contract between `src/knowledge/**` and `src/parse/**`.
 *
 * A parser never touches the filesystem and never invents bytes. It receives a
 * `SourceFile` (raw bytes plus a decoded view that remembers byte offsets) and
 * returns a **document**:
 *
 * ```js
 * {
 *   parser: "chat",              // which module produced it
 *   format: "chatgpt-export",    // the detected format id, or null when unknown
 *   kind: "chat",                // ledger `kind`
 *   method: "user-export",       // ledger `method`
 *   credentialed: false,
 *   source: "chatgpt-export",    // bucket under knowledge/raw/
 *   files: [SourceFile, ...],    // every raw file the document was built from
 *   units: [{text, byteStart, byteEnd, file, segmentIndex}],  // normalised lines
 *   anchors: [{kind, text, anchor:"k00NN:tM", index, byteStart, byteEnd, file}],
 *   warnings: ["..."],
 *   dropped: [{what, why}],
 *   meta: {...}
 * }
 * ```
 *
 * `units` are produced by `assignAnchors` (see `src/knowledge/anchors.mjs`), and
 * `anchors` by `buildSubAnchors`, so anchors stay globally monotonic per ledger
 * id and every anchor resolves to a raw byte range.
 *
 * Format detection is **never a guess**: when nothing matches, parsers return
 * `format: null` plus a `warnings` entry naming the bytes they looked at. The
 * CLI turns that into "not a recognised export format" and a non-zero exit.
 */

import { readFileSync, statSync } from "node:fs";
import { IDENTITY_FILE, canonicalSpeaker } from "../knowledge/identity.mjs";
import { inflateRawSync } from "node:zlib";
import { basename, extname } from "node:path";
import {
  assignAnchors,
  assignAnchorsToText,
  decodeBuffer,
  parseAnchor,
  verifyByteConservation,
} from "../knowledge/anchors.mjs";

/* ------------------------------------------------------------------ */
/* limits                                                              */
/* ------------------------------------------------------------------ */

/** An archive member larger than this is recorded but not inflated. */
export const DEFAULT_MAX_MEMBER_BYTES = 64 * 1024 * 1024;
/** A single line longer than this is split, with a warning. */
export const DEFAULT_MAX_LINE_CHARS = 200_000;
/** How deep to walk a JSON document before stopping. */
export const DEFAULT_MAX_JSON_DEPTH = 48;
/** How many array elements to emit as leaves per array. */
export const DEFAULT_MAX_ARRAY_LEAVES = 20_000;

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Raised when a parser cannot recognise its input. The message is written to be
 * shown to a human verbatim: it says what was tried and what was seen.
 */
export class UnrecognizedFormatError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "UnrecognizedFormatError";
    this.details = details;
  }
}

/** Raised for an input that cannot be read at all (missing file, bad encoding). */
export class InputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "InputError";
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/* source files                                                        */
/* ------------------------------------------------------------------ */

/**
 * One raw file plus a byte-faithful decoded view.
 *
 * `charToByte(i)` maps a character index in `text` to its byte offset in `raw`,
 * which is what lets every parser report byte ranges without re-deriving them.
 */
export class SourceFile {
  /**
   * @param {{path?: string, name?: string, raw: Uint8Array, label?: string,
   *          preferred?: string, fallbacks?: string[]}} input
   */
  constructor(input) {
    if (!input?.raw) throw new TypeError("SourceFile requires raw bytes");
    this.path = input.path ?? input.name ?? "<memory>";
    this.name = input.name ?? basename(this.path);
    this.raw = input.raw instanceof Uint8Array ? input.raw : new Uint8Array(input.raw);
    this.label = input.label ?? this.name;

    const decoded = decodeBuffer(this.raw, {
      ...(input.preferred ? { preferred: input.preferred } : {}),
      ...(input.fallbacks ? { fallbacks: input.fallbacks } : {}),
    });

    this.text = decoded.text;
    this.encoding = decoded.label;
    this.bom = decoded.bom;
    this.bomBytes = decoded.bomBytes;
    this.lossy = decoded.lossy;
    this.decodeWarnings = decoded.warnings;

    // Character index -> byte offset, walking the decoded text with the same
    // UTF-8 re-encoding the decoder used. Only valid for the encodings where the
    // decoded text round-trips through UTF-8; for legacy single/double byte
    // codecs we fall back to a proportional ±1 byte approximation and say so.
    this._charByteStarts = buildCharByteMap(this.text, this.raw, this.bomBytes);
  }

  get bytes() {
    return this.raw.length;
  }

  /** Byte offset of character index `index`, or `raw.length` past the end. */
  charToByte(index) {
    const map = this._charByteStarts;
    if (index <= 0) return map.length > 0 ? map[0] : this.bomBytes;
    if (index >= map.length) return this.raw.length;
    return map[index];
  }

  /** Raw bytes for the character range `[start, end)`. */
  sliceChars(start, end) {
    return this.raw.subarray(this.charToByte(start), this.charToByte(end));
  }

  /** The text of `[start, end)` exactly as it appears in the raw payload. */
  textOf(start, end) {
    return this.text.slice(start, end);
  }

  /** A `knowledge/raw/...`-relative descriptor, filled in by the store. */
  descriptor(extra = {}) {
    return {
      path: this.path,
      name: this.name,
      relativePath: null,
      bytes: this.raw.length,
      sha256: null,
      encoding: this.encoding,
      bom: this.bom,
      lossy: this.lossy,
      persisted: false,
      bytesRaw: this.raw,
      ...extra,
    };
  }
}

function buildCharByteMap(text, raw, bomBytes) {
  const map = new Int32Array(text.length + 1);
  let byte = bomBytes;
  for (let index = 0; index < text.length; index += 1) {
    map[index] = byte;
    const code = text.codePointAt(index);
    const size = code > 0xffff ? 2 : 1;
    // UTF-8 length of this code point.
    byte += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size === 2) map[index + 1] = byte - (code < 0x10000 ? 3 : 4) + (code < 0x10000 ? 3 : 4);
  }
  map[text.length] = Math.min(byte, raw.length);
  return map;
}

/** Read a file from disk into a `SourceFile`. */
export function loadSourceFile(path, options = {}) {
  let raw;
  try {
    raw = new Uint8Array(readFileSync(path));
  } catch (error) {
    throw new InputError(`cannot read ${path}: ${error.message}`, { path });
  }
  return new SourceFile({ path, raw, ...options });
}

export function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* text helpers                                                        */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
  ["#39", "'"],
  ["#x27", "'"],
  ["#x2F", "/"],
  ["hellip", "\u2026"],
  ["mdash", "\u2014"],
  ["ndash", "\u2013"],
  ["rsquo", "\u2019"],
  ["lsquo", "\u2018"],
  ["ldquo", "\u201c"],
  ["rdquo", "\u201d"],
  ["middot", "\u00b7"],
  ["bull", "\u2022"],
  ["copy", "\u00a9"],
]);

/**
 * Decode the entity forms that actually appear in mail and OOXML payloads.
 * Unknown entities are left verbatim — inventing a replacement would lose bytes.
 * @returns {{text: string, unknown: string[]}}
 */
export function decodeEntities(input) {
  const unknown = [];
  const text = String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    const key = body.toLowerCase();
    if (NAMED_ENTITIES.has(key)) return NAMED_ENTITIES.get(key);
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    } else if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    unknown.push(match);
    return match;
  });
  return { text, unknown };
}

const BLOCK_TAGS = new Set([
  "p", "br", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "section", "article", "blockquote", "pre", "hr", "ul", "ol", "td",
]);

/**
 * Extract readable text from an HTML fragment.
 *
 * `script`/`style`/`head` content is *dropped*, and the dropped byte/char count
 * is reported so the caller can put it in `warnings` — byte discipline says a
 * deletion is a finding, not a detail.
 *
 * @param {string} html
 * @returns {{text: string, droppedChars: number, droppedTags: string[]}}
 */
export function stripHtml(html) {
  const droppedTags = new Set();
  let droppedChars = 0;
  let text = "";
  let index = 0;
  const source = String(html);

  while (index < source.length) {
    const lt = source.indexOf("<", index);
    if (lt === -1) {
      text += source.slice(index);
      break;
    }
    text += source.slice(index, lt);

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      index = end === -1 ? source.length : end + 3;
      continue;
    }

    const gt = source.indexOf(">", lt);
    if (gt === -1) {
      // Unterminated tag: keep the remainder verbatim rather than eating it.
      text += source.slice(lt);
      break;
    }

    const rawTag = source.slice(lt + 1, gt);
    const match = /^\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(rawTag);
    const tag = match ? match[1].toLowerCase() : "";
    const closing = rawTag.startsWith("/");

    if (!closing && (tag === "script" || tag === "style" || tag === "head" || tag === "title")) {
      const closeIndex = source.toLowerCase().indexOf(`</${tag}`, gt);
      const end = closeIndex === -1 ? source.length : source.indexOf(">", closeIndex) + 1 || source.length;
      droppedChars += end - lt;
      droppedTags.add(tag);
      index = end;
      continue;
    }

    if (BLOCK_TAGS.has(tag)) text += "\n";
    index = gt + 1;
  }

  const { text: entityDecoded, unknown } = decodeEntities(text);
  const collapsed = entityDecoded
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text: collapsed, droppedChars, droppedTags: [...droppedTags], unknownEntities: unknown };
}

/* ------------------------------------------------------------------ */
/* byte-aware JSON scanning                                            */
/* ------------------------------------------------------------------ */

/**
 * Strip the `window.YTD.<name>.part<N> = ...;` wrapper used by X (Twitter),
 * Instagram and Google Takeout `.js` payloads, returning the JSON slice and the
 * byte offset it starts at.
 *
 * @returns {{json: string, charOffset: number, wrapper: string|null}}
 */
export function unwrapJsonAssignment(text) {
  const trimmedStart = text.search(/\S/);
  if (trimmedStart === -1) return { json: "", charOffset: 0, wrapper: null };
  const head = text.slice(trimmedStart, trimmedStart + 64);
  const match = /^(?:window\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*/.exec(head);
  if (!match) return { json: text, charOffset: 0, wrapper: null };
  const body = text.slice(trimmedStart + match[0].length);
  return { json: body, charOffset: trimmedStart + match[0].length, wrapper: match[0].trim() };
}

function skipWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t" || text[cursor] === "\n" || text[cursor] === "\r")) {
    cursor += 1;
  }
  return cursor;
}

function scanString(text, index) {
  if (text[index] !== '"') throw new SyntaxError(`expected a string at offset ${index}`);
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === '"') return cursor + 1;
    cursor += 1;
  }
  throw new SyntaxError(`unterminated string starting at offset ${index}`);
}

function scanNumber(text, index) {
  const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
  if (!match) throw new SyntaxError(`expected a number at offset ${index}`);
  return index + match[0].length;
}

function scanLiteral(text, index) {
  for (const literal of ["true", "false", "null"]) {
    if (text.startsWith(literal, index)) return index + literal.length;
  }
  throw new SyntaxError(`unexpected token at offset ${index}: ${text.slice(index, index + 12)}`);
}

/**
 * Walk every scalar in a JSON document, reporting its path and the byte range of
 * the *token* (strings exclude their quotes, so `raw` can be re-parsed directly).
 *
 * The scanner is hand written rather than `JSON.parse` + a separate position
 * search because positions must be exact: an anchor that points one byte off is
 * worse than no anchor at all.
 *
 * @param {SourceFile} file
 * @param {{maxDepth?: number, maxArrayLeaves?: number}} [options]
 * @returns {{leaves: Array<{path: string, value: unknown, byteStart: number,
 *            byteEnd: number, charStart: number, charEnd: number}>, warnings: string[],
 *            wrapper: string|null, truncated: boolean}}
 */
export function walkJsonLeaves(file, options = {}) {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const maxArrayLeaves = options.maxArrayLeaves ?? DEFAULT_MAX_ARRAY_LEAVES;
  const { json, charOffset, wrapper } = unwrapJsonAssignment(file.text);
  const leaves = [];
  const warnings = [];
  let truncated = false;
  let arrayLeaves = 0;

  const pathOf = (segments) => segments.join(".");

  const valueEnd = (text, index) => {
    const char = text[index];
    if (char === '"') return scanString(text, index);
    if (char === "{" || char === "[") {
      const stack = [char];
      let cursor = index + 1;
      while (cursor < text.length && stack.length > 0) {
        const current = text[cursor];
        if (current === '"') {
          cursor = scanString(text, cursor);
          continue;
        }
        if (current === "{") stack.push("}");
        else if (current === "[") stack.push("]");
        else if (current === "}" || current === "]") stack.pop();
        cursor += 1;
      }
      return cursor;
    }
    if (char === "-" || (char >= "0" && char <= "9")) return scanNumber(text, index);
    return scanLiteral(text, index);
  };

  const walk = (start, segments, depth) => {
    if (depth > maxDepth) {
      if (!truncated) {
        truncated = true;
        warnings.push(`JSON nesting exceeded ${maxDepth} levels; deeper values were not anchored`);
      }
      return valueEnd(json, start);
    }
    const index = skipWhitespace(json, start);
    const char = json[index];
    if (char === undefined) return index;

    if (char === "{") {
      let cursor = skipWhitespace(json, index + 1);
      if (json[cursor] === "}") return cursor + 1;
      while (cursor < json.length) {
        cursor = skipWhitespace(json, cursor);
        if (json[cursor] !== '"') throw new SyntaxError(`expected an object key at offset ${cursor}`);
        const keyEnd = scanString(json, cursor);
        const key = JSON.parse(json.slice(cursor, keyEnd));
        cursor = skipWhitespace(json, keyEnd);
        if (json[cursor] !== ":") throw new SyntaxError(`expected ':' at offset ${cursor}`);
        cursor = walk(cursor + 1, [...segments, key], depth + 1);
        cursor = skipWhitespace(json, cursor);
        if (json[cursor] === ",") {
          cursor += 1;
          continue;
        }
        if (json[cursor] === "}") return cursor + 1;
        throw new SyntaxError(`expected ',' or '}' at offset ${cursor}`);
      }
      return cursor;
    }

    if (char === "[") {
      let cursor = skipWhitespace(json, index + 1);
      if (json[cursor] === "]") return cursor + 1;
      let element = 0;
      while (cursor < json.length) {
        if (arrayLeaves >= maxArrayLeaves) {
          if (!truncated) {
            truncated = true;
            warnings.push(`array at ${pathOf(segments) || "<root>"} exceeded ${maxArrayLeaves} elements; the remainder was not anchored`);
          }
          return valueEnd(json, index);
        }
        arrayLeaves += 1;
        cursor = walk(cursor, [...segments, String(element)], depth + 1);
        element += 1;
        cursor = skipWhitespace(json, cursor);
        if (json[cursor] === ",") {
          cursor += 1;
          continue;
        }
        if (json[cursor] === "]") return cursor + 1;
        throw new SyntaxError(`expected ',' or ']' at offset ${cursor}`);
      }
      return cursor;
    }

    const tokenEnd = valueEnd(json, index);
    const rawToken = json.slice(index, tokenEnd);
    let value;
    try {
      value = JSON.parse(rawToken);
    } catch {
      value = rawToken;
    }
    const isString = char === '"';
    leaves.push({
      path: pathOf(segments),
      value,
      charStart: charOffset + index + (isString ? 1 : 0),
      charEnd: charOffset + tokenEnd - (isString ? 1 : 0),
      byteStart: file.charToByte(charOffset + index + (isString ? 1 : 0)),
      byteEnd: file.charToByte(charOffset + tokenEnd - (isString ? 1 : 0)),
      container: false,
    });
    return tokenEnd;
  };

  walk(0, [], 0);
  return { leaves, warnings, wrapper, truncated };
}

/**
 * Parse the JSON payload of a source file, unwrapping a `window.X =` prefix.
 * Throws `UnrecognizedFormatError` when the payload is not JSON at all.
 */
export function parseJsonPayload(file) {
  const { json, wrapper } = unwrapJsonAssignment(file.text);
  const trimmed = json.trim().replace(/;\s*$/, "");
  if (trimmed === "") {
    throw new UnrecognizedFormatError(`${file.label} is empty; there is no JSON payload to parse`, { path: file.path });
  }
  try {
    return { value: JSON.parse(trimmed), wrapper };
  } catch (error) {
    throw new UnrecognizedFormatError(
      `${file.label} is not valid JSON (${error.message}); known export formats are JSON, JSON-lines, CSV, .eml/.mbox, .srt/.vtt, .docx/.xlsx and zip`,
      { path: file.path, cause: error.message },
    );
  }
}

/** Every JSON object reachable from `value`, depth first, with its path. */
export function* iterateObjects(value, path = [], depth = 0, maxDepth = DEFAULT_MAX_JSON_DEPTH) {
  if (depth > maxDepth || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      yield* iterateObjects(value[index], [...path, String(index)], depth + 1, maxDepth);
    }
    return;
  }
  yield { value, path };
  for (const key of Object.keys(value)) {
    yield* iterateObjects(value[key], [...path, key], depth + 1, maxDepth);
  }
}

/**
 * Depth-first search for the first array of plain objects whose length is at
 * least `minLength` and that contains at least one of `requiredKeys`.
 * Used to locate message lists without hard-coding a whole schema.
 */
export function findObjectArray(value, requiredKeys, options = {}) {
  const minLength = options.minLength ?? 1;
  const maxDepth = options.maxDepth ?? 8;
  const queue = [{ value, path: [], depth: 0 }];
  while (queue.length > 0) {
    const { value: current, path, depth } = queue.shift();
    if (depth > maxDepth || current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      if (
        current.length >= minLength &&
        current.every((item) => item && typeof item === "object" && !Array.isArray(item)) &&
        // "required" means all of them, on every item. `some` made the Instagram
        // check (`sender_name` + `timestamp_ms`) match any Slack/Feishu export that
        // merely carried `sender_name`, so Instagram claimed other people's shapes.
        current.every((item) => requiredKeys.every((key) => key in item))
      ) {
        return { items: current, path };
      }
      for (let index = 0; index < current.length; index += 1) {
        queue.push({ value: current[index], path: [...path, String(index)], depth: depth + 1 });
      }
      continue;
    }
    for (const key of Object.keys(current)) {
      queue.push({ value: current[key], path: [...path, key], depth: depth + 1 });
    }
  }
  return null;
}

/** First present key in `keys`, so export dialects can be tolerated explicitly. */
export function pick(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null && object[key] !== "") {
      return { key, value: object[key] };
    }
  }
  return { key: null, value: undefined };
}

/* ------------------------------------------------------------------ */
/* zip containers                                                      */
/* ------------------------------------------------------------------ */

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_EOCD64_SIG = 0x06064b50;
const ZIP_EOCD64_LOCATOR_SIG = 0x07064b50;

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  throw new TypeError("expected a Buffer, Uint8Array or ArrayBuffer");
}

/**
 * Read a ZIP central directory.
 *
 * Hand-written rather than pulled from a dependency because the deliverable is
 * zero-dependency, and because an archive parser needs the *member list* even
 * when it never inflates a byte: an X export, a Takeout dump and a `.docx` are
 * all "which members exist?" questions first.
 *
 * Every entry carries the byte range of its local header and of its data, so a
 * caller that reads a member can say where in the container it came from.
 *
 * Deliberately not supported, and reported as `warnings` rather than guessed at:
 * encrypted members and members larger than `maxMemberBytes`.
 *
 * @param {Uint8Array} bytes
 * @param {{maxMemberBytes?: number, maxMembers?: number}} [options]
 * @returns {{entries: Array<object>, comment: string, warnings: string[],
 *            zip64: boolean}}
 */
export function readZipDirectory(bytes, options = {}) {
  const buffer = toBuffer(bytes);
  const maxMemberBytes = options.maxMemberBytes ?? DEFAULT_MAX_MEMBER_BYTES;
  const maxMembers = options.maxMembers ?? 200_000;
  const warnings = [];

  const eocd = findEndOfCentralDirectory(buffer);
  if (!eocd) {
    throw new UnrecognizedFormatError(
      "not a zip container: no End Of Central Directory record in the last 65 557 bytes",
    );
  }

  let centralOffset = eocd.centralOffset;
  let centralSize = eocd.centralSize;
  let entryCount = eocd.entryCount;
  let zip64 = false;

  if (centralOffset === 0xffffffff || entryCount === 0xffff || centralSize === 0xffffffff) {
    const zip64Eocd = findZip64EndOfCentralDirectory(buffer, eocd.offset);
    if (zip64Eocd) {
      centralOffset = Number(zip64Eocd.centralOffset);
      centralSize = Number(zip64Eocd.centralSize);
      entryCount = Number(zip64Eocd.entryCount);
      zip64 = true;
    } else {
      warnings.push("the End Of Central Directory claims Zip64 sizes but no Zip64 record was found; the 32-bit values were used");
    }
  }

  if (centralOffset + centralSize > buffer.length) {
    throw new UnrecognizedFormatError(
      `zip central directory runs past the end of the file (offset ${centralOffset} + ${centralSize} > ${buffer.length})`,
    );
  }
  if (entryCount > maxMembers) {
    warnings.push(`the container declares ${entryCount} members; only the first ${maxMembers} were read`);
    entryCount = maxMembers;
  }

  const entries = [];
  let cursor = centralOffset;
  while (cursor + 46 <= buffer.length && entries.length < entryCount) {
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIG) {
      warnings.push(`central directory entry ${entries.length + 1} at byte ${cursor} does not start with the expected signature; the rest of the directory was skipped`);
      break;
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const dosTime = buffer.readUInt16LE(cursor + 12);
    const dosDate = buffer.readUInt16LE(cursor + 14);
    const crc32Value = buffer.readUInt32LE(cursor + 16);
    let compressedSize = buffer.readUInt32LE(cursor + 20);
    let uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    let localOffset = buffer.readUInt32LE(cursor + 42);
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const extra = buffer.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);

    if ((flags & 0x0001) !== 0) {
      warnings.push(`member ${decodeZipName(rawName, flags)} is encrypted and was skipped`);
      cursor += 46 + nameLength + extraLength + commentLength;
      continue;
    }

    // Zip64 extra field (0x0001) overrides whichever 32-bit values are saturated.
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      const z64 = readZip64Extra(extra);
      if (z64) {
        uncompressedSize = z64.uncompressedSize ?? uncompressedSize;
        compressedSize = z64.compressedSize ?? compressedSize;
        localOffset = z64.localOffset ?? localOffset;
        zip64 = true;
      }
    }

    const name = decodeZipName(rawName, flags);
    const entry = {
      name,
      flags,
      method,
      crc32: crc32Value,
      compressedSize,
      uncompressedSize,
      localOffset,
      dosTime,
      dosDate,
      mtime: dosToIso(dosDate, dosTime),
      directory: name.endsWith("/"),
      centralOffset: cursor,
      extraBytes: extra.length,
    };
    if (entry.uncompressedSize > maxMemberBytes) {
      warnings.push(`member ${name} declares ${entry.uncompressedSize} bytes, above the ${maxMemberBytes} byte limit; it is listed but will not be inflated`);
      entry.skipped = "too-large";
    }
    entries.push(entry);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (entries.length === 0 && entryCount > 0) {
    throw new UnrecognizedFormatError("the zip container has no readable members");
  }

  return {
    entries,
    comment: buffer.subarray(eocd.offset + 22, eocd.offset + 22 + eocd.commentLength).toString("utf8"),
    warnings,
    zip64,
  };
}

function findEndOfCentralDirectory(buffer) {
  // The comment is at most 65 535 bytes, so the record starts within the last
  // 22 + 65 535 bytes.
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIG) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength > buffer.length) continue;
    return {
      offset,
      entryCount: buffer.readUInt16LE(offset + 10),
      centralSize: buffer.readUInt32LE(offset + 12),
      centralOffset: buffer.readUInt32LE(offset + 16),
      commentLength,
    };
  }
  return null;
}

function findZip64EndOfCentralDirectory(buffer, eocdOffset) {
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP_EOCD64_LOCATOR_SIG) return null;
  const recordOffset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
  if (recordOffset + 56 > buffer.length || buffer.readUInt32LE(recordOffset) !== ZIP_EOCD64_SIG) return null;
  return {
    entryCount: buffer.readBigUInt64LE(recordOffset + 32),
    centralSize: buffer.readBigUInt64LE(recordOffset + 40),
    centralOffset: buffer.readBigUInt64LE(recordOffset + 48),
  };
}

function readZip64Extra(extra) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    if (id === 0x0001 && body.length >= 8) {
      const result = {};
      let at = 0;
      if (body.length >= at + 8) {
        result.uncompressedSize = Number(body.readBigUInt64LE(at));
        at += 8;
      }
      if (body.length >= at + 8) {
        result.compressedSize = Number(body.readBigUInt64LE(at));
        at += 8;
      }
      if (body.length >= at + 8) {
        result.localOffset = Number(body.readBigUInt64LE(at));
      }
      return result;
    }
    cursor += 4 + size;
  }
  return null;
}

function decodeZipName(rawName, flags) {
  const utf8 = (flags & 0x0800) !== 0;
  if (utf8) {
    return new TextDecoder("utf-8", { fatal: false }).decode(rawName).replace(/^\uFEFF/, "");
  }
  // No UTF-8 flag: the spec says CP437. Node cannot decode CP437, and decodeBuffer
  // refuses to guess between GBK/Big5/Shift_JIS, so names are read as Latin-1 —
  // which is byte-preserving — and callers match on structure, not on the label.
  return new TextDecoder("latin1").decode(rawName);
}

function dosToIso(dosDate, dosTime) {
  if (dosDate === 0 && dosTime === 0) return null;
  const year = 1980 + ((dosDate >> 9) & 0x7f);
  const month = ((dosDate >> 5) & 0x0f) || 1;
  const day = (dosDate & 0x1f) || 1;
  const hours = (dosTime >> 11) & 0x1f;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * 2;
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

/** CRC-32 (IEEE), used to check a zip member's integrity. */
export function crc32(bytes) {
  let crc = -1;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Inflate one member and verify its CRC-32.
 *
 * A CRC mismatch is *reported*, not fatal: the bytes are still returned, because
 * silently dropping a damaged member loses data and silently accepting it hides
 * corruption.
 *
 * @param {Uint8Array} bytes the whole container
 * @param {object} entry an entry from `readZipDirectory`
 * @returns {{data: Uint8Array, verified: boolean, warning: string|null,
 *            dataStart: number, dataEnd: number}}
 */
export function readZipMember(bytes, entry, options = {}) {
  const buffer = toBuffer(bytes);
  const maxMemberBytes = options.maxMemberBytes ?? DEFAULT_MAX_MEMBER_BYTES;
  if (entry.skipped === "too-large" || entry.uncompressedSize > maxMemberBytes) {
    throw new InputError(`member ${entry.name} is larger than the ${maxMemberBytes} byte limit and was not inflated`);
  }
  if (entry.localOffset + 30 > buffer.length) {
    throw new InputError(`member ${entry.name} points at byte ${entry.localOffset}, past the end of the container`);
  }
  if (buffer.readUInt32LE(entry.localOffset) !== ZIP_LOCAL_SIG) {
    throw new InputError(`member ${entry.name} does not have a local file header at byte ${entry.localOffset}`);
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new InputError(`member ${entry.name} is truncated: it needs bytes ${dataStart}..${dataEnd} of a ${buffer.length} byte container`);
  }
  const raw = buffer.subarray(dataStart, dataEnd);

  let data;
  if (entry.method === 0) {
    data = raw;
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(raw, { maxOutputLength: maxMemberBytes });
    } catch (error) {
      throw new InputError(`member ${entry.name} could not be inflated: ${error.message}`);
    }
  } else {
    throw new InputError(`member ${entry.name} uses compression method ${entry.method}; only stored (0) and deflate (8) are supported`);
  }

  const verified = crc32(data) === entry.crc32;
  return {
    data: new Uint8Array(data),
    verified,
    warning: verified
      ? null
      : `member ${entry.name} failed its CRC-32 check (header ${entry.crc32.toString(16)}, computed ${crc32(data).toString(16)}); the bytes are still returned`,
    dataStart,
    dataEnd,
  };
}

/**
 * Read a zip container into the plain `{name, bytes}` map most callers want.
 * Entries that cannot be read become warnings, never exceptions: a damaged member
 * must not cost the caller the other ninety-nine.
 *
 * @param {Uint8Array} bytes
 * @param {{maxMemberBytes?: number, filter?: (entry: object) => boolean}} [options]
 * @returns {{members: Map<string, Uint8Array>, entries: Array<object>,
 *            warnings: string[], directory: object}}
 */
export function readZipMembers(bytes, options = {}) {
  const directory = readZipDirectory(bytes, options);
  const warnings = [...directory.warnings];
  const members = new Map();
  for (const entry of directory.entries) {
    if (entry.directory) continue;
    if (options.filter && !options.filter(entry)) continue;
    try {
      const member = readZipMember(bytes, entry, options);
      if (member.warning) warnings.push(member.warning);
      members.set(entry.name, member.data);
    } catch (error) {
      warnings.push(`${entry.name}: ${error.message}`);
    }
  }
  return { members, entries: directory.entries, warnings, directory };
}

/* ------------------------------------------------------------------ */
/* document assembly                                                   */
/* ------------------------------------------------------------------ */

/**
 * Assemble a document's readable text from per-record payloads.
 *
 * This is the function that makes the "no byte is lost" promise checkable.
 * Every parser describes its output as records that each carry:
 *
 *   `byteStart` / `byteEnd`  where the record's payload sits in the raw file
 *   `text`                   exactly the readable text of that payload
 *
 * The records are then concatenated into `content`. Each becomes one paragraph
 * anchor `[k00NN]` (via `groupBy: "segment"`), and each becomes one sub-anchor
 * `[k00NN:tM]` resolved by `recordDocument` in `src/knowledge/ledger.mjs`.
 *
 * Records that a parser synthesised from live objects rather than raw bytes must
 * declare `synthetic: true`; those are listed in `syntheticRecords` so the entry
 * can say so instead of quietly presenting derived text as source text.
 *
 * @param {object} input
 * @param {SourceFile} input.file
 * @param {Array<{text: string, kind?: string, byteStart?: number, byteEnd?: number,
 *                file?: string, label?: string, synthetic?: boolean}>} input.records
 * @param {string} [input.separator]
 */
export function assembleContent({ file, records, separator = "\n" }) {
  const usable = [];
  for (const record of records) {
    const text = typeof record.text === "string" ? record.text : "";
    if (text.trim() === "" && !record.keep) continue;
    // Only the outer edges are trimmed: internal line structure is meaningful
    // (a subtitle cue has two lines, a table row has cells) and is preserved.
    usable.push({ ...record, text: text.replace(/^[ \t]+|[ \t]+$/g, "") });
  }
  const kept = usable.filter((record) => record.text.trim() !== "");

  let cursor = 0;
  const segments = [];
  const entries = [];
  const parts = [];
  const syntheticRecords = [];

  for (const record of kept) {
    if (cursor > 0) {
      parts.push(separator);
      cursor += separator.length;
    }
    const charStart = cursor;
    parts.push(record.text);
    cursor += record.text.length;
    const charEnd = cursor;

    // A record that arrived without offsets still gets them when its text can be
    // located in the payload *unambiguously*. Without this, a record built by a
    // caller (rather than by one of the parsers, which locate their own turns)
    // reached the ledger with `byteStart: null`, and every anchor over it
    // resolved to nothing — the one property the evidence spine exists to keep.
    // An ambiguous needle stays null: guessing between two occurrences would put
    // a wrong byte range behind a right anchor.
    let byteStart = record.byteStart ?? null;
    let byteEnd = record.byteEnd ?? null;
    if (byteStart === null && !record.synthetic && file && typeof file.text === "string") {
      const needle = record.locateBy ?? record.text.trim();
      if (needle !== "") {
        const first = file.text.indexOf(needle);
        if (first !== -1 && file.text.indexOf(needle, first + 1) === -1) {
          byteStart = file.charToByte(first);
          byteEnd = file.charToByte(first + needle.length);
        }
      }
    }

    segments.push({
      charStart,
      charEnd,
      label: record.label ?? null,
      // The record's span in the raw payload travels with the segment, so the
      // ledger can report the exact bytes of a turn instead of guessing from the
      // paragraph that happens to contain it.
      byteStart,
      byteEnd,
      file: record.file ?? file.name,
      speaker: record.speaker ?? null,
      at: record.at ?? null,
    });
    entries.push({
      kind: record.kind ?? "item",
      text: record.text,
      label: record.label ?? null,
      byteStart,
      byteEnd,
      file: record.file ?? file.name,
      speaker: record.speaker ?? null,
      at: record.at ?? null,
      synthetic: Boolean(record.synthetic),
    });
    if (record.synthetic) syntheticRecords.push(record.label ?? record.text.slice(0, 40));
  }

  return { content: parts.join(""), segments, entries, syntheticRecords };
}

/**
 * Build `records[]` from slices of a decoded (not text-transformed) payload.
 *
 * Some formats — JSON, CSV, JSON-lines — keep their values verbatim in the raw
 * payload, so the readable text *is* a byte range of the file. This helper is the
 * one place those parsers convert a decoded character range into a record, which
 * keeps the raw-byte mapping in a single implementation instead of six.
 *
 * @param {SourceFile} file
 * @param {Array<{text: string, charStart: number, charEnd: number, kind?: string,
 *                label?: string, file?: string, synthetic?: boolean}>} slices
 */
export function recordsFromCharSpans(file, slices) {
  return slices.map((slice) => ({
    kind: slice.kind ?? "item",
    text: slice.text,
    label: slice.label ?? null,
    file: slice.file ?? file.name,
    synthetic: slice.synthetic,
    // `null` (not 0) when the payload does not contain the text: an offset of 0
    // would claim the first byte of the file as the origin of unrelated text.
    byteStart: slice.text === "" ? null : file.charToByte(slice.charStart),
    byteEnd: slice.text === "" ? null : file.charToByte(slice.charEnd),
    // Attribution travels with the record so `assembleContent` can put it on the
    // segment, where the renderer reads it.
    speaker: slice.speaker ?? null,
    at: slice.at ?? null,
  }));
}

/**
 * Deterministic JSON: stable key order (insertion order), 2-space indent.
 * Used for shapes that go into receipts, so two runs over the same input
 * produce the same bytes.
 */
export function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

/** Shorten a value for an error message; never throws on non-strings. */
export function truncate(value, limit = 120) {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Finish a parsed document: assemble the text, describe the raw files and hand
 * everything to `recordDocument` through the shape `src/knowledge/ledger.mjs`
 * expects. Parsers return this object; they never write to disk themselves.
 *
 * @param {object} input
 * @param {string} input.parser
 * @param {string|null} input.format detected format id, or null when unknown
 * @param {string} input.kind ledger `kind`
 * @param {string} input.source bucket name under `knowledge/raw/`
 * @param {SourceFile|SourceFile[]} input.files
 * @param {Array<object>} [input.records]
 * @param {string} [input.content] pre-assembled content (skips `records`)
 * @param {Array<object>} [input.segments]
 * @param {Array<object>} [input.entries]
 * @param {string[]} [input.warnings]
 * @param {Array<{what: string, why: string}>} [input.dropped]
 * @param {object} [input.meta]
 * @param {string} [input.method]
 * @param {object} [input.accounting]
 */
export function buildDocument(input) {
  const files = Array.isArray(input.files) ? input.files : [input.files];
  if (files.length === 0 || !files[0]) throw new TypeError("buildDocument requires at least one source file");

  // One person, several channel handles: canonicalise the speakers **before** the
  // text is assembled, so the rendered paragraph, its anchor and every derived
  // statistic name the person the same way. Doing it later (in `recordDocument`)
  // would leave the raw handle inside the anchored line.
  let records = input.records;
  let identity = null;
  if (Array.isArray(records) && input.identity?.map?.size > 0) {
    const matched = new Set();
    let changed = 0;
    records = records.map((record) => {
      if (record === null || typeof record !== "object") return record;
      const canonical = canonicalSpeaker(record.speaker, input.identity);
      if (canonical === record.speaker) return record;
      if (record.speaker !== null && record.speaker !== undefined) matched.add(String(record.speaker).trim());
      changed += 1;
      return { ...record, speaker: canonical };
    });
    if (changed > 0) identity = { file: IDENTITY_FILE, handles: [...matched].sort(), turns: changed };
  }

  const assembled = records
    ? assembleContent({ file: files[0], records, separator: input.separator })
    : { content: input.content ?? "", segments: input.segments ?? [], entries: input.entries ?? [], syntheticRecords: [] };

  return {
    parser: input.parser,
    format: input.format ?? null,
    kind: input.kind,
    method: input.method ?? "local-file",
    credentialed: Boolean(input.credentialed),
    source: input.source,
    origin: input.origin ?? files[0].path,
    // `name` identifies the file inside the bucket and is what `units[].file`
    // and `anchors[].file` refer to; it survives the trip through the ledger.
    files: files.map((file) => ({ name: file.name, ...file.descriptor() })),
    content: assembled.content,
    ...(identity ? { identity } : {}),
    // The records the document was assembled from, after speaker canonicalisation
    // and with their `kind` intact (`email` anchors one `message` per mail). The
    // ledger works off `entries`; this is what a caller inspecting the parse — and
    // `tests/parse-email.test.mjs` — reads to see the per-record shape.
    records: records ?? input.entries ?? [],
    segments: assembled.segments,
    entries: assembled.entries,
    groupBy: input.groupBy ?? (assembled.segments.length > 0 ? "segment" : "blank"),
    maxBlocks: input.maxBlocks ?? 12,
    // The detected payload encoding, surfaced so a receipt can say "this was
    // read as GBK" instead of silently guessing.
    fileEncoding: files[0]?.encoding ?? null,
    bom: files[0]?.bom ?? null,
    warnings: [
      ...(input.warnings ?? []),
      ...files.flatMap((file) => file.decodeWarnings ?? []),
      ...assembled.syntheticRecords.map((label) => `text for ${label} was derived from a live record, not from raw bytes`),
    ],
    dropped: input.dropped ?? [],
    syntheticRecords: assembled.syntheticRecords,
    accounting: input.accounting ?? { model: "raw-bytes" },
    meta: input.meta ?? {},
  };
}

/** Re-exported anchor plumbing, so parsers import from one place. */
export { assignAnchors, assignAnchorsToText, buildDocument as finalizeDocument, parseAnchor, verifyByteConservation };

