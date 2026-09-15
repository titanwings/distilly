/**
 * ledger.mjs — `knowledge/index.json`, the append-only record of everything that
 * entered the knowledge base.
 *
 * Entry shape, frozen by docs/v2/CONTRACT.md §2:
 *
 *   { id, kind, origin, fetched_at, bytes, sha256, credentialed, method, warnings[] }
 *
 * Beyond the frozen core we add two field families that parsers in
 * `src/parse/**` need in order to make anchors mechanically resolvable, and one
 * that makes repeated harvests idempotent:
 *
 *   units[]    per-paragraph anchors `[k00NN]` with their exact raw byte ranges
 *   anchors[]  per-turn anchors `[k00NN:tM]` (`turn` / `msg` / `cue` / `item`)
 *   files[]    every raw file this entry was assembled from, with sha256
 *   locations  raw / text paths relative to `knowledge/`
 *   imports    how many times the same bytes were imported
 *
 * The ledger is an append-only array. Existing entries are never rewritten, which
 * is what makes `index.json` byte-identical across runs: re-importing the same
 * bytes produces the same file, not a counter bump. Provenance changes (a
 * different id, a new paragraph) require a new entry.
 *
 * Guarantees:
 *  - **Append only.** Existing entries are never mutated.
 *  - **Deterministic bytes.** `renderLedger` sorts keys, so hashing
 *    `index.json` twice yields the same digest.
 *  - **Idempotent by content.** `appendEntry` refuses to record the same
 *    `sha256` twice for the same `origin`; it returns the original entry and a
 *    reason instead of appending.
 */

import { existsSync, readFileSync } from "node:fs";
import { KnowledgeStore, atomicWriteText, sha256Hex, stableStringify } from "./store.mjs";
import { assignAnchorsToText, conservationReport, formatAnchor, formatSubAnchor, parseAnchor } from "./anchors.mjs";

export const LEDGER_SCHEMA_VERSION = 2;

/** Kinds a ledger entry may declare. */
export const ENTRY_KINDS = Object.freeze([
  "chat",
  "chat-thread",
  "email",
  "email-thread",
  "subtitle",
  "document",
  "spreadsheet",
  "archive",
  "archive-record",
  "note",
  "transcript",
]);

/** Acquisition methods a zero-credential parser may declare. */
export const ENTRY_METHODS = Object.freeze([
  "local-file",
  "local-directory",
  "archive-member",
  "user-export",
  "model-read",
]);

/**
 * The ledger is a plain JSON **array** of entries — that is what
 * `docs/v2/ACCEPTANCE.md` §5 and `scripts/acceptance.mjs` read, and what the rest
 * of the pipeline iterates. `loadLedger` accepts either the array form or the
 * `{ version, encoder, entries }` envelope so an older file still loads, but
 * `renderLedger` always writes the array.
 */
