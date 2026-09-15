/**
 * distilly view check — validate views/<slug>.view.json against the v2 contract.
 *
 * Every finding has the same machine-readable shape so an LLM can repair itself:
 *   { code, severity, message, subject: { path, identity }, evidence, supportedFixes[] }
 *
 * Zero runtime dependencies.
 */
import { basename } from "node:path";

/** The eight page segments, in page order. The eighth is derived from `evidence[]`. */
export const REQUIRED_SECTIONS = Object.freeze([
  { id: "portrait", kind: "claims", title: "一句话画像", derived: false },
  { id: "communication", kind: "claims", title: "沟通风格", derived: false },
  { id: "values", kind: "claims", title: "决策与价值观", derived: false },
  { id: "workstyle", kind: "claims", title: "工作方式", derived: false },
  { id: "relationship", kind: "claims", title: "关系与称呼", derived: false },
  { id: "boundaries", kind: "warnings", title: "边界与雷区", derived: false },
  { id: "timeline", kind: "timeline", title: "时间线演变", derived: false },
  { id: "evidence", kind: "evidence", title: "证据附录", derived: true },
]);

export const KINDS = Object.freeze(["claims", "timeline", "warnings"]);
export const CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);
export const EVIDENCE_KINDS_HINT = Object.freeze(["message", "doc", "email", "note", "derived"]);

/** knowledge/text anchors look like [k0012] or [k0012:t3]. */
export const ANCHOR_PATTERN = /^[a-z][a-z0-9]{0,15}\d{3,}(?::t\d+)?$/;

/** Private mode forbids any run of this many verbatim source characters in the prose. */
export const PRIVATE_QUOTE_RUN = 12;

/** Titles that say nothing about the person. */
const GENERIC_TITLES = new Set([
  "",
  "view",
  "person view",
  "distilly",
  "person",
  "画像",
  "个人画像",
  "人物画像",
  "profile",
]);

const MAX_TITLE = 120;
const MAX_ITEM_TEXT = 280;

const SECTION_IDS = REQUIRED_SECTIONS.map((entry) => entry.id);
const AUTHORED = REQUIRED_SECTIONS.filter((entry) => !entry.derived);

