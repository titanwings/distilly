/**
 * `retrospect` — turn the local ledger into citable conclusions.
 *
 * The whole point of this module is that a claim is only allowed to exist if it
 * can be pointed back at the bytes it came from. Concretely:
 *
 *  - **Pure and deterministic.** No clock, no randomness, no network, no model.
 *    Every number is a function of the input files alone, every object key is
 *    written in sorted order and every float is rounded to a fixed number of
 *    digits, so running twice over the same ledger produces byte-identical
 *    files (`docs/v2/CONTRACT.md` §5).
 *  - **Evidence only from the ledger.** A claim may cite an anchor only if
 *    `knowledge/index.json` declares that anchor, so the mechanical
 *    anchor-resolution assertion in `docs/v2/ACCEPTANCE.md` §5 cannot fail by
 *    construction. When the ledger only declares a paragraph-level anchor while
 *    the text carries turn-level anchors, the units are *merged up* to the
 *    granularity the ledger can actually cite, and a note says so.
 *  - **Empty beats invented.** Every dimension has a minimum sample size. Below
 *    it the file ships `claims: []` plus a `notes` entry explaining exactly
 *    which threshold was missed — never a guessed value.
 *
 * Layout produced (relative to the person directory):
 *
 *   evidence/derived/{stats,voice,relations,timeline,boundaries,shifts,conflicts}.json
 *
 * Each file is `{kind, generated_from: [{path, sha256}], claims: [...], notes: []}`
 * and each claim is `{id, label: {zh, en}, value, confidence, evidence: [...]}`.
 *
 * Claim id naming rule (frozen for `ds/03-render`): `<file>.<dimension>` for a
 * recurring measurement, `<file>.<dimension>.<qualifier>` for a named bucket and
 * `<file>.candidate_<NNNN>` for an ordered candidate list, where `NNNN` is the
 * 1-based position in that file's deterministic order. There is never a bare
 * `<file>` id and ids never carry a timestamp or a random component.
 */

import {
  deriveBoundaries,
  deriveConflicts,
  deriveRelations,
  deriveShifts,
  deriveTimeline,
  deriveVoice,
} from "./dimensions.mjs";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** The seven derived files, in the order the contract lists them. */
export const DERIVED_KINDS = [
  "stats",
  "voice",
  "relations",
  "timeline",
  "boundaries",
  "shifts",
  "conflicts",
];

/**
 * Dimensions are skipped, not guessed, below these sample sizes. The numbers
 * are deliberately low enough that a 38-cue interview still yields a useful
 * file, and high enough that two messages yield nothing.
 */
export const MIN_UNITS = {
  any: 8, // below this every dimension is empty and says why
  participants: 2, // a 1:1 chat has exactly two speakers and must still report them
  timeSpan: 2, // units carrying a parseable timestamp
  lengths: 5,
  density: 2,
  sentences: 10,
  punctuation: 5,
  emoji: 5,
  ngram: 20,
  address: 5,
  questions: 10,
  interactions: 10,
  latency: 6,
  phases: 12,
  boundaries: 20,
  shifts: 16,
  conflicts: 10,
};

/** Sliding-window width for `shifts`, as a fraction of the corpus. */
/**
 * A rendered `<at>` as epoch milliseconds, or `null` when it is not a time.
 *
 * The anchor prefix carries whatever the source wrote: an ISO instant from a chat
 * export, an `HH:MM:SS,mmm` cue timecode from a subtitle. The derivations compare
 * and bucket these numerically (`ats.sort((a, b) => a - b)`, `unit.at - first`), so
 * leaving them as strings made every comparison `NaN` — which is why the timeline
 * came out empty for **both** corpora while the acceptance tolerated it as a gap.
 * A value that is not a time (an unknown speaker slot, a placeholder) stays as it
 * came, and `deriveTimeline` skips anything that is not a number.
 */