export function emptyLedger() {
  const entries = [];
  Object.defineProperty(entries, LEDGER_META, {
    value: { version: LEDGER_SCHEMA_VERSION, encoder: LEDGER_ENCODER },
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return entries;
}

const LEDGER_META = Symbol("distilly.ledger.meta");
const LEDGER_ENCODER = "distilly/knowledge-ledger";

function withMeta(entries, meta = {}) {
  emptyLedger();
  const list = Array.isArray(entries) ? entries : [];
  Object.defineProperty(list, LEDGER_META, {
    value: {
      version: meta.version ?? LEDGER_SCHEMA_VERSION,
      encoder: meta.encoder ?? LEDGER_ENCODER,
    },
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return list;
}

/**
 * Read `knowledge/index.json`. A missing file is an empty ledger; an unreadable
 * or malformed one is an error, because silently starting over would destroy
 * provenance.
 */
export function loadLedger(store) {
  const path = store.ledgerPath;
  if (!existsSync(path)) return emptyLedger();
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read the knowledge ledger at ${path}: ${error.message}`);
  }
  if (raw.trim() === "") return emptyLedger();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`knowledge ledger at ${path} is not valid JSON: ${error.message}`);
  }
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
        throw new Error(`knowledge ledger at ${path} has an entry without an id`);
      }
    }
    return withMeta(parsed);
  }
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
    return withMeta(parsed.entries, parsed);
  }
  throw new Error(`knowledge ledger at ${path} is neither an array nor an object with entries[]`);
}

/** Serialise the ledger deterministically (sorted keys, trailing newline). */
export function renderLedger(ledger) {
  return `${stableStringify([...ledger], 2, true)}\n`;
}

export function ledgerMeta(ledger) {
  return ledger?.[LEDGER_META] ?? { version: LEDGER_SCHEMA_VERSION, encoder: LEDGER_ENCODER };
}

export function ledgerSha256(ledger) {
  return sha256Hex(Buffer.from(renderLedger(ledger), "utf8"));
}

export function saveLedger(store, ledger) {
  const text = renderLedger(ledger);
  if (!store.dryRun) {
    store.ensure();
    atomicWriteText(store.ledgerPath, text);
  }
  return { path: store.ledgerPath, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256Hex(Buffer.from(text, "utf8")) };
}

/** Highest allocated numeric suffix, so ids never go backwards. */
export function lastId(ledger) {
  let highest = 0;
  for (const entry of ledger.entries) {
    const parsed = parseAnchor(entry?.id);
    if (parsed && parsed.index > highest) highest = parsed.index;
  }
  return highest;
}

export function nextId(ledger) {
  return formatAnchor(lastId(ledger) + 1);
}

export function findEntry(ledger, predicate) {
  return ledger.entries.find(predicate) ?? null;
}

/** Look up by `k00NN`. */
export function getEntry(ledger, id) {
  const parsed = parseAnchor(id);
  if (!parsed) return null;
  return ledger.entries.find((entry) => entry.id === parsed.id) ?? null;
}

/** Find the entry that recorded these exact bytes. */
export function findBySha256(ledger, sha256) {
  return ledger.entries.filter((entry) => entry.sha256 === sha256);
}

/**
 * Every anchor id the ledger knows about, for the `doctor` / anchor-integrity
 * gate in the contract (§5): a document may only cite an anchor that resolves.
 * @returns {Set<string>}
 */
export function anchorIndex(ledger) {
  const index = new Set();
  for (const entry of ledger.entries) {
    index.add(entry.id);
    for (const unit of entry.units ?? []) index.add(unit.anchor ?? `${entry.id}`);
    for (const sub of entry.anchors ?? []) index.add(sub.anchor);
  }
  return index;
}

/**
 * Resolve a `[k00NN]` / `[k00NN:tM]` citation anywhere in the ledger.
 * @returns {{entry: object, anchor: string, text: string, byteStart: number,
 *            byteEnd: number, file: string|null, kind: string}|null}
 */
export function resolveLedgerAnchor(ledger, anchor) {
  const parsed = parseAnchor(anchor);
  if (!parsed) return null;
  const entry = getEntry(ledger, parsed.id);
  if (!entry) return null;

  if (parsed.kind === "sub") {
    const sub = (entry.anchors ?? []).find((candidate) => candidate.anchor === anchor);
    if (!sub) return null;
    return {
      entry,
      anchor,
      kind: sub.kind ?? "item",
      text: sub.text ?? "",
      byteStart: sub.byteStart ?? null,
      byteEnd: sub.byteEnd ?? null,
      file: sub.file ?? null,
    };
  }

  const unit = (entry.units ?? []).find((candidate) => candidate.anchor === anchor);
  if (!unit) return null;
  return {
    entry,
    anchor,
    kind: "para",
    text: unit.text ?? "",
    byteStart: unit.byteStart ?? null,
    byteEnd: unit.byteEnd ?? null,
    file: unit.file ?? null,
  };
}

function normaliseWarnings(warnings) {
  const list = Array.isArray(warnings) ? warnings : warnings ? [String(warnings)] : [];
  return list.map((warning) => String(warning)).filter((warning) => warning.trim() !== "");
}

/**
 * Build a ledger entry from a parsed document.
 *
 * `document` is whatever `src/parse/*.mjs` returned; see `src/parse/common.mjs`
 * for the exact shape. Nothing is invented here: missing fields stay missing so
 * downstream consumers can tell "not applicable" from "zero".
 */
export function buildEntry(document, options = {}) {
  const id = options.id;
  if (!id) throw new TypeError("buildEntry requires an id (allocate it with nextId)");
  const parsedId = parseAnchor(id);
  if (!parsedId || parsedId.kind !== "para") {
    throw new TypeError(`buildEntry requires a paragraph id like k0001, received ${id}`);
  }

  const rawFiles = document.files ?? [];
  if (rawFiles.length === 0) throw new TypeError(`entry ${id} has no raw files`);

  const primary = rawFiles[0];
  const origin = options.origin ?? document.origin ?? primary.path;
  const fetchedAt = document.fetched_at ?? options.fetched_at ?? null;
  if (!fetchedAt) {
    throw new TypeError(`entry ${id} needs fetched_at — pass it explicitly so runs stay deterministic`);
  }

  const warnings = normaliseWarnings([...(document.warnings ?? []), ...(options.warnings ?? [])]);

  return {
    id,
    kind: document.kind,
    origin,
    fetched_at: fetchedAt,
    bytes: rawFiles.reduce((total, file) => total + (file.bytes ?? 0), 0),
    sha256: options.sha256 ?? primary.sha256,
    credentialed: Boolean(document.credentialed),
    method: document.method ?? "local-file",
    warnings,
    files: rawFiles.map((file) => ({
      path: file.relativePath ?? file.path,
      bytes: file.bytes ?? 0,
      sha256: file.sha256 ?? null,
      encoding: file.encoding ?? null,
      ...(file.members !== undefined ? { members: file.members } : {}),
    })),
    locations: {
      raw: primary.relativePath ?? primary.path,
      text: document.textRelativePath ?? null,
    },
    counts: {
      units: (document.units ?? []).length,
      anchors: (document.anchors ?? []).length,
    },
    units: (document.units ?? []).map((unit) => ({
      id: unit.anchor,
      anchor: unit.anchor,
      text: unit.text,
      byteStart: unit.byteStart,
      byteEnd: unit.byteEnd,
      file: unit.file ?? primary.relativePath ?? primary.path,
    })),
    // `anchors` carries *every* anchor this entry owns — the paragraph anchors
    // plus the per-turn/cue/message sub-anchors — because that is the list the
    // anchor-integrity gate (`scripts/acceptance.mjs`, `doctor`) reads. Elements
    // are objects with `id`; `anchor` is the same value kept for old callers.
    anchors: (document.anchors ?? []).map((anchor) => ({
      id: anchor.anchor ?? anchor.id,
      anchor: anchor.anchor ?? anchor.id,
      kind: anchor.kind,
      text: anchor.text,
      byteStart: anchor.byteStart ?? null,
      byteEnd: anchor.byteEnd ?? null,
      file: anchor.file ?? primary.relativePath ?? primary.path,
      ...(anchor.label ? { label: anchor.label } : {}),
    })),
    imports: 1,
  };
}

/**
 * Append `entry` to `ledger` unless its bytes are already recorded.
 *
 * Idempotency rule: same `sha256` (and, when both sides declare one, same
 * `origin`) ⇒ no new entry. The existing entry keeps its id and `fetched_at`
 * — the clock is never re-read, which is exactly what makes a second harvest
 * produce byte-identical `index.json`.
 *
 * @param {object} ledger
 * @param {object} entry
 * @param {{allowDuplicate?: boolean}} [options]
 * @returns {{entry: object, appended: boolean, duplicateOf: object|null, reason: string}}
 */
export function appendEntry(ledger, entry, options = {}) {
  const existing = ledger.entries.find(
    (candidate) =>
      candidate.sha256 === entry.sha256 &&
      (candidate.origin === entry.origin || !entry.origin || !candidate.origin),
  );

  if (existing && !options.allowDuplicate) {
    existing.imports = (existing.imports ?? 1) + 1;
    return {
      entry: existing,
      appended: false,
      duplicateOf: existing,
      reason: `identical bytes already recorded as ${existing.id} (sha256 ${existing.sha256})`,
    };
  }

  ledger.entries.push(entry);
  return { entry, appended: true, duplicateOf: null, reason: "new content recorded" };
}

/**
 * Store a parsed document and record it in the ledger — the single entry point
 * every parser in `src/parse/**` funnels through.
 *
 * Anchoring happens *here*, not in the parsers: only the ledger knows which
 * `k00NN` id is free, and an anchor must never be renumbered after a citation
 * exists. Parsers hand over readable text plus the character spans of their
 * turns/records; we stamp the paragraph anchors, derive the `[k00NN:tM]`
 * sub-anchors, verify byte conservation and only then touch the disk.
 *
 * Order matters: raw bytes first, then normalised text, then the ledger. A crash
 * between the steps leaves orphaned raw bytes (harmless — the next run writes
 * the identical bytes) but never a ledger entry pointing at a missing file.
 *
 * @param {KnowledgeStore} store
 * @param {object} ledger mutated in place
 * @param {object} document a parsed document from `src/parse/**`
 * @param {{id?: string, origin?: string, fetched_at?: string, allowDuplicate?: boolean}} [options]
 * @returns {{entry: object|null, appended: boolean, duplicateOf: object|null,
 *            reason: string, id: string|null, written: object|null, units: Array,
 *            conservation: Array, text: string}}
 */
export function recordDocument(store, ledger, document, options = {}) {
  const source = document.source;
  if (!source) throw new TypeError("document.source is required to place raw bytes");

  const fetchedAt = document.fetched_at ?? options.fetched_at;
  if (!fetchedAt) {
    throw new TypeError("recordDocument needs fetched_at (pass it explicitly so runs stay deterministic)");
  }

  store.ensure();

  const storedFiles = [];
  for (const file of document.files ?? []) {
    if (file.persisted) {
      storedFiles.push(file);
      continue;
    }
    if (!file.bytesRaw) {
      throw new TypeError(`document file ${file.path} carries neither bytesRaw nor a persisted record`);
    }
    const stored = store.writeRaw(source, file.name ?? file.path, file.bytesRaw);
    storedFiles.push({
      ...file,
      relativePath: stored.relativePath,
      absolutePath: stored.path,
      bytes: stored.bytes,
      sha256: stored.sha256,
      persisted: true,
      // Drop the byte payload from the descriptor we keep in memory: it is on
      // disk now and holding it would double memory for large archives.
      bytesRaw: undefined,
    });
  }

  // Anchor the assembled content, continuing the numbering when a single
  // document needs more paragraphs than one id can own (see `chunkDocuments`).
  const id = options.id ?? nextId(ledger);
  const ledgerIndex = parseAnchor(id).index;
  const anchored = assignAnchorsToText(document.content ?? "", {
    segments: document.segments ?? [],
    groupBy: document.groupBy,
    maxBlocks: document.maxBlocks,
    warnings: document.warnings ?? [],
    startIndex: ledgerIndex,
  });

  // Sub-anchors are keyed by the entry id they belong to, not by the paragraph
  // they happen to render next to, so a citation stays stable when the document
  // is re-chunked.
  const primaryUnit = anchored.units[0] ?? { anchor: id, id: ledgerIndex, byteStart: 0, byteEnd: 0 };

  const seen = new Map();
  const subAnchors = (document.entries ?? []).map((entry) => {
    const key = entry.file ?? storedFiles[0]?.name ?? null;
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);
    return {
      kind: entry.kind ?? "item",
      text: entry.text,
      anchor: formatSubAnchor(id, ordinal),
      id: formatSubAnchor(id, ordinal),
      index: ordinal,
      byteStart: entry.byteStart ?? null,
      byteEnd: entry.byteEnd ?? null,
      file: entry.file ?? storedFiles[0]?.name ?? null,
      label: entry.label ?? null,
    };
  });

  const conservation = conservationReport(
    new Map(storedFiles.map((file) => [file.relativePath, file.bytesRaw ?? Buffer.alloc(0)])),
    [{ units: anchored.units.map((unit) => ({ ...unit, file: storedFiles[0]?.relativePath ?? null })) }],
  );

  // Nothing survived parsing: keep the raw bytes, do not invent an entry.
  if (anchored.units.length === 0 && subAnchors.length === 0) {
    return {
      entry: null,
      appended: false,
      duplicateOf: null,
      reason: "parsed to no anchored content; raw bytes retained, no ledger entry created",
      id: null,
      requestedId: id,
      written: { text: null, files: storedFiles },
      units: [],
      anchors: [],
      conservation,
      text: "",
    };
  }

  const textWrite = store.writeText(source, anchored.text, document.textStem);
  const prepared = {
    ...document,
    files: storedFiles.map((file) => ({
      path: file.relativePath,
      name: file.name,
      relativePath: file.relativePath,
      bytes: file.bytes,
      sha256: file.sha256,
      encoding: file.encoding ?? null,
      members: file.members,
    })),
  };

  const paragraphAnchors = anchored.units.map((unit) => ({
    anchor: unit.anchor,
    id: unit.anchor,
    kind: "para",
    text: unit.text,
    byteStart: unit.byteStart,
    byteEnd: unit.byteEnd,
    file: storedFiles[0]?.relativePath ?? null,
  }));

  const entry = buildEntry(
    {
      ...prepared,
      units: anchored.units.map((unit) => ({ ...unit, file: storedFiles[0]?.relativePath ?? null })),
      // One flat list: paragraph anchors first, then the sub-anchors, so
      // `entry.anchors.map(a => a.id)` is the entry's whole anchor namespace.
      anchors: [...paragraphAnchors, ...subAnchors],
      textRelativePath: textWrite.relativePath,
    },
    { ...options, id, fetched_at: fetchedAt, unitCount: anchored.units.length },
  );
  entry.anchor_count = anchored.units.length + subAnchors.length;
  entry.primary_anchor = primaryUnit.anchor;
  if (document.accounting) entry.accounting = document.accounting;

  const result = appendEntry(ledger, entry, options);

  return {
    ...result,
    id: result.entry.id,
    requestedId: id,
    written: { text: textWrite, files: storedFiles },
    units: result.entry.units ?? [],
    anchors: result.entry.anchors ?? [],
    conservation,
    text: anchored.text,
  };
}

/**
 * Split a document into chunks small enough that one `k00NN` id owns a sane
 * number of paragraphs, keeping the raw files on the first chunk only.
 *
 * `knowledge/text/<source>.md` is written per entry, so a 30 000 message chat
 * would otherwise produce a single file that no reader (human or model) can
 * navigate, and every paragraph anchor under one id.
 *
 * @param {object} document
 * @param {{maxParagraphs?: number}} [options]
 * @returns {Array<object>}
 */
export function chunkDocuments(document, options = {}) {
  const maxParagraphs = options.maxParagraphs ?? 500;
  const segments = document.segments ?? [];
  if (segments.length <= maxParagraphs) return [document];

  const entries = document.entries ?? [];
  const chunks = [];
  for (let start = 0; start < segments.length; start += maxParagraphs) {
    const slice = segments.slice(start, start + maxParagraphs);
    const charStart = slice[0].charStart;
    const charEnd = slice[slice.length - 1].charEnd;
    chunks.push({
      ...document,
      // Raw bytes are written once, by the first chunk; later chunks reference
      // the same relative paths.
      files: start === 0 ? document.files : document.files.map((file) => ({ ...file, bytesRaw: undefined, persisted: true })),
      content: document.content.slice(charStart, charEnd),
      segments: slice.map((segment) => ({
        ...segment,
        charStart: segment.charStart - charStart,
        charEnd: segment.charEnd - charStart,
      })),
      entries: entries.slice(start, start + maxParagraphs),
      textStem: document.textStem,
      meta: { ...(document.meta ?? {}), chunk: Math.floor(start / maxParagraphs) + 1, chunksOf: document.source },
    });
  }
  return chunks;
}

/** Ledger statistics used by `doctor` and by the evidence report. */
export function ledgerStats(ledger) {
  const byKind = {};
  const byMethod = {};
  let bytes = 0;
  let warnings = 0;
  let anchors = 0;
  for (const entry of ledger.entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    byMethod[entry.method] = (byMethod[entry.method] ?? 0) + 1;
    bytes += entry.bytes ?? 0;
    warnings += (entry.warnings ?? []).length;
    anchors += (entry.units ?? []).length + (entry.anchors ?? []).length;
  }
  return {
    entries: ledger.entries.length,
    bytes,
    anchors,
    warnings,
    credentialed: ledger.entries.filter((entry) => entry.credentialed).length,
    byKind,
    byMethod,
  };
}

export { KnowledgeStore };
