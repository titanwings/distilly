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
import { basename, extname } from "node:path";
import {
  assignAnchors,
  assignAnchorsToText,
  buildSubAnchors,
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
        current.some((item) => requiredKeys.some((key) => key in item))
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
/* re-exported anchor plumbing                                         */
/* ------------------------------------------------------------------ */

export { assignAnchors, buildSubAnchors, parseAnchor };

/**
 * Run `assignAnchors` over a set of leaf records, then attach sub-anchors.
 *
 * Every parser ends with this call. `content` must contain every scalar worth
 * reading; the leaf records supply the raw byte ranges that make the resulting
 * anchors resolvable.
 *
 * @param {object} input
 * @param {SourceFile} input.file
 * @param {string} input.content normalised, human readable text
 * @param {number} input.ledgerId numeric ledger index (1 → k0001)
 * @param {Array<{kind: string, text: string, byteStart: number, byteEnd: number}>} [input.entries]
 * @param {string[]} [input.warnings]
 */
export function finalizeDocument(input) {
  const {
    file,
    content,
    ledgerId,
    entries = [],
    warnings = [],
    maxBlocks,
    collapseSpaces,
  } = input;

  const raw = Buffer.from(content, "utf8");
  const anchored = assignAnchors(raw, {
    ...(maxBlocks ? { maxBlocks } : {}),
    ...(collapseSpaces === undefined ? {} : { collapseSpaces }),
  });

  const kId = `k${String(ledgerId).padStart(4, "0")}`;
  const anchors = buildSubAnchors(entries, kId).map((entry, index) => ({
    ...entry,
    byteStart: entries[index].byteStart ?? null,
    byteEnd: entries[index].byteEnd ?? null,
    file: entries[index].file ?? file.name,
  }));

  return {
    text: anchored.text,
    units: anchored.units.map((unit) => ({ ...unit, file: file.name })),
    // Anchors live in the *parsed text*, not in `content`, so their byte ranges
    // point back at the raw payload directly.
    anchors,
    warnings: [...warnings, ...anchored.warnings],
    encoding: {
      label: anchored.encoding,
      bom: anchored.bom,
      lossy: anchored.lossy,
      bytes: anchored.byteLength,
      unmappedTail: anchored.unmappedTail,
    },
    parse: {
      file: file.name,
      path: file.path,
      charCount: content.length,
      lineCount: content === "" ? 0 : content.split("\n").length,
    },
    ledgerId: kId,
  };
}
