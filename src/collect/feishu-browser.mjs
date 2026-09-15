/**
 * feishu-browser.mjs — Feishu pages a **host** captured with computer use.
 *
 * `tools/feishu_browser.py` drove Playwright against the user's Chrome profile.
 * v2 deliberately does not do that: driving a browser and injecting input is
 * computer use, which belongs to the host under an explicit consent token (see
 * `src/collect/x.mjs` and `docs/v2/CONTRACT.md` §4). So the port keeps what the
 * pipeline actually owns —
 *
 *   1. the consent gate (`collect:feishu:browser`, exit 2 while waiting),
 *   2. the plan that tells the host what to capture and how to hand it over,
 *   3. the verbatim sink for the capture, and
 *   4. the normalisation that turns it into `knowledge/text/*.md` with anchors,
 *
 * — and leaves the browsing itself to the host. Nothing here imports playwright,
 * and no code path can open a page or send an event.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { KnowledgeStore } from "../knowledge/store.mjs";
import { loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile, buildDocument, recordsFromCharSpans, stripHtml } from "../parse/common.mjs";
import { consentTokenFingerprint, verify as verifyConsent } from "../consent.mjs";
import { redact } from "./feishu.mjs";

export const CHANNEL = "feishu";
export const MODE = "browser";
export const BROWSER_SCOPE = "collect:feishu:browser";
/** What the host must be able to do; printed in the plan, asserted by the tests. */
export const PRODUCER = "host:computer-use";

/** The URL→page-type table the Python tool used, plus the chat case. */
export function detectPageType(url) {
  const text = String(url ?? "");
  if (text === "") return null;
  if (text.includes("/wiki/")) return "wiki";
  if (text.includes("/docx/") || text.includes("/docs/")) return "doc";
  if (text.includes("/sheets/") || text.includes("/spreadsheets/")) return "sheet";
  if (text.includes("/base/")) return "base";
  if (text.includes("/messages/") || text.includes("/chat/")) return "chat";
  return null;
}

/** What the host has to do, spelled out so a coding agent can follow it. */
export function browserPlan({ target = null, url = null, pageType = null, scope = BROWSER_SCOPE, now = new Date().toISOString() } = {}) {
  return {
    scope,
    target,
    url,
    page_type: pageType,
    prepared_at: now,
    steps: [
      "Host (computer use): open the Feishu page in the browser the user is signed in to — this module never opens one.",
      pageType === "chat"
        ? "Host: scroll the chat back far enough to cover the requested window, then copy the visible transcript."
        : "Host: open the document and copy its text (a sheet: copy the used range as CSV/TSV).",
      "Host: write the copied text (or the saved HTML) to a file.",
      `Host: register the capture with: distilly collect feishu --mode browser --consent <token> --capture <file> --url <page url>`,
      "This module then stores the capture verbatim, normalises it into knowledge/text with anchors, and writes the ledger entry.",
    ],
    forbidden: [
      "this module never drives a browser, never injects into one and never sends input events",
      "the capture is host-reported: its provenance says so rather than claiming a verified session",
    ],
  };
}

const looksLikeHtml = (text) => /<\/?(?:html|body|div|p|span|table|td)\b/i.test(text);

/**
 * Store and record one host capture.
 *
 * @param {{env?: object, root?: string, person: string, family?: string, consentToken?: string,
 *          capturePath?: string, url?: string, pageType?: string, label?: string, producer?: string,
 *          now?: string, readFile?: Function, scope?: string}} input
 */