function diagnostic(code, severity, message, subject, evidence, supportedFixes) {
  return {
    code,
    severity,
    message,
    subject: { path: subject.path, identity: subject.identity ?? null },
    evidence: evidence ?? {},
    supportedFixes: supportedFixes ?? [],
  };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Keep only letters and digits: punctuation and spacing must not hide a verbatim run. */
export function significantText(value) {
  return String(value ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Longest verbatim overlap between prose and a source quote, in significant characters.
 * @returns {{run: string, length: number} | null}
 */
export function verbatimRun(prose, quote, threshold = PRIVATE_QUOTE_RUN) {
  const haystack = significantText(prose);
  const needle = significantText(quote);
  if (needle.length < threshold || haystack.length < threshold) return null;
  const seen = new Set();
  for (let index = 0; index + threshold <= needle.length; index += 1) {
    const gram = needle.slice(index, index + threshold);
    if (seen.has(gram)) continue;
    seen.add(gram);
    const at = haystack.indexOf(gram);
    if (at === -1) continue;
    let end = at + threshold;
    while (
      end < haystack.length &&
      index + (end - at) < needle.length &&
      haystack[end] === needle[index + (end - at)]
    ) {
      end += 1;
    }
    return { run: haystack.slice(at, end), length: end - at };
  }
  return null;
}

export function expectedSlug(viewPath) {
  const name = basename(String(viewPath ?? ""));
  const match = /^(.*)\.view\.json$/.exec(name);
  return match ? match[1] : null;
}

class Report {
  constructor() {
    this.diagnostics = [];
  }

  add(code, severity, message, subject, evidence, supportedFixes) {
    this.diagnostics.push(diagnostic(code, severity, message, subject, evidence, supportedFixes));
  }

  error(...args) {
    this.add(...args.slice(0, 1), "error", ...args.slice(1));
  }

  warn(...args) {
    this.add(...args.slice(0, 1), "warning", ...args.slice(1));
  }

  get errors() {
    return this.diagnostics.filter((entry) => entry.severity === "error");
  }

  get warnings() {
    return this.diagnostics.filter((entry) => entry.severity === "warning");
  }
}

function checkMeta(report, meta, slug) {
  if (!isPlainObject(meta)) {
    report.error(
      "VIEW_META_MISSING",
      "meta is required: { slug, title, lang?, generated_at?, shareable? }",
      { path: "meta", identity: null },
      { observed: meta === undefined ? "undefined" : typeof meta },
      ['add "meta": { "slug": "<slug>", "title": "<human title>" }'],
    );
    return;
  }

  if (!isNonEmptyString(meta.slug)) {
    report.error(
      "VIEW_SLUG_MISSING",
      "meta.slug is required and must match the file name views/<slug>.view.json",
      { path: "meta.slug", identity: null },
      { observed: meta.slug ?? null, expected: slug },
      [slug ? `set "slug": "${slug}"` : "set meta.slug to the person slug"],
    );
  } else if (slug && meta.slug !== slug) {
    report.error(
      "VIEW_SLUG_MISMATCH",
      `meta.slug "${meta.slug}" does not match the file name slug "${slug}"`,
      { path: "meta.slug", identity: meta.slug },
      { observed: meta.slug, expected: slug },
      [`set "slug": "${slug}"`, `or rename the file to ${meta.slug}.view.json`],
    );
  }

  if (!isNonEmptyString(meta.title)) {
    report.error(
      "VIEW_TITLE_MISSING",
      "meta.title is required: the page heading cannot be derived from the slug",
      { path: "meta.title", identity: null },
      { observed: meta.title ?? null },
      ['add "title": "<人名/代号> · 个人画像"'],
    );
  } else {
    const trimmed = meta.title.trim();
    if (GENERIC_TITLES.has(trimmed.toLowerCase())) {
      report.warn(
        "VIEW_TITLE_GENERIC",
        `meta.title "${trimmed}" is a placeholder, not a person-specific title`,
        { path: "meta.title", identity: trimmed },
        { observed: trimmed, expected: "a person-specific title" },
        ["use a title that names the person, e.g. \"张三 · 沟通与协作画像\""],
      );
    }
    if (trimmed.length > MAX_TITLE) {
      report.warn(
        "VIEW_TITLE_TOO_LONG",
        `meta.title is ${trimmed.length} characters; keep it under ${MAX_TITLE}`,
        { path: "meta.title", identity: trimmed.slice(0, 24) },
        { observed: trimmed.length, expected: `<= ${MAX_TITLE}` },
        ["shorten the title"],
      );
    }
  }
}

function checkSections(report, sections, evidenceIndex, options = {}) {
  const allowMissing = options.allowMissing === true;
  const thin = (code, message, subject, evidence, fixes) =>
    allowMissing ? report.warn(code, message, subject, evidence, fixes) : report.error(code, message, subject, evidence, fixes);
  if (!Array.isArray(sections)) {
    report.error(
      "VIEW_SECTIONS_MISSING",
      "sections must be an array holding the seven authored segments",
      { path: "sections", identity: null },
      { observed: sections === undefined ? "undefined" : typeof sections },
      [`add "sections" with: ${AUTHORED.map((entry) => entry.id).join(", ")}`],
    );
    return { items: 0, cited: new Set() };
  }

  const seen = new Map();
  let itemCount = 0;
  const cited = new Set();

  sections.forEach((section, index) => {
    const path = `sections[${index}]`;
    if (!isPlainObject(section)) {
      report.error("VIEW_SECTION_INVALID", `${path} must be an object`, { path, identity: null }, { observed: typeof section }, ["replace it with { id, kind, title, items[] }"]);
      return;
    }

    const id = isNonEmptyString(section.id) ? section.id : null;
    const identity = id ?? null;
    if (!id) {
      report.error("VIEW_SECTION_ID_MISSING", `${path} needs a string id`, { path: `${path}.id`, identity: null }, { observed: section.id ?? null }, [`use one of: ${SECTION_IDS.join(", ")}`]);
    } else if (!SECTION_IDS.includes(id)) {
      report.error(
        "VIEW_SECTION_UNKNOWN",
        `${path}.id "${id}" is not one of the eight page segments`,
        { path: `${path}.id`, identity: id },
        { observed: id, expected: SECTION_IDS },
        [`rename it to one of: ${SECTION_IDS.join(", ")}`],
      );
    } else if (seen.has(id)) {
      report.error(
        "VIEW_SECTION_DUPLICATE",
        `section "${id}" appears more than once`,
        { path, identity: id },
        { observed: index, firstIndex: seen.get(id) },
        ["keep a single section per id"],
      );
    } else {
      seen.set(id, index);
    }

    const expected = REQUIRED_SECTIONS.find((entry) => entry.id === id);
    if (expected && expected.derived) {
      report.error(
        "VIEW_SECTION_DERIVED",
        `section "${id}" is derived from evidence[] and must not be authored`,
        { path, identity: id },
        { observed: section.kind ?? null, expected: "remove this section" },
        ["delete it and describe the anchors in evidence[] instead"],
      );
    } else if (expected && section.kind !== expected.kind) {
      report.error(
        "VIEW_KIND_INVALID",
        `${path}.kind must be "${expected.kind}" for section "${id}" (got ${JSON.stringify(section.kind ?? null)})`,
        { path: `${path}.kind`, identity: id },
        { observed: section.kind ?? null, expected: expected.kind, allowed: KINDS },
        [`set "kind": "${expected.kind}"`],
      );
    } else if (!expected && !KINDS.includes(section.kind)) {
      report.error(
        "VIEW_KIND_INVALID",
        `${path}.kind must be one of ${KINDS.join("|")}`,
        { path: `${path}.kind`, identity },
        { observed: section.kind ?? null, allowed: KINDS },
        [`set "kind" to one of: ${KINDS.join(", ")}`],
      );
    }

    if (!Array.isArray(section.items)) {
      report.error("VIEW_SECTION_ITEMS_MISSING", `${path}.items must be an array`, { path: `${path}.items`, identity }, { observed: typeof section.items }, ["add an items array with at least one entry"]);
      return;
    }
    if (section.items.length === 0) {
      report.error(
        "VIEW_SECTION_EMPTY",
        `section "${id ?? index}" has no items; every page segment must be non-empty`,
        { path: `${path}.items`, identity },
        { observed: 0, expected: ">= 1" },
        ["add a claim with text, anchors and confidence"],
      );
    }

    section.items.forEach((item, itemIndex) => {
      const itemPath = `${path}.items[${itemIndex}]`;
      itemCount += 1;
      if (!isPlainObject(item)) {
        report.error("VIEW_ITEM_INVALID", `${itemPath} must be an object`, { path: itemPath, identity: null }, { observed: typeof item }, ["replace it with { text, anchors, confidence }"]);
        return;
      }
      const text = isNonEmptyString(item.text) ? item.text.trim() : null;
      if (!text) {
        report.error("VIEW_ITEM_TEXT_MISSING", `${itemPath}.text must be a non-empty string`, { path: `${itemPath}.text`, identity }, { observed: item.text ?? null }, ["write the conclusion in one sentence"]);
      } else if (text.length > MAX_ITEM_TEXT) {
        report.warn(
          "VIEW_ITEM_TEXT_TOO_LONG",
          `${itemPath}.text is ${text.length} characters; split it for readability`,
          { path: `${itemPath}.text`, identity: text.slice(0, 24) },
          { observed: text.length, expected: `<= ${MAX_ITEM_TEXT}` },
          ["split the sentence or move detail into the evidence note"],
        );
      }

      const anchors = Array.isArray(item.anchors) ? item.anchors : null;
      if (!anchors || anchors.length === 0) {
        thin(
          "VIEW_ANCHOR_MISSING",
          `${itemPath} needs at least one evidence anchor`,
          { path: `${itemPath}.anchors`, identity: identity ?? text?.slice(0, 24) ?? null },
          { observed: anchors === null ? typeof item.anchors : "[]" },
          ['add "anchors": ["k0012"]', "never state a conclusion the ledger cannot support"],
        );
      } else {
        anchors.forEach((anchor, anchorIndex) => {
          const anchorPath = `${itemPath}.anchors[${anchorIndex}]`;
          if (typeof anchor !== "string" || !ANCHOR_PATTERN.test(anchor)) {
            report.error(
              "VIEW_ANCHOR_FORMAT",
              `${anchorPath} = ${JSON.stringify(anchor ?? null)} is not a ledger anchor like "k0012" or "k0012:t3"`,
              { path: anchorPath, identity: String(anchor ?? "") },
              { observed: anchor ?? null, pattern: String(ANCHOR_PATTERN) },
              ["copy the anchor id from knowledge/text/<source>.md, e.g. k0012"],
            );
            return;
          }
          cited.add(anchor);
          if (evidenceIndex.size > 0 && !evidenceIndex.has(anchor)) {
            report.error(
              "VIEW_ANCHOR_UNKNOWN",
              `${anchorPath} "${anchor}" has no entry in evidence[], so the appendix cannot resolve it`,
              { path: anchorPath, identity: anchor },
              { observed: anchor, known: [...evidenceIndex.keys()].slice(0, 20) },
              [`add { "anchor": "${anchor}", "source": "<source>", "kind": "message", "path": "knowledge/text/<source>.md" } to evidence[]`],
            );
          }
        });
      }

      if (!CONFIDENCE_LEVELS.includes(item.confidence)) {
        report.error(
          "VIEW_CONFIDENCE_INVALID",
          `${itemPath}.confidence must be one of ${CONFIDENCE_LEVELS.join("|")}`,
          { path: `${itemPath}.confidence`, identity: identity ?? text?.slice(0, 24) ?? null },
          { observed: item.confidence ?? null, allowed: CONFIDENCE_LEVELS },
          [`set "confidence": "high" | "medium" | "low"`],
        );
      }

      if (section.kind === "timeline" && !isNonEmptyString(item.at)) {
        thin(
          "VIEW_TIMELINE_AT_MISSING",
          `${itemPath}.at is required for timeline entries`,
          { path: `${itemPath}.at`, identity: text?.slice(0, 24) ?? null },
          { observed: item.at ?? null },
          ['add "at": "2024-03" or an ISO date'],
        );
      }

      if (section.kind === "warnings" && item.severity !== undefined && !CONFIDENCE_LEVELS.includes(item.severity)) {
        report.warn(
          "VIEW_SEVERITY_INVALID",
          `${itemPath}.severity should be one of ${CONFIDENCE_LEVELS.join("|")}`,
          { path: `${itemPath}.severity`, identity: text?.slice(0, 24) ?? null },
          { observed: item.severity, allowed: CONFIDENCE_LEVELS },
          ['set "severity": "high" | "medium" | "low" or drop the field'],
        );
      }
    });
  });

  AUTHORED.forEach((entry, order) => {
    if (!seen.has(entry.id)) {
      report.error(
        "VIEW_SECTION_MISSING",
        `the page segment "${entry.id}" (${entry.title}) is missing`,
        { path: `sections[${entry.id}]`, identity: entry.id },
        { observed: [...seen.keys()], expected: AUTHORED.map((item) => item.id) },
        [`add { "id": "${entry.id}", "kind": "${entry.kind}", "title": "${entry.title}", "items": [...] }`],
      );
      return;
    }
    const actual = seen.get(entry.id);
    if (actual !== order) {
      report.warn(
        "VIEW_SECTION_ORDER",
        `section "${entry.id}" sits at position ${actual + 1}; the page order is fixed at position ${order + 1}`,
        { path: `sections[${actual}]`, identity: entry.id },
        { observed: actual, expected: order },
        ["reorder sections to: " + AUTHORED.map((item) => item.id).join(" -> ")],
      );
    }
  });

  return { items: itemCount, cited };
}

function checkEvidence(report, evidence) {
  const index = new Map();
  if (!Array.isArray(evidence)) {
    report.error(
      "VIEW_EVIDENCE_MISSING",
      "evidence must be an array: it renders the eighth segment (证据附录) and resolves every anchor",
      { path: "evidence", identity: null },
      { observed: evidence === undefined ? "undefined" : typeof evidence },
      ['add "evidence": [{ "anchor": "k0012", "source": "feishu", "kind": "message", "path": "knowledge/text/feishu.md" }]'],
    );
    return index;
  }
  if (evidence.length === 0) {
    report.error(
      "VIEW_EVIDENCE_EMPTY",
      "evidence[] is empty: the evidence appendix would be an empty page segment",
      { path: "evidence", identity: null },
      { observed: 0, expected: ">= 1" },
      ["copy the anchors used by the claims from knowledge/text/<source>.md"],
    );
    return index;
  }

  evidence.forEach((entry, position) => {
    const path = `evidence[${position}]`;
    if (!isPlainObject(entry)) {
      report.error("VIEW_EVIDENCE_INVALID", `${path} must be an object`, { path, identity: null }, { observed: typeof entry }, ["replace it with { anchor, source, kind }"]);
      return;
    }
    const identity = isNonEmptyString(entry.anchor) ? entry.anchor : null;
    if (!identity || !ANCHOR_PATTERN.test(identity)) {
      report.error(
        "VIEW_EVIDENCE_INVALID",
        `${path}.anchor must look like "k0012" or "k0012:t3"`,
        { path: `${path}.anchor`, identity },
        { observed: entry.anchor ?? null, pattern: String(ANCHOR_PATTERN) },
        ['set "anchor" to the id printed in knowledge/text/<source>.md'],
      );
      return;
    }
    if (index.has(identity)) {
      report.error(
        "VIEW_EVIDENCE_DUPLICATE",
        `evidence anchor "${identity}" appears more than once`,
        { path, identity },
        { observed: position, firstPosition: index.get(identity).position },
        ["merge the duplicate entries"],
      );
      return;
    }
    index.set(identity, { entry, position });

    if (!isNonEmptyString(entry.source)) {
      report.error(
        "VIEW_EVIDENCE_INVALID",
        `${path}.source is required (which channel the anchor came from)`,
        { path: `${path}.source`, identity },
        { observed: entry.source ?? null },
        ['set "source": "feishu" | "slack" | "email" | "doc" | ...'],
      );
    }
    if (!isNonEmptyString(entry.kind)) {
      report.warn(
        "VIEW_EVIDENCE_KIND_MISSING",
        `${path}.kind is missing; the appendix badge will read "source"`,
        { path: `${path}.kind`, identity },
        { observed: entry.kind ?? null, suggested: EVIDENCE_KINDS_HINT },
        [`set "kind": "message" (or ${EVIDENCE_KINDS_HINT.join("/")})`],
      );
    }
    if (isNonEmptyString(entry.path) && /^([a-z]+:)?\//i.test(entry.path.trim())) {
      report.warn(
        "VIEW_EVIDENCE_PATH_ABSOLUTE",
        `${path}.path should stay relative to the Skill directory`,
        { path: `${path}.path`, identity },
        { observed: entry.path },
        ["use knowledge/text/<source>.md or knowledge/raw/<source>/... "],
      );
    }
  });

  return index;
}

function checkPrivacy(report, view, evidenceIndex, shareable) {
  if (shareable) return { leaks: 0 };
  const quotes = [];
  for (const [anchor, { entry }] of evidenceIndex) {
    if (isNonEmptyString(entry.quote)) quotes.push({ anchor, quote: entry.quote });
  }
  if (quotes.length === 0) return { leaks: 0 };

  let leaks = 0;
  const subjects = [];
  const meta = isPlainObject(view.meta) ? view.meta : {};
  for (const field of ["title", "subtitle"]) {
    if (isNonEmptyString(meta[field])) subjects.push({ path: `meta.${field}`, identity: field, text: meta[field] });
  }
  if (Array.isArray(view.sections)) {
    view.sections.forEach((section, sectionIndex) => {
      if (!isPlainObject(section)) return;
      if (isNonEmptyString(section.summary)) {
        subjects.push({ path: `sections[${sectionIndex}].summary`, identity: section.id ?? null, text: section.summary });
      }
      if (!Array.isArray(section.items)) return;
      section.items.forEach((item, itemIndex) => {
        if (isPlainObject(item) && isNonEmptyString(item.text)) {
          subjects.push({
            path: `sections[${sectionIndex}].items[${itemIndex}].text`,
            identity: section.id ?? null,
            text: item.text,
          });
        }
      });
    });
  }

  for (const subject of subjects) {
    for (const source of quotes) {
      const hit = verbatimRun(subject.text, source.quote);
      if (!hit) continue;
      leaks += 1;
      report.error(
        "VIEW_QUOTE_LEAK",
        `${subject.path} repeats ${hit.length} verbatim characters from ${source.anchor}; private mode must paraphrase`,
        { path: subject.path, identity: subject.identity },
        { run: hit.run, runLength: hit.length, anchor: source.anchor, threshold: PRIVATE_QUOTE_RUN },
        [
          "rewrite the sentence as a conclusion (no verbatim source wording)",
          "or render with --shareable when the audience may see quotes",
        ],
      );
    }
  }
  return { leaks };
}

/**
 * Coerce a loosely shaped view.json into the canonical shape.
 *
 * Hand-written view files drift: a section may carry `items` instead of `claims`,
 * confidence may be missing, a title may be absent. `checkView` reports those as
 * problems — which is right — but callers still need a *usable* object (for the
 * slug, for the receipt), so this returns one plus a note per coercion applied.
 *
 * Idempotent by construction: every step only fills a gap or replaces a wrong
 * type, so running it twice yields the same view and no further notes.
 *
 * @returns {{view: object|null, notes: string[]}}
 */
export function normalizeView(raw) {
  const notes = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { view: null, notes: ["view.json must be a JSON object"] };
  }

  const view = { ...raw };

  if (view.meta === null || typeof view.meta !== "object" || Array.isArray(view.meta)) {
    if (view.meta !== undefined) notes.push("meta was not an object; replaced with {}");
    view.meta = {};
  } else {
    view.meta = { ...view.meta };
  }
  if (typeof view.meta.slug !== "string" || view.meta.slug.trim() === "") {
    if (view.meta.slug !== undefined) notes.push("meta.slug was not a non-empty string; dropped");
    delete view.meta.slug;
  }

  const rawSections = Array.isArray(view.sections) ? view.sections : [];
  if (!Array.isArray(view.sections) && view.sections !== undefined) {
    notes.push("sections was not an array; replaced with []");
  }
  view.sections = rawSections.map((section, index) => {
    const expected = REQUIRED_SECTIONS[index];
    if (section === null || typeof section !== "object" || Array.isArray(section)) {
      notes.push(`sections[${index}] was not an object; replaced with an empty section`);
      return { id: expected?.id ?? `section-${index + 1}`, kind: expected?.kind ?? "claims", title: expected?.title ?? "", items: [] };
    }
    const next = { ...section };
    if (typeof next.id !== "string" || next.id === "") {
      next.id = expected?.id ?? `section-${index + 1}`;
      notes.push(`sections[${index}].id was missing; used "${next.id}"`);
    }
    if (!KINDS.includes(next.kind)) {
      next.kind = expected?.kind ?? "claims";
      notes.push(`sections[${index}].kind was not one of ${KINDS.join("/")}; used "${next.kind}"`);
    }
    if (typeof next.title !== "string") {
      next.title = expected?.title ?? "";
      notes.push(`sections[${index}].title was not a string; used "${next.title}"`);
    }
    if (next.kind === "evidence") {
      if (!Array.isArray(next.rows)) next.rows = [];
      delete next.items;
      return next;
    }
    const items = Array.isArray(next.items) ? next.items : Array.isArray(next.claims) ? next.claims : [];
    if (!Array.isArray(next.items) && Array.isArray(next.claims)) {
      notes.push(`sections[${index}] used "claims"; read as "items"`);
    }
    next.items = items.map((item, itemIndex) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        notes.push(`sections[${index}].items[${itemIndex}] was not an object; replaced`);
        return { text: "", confidence: "low", evidence: [] };
      }
      const entry = { ...item };
      if (typeof entry.text !== "string") {
        entry.text = typeof entry.claim === "string" ? entry.claim : "";
        notes.push(`sections[${index}].items[${itemIndex}].text was missing`);
      }
      if (!CONFIDENCE_LEVELS.includes(entry.confidence)) {
        entry.confidence = "low";
        notes.push(`sections[${index}].items[${itemIndex}].confidence was not one of ${CONFIDENCE_LEVELS.join("/")}; used "low"`);
      }
      if (!Array.isArray(entry.evidence)) {
        entry.evidence = typeof entry.evidence === "string" ? [entry.evidence] : [];
        notes.push(`sections[${index}].items[${itemIndex}].evidence was not an array`);
      }
      return entry;
    });
    delete next.claims;
    return next;
  });

  if (!Array.isArray(view.evidence)) {
    if (view.evidence !== undefined) notes.push("evidence was not an array; replaced with []");
    view.evidence = [];
  } else {
    view.evidence = view.evidence.map((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        notes.push(`evidence[${index}] was not an object; replaced`);
        return { anchor: "", text: "" };
      }
      const next = { ...entry };
      if (typeof next.anchor !== "string") {
        next.anchor = typeof next.id === "string" ? next.id : "";
        notes.push(`evidence[${index}].anchor was missing`);
      }
      if (typeof next.text !== "string") {
        next.text = "";
        notes.push(`evidence[${index}].text was missing`);
      }
      return next;
    });
  }

  return { view, notes };
}

