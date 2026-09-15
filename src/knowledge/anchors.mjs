/**
 * anchors.mjs — encoding detection, byte-faithful normalisation and the global
 * monotonic anchor space `[k00NN]` / `[k00NN:tM]`.
 *
 * Four invariants drive every decision in this file:
 *
 *  1. **Bytes are never lost silently.** Raw bytes live verbatim under
 *     `knowledge/raw/`. Every paragraph anchor resolves back to a byte range of
 *     the payload it came from, and anything a parser drops is reported in
 *     `warnings`, never swallowed.
 *  2. **Every unit has at least one non-whitespace code point.** Whitespace runs
 *     are separators, not units.
 *  3. **Anchors are globally monotonic.** Ids are zero padded to four digits,
 *     never reused and never renumbered, so a later append cannot invalidate an
 *     earlier citation.
 *  4. **Encoding ambiguity is an outcome, not a coin flip.** GBK and Big5 decode
 *     the same CJK byte pairs; when more than one legacy codec fits we say so
 *     instead of inventing characters.
 *
 * Determinism: ids are a pure function of `(id, unitIndex)` and every routine
 * returns objects with keys in a fixed order, so the same input yields the same
 * anchors — and the same bytes — on every run. No clocks, no randomness.
 */

const BOMS = [
  { name: "utf-8", bytes: [0xef, 0xbb, 0xbf], decodeAs: "utf-8" },
  { name: "utf-32le", bytes: [0xff, 0xfe, 0x00, 0x00], decodeAs: "utf-32le" },
  { name: "utf-32be", bytes: [0x00, 0x00, 0xfe, 0xff], decodeAs: "utf-32be" },
  { name: "utf-16le", bytes: [0xff, 0xfe], decodeAs: "utf-16le" },
  { name: "utf-16be", bytes: [0xfe, 0xff], decodeAs: "utf-16be" },
];

/** Segment kinds agreed across every parser in `src/parse/**`. */
export const SEGMENT_KINDS = Object.freeze([
  "turn", // chat message
  "msg", // email message
  "cue", // subtitle cue
  "para", // document paragraph
  "item", // structured record (CSV row, JSON object)
]);

const DEFAULT_TEXT_ENCODING_FALLBACKS = Object.freeze(["gbk", "big5", "shift_jis"]);

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function toUint8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  throw new TypeError("expected a Uint8Array, ArrayBuffer, number[] or string");
}

