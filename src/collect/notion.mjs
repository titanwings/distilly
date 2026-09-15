/**
 * notion.mjs — Notion pages, read with an internal integration token.
 *
 * Notion's read path is unusual: the API has almost no GETs — searching and
 * listing blocks are `POST`s that change nothing. The allowlist therefore names
 * those two POSTs explicitly and refuses everything else, which is the same
 * guarantee the GET-only channels get: there is no code path here that can create,
 * edit, delete or share anything.
 *
 * A fetched page becomes one ledger entry: the raw API responses verbatim under
 * `knowledge/raw/notion/`, and the block text as anchored paragraphs — the same
 * shape a harvested document has, so `retrospect` reads it without special cases.
 */

import { join, resolve } from "node:path";

import { KnowledgeStore } from "../knowledge/store.mjs";
import { loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile, buildDocument, recordsFromCharSpans } from "../parse/common.mjs";
import {
  CollectFailure,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RETRIES,
  loadCredential,
  readCheckpoint,
  redact,
  requestJson,
  scrub,
  writeCheckpoint,
  clearCheckpoint,
  writeRaw,
} from "./kit.mjs";

export const CHANNEL = "notion";
export const CONFIG_FILE = "notion_config.json";
export const ENV_KEYS = ["DISTILLY_NOTION_TOKEN", "NOTION_TOKEN"];
export const DEFAULT_BASE_URL = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";

/**
 * The only calls this module makes. `POST /v1/search` and `POST
 * /v1/databases/*\/query` are documented as read operations — they take a filter
 * and return rows; nothing is written.
 */
export const ALLOWED_CALLS = [
  { method: "GET", path: "/v1/blocks/" },
  { method: "GET", path: "/v1/pages/" },
  { method: "GET", path: "/v1/users/" },
  { method: "POST", path: "/v1/search" },
  { method: "POST", path: /^\/v1\/databases\/[^/]+\/query$/ },
];

const REMEDIATION = [
  "create an internal integration at https://www.notion.so/my-integrations and copy its token",
  "share the page with the integration (⋯ → Connections)",
  `write ~/.distilly/${CONFIG_FILE} as {"integration_token": "…"}`,
];

/** Block types whose text is dialogue or prose; everything else is named. */
const TEXT_BLOCKS = new Map([
  ["paragraph", null],
  ["heading_1", null],
  ["heading_2", null],
  ["heading_3", null],
  ["bulleted_list_item", null],
  ["numbered_list_item", null],
  ["quote", null],
  ["callout", null],
  ["toggle", null],
  ["to_do", null],
  ["code", null],
  ["template", null],
]);

/** Flatten `rich_text[]` (and a code block's `caption`) into plain text. */
export function blockText(block) {
  const type = block?.type;
  if (!type || !TEXT_BLOCKS.has(type)) return null;
  const payload = block[type] ?? {};
  const rich = Array.isArray(payload.rich_text) ? payload.rich_text : [];
  const text = rich.map((part) => part?.plain_text ?? part?.text?.content ?? "").join("");
  const caption = Array.isArray(payload.caption) ? payload.caption.map((part) => part?.plain_text ?? "").join("") : "";
  return `${text}${caption}`.trim();
}

/** How a page's title is rendered: the first rich-text of its title property. */
export function pageTitle(page) {
  const properties = page?.properties ?? {};
  for (const value of Object.values(properties)) {
    if (value?.type === "title" && Array.isArray(value.title)) {
      const text = value.title.map((part) => part?.plain_text ?? "").join("").trim();
      if (text !== "") return text;
    }
  }
  return page?.id ?? "untitled";
}

/**
 * Walk a page's children (breadth-first, depth-limited) and collect paragraphs.
 *
 * @returns {{paragraphs: string[], blocks: number, skipped: object, warnings: string[]}}
 */