/**
 * Validate one view.json document.
 * @param {unknown} view parsed view.json
 * @param {{viewPath?: string, shareable?: boolean}} [options]
 */
export function checkView(view, options = {}) {
  // `allowMissing` is opt-in and narrow: it downgrades "a segment is thin" from
  // error to warning, and nothing else. A claim that cites a nonexistent anchor is
  // still an error with or without it.
  const allowMissing = options.allowMissing === true;
  const report = new Report();
  const slug = expectedSlug(options.viewPath);
  const shareable = options.shareable === true;

  if (!isPlainObject(view)) {
    report.error(
      "VIEW_DOC_INVALID",
      "view.json must be a JSON object",
      { path: options.viewPath ?? "view.json", identity: null },
      { observed: view === null ? "null" : typeof view },
      ['start from { "meta": {...}, "sections": [...], "evidence": [...] }'],
    );
    return finish(report, { shareable, sections: 0, items: 0, evidence: 0, cited: 0, anchors: 0 });
  }

  checkMeta(report, view.meta, slug);
  const evidenceIndex = checkEvidence(report, view.evidence);
  const sections = checkSections(report, view.sections, evidenceIndex, { allowMissing });
  const privacy = checkPrivacy(report, view, evidenceIndex, shareable);

  const uncited = [...evidenceIndex.keys()].filter((anchor) => !sections.cited.has(anchor));
  for (const anchor of uncited) {
    const { position } = evidenceIndex.get(anchor);
    report.warn(
      "VIEW_EVIDENCE_UNCITED",
      `evidence "${anchor}" is not referenced by any claim`,
      { path: `evidence[${position}]`, identity: anchor },
      { observed: anchor, cited: [...sections.cited] },
      ["cite it from a claim", "or drop the entry so the appendix matches the prose"],
    );
  }

  return finish(report, {
    shareable,
    sections: Array.isArray(view.sections) ? view.sections.length : 0,
    items: sections.items,
    evidence: evidenceIndex.size,
    cited: sections.cited.size,
    anchors: evidenceIndex.size,
    leaks: privacy.leaks,
    uncited: uncited.length,
  });
}

