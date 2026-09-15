/**
 * distilly view render — template + views/<slug>.view.json -> views/<slug>.html
 * plus evidence/renders/receipt.json.
 *
 * Guarantees:
 *   - single file, offline, no external request (the template's CSP forbids them);
 *   - deterministic: the same inputs produce the same bytes, twice in a row;
 *   - private by default: without --shareable no source wording reaches the HTML;
 *   - the renderer invents nothing: every byte of content comes from view.json.
 *
 * Zero runtime dependencies.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { anchorCounts, checkView, expectedSlug } from "./schema.mjs";

export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
export const TEMPLATE_PATH = join(packageRoot, "assets", "distilly-template.html");
export const VIEW_DATA_MARKER = "@@DISTILLY:VIEW_DATA@@";

const RECEIPT_RELATIVE = join("evidence", "renders", "receipt.json");

export class ViewError extends Error {
  constructor(message, diagnostics = [], supportedFixes = []) {
    super(message);
    this.name = "ViewError";
    this.diagnostics = diagnostics;
    this.supportedFixes = supportedFixes;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively sort object keys so the same document always serialises identically. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON (sorted keys, 2-space indent, trailing newline). */
export function canonicalJson(value, indent = 2) {
  return `${JSON.stringify(canonical(value), null, indent)}\n`;
}

/** JSON safe to inline inside <script type="application/json">. */
function embedJson(value) {
  return canonicalJson(value, 2)
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029")
    .trimEnd();
}