export async function readBlocks(options) {
  const { fetchImpl, baseUrl, headers, rootBlockId, maxDepth = 2, maxBlocks = 500, maxRetries, sleep, secrets, onRetry, depth = 0 } = options;
  const paragraphs = [];
  const warnings = [];
  const skipped = {};
  let blocks = 0;
  let cursor = null;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const url = `${baseUrl}/blocks/${encodeURIComponent(rootBlockId)}/children?${params.toString()}`;
    const response = await requestJson({
      fetchImpl,
      url,
      method: "GET",
      headers,
      maxRetries,
      ...(sleep ? { sleep } : {}),
      secrets,
      allowlist: ALLOWED_CALLS,
      channel: CHANNEL,
      onRetry,
    });
    for (const block of response.json?.results ?? []) {
      blocks += 1;
      if (blocks > maxBlocks) break;
      const text = blockText(block);
      if (text !== null) {
        if (text !== "") paragraphs.push(text);
        continue;
      }
      if (block?.type === "child_page" && depth < maxDepth) {
        const child = await readBlocks({ ...options, rootBlockId: block.id, depth: depth + 1, maxBlocks: maxBlocks - blocks });
        paragraphs.push(...child.paragraphs);
        Object.assign(skipped, child.skipped);
        warnings.push(...child.warnings);
        blocks += child.blocks;
        continue;
      }
      const type = block?.type ?? "unknown";
      skipped[type] = (skipped[type] ?? 0) + 1;
    }
    cursor = response.json?.has_more ? response.json?.next_cursor ?? null : null;
  } while (cursor);

  if (Object.keys(skipped).length > 0) {
    warnings.push(
      `blocks without dialogue text were not anchored: ${Object.entries(skipped)
        .map(([type, count]) => `${type}×${count}`)
        .join(", ")}`,
    );
  }
  return { paragraphs, blocks, skipped, warnings };
}

/**
 * @param {{fetch?: Function, env?: object, root?: string, person: string, family?: string,
 *          pageId: string, maxDepth?: number, maxRetries?: number, sleep?: Function,
 *          now?: string, baseUrl?: string}} options
 */
export async function collect(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    pageId,
    maxDepth = 2,
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_NOTION_BASE_URL || DEFAULT_BASE_URL,
  } = options;

  const outputs = [];
  const warnings = [];
  const retries = [];
  const base = {
    command: "collect",
    channel: CHANNEL,
    mode: "api",
    ok: false,
    inputs: [],
    outputs,
    warnings,
    unavailable: [],
    credential_file: CONFIG_FILE,
    retries,
  };
  let secrets = [];
  const fail = (failure) => ({
    ok: false,
    exitCode: failure.exitCode ?? 1,
    receipt: scrub(
      {
        ...base,
        ok: false,
        person: person ?? null,
        page_id: pageId ?? null,
        errors: [redact(failure.message, secrets)],
        unavailable: [{ channel: CHANNEL, reason: redact(`${failure.reason}: ${failure.message}`, secrets), remediation: failure.remediation ?? [] }],
      },
      secrets,
    ),
  });

  try {
    if (!person) throw new CollectFailure("missing-person", "collect notion needs --person <slug>", { remediation: ["pass --person"] });
    if (!pageId) {
      throw new CollectFailure("missing-target", "collect notion needs --page-id <id|url>", {
        remediation: ["copy the page id from its URL (32 hex characters before the ?)"],
      });
    }
    const credential = loadCredential({ env, configFile: CONFIG_FILE, envKeys: ENV_KEYS, fields: ["integration_token"] });
    secrets = [credential.values.integration_token];
    base.credential_source = credential.source;

    const headers = {
      authorization: `Bearer ${credential.values.integration_token}`,
      "notion-version": NOTION_VERSION,
      accept: "application/json",
    };
    const id = normalisePageId(pageId);
    const onRetry = (info) => {
      retries.push(info);
      warnings.push(`retry ${info.attempt} after ${info.reason} (waited ${info.delayMs}ms)`);
    };

    const pageResponse = await requestJson({
      fetchImpl,
      url: `${baseUrl}/pages/${id}`,
      method: "GET",
      headers,
      maxRetries,
      ...(sleep ? { sleep } : {}),
      secrets,
      allowlist: ALLOWED_CALLS,
      channel: CHANNEL,
      onRetry,
    });
    const title = pageTitle(pageResponse.json);

    const knowledgeDir = join(resolve(root), "skills", family, person, "knowledge");
    const stored = writeRaw(knowledgeDir, CHANNEL, `${id}-page`, pageResponse.text);
    outputs.push({ path: stored.relativePath, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" });

    const read = await readBlocks({
      fetchImpl,
      baseUrl,
      headers,
      rootBlockId: id,
      maxDepth,
      maxRetries,
      sleep,
      secrets,
      onRetry,
    });
    warnings.push(...read.warnings);

    const text = [`# ${title}`, "", ...read.paragraphs].join("\n");
    if (read.paragraphs.length === 0) {
      throw new CollectFailure("no-text", `page ${id} has no paragraph blocks this client can read`, {
        remediation: ["share the page with the integration, or check that it has text blocks"],
      });
    }

    const file = new SourceFile({ path: `${id}.md`, name: `${id}.md`, raw: new Uint8Array(Buffer.from(text, "utf8")) });
    const spans = [];
    const pattern = /[^\n]+/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      spans.push({ text: match[0], charStart: match.index, charEnd: match.index + match[0].length, kind: "paragraph" });
    }
    const document = buildDocument({
      parser: "notion",
      format: "blocks",
      kind: "doc",
      method: "api-integration-token",
      credentialed: true,
      credential_source: credential.source,
      credential_file: CONFIG_FILE,
      source: CHANNEL,
      origin: `https://www.notion.so/${id}`,
      files: [file],
      records: recordsFromCharSpans(file, spans),
      meta: { title, blocks: read.blocks, page_id: id },
    });

    const store = new KnowledgeStore(join(resolve(root), "skills", family, person));
    const ledger = loadLedger(store);
    const recorded = recordDocument(store, ledger, { ...document, fetched_at: now }, { fetched_at: now });
    saveLedger(store, ledger);
    if (recorded.written.text) {
      outputs.push({
        path: recorded.written.text.relativePath,
        sha256: recorded.written.text.sha256,
        bytes: recorded.written.text.bytes,
        kind: "text",
      });
    }

    return {
      ok: true,
      exitCode: 0,
      receipt: scrub(
        {
          ...base,
          ok: true,
          person,
          page_id: id,
          title,
          blocks: read.blocks,
          paragraphs: read.paragraphs.length,
          text_entries: [recorded.entry?.id ?? null].filter(Boolean),
          anchors: { total: recorded.entry?.anchor_count ?? 0, cited: 0 },
          ledger: { path: store.ledgerPath, total: ledger.length },
          unavailable: [],
        },
        secrets,
      ),
    };
  } catch (error) {
    if (!(error instanceof CollectFailure)) {
      throw new CollectFailure("unexpected", redact(error?.message ?? String(error), secrets), {
        remediation: ["rerun with --json and report the receipt"],
      });
    }
    return fail(error);
  }
}