export function collectBrowser(input = {}) {
  const {
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    scope = BROWSER_SCOPE,
    consentToken,
    capturePath,
    url = null,
    label,
    producer = PRODUCER,
    now = new Date().toISOString(),
    readFile = readFileSync,
  } = input;

  const pageType = input.pageType ?? detectPageType(url) ?? (url ? "page" : null);
  const base = {
    command: "collect",
    channel: CHANNEL,
    mode: MODE,
    ok: false,
    person: person ?? null,
    target: url,
    page_type: pageType,
    credential_file: null,
    inputs: [],
    outputs: [],
    anchors: { total: 0, cited: 0 },
    warnings: [],
    unavailable: [],
  };

  const verification = verifyConsent(consentToken, { env, scope });
  if (!verification.ok) {
    return {
      ok: false,
      exitCode: 2,
      receipt: {
        ...base,
        status: "waiting-for-user-consent",
        consent_scope: scope,
        errors: [`waiting for user consent (${verification.reason})`],
        unavailable: [
          {
            channel: CHANNEL,
            reason: `waiting for user consent: ${verification.reason}`,
            scope,
            remediation: verification.remediation,
          },
        ],
      },
    };
  }

  const consent = {
    scope: verification.record.scope,
    granted_at: verification.record.granted_at,
    expires_at: verification.record.expires_at,
    token_sha256_12: consentTokenFingerprint(consentToken),
  };
  const provenance = { method: "browser-host", producer, confidence: "host-reported" };

  if (!capturePath) {
    return {
      ok: true,
      exitCode: 0,
      receipt: { ...base, ok: true, status: "awaiting-host-capture", consent, provenance, plan: browserPlan({ target: url, url, pageType, scope, now }) },
    };
  }

  let bytes;
  try {
    bytes = readFile(capturePath);
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      receipt: {
        ...base,
        errors: [`cannot read --capture ${capturePath}: ${redact(error.message)}`],
        consent,
        unavailable: [
          { channel: CHANNEL, reason: `capture-unreadable: ${redact(error.message)}`, remediation: ["point --capture at a file produced by the host"] },
        ],
      },
    };
  }

  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  const decoded = raw.toString("utf8");
  const html = looksLikeHtml(decoded);
  const text = html ? stripHtml(decoded).text : decoded;
  const name = label ?? `browser-${pageType ?? "page"}-${String(now).slice(0, 10)}`;
  // The capture is stored **verbatim**: the raw payload is what the host handed
  // over, not the text we derived from it. Building the `SourceFile` from the
  // stripped text (as this did) meant the HTML was gone after a run — the one
  // thing the raw vault exists to prevent — and the anchor offsets pointed into a
  // file that was never on disk in that form.
  const file = new SourceFile({
    path: `${name}${html ? ".html" : ".txt"}`,
    name: `${name}${html ? ".html" : ".txt"}`,
    raw: new Uint8Array(raw),
  });

  const spans = [];
  const pattern = /[^\n]+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // Paragraph text only: `assembleContent` locates each one inside the raw
    // payload, so an anchor points at the bytes the host captured. A paragraph the
    // raw HTML does not contain verbatim keeps a `null` range rather than a guess.
    spans.push({ text: match[0], kind: "paragraph" });
  }
  const document = buildDocument({
    parser: "feishu-browser",
    format: pageType,
    kind: pageType === "chat" ? "message" : "doc",
    method: "browser-host",
    credentialed: false,
    source: CHANNEL,
    origin: url ?? `${name}.txt`,
    files: [file],
    records: spans,
    meta: { page_type: pageType, url, producer },
  });

  const store = new KnowledgeStore(join(resolve(root), "skills", family, person));
  const ledger = loadLedger(store);
  const recorded = recordDocument(store, ledger, { ...document, fetched_at: now }, { fetched_at: now });
  // `buildEntry` keeps the pipeline's own fields; the capture's provenance is
  // added here so a reader can see this text came from a host, not from an API.
  const entry = ledger.find((candidate) => candidate.id === recorded.entry.id);
  if (entry) {
    entry.url = url;
    entry.urls = url ? [url] : [];
    entry.provenance = provenance;
    entry.consent = consent;
    entry.host_capture = { file: capturePath, bytes: raw.length, sha256: recorded.written.files[0]?.sha256 ?? null, html: looksLikeHtml(decoded) };
  }
  saveLedger(store, ledger);

  const rawFile = recorded.written.files[0];
  const textFile = recorded.written.text;
  return {
    ok: true,
    exitCode: 0,
    receipt: {
      ...base,
      ok: true,
      status: "captured",
      consent,
      provenance,
      page_type: pageType,
      outputs: [
        ...(rawFile ? [{ path: rawFile.relativePath, sha256: rawFile.sha256, bytes: rawFile.bytes, kind: "raw" }] : []),
        ...(textFile ? [{ path: textFile.relativePath, sha256: textFile.sha256, bytes: textFile.bytes, kind: "text" }] : []),
      ],
      anchors: { total: recorded.entry?.anchor_count ?? 0, cited: 0 },
      entry: recorded.entry?.id ?? null,
      warnings: [...(document.warnings ?? []).map((warning) => warning.message ?? warning)],
      unavailable: [],
    },
  };
}

/* ------------------------------------------------------------------ CLI */

export function parseBrowserArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), consent: null, capture: null, url: null, label: null, scope: BROWSER_SCOPE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") continue;
    else if (arg === "--mode") {
      const value = argv[index + 1];
      if (value !== "browser") return { error: `feishu-browser handles --mode browser only (got ${value ?? "nothing"})` };
      index += 1;
    } else if (["--person", "--base-dir", "--consent", "--capture", "--url", "--label"].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      options[{ "--person": "person", "--base-dir": "baseDir", "--consent": "consent", "--capture": "capture", "--url": "url", "--label": "label" }[arg]] = value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else if (!options.url) options.url = arg;
    else return { error: `unexpected argument: ${arg}` };
  }
  if (!options.person) return { error: "--person is required" };
  if (!options.url) return { error: "collect feishu --mode browser needs --url <page url>" };
  return { options };
}

export function runCollectCli(argv, io = {}) {
  const out = typeof io.stdout === "function" ? io.stdout : (line) => process.stdout.write(`${line}\n`);
  const err = typeof io.stderr === "function" ? io.stderr : (line) => process.stderr.write(`${line}\n`);
  const parsed = parseBrowserArgs(argv);
  if (parsed.error) {
    return {
      ok: false,
      exitCode: 2,
      receipt: {
        command: "collect",
        channel: CHANNEL,
        mode: MODE,
        ok: false,
        warnings: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        errors: [parsed.error],
        unavailable: [{ channel: CHANNEL, reason: parsed.error, remediation: ["distilly collect feishu --help"] }],
      },
    };
  }
  const { options } = parsed;
  const result = collectBrowser({
    root: options.baseDir,
    person: options.person,
    consentToken: options.consent,
    capturePath: options.capture,
    url: options.url,
    label: options.label,
  });

  if (!options.json) {
    if (result.receipt.status === "waiting-for-user-consent") {
      err(`collect feishu (browser): ${result.receipt.errors[0]}`);
      for (const item of result.receipt.unavailable) for (const step of item.remediation ?? []) err(`  ${step}`);
    } else if (result.receipt.status === "awaiting-host-capture") {
      out("collect feishu (browser): waiting for the host capture");
      for (const step of result.receipt.plan.steps) out(`  ${step}`);
    } else if (result.ok) {
      out(`collect feishu (browser): ${result.receipt.anchors.total} anchor(s) from ${options.capture}`);
      for (const output of result.receipt.outputs) out(`  ${output.kind}: ${output.path}`);
    }
    for (const warning of result.receipt.warnings ?? []) err(`  warning: ${warning}`);
    for (const failure of result.receipt.errors ?? []) err(`  error: ${failure}`);
  }
  return result;
}
