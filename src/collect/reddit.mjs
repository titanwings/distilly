/**
 * reddit.mjs — Reddit comments, read with an OAuth client credential.
 *
 * The only mutation this module performs is the OAuth token exchange — a POST that
 * changes nothing a user can see, exactly like Feishu's tenant-token call. Every
 * other request is a GET against a small allowlist, so there is no path here that
 * can post, vote, edit or delete.
 *
 * A listing page is stored verbatim under `knowledge/raw/reddit/` and the comments
 * it contains become anchored paragraphs (author + UTC time + body), which is the
 * shape the derivation reads. `[deleted]` and `[removed]` bodies are skipped by
 * name, never anchored as if someone had said them.
 */

import { join, resolve } from "node:path";

import { KnowledgeStore } from "../knowledge/store.mjs";
import { loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile, buildDocument, recordsFromCharSpans } from "../parse/common.mjs";
import {
  CollectFailure,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RETRIES,
  clearCheckpoint,
  loadCredential,
  readCheckpoint,
  redact,
  requestJson,
  scrub,
  writeCheckpoint,
  writeRaw,
} from "./kit.mjs";

export const CHANNEL = "reddit";
export const CONFIG_FILE = "reddit_config.json";
export const ENV_KEYS = ["DISTILLY_REDDIT_CLIENT_ID", "REDDIT_CLIENT_ID", "DISTILLY_REDDIT_CLIENT_SECRET", "REDDIT_CLIENT_SECRET"];
export const DEFAULT_BASE_URL = "https://oauth.reddit.com";
export const DEFAULT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const DEFAULT_PAGE_SIZE = 100;
export const USER_AGENT = "distilly/1.0 (read-only collector)";

/** The token exchange, plus GETs. Reddit's read API never needs another verb. */
export const ALLOWED_CALLS = [
  { method: "POST", path: "/api/v1/access_token" },
  { method: "GET", path: "/api/v1/me" },
  { method: "GET", path: "/r/" },
  { method: "GET", path: "/user/" },
  { method: "GET", path: "/comments/" },
];

const REMEDIATION = [
  "create a script app at https://www.reddit.com/prefs/apps (type: script) and copy the id and secret",
  `write ~/.distilly/${CONFIG_FILE} as {"client_id": "…", "client_secret": "…"}`,
];

/** `[deleted]` / `[removed]` are placeholders, not something a person said. */
export const isPlaceholder = (body) => {
  const text = String(body ?? "").trim();
  return text === "" || text === "[deleted]" || text === "[removed]";
};

/** A listing's comment children, flattened, with placeholders removed. */
export function commentsFromListing(json) {
  const children = json?.data?.children ?? [];
  const comments = [];
  const skipped = {};
  const walk = (nodes, depth = 0) => {
    for (const node of nodes) {
      if (node?.kind === "more") {
        skipped.more = (skipped.more ?? 0) + 1;
        continue;
      }
      const data = node?.data ?? node;
      if (!data || typeof data !== "object") continue;
      if (typeof data.body === "string") {
        if (isPlaceholder(data.body)) skipped.placeholder = (skipped.placeholder ?? 0) + 1;
        else {
          comments.push({
            id: data.id ?? null,
            author: data.author ?? "unknown",
            body: data.body,
            created_utc: typeof data.created_utc === "number" ? data.created_utc : null,
            permalink: data.permalink ?? null,
            depth,
            score: typeof data.score === "number" ? data.score : null,
          });
        }
      }
      const replies = data.replies?.data?.children;
      if (Array.isArray(replies)) walk(replies, depth + 1);
    }
  };
  walk(children);
  return { comments, skipped, after: json?.data?.after ?? null };
}

/** One anchor per comment: `<ISO> <author>：<body>`. */
export function redditDocument({ comments, file, options }) {
  const text = comments.map((comment) => {
    const at = comment.created_utc === null ? "" : new Date(comment.created_utc * 1000).toISOString();
    return `${at} ${comment.author}：${comment.body}`;
  }).join("\n");
  const spans = [];
  let offset = 0;
  for (const [index, comment] of comments.entries()) {
    const line = text.split("\n")[index];
    spans.push({ text: line, charStart: offset, charEnd: offset + line.length, kind: "comment", label: comment.id ?? undefined });
    offset += line.length + 1;
  }
  void file;
  return { content: text, spans, options };
}