/** `https://www.notion.so/Title-<32 hex>?v=…` → `<32 hex>` (dashed ids accepted). */
export function normalisePageId(input) {
  const text = String(input ?? "").trim();
  const dashed = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (dashed) return dashed[0];
  const bare = text.match(/[0-9a-f]{32}/i);
  if (bare) {
    const value = bare[0];
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  if (/^[0-9a-f-]{36}$/i.test(text)) return text;
  throw new CollectFailure("bad-target", `cannot read a Notion page id out of "${text.slice(0, 60)}"`, {
    remediation: ["pass the page URL or its 32-character id"],
  });
}

/* ------------------------------------------------------------------ CLI */

export function parseNotionArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), pageId: null, maxDepth: 2, json: false };
  const takesValue = { "--person": "person", "--base-dir": "baseDir", "--page-id": "pageId", "--url": "pageId", "--max-depth": "maxDepth" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (takesValue[arg]) {
      const value = argv[index + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      options[takesValue[arg]] = takesValue[arg] === "maxDepth" ? Number(value) : value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else if (!options.pageId) options.pageId = arg;
    else return { error: `unexpected argument: ${arg}` };
  }
  if (!options.person) return { error: "--person is required" };
  if (!options.pageId) return { error: "collect notion needs --page-id <id|url>" };
  return { options };
}

export async function runCollectCli(argv, io = {}) {
  const out = typeof io.stdout === "function" ? io.stdout : (line) => process.stdout.write(`${line}\n`);
  const err = typeof io.stderr === "function" ? io.stderr : (line) => process.stderr.write(`${line}\n`);
  const parsed = parseNotionArgs(argv);
  if (parsed.error) {
    return {
      ok: false,
      exitCode: 2,
      receipt: {
        command: "collect",
        channel: CHANNEL,
        mode: "api",
        ok: false,
        person: null,
        warnings: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        unavailable: [{ channel: CHANNEL, reason: parsed.error, remediation: ["distilly collect notion --help"] }],
        error: { code: "collect/usage", message: parsed.error, remedy: "distilly collect notion --help" },
      },
    };
  }
  const { options } = parsed;
  const result = await collect({
    root: options.baseDir,
    person: options.person,
    pageId: options.pageId,
    maxDepth: options.maxDepth,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
  if (!options.json) {
    if (result.ok) {
      out(`collect notion: "${result.receipt.title}" — ${result.receipt.paragraphs} paragraph(s), ${result.receipt.anchors.total} anchor(s)`);
      for (const output of result.receipt.outputs) out(`  ${output.kind}: ${output.path}`);
    }
    for (const warning of result.receipt.warnings ?? []) err(`  warning: ${warning}`);
    for (const failure of result.receipt.unavailable ?? []) {
      err(`  unavailable: ${failure.reason}`);
      for (const step of failure.remediation ?? []) err(`    ${step}`);
    }
  }
  return result;
}

export { REMEDIATION as NOTION_REMEDIATION };