function finish(report, summary) {
  const errors = report.errors;
  const warnings = report.warnings;
  return {
    ok: errors.length === 0,
    diagnostics: report.diagnostics,
    errors,
    warnings,
    summary: {
      shareable: summary.shareable === true,
      segments: REQUIRED_SECTIONS.length,
      sections: summary.sections ?? 0,
      items: summary.items ?? 0,
      evidence: summary.evidence ?? 0,
      anchors: summary.anchors ?? 0,
      cited: summary.cited ?? 0,
      uncited: summary.uncited ?? 0,
      quoteLeaks: summary.leaks ?? 0,
    },
  };
}

/** Human-readable one-liner for a diagnostic (CLI output). */
export function formatDiagnostic(entry) {
  const where = entry.subject.path ?? "view.json";
  return `${entry.severity.toUpperCase()} ${entry.code} ${where}: ${entry.message}` +
    (entry.supportedFixes.length > 0 ? `\n    fix: ${entry.supportedFixes.join(" | ")}` : "");
}

/** Aggregate counters used by the receipt. */
export function anchorCounts(view) {
  const cited = new Set();
  if (isPlainObject(view) && Array.isArray(view.sections)) {
    for (const section of view.sections) {
      if (!isPlainObject(section) || !Array.isArray(section.items)) continue;
      for (const item of section.items) {
        if (isPlainObject(item) && Array.isArray(item.anchors)) {
          for (const anchor of item.anchors) if (typeof anchor === "string") cited.add(anchor);
        }
      }
    }
  }
  const total = isPlainObject(view) && Array.isArray(view.evidence) ? view.evidence.length : 0;
  return { total, cited: cited.size };
}
