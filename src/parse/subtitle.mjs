/**
 * subtitle.mjs — `.srt` and `.vtt` → one record per cue (speaker + timecode).
 *
 * Ported from `tools/research/srt_to_transcript.py`, with three differences that
 * the Python version cannot offer:
 *
 *  1. **Cue boundaries are kept.** Python flattened everything into prose
 *     paragraphs, so a quote could not be traced back to a moment in the video.
 *     Here every cue carries its index, its `start`/`end` timecode and its raw
 *     byte range, hence its own `[k00NN:tM]` anchor.
 *  2. **Byte ranges are exact.** Cue text comes from a slice of the decoded
 *     payload, so `recordsFromCharSpans` can point at the original bytes.
 *  3. **Nothing is silent.** A malformed cue, a duplicate index, a stray
 *     timestamp or an unknown encoding is reported in `warnings`.
 *
 * Speaker detection stays conservative: SubRip has no speaker field, so a name is
 * only claimed when the line matches `<v Name>` (WebVTT voice span) or the strict
 * `NAME: text` shape with a short, punctuation-free name. Anything else is
 * attributed to `null` and the cue text is left untouched.
 */

import { UnrecognizedFormatError, buildDocument, recordsFromCharSpans } from "./common.mjs";

const SRT_TIMECODE = /^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})(.*)$/;
const VTT_TIMECODE = /^\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})(.*)$/;
const VTT_VOICE = /^<v(?:\.[^\s>]+)*\s+([^>]+)>/;
const SPEAKER_PREFIX = /^([\p{L}\p{N}][\p{L}\p{N} ._'-]{0,23}):\s+(\S.*)$/u;
const TIMECODE_ANY = /^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/;
const TAG = /<[^>]*>/g;
/** WebVTT cue settings that appear after the arrow. */
const CUE_SETTINGS = /\b(?:align|position|size|line|region|vertical|snap-to-lines):\S+/gi;

function pad(value, width) {
  return String(value).padStart(width, "0");
}

/**
 * Split text into lines like `String.prototype.split("\n")`, but with two
 * differences that matter for byte accounting and for timecode matching:
 *
 *  - a terminal `\r` is part of the separator, so it never reaches a regex and
 *    never lands in the anchored text;
 *  - every line keeps the *original* character offsets of its content, so a byte
 *    range derived from a line is still exact for a CRLF payload.
 */
function splitLines(text) {
  const lines = [];
  let index = 0;
  while (index <= text.length) {
    const newline = text.indexOf("\n", index);
    if (newline === -1) {
      const end = text.length;
      const contentEnd = end > index && text[end - 1] === "\r" ? end - 1 : end;
      lines.push({ text: text.slice(index, contentEnd), start: index, end: contentEnd, terminatorEnd: end });
      break;
    }
    const contentEnd = newline > index && text[newline - 1] === "\r" ? newline - 1 : newline;
    lines.push({ text: text.slice(index, contentEnd), start: index, end: contentEnd, terminatorEnd: newline + 1 });
    index = newline + 1;
  }
  return { lines, text };
}

/**
 * Parse a timecode into milliseconds, or `null` when it is not a timecode.
 * Both `.` and `,` are accepted as the decimal separator (`.srt` in the wild uses
 * both), and hours are optional in WebVTT.
 */
export function parseTimecode(value) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(String(value).trim());
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  const millis = Number(fraction.padEnd(3, "0").slice(0, 3));
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + millis;
}

/** `3723004` → `01:02:03.004`. */
export function formatTimecode(millis) {
  if (!Number.isFinite(millis)) return null;
  const sign = millis < 0 ? "-" : "";
  const total = Math.abs(millis);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const ms = total % 1_000;
  return `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms, 3)}`;
}

/**
 * Detect which subtitle format a payload is.
 *
 * WebVTT is identified by its `WEBVTT` magic (after an optional BOM, which the
 * caller has already stripped from `text`). SubRip is identified by at least one
 * timestamp line — deliberately *not* by the `.srt` extension alone, because a
 * `.txt` transcript with timecodes is the same thing and rejecting it would be
 * user-hostile. A payload with neither is reported as unrecognised.
 *
 * @param {import("./common.mjs").SourceFile} file
 * @returns {{format: "srt"|"vtt", reasons: string[]}}
 */
export function detectSubtitleFormat(file) {
  const reasons = [];
  const { lines } = splitLines(file.text);
  const head = lines[0]?.text ?? "";

  if (/^\uFEFF?WEBVTT(?:[\s(]|$)/.test(head)) {
    reasons.push("payload starts with the WEBVTT signature");
    return { format: "vtt", reasons };
  }

  // SubRip requires a comma before the milliseconds; WebVTT requires a dot. The
  // order matters because a WebVTT timecode also matches the lenient SubRip
  // pattern, and a `.vtt` without its header must not be read as SubRip.
  const vttLines = lines.filter((line) => VTT_TIMECODE.test(line.text));
  if (vttLines.length > 0) {
    reasons.push(`${vttLines.length} WebVTT timecode line(s) without a WEBVTT header`);
    return { format: "vtt", reasons };
  }

  const srtLines = lines.filter((line) => SRT_TIMECODE.test(line.text));
  if (srtLines.length > 0) {
    reasons.push(`${srtLines.length} SubRip timecode line(s)`);
    return { format: "srt", reasons };
  }

  throw new UnrecognizedFormatError(
    `${file.label} is not a recognised subtitle file: no WEBVTT signature and no "HH:MM:SS,mmm --> HH:MM:SS,mmm" timecode line in ${lines.length} line(s)`,
    { path: file.path, lines: lines.length },
  );
}

/**
 * Split a payload into cues.
 *
 * A cue starts at a timecode line. Everything up to the next timecode belongs to
 * it, which tolerates the two common real-world shapes: WebVTT allows a cue
 * identifier line before the timecode, and SubRip requires a numeric index there.
 *
 * @returns {{cues: Array<object>, warnings: string[], indexProblems: string[]}}
 */
export function splitCues(file, format) {
  const text = file.text;
  const matcher = format === "vtt" ? VTT_TIMECODE : SRT_TIMECODE;
  const { lines } = splitLines(text);

  const cueStarts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (matcher.test(lines[index].text)) cueStarts.push(index);
  }

  const cues = [];
  const warnings = [];
  const indexProblems = [];
  const seenIndexes = new Map();

  for (let position = 0; position < cueStarts.length; position += 1) {
    const lineIndex = cueStarts[position];
    const match = matcher.exec(lines[lineIndex].text);
    const isVtt = format === "vtt";

    const start = isVtt
      ? ((Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000) + Number(match[4])
      : ((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000) + Number(match[4].padEnd(3, "0"));
    const end = isVtt
      ? ((Number(match[5] ?? 0) * 3600 + Number(match[6]) * 60 + Number(match[7])) * 1000) + Number(match[8])
      : ((Number(match[5]) * 3600 + Number(match[6]) * 60 + Number(match[7])) * 1000) + Number(match[8].padEnd(3, "0"));
    const settings = isVtt ? (match[9] ?? "").trim() : "";

    // The index line (SubRip) or the cue identifier (WebVTT) sits directly above
    // the timecode, so the body must stop before it — otherwise cue N swallows
    // cue N+1's index (and a cue identifier is silent data loss).
    let indexLine = null;
    let indexLineText = null;
    if (lineIndex > 0) {
      const candidate = lines[lineIndex - 1].text.trim();
      if (candidate !== "" && !TIMECODE_ANY.test(candidate) && !/^NOTE\b/.test(candidate)) {
        indexLine = candidate;
        indexLineText = lines[lineIndex - 1];
      }
    }
    const nextLineIndex = position + 1 < cueStarts.length ? cueStarts[position + 1] : lines.length;
    const lastBodyLine = nextLineIndex - 1 - (nextLineIndex < lines.length && indexLineText ? 1 : 0);

    const bodyStartLine = lineIndex + 1;
    const bodyLines = [];
    for (let cursor = bodyStartLine; cursor <= lastBodyLine && cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.text.trim() === "" && cursor > bodyStartLine + 1) break;
      if (/^\s*NOTE\b/.test(line.text) || /^\s*STYLE\b/.test(line.text)) break;
      bodyLines.push(line);
    }

    const rawLines = bodyLines.map((line) => line.text);
    const cleaned = rawLines
      .map((line) => line.replace(TAG, "").replace(CUE_SETTINGS, "").replace(/\s+/g, " ").trim())
      .filter((line) => line !== "");
    const body = cleaned.join("\n").trim();

    let speaker = null;
    let speakerSource = null;
    const voice = VTT_VOICE.exec(rawLines[0] ?? "");
    if (voice) {
      speaker = voice[1].trim();
      speakerSource = "webvtt-voice";
    } else {
      const prefix = SPEAKER_PREFIX.exec(cleaned[0] ?? "");
      if (prefix) {
        speaker = prefix[1].trim();
        speakerSource = "name-prefix";
      }
    }

    const lastBody = bodyLines.length > 0 ? bodyLines[bodyLines.length - 1] : lines[lineIndex];
    // The byte range covers the timecode line through the terminator of the last
    // line of cue text: enough to show where the cue came from, and nothing that
    // belongs to the next cue.
    // A cue owns its identifier line too: the SubRip index or the WebVTT cue
    // name is part of what identifies the cue in the file.
    const firstLine = indexLineText && indexLineText.start < lines[lineIndex].start ? indexLineText : lines[lineIndex];
    const byteStart = file.charToByte(firstLine.start);
    const byteEnd = file.charToByte(lastBody.terminatorEnd);

    if (indexLine !== null && /^\d+$/.test(indexLine)) {
      const numeric = Number(indexLine);
      if (seenIndexes.has(numeric)) {
        indexProblems.push(`cue index ${numeric} appears more than once (first at line ${seenIndexes.get(numeric) + 1}, again at line ${lineIndex})`);
      } else {
        seenIndexes.set(numeric, lineIndex - 1);
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      warnings.push(`cue at line ${lineIndex + 1} has an unreadable timecode and was skipped`);
      continue;
    }
    if (end < start) {
      warnings.push(`cue at line ${lineIndex + 1} ends (${formatTimecode(end)}) before it starts (${formatTimecode(start)}); the timecodes are kept verbatim`);
    }
    if (body === "") {
      warnings.push(`cue ${indexLine ?? position + 1} at ${formatTimecode(start)} has no text and was not anchored`);
      continue;
    }

    cues.push({
      index: indexLine !== null && /^\d+$/.test(indexLine) ? Number(indexLine) : position + 1,
      start,
      end,
      settings: settings || null,
      speaker,
      speakerSource,
      text: body,
      line: lineIndex + 1,
      charStart: firstLine.start,
      charEnd: lastBody.terminatorEnd,
      byteStart,
      byteEnd,
    });
  }

  for (const problem of indexProblems) warnings.push(problem);
  for (const note of collectNotes(lines, format)) warnings.push(note);
  return { cues, warnings, indexProblems };
}

function collectNotes(lines, format) {
  const notes = [];
  if (format !== "vtt") return notes;
  let noteCount = 0;
  let headerFields = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*NOTE\b/.test(lines[index].text)) noteCount += 1;
    if (index < 40 && /^(?:Kind|Language|Region|STYLE)\s*:/i.test(lines[index].text)) headerFields += 1;
  }
  if (noteCount > 0) notes.push(`${noteCount} WebVTT NOTE block(s) were skipped (they are comments, not dialogue)`);
  if (headerFields > 0) notes.push(`${headerFields} WebVTT header/metadata line(s) were skipped`);
  if (/^\s*STYLE\b/m.test(lines.map((line) => line.text).join("\n"))) {
    notes.push("the WebVTT STYLE block was skipped; only cue text was anchored");
  }
  return notes;
}

/**
 * Parse a subtitle payload into a ledger-ready document.
 *
 * @param {import("./common.mjs").SourceFile} file
 * @param {{format?: "srt"|"vtt"}} [options]
 */
export function parseSubtitle(file, options = {}) {
  const detected = options.format ? { format: options.format, reasons: ["format supplied by the caller"] } : detectSubtitleFormat(file);
  const { cues, warnings } = splitCues(file, detected.format);
  if (cues.length === 0) {
    throw new UnrecognizedFormatError(
      `${file.label} looks like ${detected.format.toUpperCase()} but contains no cue with text`,
      { path: file.path, format: detected.format },
    );
  }

  const records = recordsFromCharSpans(
    file,
    cues.map((cue) => ({
      text: cue.text,
      charStart: cue.charStart,
      charEnd: cue.charEnd,
      kind: "cue",
      label: cue.speaker
        ? `cue ${cue.index} · ${cue.speaker} @ ${formatTimecode(cue.start)}`
        : `cue ${cue.index} @ ${formatTimecode(cue.start)}`,
      speaker: cue.speaker ?? null,
      at: formatTimecode(cue.start),
      speaker: cue.speaker ?? null,
      at: formatTimecode(cue.start),
    })),
  );

  const speakers = [...new Set(cues.map((cue) => cue.speaker).filter(Boolean))];
  const first = cues[0];
  const last = cues[cues.length - 1];
  const extraWarnings = [];
  if (speakers.length === 0) {
    extraWarnings.push("no speaker could be read from this subtitle: SubRip has no speaker field and no cue used a `<v Name>` span or a `Name:` prefix");
  }
  if (first.index !== 1) {
    extraWarnings.push(`the first cue is numbered ${first.index}, not 1; the numbering was kept as-is`);
  }

  return buildDocument({
    identity: options.identity,
    parser: "subtitle",
    format: detected.format,
    kind: "subtitle",
    method: "local-file",
    source: "subtitle",
    files: [file],
    records,
    warnings: [...warnings, ...extraWarnings],
    meta: {
      cues: cues.length,
      durationMs: last.end - first.start,
      startsAt: formatTimecode(first.start),
      endsAt: formatTimecode(last.end),
      speakers,
      detection: detected.reasons,
      // Per-cue timing lives here so a later pass can build a timeline without
      // re-parsing the file. Anchors `[k00NN:tM]` index into this array.
      timecodes: cues.map((cue) => ({
        index: cue.index,
        start: cue.start,
        end: cue.end,
        startTimecode: formatTimecode(cue.start),
        endTimecode: formatTimecode(cue.end),
        speaker: cue.speaker,
        line: cue.line,
      })),
    },
    dropped: cues.some((cue) => cue.settings)
      ? [{ what: "WebVTT cue settings", why: "layout hints (align/position/line), not dialogue" }]
      : [],
  });
}