export function toEpochMillis(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;

  const timecode = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(text);
  if (timecode) {
    const [, hours, minutes, seconds, fraction] = timecode;
    const millis = Number(fraction.padEnd(3, "0"));
    return ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + millis;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const SHIFT_WINDOW_RATIO = 0.18;
const SHIFT_WINDOW_MIN = 5;
const SHIFT_WINDOW_MAX = 12;
/** A shift point must clear both a relative and an absolute threshold. */
const SHIFT_RELATIVE = 0.45;
const SHIFT_ABSOLUTE = 6;

/** One anchor, as frozen in `docs/v2/CONTRACT.md`: `k0012` or `k0012:t3`. */
const ANCHOR_PATTERN = /k\d{4,}(?::t\d+)?/;
const ANCHOR_PATTERN_GLOBAL = /k\d{4,}(?::t\d+)?/g;
const ANCHOR_BRACKETS = /\[(k\d{4,}(?::t\d+)?)\]/g;
/**
 * The anchor forms that actually occur. `[k0012]` / `[k0012:t3]` is the shape
 * this module's contract describes and the shape the acceptance corpus uses;
 * `k0012 text` (bare, no brackets) is what `src/knowledge/anchors.mjs` renders
 * into `knowledge/text/*.md`. Both are read, and the parser never invents an
 * anchor that is not literally present in the line.
 */
const ANCHOR_LEADING = /^\s*(k\d{4,}(?::t\d+)?)(?=\s|$)/;

/** `2024-03-04T09:02:00Z`, `2024-03-04 09:02`, `2024-03-04T09:02:00+08:00`. */
const LEADING_TIMESTAMP =
  /^\s*(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)\s*/;

/**
 * A bare timecode, as subtitle parsers render it ("00:00:01.000").
 *
 * It is consumed but does **not** become `at`: a timecode is an offset inside one
 * file, not an instant on a calendar, and pretending otherwise would let a
 * timeline claim dates the corpus never carried.
 */
const LEADING_TIMECODE = /^\s*(\d{1,3}:\d{2}:\d{2}(?:[.,]\d{1,3})?)\s*/;

/** `林工：` / `interviewer: ` at the head of a turn. */
const LEADING_SPEAKER = /^([^\d：:\n][^：:\n]{0,23})[：:]\s*/;

// ---------------------------------------------------------------------------
// deterministic primitives
// ---------------------------------------------------------------------------

/** Sorted-key JSON. The run-twice-same-sha256 gate rests on this. */
export function stableStringify(value, indent = 2) {
  const normalise = (input) => {
    if (input === null || typeof input !== "object") return input;
    if (Array.isArray(input)) return input.map(normalise);
    const output = {};
    for (const key of Object.keys(input).sort()) {
      if (input[key] === undefined) continue;
      output[key] = normalise(input[key]);
    }
    return output;
  };
  return JSON.stringify(normalise(value), null, indent);
}

/** Fixed-precision floats: the same ratio always serialises to the same text. */
export function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const scaled = Math.round(value * factor) / factor;
  return Object.is(scaled, -0) ? 0 : scaled;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function countChars(text) {
  return [...text].length;
}

function median(sortedNumbers) {
  if (sortedNumbers.length === 0) return null;
  const middle = Math.floor(sortedNumbers.length / 2);
  return sortedNumbers.length % 2 === 1
    ? sortedNumbers[middle]
    : (sortedNumbers[middle - 1] + sortedNumbers[middle]) / 2;
}

function percentile(sortedNumbers, fraction) {
  if (sortedNumbers.length === 0) return null;
  return sortedNumbers[percentileIndex(sortedNumbers.length, fraction)];
}

function percentileIndex(length, fraction) {
  return Math.min(length - 1, Math.max(0, Math.ceil(fraction * length) - 1));
}

function mean(numbers) {
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function unique(values) {
  return [...new Set(values)];
}

/** Split a list into `parts` contiguous chunks that differ in length by <= 1. */
function chunk(values, parts) {
  const size = Math.ceil(values.length / parts);
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/** Up to `max` items, evenly spread across the list, order preserved. */
function spread(values, max) {
  if (values.length <= max) return values.slice();
  if (max <= 1) return [values[0]];
  const picked = [];
  for (let index = 0; index < max; index += 1) {
    picked.push(values[Math.round((index * (values.length - 1)) / (max - 1))]);
  }
  return unique(picked);
}

/** `[k, t]`, so anchors order the way a human reads the ledger. */
function anchorRank(anchor) {
  const match = /^k(\d+)(?::t(\d+))?$/.exec(anchor);
  if (!match) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  return [Number(match[1]), match[2] === undefined ? 0 : Number(match[2])];
}

export function compareAnchors(left, right) {
  const [leftK, leftT] = anchorRank(left);
  const [rightK, rightT] = anchorRank(right);
  if (leftK !== rightK) return leftK - rightK;
  if (leftT !== rightT) return leftT - rightT;
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedAnchors(anchors) {
  return unique(anchors).sort(compareAnchors);
}

/**
 * Confidence rules — the only three values allowed are `high`, `medium`, `low`.
 *
 *   high    >= 40 units of sample AND >= 3 independent anchors cited
 *   medium  >= 15 units of sample AND >= 2 independent anchors cited
 *   low     everything else that still cleared the dimension's minimum
 *
 * A dimension that cannot cite even one anchor is not emitted at all, so a
 * claim never carries `evidence: []`.
 */
function confidenceOf(sample, evidenceCount) {
  if (sample >= 40 && evidenceCount >= 3) return "high";
  if (sample >= 15 && evidenceCount >= 2) return "medium";
  return "low";
}

/**
 * Build a claim. Returns `null` when there is nothing to cite, so a claim can
 * never reach the output with `evidence: []` — the assembly step drops the
 * `null`s. `fallback` is a last resort for measurements whose natural anchor is
 * not guaranteed to exist (a median that lands between two samples, say).
 */
function makeClaim(id, zh, en, value, evidence, sample, fallback = []) {
  let anchors = sortedAnchors(evidence);
  if (anchors.length === 0) anchors = sortedAnchors(fallback);
  if (anchors.length === 0) return null;
  return {
    id,
    label: { zh, en },
    value,
    confidence: confidenceOf(sample, anchors.length),
    evidence: anchors.slice(0, 8),
  };
}

/** `zh / en`, so a single `notes` string stays readable in both languages. */
function note(zh, en) {
  return `${zh} / ${en}`;
}

// ---------------------------------------------------------------------------
// reading the ledger
// ---------------------------------------------------------------------------

/** Normalise one `anchors` element: a string, or an object with an id. */
function anchorIdOf(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    for (const key of ["id", "anchor", "ref", "value"]) {
      if (typeof entry[key] === "string") return entry[key];
    }
  }
  return null;
}

function readLedger(personRoot) {
  const ledgerPath = join(personRoot, "knowledge", "index.json");
  const bytes = readFileSync(ledgerPath);
  const parsed = JSON.parse(bytes.toString("utf8"));
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
  const declared = [];
  for (const entry of entries) {
    const list = Array.isArray(entry?.anchors) ? entry.anchors : [];
    for (const item of list) {
      const id = anchorIdOf(item);
      if (typeof id === "string" && ANCHOR_PATTERN.test(id)) declared.push(id);
    }
  }
  return {
    path: ledgerPath,
    relativePath: "knowledge/index.json",
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
    entries,
    declared: sortedAnchors(declared),
  };
}

function listTextFiles(personRoot) {
  const textRoot = join(personRoot, "knowledge", "text");
  if (!existsSync(textRoot)) return [];
  return readdirSync(textRoot)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const path = join(textRoot, name);
      const bytes = readFileSync(path);
      return {
        name,
        path,
        relativePath: `knowledge/text/${name}`,
        bytes: bytes.length,
        sha256: sha256Hex(bytes),
        text: bytes.toString("utf8"),
      };
    });
}

/** `2024-03-04T09:02:00Z` → epoch milliseconds. Hand-rolled so it is UTC and
 * implementation-independent (no `Date` locale or timezone behaviour). */
function parseTimestamp(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
    raw,
  );
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00", zone] = match;
  let offsetMinutes = 0;
  if (zone && zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return utc - offsetMinutes * 60000;
}

function toIso(milliseconds) {
  return new Date(milliseconds).toISOString().replace(".000Z", "Z");
}

/**
 * Split one normalised text file into raw blocks: every line carrying at least
 * one anchor — bracketed anywhere, or bare at the head of the line — starts a
 * block, and an anchor-free non-empty line continues the previous one.
 */
function readBlocks(text) {
  const blocks = [];
  for (const line of text.split(/\r?\n/)) {
    const anchors = [...line.matchAll(ANCHOR_BRACKETS)].map((match) => match[1]);
    if (anchors.length === 0) {
      const leading = ANCHOR_LEADING.exec(line);
      if (leading) anchors.push(leading[1]);
    }
    if (anchors.length > 0) {
      blocks.push({ anchors, line });
    } else if (line.trim() !== "" && blocks.length > 0) {
      blocks[blocks.length - 1].line += ` ${line.trim()}`;
    }
  }
  return blocks;
}

/**
 * Strip anchors, the optional inline timestamp and the optional `speaker:`
 * prefix from a block, returning the three parts.
 */
function splitBlock(line) {
  let rest = line.replace(ANCHOR_BRACKETS, " ");
  rest = rest.replace(ANCHOR_LEADING, " ");
  let at = null;
  let atLabel = null;
  const stamp = LEADING_TIMESTAMP.exec(rest);
  if (stamp) {
    at = parseTimestamp(stamp[1]);
    atLabel = stamp[1];
    rest = rest.slice(stamp[0].length);
  }
  // A subtitle timecode sits where a chat timestamp would; consume it before the
  // speaker, or the speaker regex eats "00" out of "00:00:01.000 面试官：".
  // It is also *the* time of that unit — consuming it without keeping it left
  // `at` null for every subtitle corpus, which is why the timeline was skipped and
  // every shift reported `at_time: null`.
  const timecode = LEADING_TIMECODE.exec(rest);
  if (timecode) {
    if (at === null) {
      const millis = toEpochMillis(timecode[1]);
      if (millis !== null) at = millis;
    }
    // A bare `HH:MM:SS,mmm` has no date. The milliseconds are what the derivation
    // buckets by, but rendering them back as an instant produced
    // `1970-01-01T00:03:51.001Z` — a date the corpus never carried. The raw
    // timecode travels along so the page can show the time it actually has.
    if (atLabel === null) atLabel = timecode[1].replace(",", ".");
    rest = rest.slice(timecode[0].length);
  }

  let speaker = null;
  const prefix = LEADING_SPEAKER.exec(rest);
  if (prefix) {
    speaker = prefix[1].trim();
    rest = rest.slice(prefix[0].length);
  }
  return { at, atLabel, speaker, text: rest.replace(/\s+/g, " ").trim() };
}

/**
 * Build the citable units.
 *
 * Each unit carries the anchor that will be written into `evidence`. When the
 * ledger declares only the paragraph-level form of a turn-level anchor, the
 * turns are merged into one unit and the merge is reported in `notes` — the
 * statistics then describe exactly the granularity a reader can go and check.
 */
function buildUnits(blocks, ledger) {
  const declared = new Set(ledger.declared);
  const notes = [];
  const warnings = [];
  const byAnchor = new Map();
  const order = [];
  const undeclared = [];
  let merges = 0;

  const emittableOf = (anchor) => {
    if (declared.has(anchor)) return anchor;
    const base = anchor.split(":")[0];
    if (declared.has(base)) return base;
    return null;
  };

  for (const block of blocks) {
    const parts = splitBlock(block.line);
    const targets = [];
    for (const anchor of block.anchors) {
      const emittable = emittableOf(anchor);
      if (emittable === null) {
        undeclared.push(anchor);
        continue;
      }
      if (emittable !== anchor) merges += 1;
      if (!targets.includes(emittable)) targets.push(emittable);
    }
    for (const anchor of unique(targets)) {
      if (!byAnchor.has(anchor)) {
        const unit = {
          anchor,
          file: block.file,
          speakers: [],
          texts: [],
          ats: [],
          atLabels: [],
        };
        byAnchor.set(anchor, unit);
        order.push(unit);
      }
      const unit = byAnchor.get(anchor);
      if (parts.speaker !== null) unit.speakers.push(parts.speaker);
      if (parts.at !== null) {
        const millis = toEpochMillis(parts.at);
        unit.ats.push(millis === null ? parts.at : millis);
      }
      if (parts.atLabel) unit.atLabels.push(parts.atLabel);
      unit.texts.push(parts.text);
    }
  }

  const units = order.map((unit, index) => {
    const text = unit.texts.filter(Boolean).join(" ");
    const speakers = unique(unit.speakers);
    const ats = unit.ats.slice().sort((left, right) => left - right);
    return {
      index,
      anchor: unit.anchor,
      file: unit.file,
      text,
      chars: countChars(text),
      speaker: speakers.length === 1 ? speakers[0] : null,
      speakers,
      at: ats.length > 0 ? ats[0] : null,
      atLabel: unit.atLabels.length > 0 ? unit.atLabels[0] : null,
      atLast: ats.length > 0 ? ats[ats.length - 1] : null,
      mergedTurns: unit.texts.length,
    };
  });

  if (merges > 0) {
    notes.push(
      note(
        `账本只声明段落级锚点：${merges} 条更细粒度的消息被合并到可引用锚点上，统计以合并后的 ${units.length} 个单元为单位。`,
        `The ledger only declares paragraph anchors, so ${merges} finer-grained messages were merged onto citable anchors; statistics describe the resulting ${units.length} units.`,
      ),
    );
  }
  if (undeclared.length > 0) {
    warnings.push(
      `${undeclared.length} anchor(s) appear in knowledge/text but are not declared in knowledge/index.json (first: ${undeclared[0]}); they were not cited.`,
    );
  }
  return { units, notes, warnings };
}

function orderUnits(units) {
  const timed = units.filter((unit) => unit.at !== null);
  if (timed.length === units.length && units.length > 1) {
    return units.slice().sort((left, right) => left.at - right.at || left.index - right.index);
  }
  return units.slice();
}

function readCorpus(personRoot) {
  const ledger = readLedger(personRoot);
  const files = listTextFiles(personRoot);
  const warnings = [];
  const notes = [];
  const blocks = [];
  for (const file of files) {
    for (const block of readBlocks(file.text)) blocks.push({ ...block, file: file.relativePath });
    // Provenance is established by the ledger's own record of where the text went,
    // not by comparing a raw-file digest with a normalised-text digest: those are
    // two different files and the comparison can never hold. The raw digest is
    // kept as a fallback for entries written by other producers.
    const recordedAs = file.relativePath.replace(/^knowledge\//, "");
    const digestKnown = ledger.entries.some(
      (entry) => entry?.locations?.text === recordedAs || entry?.sha256 === file.sha256,
    );
    if (!digestKnown) {
      warnings.push(
        `knowledge/${file.relativePath.replace(/^knowledge\//, "")} has no ledger entry with a matching sha256; it was read but not trusted for provenance.`,
      );
    }
  }
  const built = buildUnits(blocks, ledger);
  const units = orderUnits(built.units);
  const timestamps = units.flatMap((unit) => (unit.at === null ? [] : [unit.at]));
  return {
    ledger,
    files,
    units,
    timestamps,
    notes: [...notes, ...built.notes],
    warnings: [...warnings, ...built.warnings],
    inputs: [ledger, ...files].map((file) => ({
      path: file.relativePath,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
  };
}

// ---------------------------------------------------------------------------
// stats — 条数 / 参与者 / 时间跨度 / 消息长度分布 / 单位时间密度
// ---------------------------------------------------------------------------

export function deriveStats(corpus) {
  const { units, timestamps } = corpus;
  const claims = [];
  const notes = [];
  if (units.length < MIN_UNITS.any) {
    notes.push(
      note(
        `样本不足：只有 ${units.length} 条可引用消息，低于所有维度的最低样本数 ${MIN_UNITS.any}，未产出任何结论。`,
        `Insufficient sample: only ${units.length} citable messages, below the minimum of ${MIN_UNITS.any} for every dimension, so no claim was produced.`,
      ),
    );
    return { claims, notes };
  }

  const anchors = units.map((unit) => unit.anchor);
  claims.push(
    makeClaim(
      "stats.message_count",
      "可引用消息条数",
      "Number of citable messages",
      units.length,
      spread(anchors, 3),
      units.length,
    ),
  );

  const files = unique(units.map((unit) => unit.file));
  if (files.length > 1) {
    const perFile = files.map((file) => units.find((unit) => unit.file === file).anchor);
    claims.push(
      makeClaim(
        "stats.source_count",
        "来源文件数",
        "Number of source files",
        files.length,
        perFile,
        units.length,
      ),
    );
  }

  const speakerCounts = new Map();
  const firstAnchorOfSpeaker = new Map();
  for (const unit of units) {
    for (const speaker of unit.speakers) {
      speakerCounts.set(speaker, (speakerCounts.get(speaker) ?? 0) + 1);
      if (!firstAnchorOfSpeaker.has(speaker)) firstAnchorOfSpeaker.set(speaker, unit.anchor);
    }
  }
  const participants = [...speakerCounts.keys()].sort(
    (left, right) => speakerCounts.get(right) - speakerCounts.get(left) || (left < right ? -1 : 1),
  );
  if (participants.length >= MIN_UNITS.participants) {
    claims.push(
      makeClaim(
        "stats.participants",
        "参与者（按发言条数降序）",
        "Participants, most active first",
        participants,
        participants.map((name) => firstAnchorOfSpeaker.get(name)),
        units.length,
      ),
    );
    claims.push(
      makeClaim(
        "stats.participant_count",
        "参与者人数",
        "Number of participants",
        participants.length,
        participants.map((name) => firstAnchorOfSpeaker.get(name)),
        units.length,
      ),
    );
  } else {
    notes.push(
      note(
        `参与者维度跳过：只识别到 ${participants.length} 个说话人，低于阈值 ${MIN_UNITS.participants}。`,
        `Participants skipped: only ${participants.length} speakers recognised, below the threshold of ${MIN_UNITS.participants}.`,
      ),
    );
  }

  if (timestamps.length >= MIN_UNITS.timeSpan) {
    const sorted = timestamps.slice().sort((left, right) => left - right);
    const spanMs = sorted[sorted.length - 1] - sorted[0];
    const firstTimed = units.find((unit) => unit.at === sorted[0]);
    const lastTimed = units.reduce(
      (found, unit) => (unit.at !== null && unit.at >= (found?.at ?? -Infinity) ? unit : found),
      null,
    );
    const evidence = [firstTimed?.anchor, lastTimed?.anchor].filter(Boolean);
    claims.push(
      makeClaim(
        "stats.time_range",
        "时间范围（首条 / 末条时间戳）",
        "Time range (first / last timestamp)",
        { from: toIso(sorted[0]), to: toIso(sorted[sorted.length - 1]) },
        evidence,
        timestamps.length,
      ),
    );
    claims.push(
      makeClaim(
        "stats.time_span_days",
        "时间跨度（天）",
        "Time span in days",
        round(spanMs / 86400000, 3),
        evidence,
        timestamps.length,
      ),
    );
    const spanHours = spanMs / 3600000;
    if (spanHours >= 1) {
      claims.push(
        makeClaim(
          "stats.density_per_hour",
          "单位时间密度（条/小时）",
          "Message density (messages per hour)",
          {
            per_hour: round(units.length / spanHours, 4),
            span_hours: round(spanHours, 3),
            messages: units.length,
          },
          spread(anchors, 3),
          timestamps.length,
        ),
      );
    } else {
      notes.push(
        note(
          "单位时间密度跳过：可解析的时间跨度不足 1 小时，密度会退化成无意义的巨大值。",
          "Density skipped: the parseable span is under one hour, which would make the ratio meaninglessly large.",
        ),
      );
    }
  } else {
    notes.push(
      note(
        `时间跨度与密度跳过：只有 ${timestamps.length} 条消息带可解析时间戳，低于阈值 ${MIN_UNITS.timeSpan}。`,
        `Time span and density skipped: only ${timestamps.length} messages carry a parseable timestamp, below the threshold of ${MIN_UNITS.timeSpan}.`,
      ),
    );
  }

  if (units.length >= MIN_UNITS.lengths) {
    const lengths = units.map((unit) => unit.chars).sort((left, right) => left - right);
    const shortest = units.reduce((found, unit) => (unit.chars < found.chars ? unit : found), units[0]);
    const longest = units.reduce((found, unit) => (unit.chars > found.chars ? unit : found), units[0]);
    claims.push(
      makeClaim(
        "stats.message_length",
        "消息长度分布（字符数）",
        "Message length distribution (characters)",
        {
          unit: "characters",
          mean: round(mean(lengths), 2),
          median: round(median(lengths), 2),
          p90: round(percentile(lengths, 0.9), 2),
          min: lengths[0],
          max: lengths[lengths.length - 1],
        },
        [shortest.anchor, longest.anchor],
        units.length,
      ),
    );
  }

  return { claims, notes };
}

// ---------------------------------------------------------------------------
// document assembly
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// additional dimensions
// ---------------------------------------------------------------------------

/**
 * The six dimensions that live in their own module: `voice`, `relations`,
 * `timeline`, `boundaries`, `shifts`, `conflicts`.
 *
 * They are handed this file's private helpers (claim construction, thresholds)
 * rather than re-deriving them, so every dimension measures and cites the same
 * way `stats` does — and a threshold change stays in one place.
 */
const DIMENSION_HELPERS = {
  makeClaim,
  note,
  MIN: MIN_UNITS,
  SHIFT_WINDOW_RATIO,
  SHIFT_WINDOW_MIN,
  SHIFT_WINDOW_MAX,
  SHIFT_RELATIVE,
  SHIFT_ABSOLUTE,
};

// 不叫 run：本文件已经导出了一个同名的 CLI 入口函数。
//
// 低于全局下限时统一短路：语料太薄，**每个**维度都无话可说，此时报各自的
// 分维度阈值（"少于 10 句"）虽然不假却会误导 —— 读者需要的是那个解释"为什么
// 一条结论都没有"的数字。
const withHelpers = (deriver) => (corpus) => {
  const floor = MIN_UNITS.any;
  if (corpus.units.length < floor) {
    return {
      claims: [],
      notes: [
        // 拼接而不是模板字符串：这段代码本身住在一个模板字符串里，
        // 写成插值会被**补丁文件**在写入时求值（那时 corpus 还不存在）。
        note(
          "样本不足：只有 " + corpus.units.length + " 条可引用消息，低于所有维度的最低样本数 " + floor + "，未产出任何结论。",
          "Insufficient sample: only " + corpus.units.length + " citable messages, below the minimum of " + floor + " for every dimension, so no claim was produced.",
        ),
      ],
    };
  }
  return deriver(corpus, DIMENSION_HELPERS);
};

const DERIVERS = {
  stats: deriveStats,
  voice: withHelpers(deriveVoice),
  relations: withHelpers(deriveRelations),
  timeline: withHelpers(deriveTimeline),
  boundaries: withHelpers(deriveBoundaries),
  shifts: withHelpers(deriveShifts),
  conflicts: withHelpers(deriveConflicts),
};

/** Run every available dimension and assemble the seven documents. */
export function deriveDocuments(corpus) {
  const generatedFrom = corpus.inputs.map((input) => ({
    path: input.path,
    sha256: input.sha256,
  }));
  const documents = {};
  const notes = [];
  for (const kind of DERIVED_KINDS) {
    const deriver = DERIVERS[kind];
    const result = deriver ? deriver(corpus) : { claims: [], notes: [] };
    documents[kind] = {
      kind,
      generated_from: generatedFrom,
      claims: result.claims.filter(Boolean),
      notes: unique([...corpus.notes, ...result.notes]),
    };
    for (const line of result.notes) notes.push({ kind, line });
  }
  return { documents, notes };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP = `distilly retrospect — 纯派生：knowledge/ → evidence/derived/*.json

用法 / Usage:
  distilly retrospect --person <slug> [--json]
  distilly retrospect --dir <person-dir> [--json]
  distilly retrospect --help

选项 / Options:
  --person <slug>   在 ./skills/*/<slug>/ 下查找该人的目录
  --dir <path>      直接指定人的目录（含 knowledge/index.json）
  --json            只打印机器可读回执 / print the machine-readable receipt only
  --help            打印本帮助 / print this help

输入（只读） / Inputs (read only):
  knowledge/index.json      账本；每条结论的锚点都必须在这里声明
  knowledge/text/*.md       归一化正文，段落锚点 [k0012] / [k0012:t3]

输出 / Outputs:
  evidence/derived/{stats,voice,relations,timeline,boundaries,shifts,conflicts}.json

退出码 / Exit codes:
  0 成功    2 缺输入或用法错误（回执里给出补救步骤）

不联网、不调用任何模型：同一份输入跑两次，产物逐字节相同。
No network and no model call: the same input produces byte-identical output.
`;

function parseArgs(args) {
  const options = { person: null, dir: null, json: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--person" || arg === "--dir") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return { error: `${arg} requires a value` };
      }
      options[arg === "--person" ? "person" : "dir"] = value;
      index += 1;
    } else return { error: `unknown option: ${arg}` };
  }
  return { options };
}

function familyDirs(skillsRoot) {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot)
    .sort()
    .map((name) => join(skillsRoot, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
}

/** Resolve the person directory from `--dir`, `--person` or the cwd. */
export function resolvePersonRoot(options, cwd) {
  const hasLedger = (path) => existsSync(join(path, "knowledge", "index.json"));
  if (options.dir) {
    const path = resolve(cwd, options.dir);
    return hasLedger(path) ? { root: path } : { error: `${path} has no knowledge/index.json` };
  }
  if (options.person) {
    const candidates = [
      join(cwd, "skills", "colleague", options.person),
      ...familyDirs(join(cwd, "skills")).map((family) => join(family, options.person)),
    ];
    for (const candidate of unique(candidates)) {
      if (hasLedger(candidate)) return { root: candidate };
    }
    return {
      error: `${join(cwd, "skills", "*", options.person)} has no knowledge/index.json`,
    };
  }
  if (hasLedger(cwd)) return { root: cwd };
  return { error: `${cwd} has no knowledge/index.json` };
}

function writeDerivedFiles(personRoot, documents) {
  const outputDir = join(personRoot, "evidence", "derived");
  mkdirSync(outputDir, { recursive: true });
  const outputs = [];
  for (const kind of DERIVED_KINDS) {
    const body = Buffer.from(`${stableStringify(documents[kind])}\n`, "utf8");
    const path = join(outputDir, `${kind}.json`);
    const staging = join(outputDir, `.${basename(path)}.${process.pid}.tmp`);
    writeFileSync(staging, body);
    renameSync(staging, path);
    outputs.push({
      path: `evidence/derived/${kind}.json`,
      sha256: sha256Hex(body),
      bytes: body.length,
    });
  }
  return outputs;
}

function humanSummary(receipt, documents) {
  const lines = [`retrospect: ${receipt.outputs.length} 个派生文件 / derived files`];
  for (const output of receipt.outputs) {
    const size = documents[basename(output.path, ".json")].claims.length;
    lines.push(`  ${output.path}  ${size} claim(s)  ${output.sha256.slice(0, 12)}`);
  }
  if (receipt.warnings.length > 0) {
    lines.push(`  警告 / warnings: ${receipt.warnings.length}`);
    for (const warning of receipt.warnings) lines.push(`    - ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * CLI entry point. `io` may override the working directory and the two streams,
 * which is how the tests drive it without spawning a process.
 *
 * @returns {{exitCode: number, receipt: object}}
 */
export function run(args = [], io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const parsed = parseArgs(args);

  const emit = (receipt, exitCode, documents = null) => {
    if (parsed.options?.json) stdout.write(`${stableStringify(receipt)}\n`);
    else if (exitCode !== 0) stderr.write(`retrospect: ${receipt.error.message}\n`);
    else stdout.write(humanSummary(receipt, documents));
    return { exitCode, receipt };
  };

  if (parsed.error) {
    return emit(
      {
        command: "retrospect",
        person: null,
        ok: false,
        inputs: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        warnings: [],
        unavailable: [],
        error: { code: "retrospect/usage", message: parsed.error, remedy: "distilly retrospect --help" },
      },
      2,
    );
  }
  if (parsed.options.help) {
    stdout.write(HELP);
    return { exitCode: 0, receipt: null };
  }

  const resolved = resolvePersonRoot(parsed.options, cwd);
  if (resolved.error) {
    return emit(
      {
        command: "retrospect",
        person: parsed.options.person,
        ok: false,
        inputs: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        warnings: [],
        unavailable: [],
        error: {
          code: "retrospect/missing-input",
          message: resolved.error,
          remedy:
            "run `distilly harvest <dir|file> --person <slug>` first, then pass the same --person (or --dir <person-dir>)",
        },
      },
      2,
    );
  }

  const corpus = readCorpus(resolved.root);
  const { documents } = deriveDocuments(corpus);
  const outputs = writeDerivedFiles(resolved.root, documents);

  const cited = sortedAnchors(
    Object.values(documents).flatMap((document) =>
      document.claims.flatMap((claim) => claim.evidence),
    ),
  );
  const ledgerWarnings = corpus.ledger.entries.flatMap((entry) =>
    (Array.isArray(entry?.warnings) ? entry.warnings : []).map(
      (warning) => `ledger:${entry?.id ?? "?"}: ${warning}`,
    ),
  );

  const receipt = {
    command: "retrospect",
    person: parsed.options.person ?? basename(resolved.root),
    ok: true,
    inputs: corpus.inputs,
    outputs,
    anchors: { total: corpus.ledger.declared.length, cited: cited.length },
    warnings: [...corpus.warnings, ...ledgerWarnings],
    unavailable: [],
  };
  return emit(receipt, 0, documents);
}

export default run;