/** Read and parse one view.json. */
export function loadViewDocument(viewPath) {
  const absolute = resolve(viewPath);
  if (!existsSync(absolute)) {
    throw new ViewError(`view.json not found: ${absolute}`, [], [
      "run: distilly view check <slug>",
      "or pass --file <path/to/<slug>.view.json>",
    ]);
  }
  const text = readFileSync(absolute, "utf8");
  let view;
  try {
    view = JSON.parse(text);
  } catch (error) {
    throw new ViewError(`view.json is not valid JSON: ${error.message}`, [], [
      "fix the JSON syntax (trailing commas and comments are not allowed)",
      "or re-emit the document: distilly view render <slug>",
    ]);
  }
  return { view, text, path: absolute, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
}

/** Locate views/<slug>.view.json under a repository root (skills/<family>/<slug>/views/...). */
export function findViewDocuments(slug, root = process.cwd()) {
  const found = [];
  const direct = join(root, "views", `${slug}.view.json`);
  if (existsSync(direct)) found.push(direct);
  const skillsRoot = join(root, "skills");
  if (existsSync(skillsRoot) && statSync(skillsRoot).isDirectory()) {
    for (const family of readdirSync(skillsRoot)) {
      const candidate = join(skillsRoot, family, slug, "views", `${slug}.view.json`);
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}

function personDirOf(viewPath) {
  return dirname(dirname(resolve(viewPath)));
}

function relativeTo(base, target) {
  const rel = relative(base, target);
  return rel === "" ? "." : rel;
}

/** Deep-copy the payload the page receives, dropping quotes when the render is private. */
export function buildPayload(view, shareable) {
  const payload = {
    meta: isPlainObject(view.meta) ? { ...view.meta } : {},
    shareable: shareable === true,
    sections: Array.isArray(view.sections) ? view.sections : [],
    evidence: Array.isArray(view.evidence) ? view.evidence : [],
  };
  payload.meta.shareable = payload.shareable;
  if (!payload.shareable) {
    payload.evidence = payload.evidence.map((entry) =>
      isPlainObject(entry) ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "quote")) : entry,
    );
  }
  return payload;
}

/**
 * Render one view.json into a single-file HTML page and a receipt.
 * @param {{viewPath: string, outPath?: string, receiptPath?: string, templatePath?: string, shareable?: boolean, root?: string}} options
 */
export function renderView(options) {
  const shareable = options.shareable === true;
  // `renderView` re-runs the same check before writing, so the opt-in has to travel
  // with it: otherwise a page that passed `view check --allow-missing` still fails
  // to render, and the user sees a check error they just satisfied.
  const allowMissing = options.allowMissing === true;
  const templatePath = resolve(options.templatePath ?? TEMPLATE_PATH);
  const document = loadViewDocument(options.viewPath);
  const slug = expectedSlug(document.path) ?? (isPlainObject(document.view.meta) ? document.view.meta.slug : null);

  const report = checkView(document.view, { viewPath: document.path, shareable, allowMissing });
  if (!report.ok) {
    throw new ViewError(
      `view.json failed view check with ${report.errors.length} error(s); fix them before rendering`,
      report.diagnostics,
      ["run: distilly view check <slug>", "every diagnostic carries supportedFixes[]"],
    );
  }

  if (!existsSync(templatePath)) {
    throw new ViewError(`template not found: ${templatePath}`, [], [
      "run: node scripts/generate-template.mjs",
    ]);
  }
  const template = readFileSync(templatePath, "utf8");
  const markerCount = template.split(VIEW_DATA_MARKER).length - 1;
  if (markerCount !== 1) {
    throw new ViewError(
      `assets/distilly-template.html must contain exactly one ${VIEW_DATA_MARKER} marker (found ${markerCount})`,
      [],
      ["run: node scripts/generate-template.mjs", "never edit the generated template by hand"],
    );
  }

  const payload = buildPayload(document.view, shareable);
  const html = `${template.replace(VIEW_DATA_MARKER, embedJson(payload))}`;

  const personDir = personDirOf(document.path);
  const outPath = resolve(options.outPath ?? join(personDir, "views", `${slug ?? "view"}.html`));
  const receiptPath = resolve(options.receiptPath ?? join(personDir, RECEIPT_RELATIVE));

  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");

  const counts = anchorCounts(document.view);
  const inlined = shareable
    ? payload.evidence
        .filter((entry) => isPlainObject(entry) && typeof entry.quote === "string" && entry.quote.trim() !== "")
        .map((entry) => ({
          anchor: entry.anchor,
          source: entry.source ?? null,
          kind: entry.kind ?? null,
          path: entry.path ?? null,
          quote_sha256: sha256(entry.quote),
          quote_bytes: Buffer.byteLength(entry.quote, "utf8"),
        }))
    : [];

  const segments = [
    ...(Array.isArray(document.view.sections) ? document.view.sections : []).map((section) => ({
      id: section?.id ?? null,
      kind: section?.kind ?? null,
      items: Array.isArray(section?.items) ? section.items.length : 0,
    })),
    { id: "evidence", kind: "evidence", items: payload.evidence.length },
  ];

  const receipt = {
    command: "view render",
    person: slug,
    ok: true,
    shareable,
    generated_at: isPlainObject(document.view.meta) ? document.view.meta.generated_at ?? null : null,
    inputs: [
      { path: relativeTo(personDir, document.path), sha256: document.sha256, bytes: document.bytes },
    ],
    template: {
      path: relativeTo(packageRoot, templatePath),
      sha256: sha256(template),
      bytes: Buffer.byteLength(template, "utf8"),
    },
    outputs: [{ path: relativeTo(personDir, outPath), sha256: sha256(html), bytes: Buffer.byteLength(html, "utf8") }],
    anchors: { total: counts.total, cited: counts.cited },
    inlined_sources: inlined,
    segments,
    diagnostics: {
      errors: 0,
      warnings: report.warnings.length,
      codes: report.warnings.map((entry) => entry.code),
    },
    warnings: report.warnings.map((entry) => entry.message),
    unavailable: [],
  };

  writeFileSync(receiptPath, canonicalJson(receipt), "utf8");

  return {
    receipt,
    receiptPath,
    outPath,
    html,
    templatePath,
    document,
    report,
    receiptSha256: sha256(readFileSync(receiptPath)),
    receiptBytes: statSync(receiptPath).size,
  };
}

/** Files a rendered page must never contain: absolute URLs and remote references. */
export function offlineViolations(html) {
  const violations = [];
  for (const [needle, why] of [
    ['src="http', "external script/image source"],
    ["src='http", "external script/image source"],
    ['href="http', "external stylesheet/link"],
    ["@import", "CSS import"],
    ["url(http", "remote CSS url()"],
    ["//cdn.", "CDN reference"],
  ]) {
    if (html.includes(needle)) violations.push({ needle, why });
  }
  if (!html.includes("default-src 'none'")) violations.push({ needle: "Content-Security-Policy", why: "frozen CSP meta is missing" });
  return violations;
}

export { isAbsolute };