/**
 * @param {{fetch?: Function, env?: object, root?: string, person: string, family?: string,
 *          target: string, kind?: "subreddit"|"user", limit?: number, maxPages?: number,
 *          maxRetries?: number, sleep?: Function, now?: string, baseUrl?: string, tokenUrl?: string}} options
 */
export async function collect(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    target,
    limit = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_REDDIT_BASE_URL || DEFAULT_BASE_URL,
    tokenUrl = env?.DISTILLY_REDDIT_TOKEN_URL || DEFAULT_TOKEN_URL,
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
        target: target ?? null,
        errors: [redact(failure.message, secrets)],
        unavailable: [{ channel: CHANNEL, reason: redact(`${failure.reason}: ${failure.message}`, secrets), remediation: failure.remediation ?? [] }],
      },
      secrets,
    ),
  });

  try {
    if (!person) throw new CollectFailure("missing-person", "collect reddit needs --person <slug>", { remediation: ["pass --person"] });
    if (!target) {
      throw new CollectFailure("missing-target", "collect reddit needs --target <subreddit|username>", {
        remediation: ["pass --target programming, or --target someuser with --kind user"],
      });
    }
    const kind = options.kind ?? "subreddit";
    if (!["subreddit", "user"].includes(kind)) {
      throw new CollectFailure("bad-kind", `--kind must be subreddit or user (got ${kind})`, { remediation: ["pass --kind subreddit|user"] });
    }

    const credential = loadCredential({
      env,
      configFile: CONFIG_FILE,
      envKeys: ENV_KEYS,
      fields: ["client_id", "client_secret"],
    });
    secrets = [credential.values.client_secret];
    base.credential_source = credential.source;

    const basic = Buffer.from(`${credential.values.client_id}:${credential.values.client_secret}`).toString("base64");
    const tokenResponse = await requestJson({
      fetchImpl,
      url: tokenUrl,
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
      body: "grant_type=client_credentials",
      maxRetries,
      ...(sleep ? { sleep } : {}),
      secrets,
      allowlist: ALLOWED_CALLS,
      channel: CHANNEL,
    });
    const token = tokenResponse.json?.access_token ?? null;
    if (!token) {
      throw new CollectFailure("auth-failed", "Reddit rejected the client credential", { remediation: REMEDIATION });
    }
    secrets = [...secrets, token];

    const knowledgeDir = join(resolve(root), "skills", family, person, "knowledge");
    const store = new KnowledgeStore(join(resolve(root), "skills", family, person));
    const ledger = loadLedger(store);
    const checkpoint = options.resume === false ? null : readCheckpoint({ env, root, channel: CHANNEL, target: `${kind}:${target}` });
    let cursor = checkpoint?.cursor ?? null;
    if (cursor) warnings.push(`resuming from checkpoint (${checkpoint.pages ?? 0} page(s) done)`);

    const pageSize = Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), 100);
    const headers = { authorization: `Bearer ${token}`, "user-agent": USER_AGENT, accept: "application/json" };
    const path = kind === "subreddit" ? `/r/${encodeURIComponent(target)}/comments` : `/user/${encodeURIComponent(target)}/comments`;

    let pages = 0;
    let items = 0;
    let comments = 0;
    let anchors = 0;
    const textEntries = [];

    for (;;) {
      if (pages >= maxPages) {
        warnings.push(`stopped after --max-pages ${maxPages}; rerun to continue from the cursor`);
        break;
      }
      const params = new URLSearchParams({ limit: String(pageSize), raw_json: "1" });
      if (cursor) params.set("after", cursor);
      const response = await requestJson({
        fetchImpl,
        url: `${baseUrl}${path}?${params.toString()}`,
        method: "GET",
        headers,
        maxRetries,
        ...(sleep ? { sleep } : {}),
        secrets,
        allowlist: ALLOWED_CALLS,
        channel: CHANNEL,
        onRetry: (info) => {
          retries.push(info);
          warnings.push(`retry ${info.attempt} after ${info.reason} (waited ${info.delayMs}ms)`);
        },
      });
      pages += 1;
      const listing = commentsFromListing(response.json);
      items += response.json?.data?.children?.length ?? 0;
      comments += listing.comments.length;
      for (const [type, count] of Object.entries(listing.skipped)) warnings.push(`${count} ${type} entr(ies) were skipped`);

      const name = `${kind}-${target}-p${String(pages).padStart(3, "0")}`;
      const stored = writeRaw(knowledgeDir, CHANNEL, name, response.text);
      outputs.push({ path: stored.relativePath, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" });

      if (listing.comments.length > 0) {
        const text = listing.comments
          .map((comment) => `${comment.created_utc === null ? "" : new Date(comment.created_utc * 1000).toISOString()} ${comment.author}：${comment.body}`)
          .join("\n");
        const file = new SourceFile({ path: `${name}.txt`, name: `${name}.txt`, raw: new Uint8Array(Buffer.from(text, "utf8")) });
        const spans = [];
        let offset = 0;
        for (const line of text.split("\n")) {
          spans.push({ text: line, charStart: offset, charEnd: offset + line.length, kind: "comment" });
          offset += line.length + 1;
        }
        const document = buildDocument({
          parser: "reddit",
          format: "listing",
          kind: "chat",
          method: "api-oauth-client",
          credentialed: true,
          credential_source: credential.source,
          credential_file: CONFIG_FILE,
          source: CHANNEL,
          origin: `https://www.reddit.com${path}`,
          files: [file],
          records: recordsFromCharSpans(file, spans),
          meta: { target, kind, comments: listing.comments.length },
        });
        const recorded = recordDocument(store, ledger, { ...document, fetched_at: now }, { fetched_at: now });
        if (recorded.written.text) {
          outputs.push({
            path: recorded.written.text.relativePath,
            sha256: recorded.written.text.sha256,
            bytes: recorded.written.text.bytes,
            kind: "text",
          });
          textEntries.push(recorded.entry?.id ?? null);
          anchors += recorded.entry?.anchor_count ?? 0;
        }
      }

      cursor = listing.after;
      if (!cursor) break;
      if (options.resume !== false) {
        writeCheckpoint({ env, root, channel: CHANNEL, target: `${kind}:${target}` }, { channel: CHANNEL, target, cursor, pages, items, updated_at: now });
      }
    }

    saveLedger(store, ledger);
    clearCheckpoint({ env, root, channel: CHANNEL, target: `${kind}:${target}` });

    return {
      ok: true,
      exitCode: 0,
      receipt: scrub(
        {
          ...base,
          ok: true,
          person,
          target,
          kind,
          pages,
          items,
          comments,
          cursor,
          text_entries: textEntries.filter(Boolean),
          anchors: { total: anchors, cited: 0 },
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

/* ------------------------------------------------------------------ CLI */

export function parseRedditArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), target: null, kind: "subreddit", limit: DEFAULT_PAGE_SIZE, maxPages: DEFAULT_MAX_PAGES, json: false };
  const takesValue = { "--person": "person", "--base-dir": "baseDir", "--target": "target", "--kind": "kind", "--limit": "limit", "--max-pages": "maxPages" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (takesValue[arg]) {
      const value = argv[index + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      options[takesValue[arg]] = /limit|maxPages/.test(takesValue[arg]) ? Number(value) : value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else if (!options.target) options.target = arg;
    else return { error: `unexpected argument: ${arg}` };
  }
  if (!options.person) return { error: "--person is required" };
  if (!options.target) return { error: "collect reddit needs --target <subreddit|username>" };
  return { options };
}

export async function runCollectCli(argv, io = {}) {
  const out = typeof io.stdout === "function" ? io.stdout : (line) => process.stdout.write(`${line}\n`);
  const err = typeof io.stderr === "function" ? io.stderr : (line) => process.stderr.write(`${line}\n`);
  const parsed = parseRedditArgs(argv);
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
        unavailable: [{ channel: CHANNEL, reason: parsed.error, remediation: ["distilly collect reddit --help"] }],
        error: { code: "collect/usage", message: parsed.error, remedy: "distilly collect reddit --help" },
      },
    };
  }
  const { options } = parsed;
  const result = await collect({
    root: options.baseDir,
    person: options.person,
    target: options.target,
    kind: options.kind,
    limit: options.limit,
    maxPages: options.maxPages,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
  if (!options.json) {
    if (result.ok) {
      out(`collect reddit: ${result.receipt.comments} comment(s) in ${result.receipt.pages} page(s), ${result.receipt.anchors.total} anchor(s)`);
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

export { REMEDIATION as REDDIT_REMEDIATION };