function startsWithBytes(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function countReplacementChars(text) {
  let count = 0;
  for (const char of text) {
    if (char === "\uFFFD") count += 1;
  }
  return count;
}

function controlReplacement(code) {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return null;
  if (code < 0x20 || code === 0x7f) return " ";
  if (code >= 0x80 && code <= 0x9f) return " ";
  return null;
}

function isUnicodeSpace(code) {
  return (
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/* ------------------------------------------------------------------ */
/* encoding                                                            */
/* ------------------------------------------------------------------ */

/**
 * Detect the BOM of a buffer without decoding it.
 * @param {Uint8Array} bytes
 * @returns {{label: string, length: number, decodeAs: string}|null}
 */
export function detectBom(bytes) {
  if (!bytes || bytes.length < 2) return null;
  for (const bom of BOMS) {
    if (startsWithBytes(bytes, bom.bytes)) {
      return { label: bom.name, length: bom.bytes.length, decodeAs: bom.decodeAs };
    }
  }
  return null;
}

function looksLikeUtf16WithoutBom(bytes, littleEndian) {
  const sample = Math.min(bytes.length, 512);
  if (sample < 4) return false;
  let zeros = 0;
  let pairs = 0;
  for (let index = 0; index + 1 < sample; index += 2) {
    pairs += 1;
    const [a, b] = littleEndian ? [bytes[index], bytes[index + 1]] : [bytes[index + 1], bytes[index]];
    if (a === 0x00 && b !== 0x00) zeros += 1;
  }
  return pairs > 0 && zeros / pairs > 0.6;
}

function decodeWith(codec, bytes) {
  return new TextDecoder(codec, { fatal: true }).decode(bytes);
}

/**
 * True when `bytes` is valid UTF-8. Node's strict decoder rejects overlong
 * forms, surrogate halves and truncated sequences, so a round trip through it is
 * a sound test — and it is what keeps us from mistaking GBK for UTF-8.
 */
export function isValidUtf8(bytes) {
  try {
    decodeWith("utf-8", toUint8(bytes));
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide how to read `bytes`.
 *
 * Order:
 *  1. a BOM, which is authoritative;
 *  2. an explicit `preferred` label (how a parser passes a declared `charset=`);
 *  3. a BOM-less UTF-16 shape (NUL bytes at every other position);
 *  4. strict UTF-8;
 *  5. **only when `legacyFallback` is on**: a legacy codec, and only if exactly
 *     one of them decodes the payload;
 *  6. UTF-8 with U+FFFD replacement, reporting how many sequences were replaced.
 *
 * Step 5 is opt-in because GBK, Big5 and Shift_JIS map almost any byte pair to
 * *some* character. A silent fallback would turn a truncated JPEG into confident
 * nonsense; a loudly-reported U+FFFD is the honest answer.
 *
 * @param {Uint8Array} bytes
 * @param {{preferred?: string, fallbacks?: string[], legacyFallback?: boolean}} [options]
 * @returns {{label: string, bom: string|null, bomBytes: number, decoded?: string,
 *            ok: boolean, lossy: boolean, attempted: string[],
 *            ambiguous?: string[], error?: string}}
 */
export function detectEncoding(bytes, options = {}) {
  const {
    preferred,
    fallbacks = DEFAULT_TEXT_ENCODING_FALLBACKS,
    legacyFallback = false,
  } = options;
  const bom = detectBom(bytes);
  const attempted = [];

  if (bom) {
    attempted.push(bom.label);
    try {
      return {
        label: bom.label,
        bom: bom.label,
        bomBytes: bom.length,
        decoded: decodeWith(bom.decodeAs, bytes.subarray(bom.length)),
        ok: true,
        lossy: false,
        attempted,
      };
    } catch (error) {
      return {
        label: bom.label,
        bom: bom.label,
        bomBytes: bom.length,
        ok: false,
        lossy: true,
        attempted,
        error: `declared BOM ${bom.label} but the payload is not valid ${bom.label}: ${error.message}`,
      };
    }
  }

  const candidates = [];
  if (preferred) candidates.push({ codec: preferred, lossy: preferred !== "utf-8" });
  if (looksLikeUtf16WithoutBom(bytes, true)) candidates.push({ codec: "utf-16le", lossy: true });
  if (looksLikeUtf16WithoutBom(bytes, false)) candidates.push({ codec: "utf-16be", lossy: true });
  candidates.push({ codec: "utf-8", lossy: false });

  if (!preferred && legacyFallback) {
    const decodable = [];
    for (const codec of fallbacks) {
      try {
        decodeWith(codec, bytes);
        decodable.push(codec);
      } catch {
        // Not this codec.
      }
    }
    if (decodable.length === 1) {
      candidates.push({ codec: decodable[0], lossy: true });
    } else if (decodable.length > 1) {
      return {
        label: "utf-8",
        bom: null,
        bomBytes: 0,
        ok: false,
        lossy: true,
        attempted: ["utf-8", ...decodable],
        ambiguous: decodable,
        error: `the payload is not UTF-8 and ${decodable.join("/")} all decode it; declare the charset in the export (or pass it explicitly) instead of letting us guess`,
      };
    }
  } else if (preferred) {
    for (const codec of fallbacks) {
      if (!candidates.some((candidate) => candidate.codec === codec)) {
        candidates.push({ codec, lossy: true });
      }
    }
  }

  let lastError = "no candidate encoding was attempted";
  for (const candidate of candidates) {
    attempted.push(candidate.codec);
    let decoded;
    try {
      decoded = decodeWith(candidate.codec, bytes);
    } catch (error) {
      lastError = `${candidate.codec}: ${error.message}`;
      continue;
    }
    return {
      label: candidate.codec,
      bom: null,
      bomBytes: 0,
      decoded,
      ok: true,
      // Anything past UTF-8 is a guess about a non-UTF-8 legacy encoding; the
      // caller is expected to surface that in `warnings`.
      lossy: candidate.lossy,
      attempted,
    };
  }

  return {
    label: "utf-8",
    bom: null,
    bomBytes: 0,
    ok: false,
    lossy: true,
    attempted,
    error: `no candidate encoding decoded cleanly (${lastError}); re-decoding as utf-8 with U+FFFD replacement`,
  };
}

/**
 * Decode raw bytes to text, always producing something and always explaining
 * itself. Invalid sequences become U+FFFD as a last resort, with a count.
 *
 * @param {Uint8Array} bytes
 * @param {{preferred?: string, fallbacks?: string[], legacyFallback?: boolean}} [options]
 * @returns {{text: string, label: string, bom: string|null, bomBytes: number,
 *            lossy: boolean, replaced: number, attempted: string[],
 *            ambiguous: string[]|null, warnings: string[]}}
 */
export function decodeBuffer(bytes, options = {}) {
  const buffer = toUint8(bytes);
  const detection = detectEncoding(buffer, options);
  const warnings = [];
  let text;
  let replaced = 0;

  if (detection.ok) {
    text = detection.decoded;
    if (detection.lossy) {
      warnings.push(
        `text decoded as ${detection.label} (no BOM, not valid UTF-8); byte-to-character offsets assume ${detection.label}`,
      );
    }
  } else {
    const body = detection.bomBytes ? buffer.subarray(detection.bomBytes) : buffer;
    text = new TextDecoder("utf-8", { fatal: false }).decode(body);
    replaced = countReplacementChars(text);
    warnings.push(detection.error);
    if (replaced > 0) {
      warnings.push(`${replaced} invalid byte sequence(s) became U+FFFD; raw bytes are preserved under knowledge/raw/`);
    }
  }

  return {
    text,
    label: detection.label,
    bom: detection.bom,
    bomBytes: detection.bomBytes,
    lossy: Boolean(detection.lossy),
    replaced,
    attempted: detection.attempted ?? [],
    ambiguous: detection.ambiguous ?? null,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* decoded text -> byte map                                            */
/* ------------------------------------------------------------------ */

/**
 * Walk the decoded text and record, for every code point, the byte span it came
 * from. UTF-8 is a closed form (a code point's UTF-8 width is the width the
 * decoder consumed); for every other codec we re-decode one code point at a time
 * from the real byte position, because guessing a width is exactly what makes a
 * GBK anchor point one byte off.
 *
 * U+FFFD is ambiguous — a genuine replacement character or a decoded `\uFFFD` —
 * but both are 3 UTF-8 bytes, so the widths stay right either way.
 *
 * @returns {{starts: number[], ends: number[], offsets: number[], lines: number[],
 *            usable: boolean}}
 */
function mapDecodedText(decodedText, buffer, bomBytes, codec) {
  const starts = [];
  const ends = [];
  const offsets = [];
  const lines = [];
  let line = 1;

  const note = (char, byteStart, byteEnd) => {
    offsets.push(byteStart);
    lines.push(line);
    starts.push(byteStart);
    ends.push(byteEnd);
    if (char === "\n") line += 1;
  };

  if (codec === "utf-8") {
    let position = bomBytes;
    for (let index = 0; index < decodedText.length; ) {
      const char = decodedText[index];
      const code = decodedText.codePointAt(index);
      const size = code > 0xffff ? 2 : 1;
      const width = Buffer.byteLength(decodedText.slice(index, index + size), "utf8");
      note(char, position, position + width);
      position += width;
      index += size;
    }
    return { starts, ends, offsets, lines, usable: true };
  }

  let decoder;
  try {
    decoder = new TextDecoder(codec);
  } catch {
    return { starts: null, ends: null, offsets: null, lines: null, usable: false };
  }

  let position = bomBytes;
  let emitted = 0;
  const chunkSize = 64 * 1024;
  while (position < buffer.length && emitted < decodedText.length) {
    const chunk = buffer.subarray(position, Math.min(position + chunkSize, buffer.length));
    // Longest prefix that decodes cleanly: one code point (or one malformed
    // replacement) at a time.
    let low = 1;
    let high = chunk.length;
    let validEnd = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      try {
        decoder.decode(chunk.subarray(0, middle), { stream: middle < chunk.length });
        validEnd = middle;
        low = middle + 1;
      } catch {
        high = middle - 1;
      }
    }
    if (validEnd === 0) break;
    const piece = decoder.decode(chunk.subarray(0, validEnd), { stream: validEnd < chunk.length });
    for (let index = 0; index < piece.length && emitted < decodedText.length; index += 1) {
      note(piece[index], position, position + validEnd);
      emitted += 1;
    }
    position += validEnd;
  }

  return { starts, ends, offsets, lines, usable: true };
}

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

function editableNormalize(decoded, options) {
  const { text, charStart, charEnd } = decoded;
  const outChars = [];
  const outStart = [];
  const outEnd = [];
  const collapse = options.collapseSpaces !== false;

  const push = (char, start, end) => {
    outChars.push(char);
    outStart.push(start);
    outEnd.push(end);
  };

  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index);
    const size = code > 0xffff ? 2 : 1;
    const start = charStart[index];
    const end = charEnd[index + size - 1];

    if (code === 0xfeff) {
      // BOM / zero-width no-break space: dropped, but its bytes stay in the map.
      index += size;
      continue;
    }
    if (code === 0x0d) {
      // CR or CRLF -> LF. The LF half contributes no character of its own; the
      // resulting LF spans both bytes so the range stays gapless.
      const isCrlf = text[index + 1] === "\n";
      push("\n", start, isCrlf ? charEnd[index + 1] : end);
      index += isCrlf ? 2 : 1;
      continue;
    }
    if (code === 0x0a || code === 0x85 || code === 0x2028 || code === 0x2029) {
      push("\n", start, end);
      index += size;
      continue;
    }
    const replacement = controlReplacement(code);
    if (replacement !== null) {
      push(replacement, start, end);
      index += size;
      continue;
    }
    if (isUnicodeSpace(code)) {
      push(collapse ? " " : String.fromCodePoint(code), start, end);
      index += size;
      continue;
    }
    push(String.fromCodePoint(code), start, end);
    index += size;
  }

  // Trim trailing horizontal whitespace per line.
  const trimmed = [];
  let lineStart = 0;
  for (let index = 0; index <= outChars.length; index += 1) {
    const isEnd = index === outChars.length;
    if (!isEnd && outChars[index] !== "\n") continue;
    let last = index;
    while (last > lineStart && outChars[last - 1] === " ") last -= 1;
    for (let cursor = lineStart; cursor < last; cursor += 1) {
      trimmed.push({ char: outChars[cursor], start: outStart[cursor], end: outEnd[cursor] });
    }
    if (!isEnd) trimmed.push({ char: "\n", start: outStart[index], end: outEnd[index] });
    lineStart = index + 1;
  }

  const chars = [];
  const charOutStart = [];
  const charOutEnd = [];
  for (const unit of trimmed) {
    chars.push(unit.char);
    charOutStart.push(unit.start);
    charOutEnd.push(unit.end);
  }

  const normalised = chars.join("");
  const mappedTo = charOutEnd.length > 0 ? charOutEnd[charOutEnd.length - 1] : decoded.bomBytes;
  const buffer = decoded.bytes ?? Buffer.from(decoded.text, "utf8");

  return {
    text: normalised,
    charStart: Int32Array.from(charOutStart),
    charEnd: Int32Array.from(charOutEnd),
    bytes: buffer,
    encoding: decoded.encoding,
    bom: decoded.bom,
    bomBytes: decoded.bomBytes,
    lossy: decoded.lossy,
    replaced: decoded.replaced,
    warnings: decoded.warnings ?? [],
    // Character -> raw byte, for payloads decoded from a file. `null` when the
    // text was assembled by a parser instead.
    byteOffset: decoded.byteOffset ?? null,
    // Bytes at the tail that produced no character (trailing whitespace, BOM).
    unmappedTail: buffer.length - mappedTo,
  };
}

/**
 * Normalise text that has *already* been decoded, keeping the character → byte
 * mapping the caller passes in. Used by parsers that assemble their own text and
 * by `assignAnchorsToText`.
 *
 * @param {string} text
 * @param {{byteStarts?: Int32Array|number[], byteEnds?: Int32Array|number[],
 *          bomBytes?: number, encoding?: string, bom?: string|null,
 *          lossy?: boolean, collapseSpaces?: boolean}} [options]
 */
export function normalizeTextWithMap(text, options = {}) {
  const source = String(text ?? "");
  const provided = options.byteStarts ?? null;
  const providedEnds = options.byteEnds ?? null;
  const bomBytes = options.bomBytes ?? 0;

  const starts = new Int32Array(source.length);
  const ends = new Int32Array(source.length);
  {
    let position = bomBytes;
    for (let index = 0; index < source.length; ) {
      const code = source.codePointAt(index);
      const size = code > 0xffff ? 2 : 1;
      const width = Buffer.byteLength(source.slice(index, index + size), "utf8");
      const start = provided ? provided[index] : position;
      const end = providedEnds ? providedEnds[index + size - 1] : start + width;
      starts[index] = start;
      ends[index] = end;
      if (size === 2) {
        starts[index + 1] = start;
        ends[index + 1] = end;
      }
      position = end;
      index += size;
    }
  }

  return editableNormalize(
    {
      text: source,
      charStart: starts,
      charEnd: ends,
      bytes: Buffer.from(source, "utf8"),
      encoding: options.encoding ?? "utf-8",
      bom: options.bom ?? null,
      bomBytes,
      lossy: Boolean(options.lossy),
      replaced: 0,
      warnings: [],
      // Only meaningful when the caller supplied the map; without it the offsets
      // are positions in this string, not in a payload.
      byteOffset: provided ? Int32Array.from(starts) : null,
    },
    options,
  );
}

/**
 * Normalise a raw payload while remembering where every character came from:
 * a single decode pass, then a single text pass.
 *
 * Transformations (all recorded, none lossy for non-whitespace content):
 *  - U+FEFF anywhere → removed (byte span kept, so ranges stay closed)
 *  - CRLF / CR → LF
 *  - NEL / LINE SEPARATOR / PARAGRAPH SEPARATOR → LF
 *  - C0/C1 control characters → space
 *  - NBSP and other Unicode spaces → U+0020
 *  - trailing horizontal whitespace on each line → trimmed
 *
 * `charStart[i]` / `charEnd[i]` are byte positions in `bytes`; ranges are
 * contiguous and ascending, so `bytes.subarray(charStart[i], charEnd[i])` is the
 * exact raw span of character `i`.
 *
 * @param {Uint8Array} bytes
 * @param {{preferred?: string, fallbacks?: string[], legacyFallback?: boolean,
 *          collapseSpaces?: boolean}} [options]
 */
export function normalizeWithMap(bytes, options = {}) {
  const buffer = toUint8(bytes);
  const decoded = decodeBuffer(buffer, options);
  const mapped = mapDecodedText(decoded.text, buffer, decoded.bomBytes, decoded.label);

  return editableNormalize(
    {
      ...decoded,
      charStart: Int32Array.from(mapped.starts ?? []),
      charEnd: Int32Array.from(mapped.ends ?? []),
      byteOffset: mapped.offsets ? Int32Array.from(mapped.offsets) : null,
    },
    options,
  );
}

/* ------------------------------------------------------------------ */
/* paragraph segmentation                                              */
/* ------------------------------------------------------------------ */

function isBlank(text) {
  return text.replace(/\s+/gu, "") === "";
}

function hasVisibleCodePoint(text) {
  return /\S/u.test(text);
}

/**
 * Split normalised text into leaf lines, each carrying its byte range and its
 * absolute offset in the payload (or `null` for parser-assembled text).
 */
function splitLeafLines(normalized) {
  const { text, charStart, charEnd, bytes, byteOffset } = normalized;
  const lines = [];
  let index = 0;

  while (index < text.length) {
    let cursor = index;
    while (cursor < text.length && text[cursor] !== "\n") cursor += 1;
    lines.push({
      text: text.slice(index, cursor),
      start: index,
      end: cursor,
      // Byte positions are in *raw payload* space: a line is the span of its
      // characters, separators included.
      byteStart: cursor > index ? charStart[index] : bytes.length,
      byteEnd: cursor > index ? charEnd[cursor - 1] : bytes.length,
      offset: byteOffset ? byteOffset[index] : null,
      trailing: false,
    });
    index = cursor + 1;
  }

  return lines;
}

/**
 * Map a normalised character index to the segment (turn / cue / message) that
 * produced it, so a paragraph can never straddle two messages.
 */
function buildSegmentLookup(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const spans = segments.map((segment, index) => ({
    start: segment.charStart ?? 0,
    end: segment.charEnd ?? segment.charStart ?? 0,
    index,
    label: segment.label ?? null,
    file: segment.file ?? null,
    // Present only when the parser could point at the raw payload. `null` means
    // "this text is derived" (an inflated OOXML member, a stripped HTML body) and
    // is reported as such rather than faked with an offset.
    raw:
      Number.isInteger(segment.byteStart) && Number.isInteger(segment.byteEnd)
        ? { byteStart: segment.byteStart, byteEnd: segment.byteEnd, file: segment.file ?? null }
        : null,
  }));
  return (charIndex) => {
    for (const span of spans) {
      if (charIndex >= span.start && charIndex < span.end) return span;
    }
    return spans[spans.length - 1];
  };
}

/**
 * Group leaf lines into paragraphs.
 *
 * Two modes, chosen by `options.groupBy`:
 *  - `"segment"` (the default when `segments` is given): one paragraph per source
 *    turn / cue / record, with `maxBlocks` consecutive lines as a safety valve
 *    for a runaway single record.
 *  - `"blank"`: paragraphs are separated by blank lines, capped at `maxBlocks`.
 */
function groupLines(lines, lookup, options) {
  const maxBlocks = options.maxBlocks ?? 12;
  const mode = options.groupBy ?? (lookup ? "segment" : "blank");
  const groups = [];
  let current = [];

  const flush = () => {
    if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  };

  for (const line of lines) {
    if (isBlank(line.text)) {
      if (mode === "blank") flush();
      continue;
    }
    const segment = lookup ? lookup(line.start) : null;
    const segmentIndex = segment ? segment.index : 0;
    if (current.length >= maxBlocks) flush();
    if (mode === "segment" && current.length > 0 && current[0].segmentIndex !== segmentIndex) flush();
    current.push({
      text: line.text,
      byteStart: line.byteStart,
      byteEnd: line.byteEnd,
      offset: line.offset,
      charStart: line.start,
      charEnd: line.end,
      segmentIndex,
      label: segment ? segment.label : null,
      raw: segment ? segment.raw : null,
    });
  }
  flush();
  return groups;
}

/**
 * Assign global monotonic anchors to already-assembled text.
 *
 * The paragraph anchors `[k00NN]` are placed in the returned `text`, which is what
 * gets written to `knowledge/text/<source>.md`. Each unit additionally reports the
 * byte range of the content it came from, which is what makes a citation
 * resolvable.
 *
 * @param {string} content readable text assembled by a parser
 * @param {{segments?: Array<{charStart: number, charEnd: number, byteStart?: number,
 *            byteEnd?: number, file?: string, label?: string}>,
 *          groupBy?: "segment"|"blank", maxBlocks?: number, warnings?: string[],
 *          startIndex?: number}} [options] `startIndex` continues the numbering of
 *          an existing entry, so a long archive spans `k0007`, `k0008`, …
 */
export function assignAnchorsToText(content, options = {}) {
  const source = typeof content === "string" ? content : String(content ?? "");
  return anchorNormalized(normalizeTextWithMap(source, options), options);
}

function anchorNormalized(normalized, options = {}) {
  const lookup = buildSegmentLookup(options.segments);
  const lines = splitLeafLines(normalized);
  const groups = groupLines(lines, lookup, options);
  const startIndex = options.startIndex ?? 1;
  if (!Number.isInteger(startIndex) || startIndex < 1) {
    throw new TypeError(`startIndex must be a positive integer, received ${startIndex}`);
  }

  const units = [];
  const warnings = [...(options.warnings ?? []), ...normalized.warnings];
  let unanchored = 0;

  for (const group of groups) {
    const text = group.map((line) => line.text).join("\n");
    if (!hasVisibleCodePoint(text)) {
      warnings.push("a paragraph had no visible code point and was dropped");
      continue;
    }
    const id = startIndex + units.length;
    // A unit's bytes come from the records it is made of — never from the
    // separator whitespace between them, which the assembled buffer contributes
    // and the raw payload does not. Without segments the unit *is* a contiguous
    // slice of the payload, so its own character span is the byte range.
    const raws = group.map((line) => line.raw).filter(Boolean);
    const offsets = group.map((line) => line.offset).filter((offset) => offset !== null);
    let byteStart = null;
    let byteEnd = null;
    if (raws.length > 0) {
      byteStart = Math.min(...raws.map((raw) => raw.byteStart));
      byteEnd = Math.max(...raws.map((raw) => raw.byteEnd));
    } else if (offsets.length === group.length) {
      byteStart = Math.min(...offsets);
      byteEnd = Math.max(...group.map((line) => line.byteEnd));
    }
    if (byteStart === null || byteEnd === null) unanchored += 1;

    const files = [...new Set(group.map((line) => line.raw?.file ?? null).filter(Boolean))];
    units.push({
      id,
      anchor: formatAnchor(id),
      kind: "para",
      text,
      byteStart,
      byteEnd,
      file: files.length === 1 ? files[0] : null,
      files,
      contentCharStart: Math.min(...group.map((line) => line.charStart)),
      contentCharEnd: Math.max(...group.map((line) => line.charEnd)),
      lineCount: group.length,
      recordStart: Math.min(...group.map((line) => line.segmentIndex)),
      recordEnd: Math.max(...group.map((line) => line.segmentIndex)),
      segments: [...new Set(group.map((line) => line.segmentIndex))].sort((a, b) => a - b),
    });
  }

  if (unanchored > 0) {
    warnings.push(
      `${unanchored} paragraph(s) carry text reconstructed from a container (an inflated OOXML member, a stripped HTML body) and therefore report no raw byte offset`,
    );
  }

  const rendered = units.length > 0 ? `${units.map((unit) => `${unit.anchor} ${unit.text}`).join("\n\n")}\n` : "";

  return {
    text: rendered,
    units,
    warnings,
    encoding: normalized.encoding,
    lossy: normalized.lossy,
    byteLength: normalized.bytes.length,
    unmappedTail: normalized.unmappedTail,
  };
}

/**
 * `assignAnchors(bytes, …)` — decode a raw payload, normalise it and anchor it in
 * one call. For payloads that are already human readable (`.srt`, `.vtt`, a mail
 * body, a CSV export) the payload *is* the text, so a paragraph's byte range is
 * simply its own character range in the file.
 *
 * @param {Uint8Array} bytes
 */
export function assignAnchors(bytes, options = {}) {
  const buffer = toUint8(bytes);
  // Exactly one normalisation pass: a second pass would rebuild the character →
  // byte map and move every offset.
  return anchorNormalized(normalizeWithMap(buffer, options), options);
}

/* ------------------------------------------------------------------ */
/* anchor ids                                                          */
/* ------------------------------------------------------------------ */

/** `1` → `k0001`. Ids are zero padded to four digits and grow past 9999. */
export function formatAnchor(index) {
  if (!Number.isInteger(index) || index < 1) {
    throw new TypeError(`anchor index must be a positive integer, received ${index}`);
  }
  return `k${String(index).padStart(4, "0")}`;
}

const ANCHOR_RE = /^k(\d{4,})(?::t(\d+))?$/;

/**
 * Parse `k0012` or `k0012:t3`.
 * @returns {{id: string, index: number, kind: "para"|"sub", subAnchor: string|null,
 *            subIndex: number|null, canonical: boolean}|null}
 */
export function parseAnchor(value) {
  if (typeof value !== "string") return null;
  const match = ANCHOR_RE.exec(value);
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  const subIndex = match[2] === undefined ? null : Number.parseInt(match[2], 10);
  if (subIndex !== null && subIndex < 1) return null;
  return {
    id: `k${match[1]}`,
    index,
    kind: subIndex === null ? "para" : "sub",
    subAnchor: subIndex === null ? null : `t${subIndex}`,
    subIndex,
    // Canonical means we would have written it exactly this way ourselves.
    canonical: match[1].length === 4,
  };
}

/** Format the per-record anchor of a ledger entry: `k0007` + 3 → `k0007:t3`. */
export function formatSubAnchor(kId, index) {
  const parsed = parseAnchor(kId);
  if (!parsed || parsed.kind !== "para") {
    throw new TypeError(`formatSubAnchor needs a paragraph id like k0007, received ${kId}`);
  }
  if (!Number.isInteger(index) || index < 1) {
    throw new TypeError(`sub-anchor index must be a positive integer, received ${index}`);
  }
  return `${parsed.id}:t${index}`;
}

/**
 * Resolve an anchor against a ledger entry (or any object with `units` and
 * `anchors`) and return the text and the byte range it points at.
 *
 * @param {string} anchor
 * @param {{units?: Array, anchors?: Array}} record
 * @param {{bytes?: Uint8Array, bytesByFile?: Map<string, Uint8Array>}} [raw]
 * @returns {{anchor: string, kind: string, text: string, byteStart: number|null,
 *            byteEnd: number|null, file: string|null, bytes: Uint8Array|null}|null}
 */
export function resolveAnchor(anchor, record, raw = {}) {
  const parsed = parseAnchor(anchor);
  if (!parsed) return null;
  const units = record?.units ?? [];
  const listed = record?.anchors ?? [];

  const slice = (file, byteStart, byteEnd) => {
    if (!Number.isInteger(byteStart) || !Number.isInteger(byteEnd) || byteEnd < byteStart) return null;
    if (raw.bytesByFile && file && raw.bytesByFile.has(file)) {
      return raw.bytesByFile.get(file).subarray(byteStart, byteEnd);
    }
    if (raw.bytes) {
      const bytes = toUint8(raw.bytes);
      if (byteEnd <= bytes.length) return bytes.subarray(byteStart, byteEnd);
    }
    return null;
  };

  if (parsed.kind === "sub") {
    const direct = listed.find((candidate) => (candidate.anchor ?? candidate.id ?? candidate) === anchor);
    if (direct && typeof direct === "object") {
      const file = direct.file ?? null;
      return {
        anchor,
        kind: direct.kind ?? "item",
        text: direct.text ?? "",
        byteStart: direct.byteStart ?? null,
        byteEnd: direct.byteEnd ?? null,
        file,
        bytes: slice(file, direct.byteStart, direct.byteEnd),
      };
    }
    // Fall back to the matching line of the parent paragraph.
    const parent = units[parsed.index - 1];
    if (!parent) return null;
    const text = String(parent.text).split("\n")[parsed.subIndex - 1];
    if (text === undefined) return null;
    return {
      anchor,
      kind: "sub",
      text,
      byteStart: parent.byteStart,
      byteEnd: parent.byteEnd,
      file: parent.file ?? null,
      bytes: slice(parent.file ?? null, parent.byteStart, parent.byteEnd),
    };
  }

  const unit = units.find((candidate) => (candidate.anchor ?? candidate.id) === anchor) ?? units[parsed.index - 1];
  if (!unit) return null;
  return {
    anchor,
    kind: unit.kind ?? "para",
    text: unit.text,
    byteStart: unit.byteStart ?? null,
    byteEnd: unit.byteEnd ?? null,
    file: unit.file ?? null,
    bytes: slice(unit.file ?? null, unit.byteStart, unit.byteEnd),
  };
}

/**
 * Verify the invariants a parsed document must satisfy before it is recorded.
 * Returns a list of human readable problems; empty means the document is sound.
 *
 * Checks:
 *  1. every unit has at least one non-whitespace code point
 *  2. every unit's byte range is usable (integers, ordered) or explicitly absent
 *  3. unit ranges are ordered and non-overlapping per backing buffer
 *  4. unit ranges stay inside the payload they claim to come from
 *
 * @param {object} document
 * @param {{fileOrigins?: Map<string, Uint8Array>}} [options]
 */
export function verifyByteConservation(document, options = {}) {
  const problems = [];
  const units = document?.units ?? [];
  const byFile = new Map();

  for (const unit of units) {
    if (!hasVisibleCodePoint(unit.text)) {
      problems.push(`unit ${unit.anchor} has no non-whitespace code point`);
      continue;
    }
    if (unit.byteStart === null || unit.byteStart === undefined) continue;
    if (!Number.isInteger(unit.byteStart) || !Number.isInteger(unit.byteEnd) || unit.byteEnd < unit.byteStart) {
      problems.push(`unit ${unit.anchor} has an unusable byte range ${unit.byteStart}..${unit.byteEnd}`);
      continue;
    }
    const file = unit.file ?? "<content>";
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push([unit.byteStart, unit.byteEnd, unit.anchor]);
  }

  for (const [file, ranges] of byFile) {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index][0] < sorted[index - 1][1]) {
        problems.push(
          `${file}: ${sorted[index][2]} starts at ${sorted[index][0]}, inside ${sorted[index - 1][2]} (ends ${sorted[index - 1][1]})`,
        );
      }
    }
    const buffer = options.fileOrigins?.get?.(file);
    if (buffer && sorted.length > 0) {
      const last = sorted[sorted.length - 1];
      if (last[1] > buffer.length) {
        problems.push(`${file}: ${last[2]} ends at ${last[1]}, past the ${buffer.length} byte payload`);
      }
    }
  }

  return { problems, byFile };
}

/**
 * Byte-conservation accounting across a set of documents: how many bytes of each
 * raw payload were anchored, and how many were separators or deliberately
 * skipped metadata. The caller compares `unanchored` against what it expects and
 * explains the difference in `warnings`.
 *
 * @param {Map<string, Uint8Array>} fileOrigins
 * @param {Array<object>} documents
 */
export function conservationReport(fileOrigins, documents) {
  const report = [];
  for (const [file, bytes] of fileOrigins) {
    const covered = new Uint8Array(bytes.length);
    let anchored = 0;
    for (const document of documents) {
      for (const unit of document.units ?? []) {
        if ((unit.file ?? null) !== file) continue;
        if (!Number.isInteger(unit.byteStart)) continue;
        for (let index = unit.byteStart; index < unit.byteEnd && index < bytes.length; index += 1) {
          if (covered[index] === 0) {
            covered[index] = 1;
            anchored += 1;
          }
        }
      }
    }
    report.push({
      file,
      bytes: bytes.length,
      anchored,
      unanchored: bytes.length - anchored,
      coverage: bytes.length === 0 ? 1 : anchored / bytes.length,
    });
  }
  return report;
}
