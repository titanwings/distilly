/**
 * gmail.mjs — Gmail messages, read with an OAuth refresh token.
 *
 * The read path is deliberately thin: list message ids, fetch each one as **raw
 * MIME**, and hand the bytes to the email parser that already exists
 * (`src/parse/email.mjs`). Headers, charsets, HTML fallbacks and attachment
 * warnings are therefore identical to a locally harvested `.eml` — one
 * implementation, two doors.
 *
 * Read-only by construction: the allowlist has one POST (the OAuth token
 * exchange) and GETs under `/gmail/v1/users/`. Nothing here can send, label,
 * trash or modify a message.
 */

import { join, resolve } from "node:path";

import { KnowledgeStore } from "../knowledge/store.mjs";
import { loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile } from "../parse/common.mjs";
import { parseEmail } from "../parse/email.mjs";
import {
  CollectFailure,
  DEFAULT_MAX_RETRIES,
  clearCheckpoint,
  loadCredential,
  readCheckpoint,
  redact,
  requestJson,
  scrub,
  writeCheckpoint,
} from "./kit.mjs";

export const CHANNEL = "gmail";
export const CONFIG_FILE = "gmail_config.json";
export const ENV_KEYS = [
  "DISTILLY_GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_ID",
  "DISTILLY_GMAIL_CLIENT_SECRET",
  "GMAIL_CLIENT_SECRET",
  "DISTILLY_GMAIL_REFRESH_TOKEN",
  "GMAIL_REFRESH_TOKEN",
];
export const DEFAULT_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
export const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_MAX_MESSAGES = 200;

export const ALLOWED_CALLS = [
  { method: "POST", path: "/token" },
  { method: "GET", path: "/gmail/v1/users/" },
];

const REMEDIATION = [
  "create an OAuth client (desktop) in Google Cloud, enable the Gmail API, and add scope gmail.readonly",
  "run the consent flow once and keep the refresh token",
  `write ~/.distilly/${CONFIG_FILE} as {"client_id": "…", "client_secret": "…", "refresh_token": "…"}`,
];

/** Gmail returns base64url; `Buffer` needs the padding restored. */
export function decodeRawMessage(raw) {
  const text = String(raw ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/**
 * @param {{fetch?: Function, env?: object, root?: string, person: string, family?: string,
 *          query?: string, limit?: number, maxMessages?: number, maxRetries?: number,
 *          sleep?: Function, now?: string, baseUrl?: string, tokenUrl?: string}} options
 */
export async function collect(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    query = "",
    limit = DEFAULT_PAGE_SIZE,
    maxMessages = DEFAULT_MAX_MESSAGES,
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_GMAIL_BASE_URL || DEFAULT_BASE_URL,
    tokenUrl = env?.DISTILLY_GMAIL_TOKEN_URL || DEFAULT_TOKEN_URL,
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
        query: query || null,
        errors: [redact(failure.message, secrets)],
        unavailable: [{ channel: CHANNEL, reason: redact(`${failure.reason}: ${failure.message}`, secrets), remediation: failure.remediation ?? [] }],
      },
      secrets,
    ),
  });

  try {
    if (!person) throw new CollectFailure("missing-person", "collect gmail needs --person <slug>", { remediation: ["pass --person"] });
    const credential = loadCredential({
      env,
      configFile: CONFIG_FILE,
      envKeys: ENV_KEYS,
      fields: ["client_id", "client_secret", "refresh_token"],
    });
    secrets = [credential.values.client_secret, credential.values.refresh_token];
    base.credential_source = credential.source;

    const onRetry = (info) => {
      retries.push(info);
      warnings.push(`retry ${info.attempt} after ${info.reason} (waited ${info.delayMs}ms)`);
    };

    const exchange = async () => {
      const response = await requestJson({
        fetchImpl,
        url: tokenUrl,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credential.values.refresh_token,
          client_id: credential.values.client_id,
          client_secret: credential.values.client_secret,
        }).toString(),
        maxRetries,
        ...(sleep ? { sleep } : {}),
        secrets,
        allowlist: ALLOWED_CALLS,
        channel: CHANNEL,
      });
      const token = response.json?.access_token ?? null;
      if (!token) throw new CollectFailure("auth-failed", "Google rejected the refresh token", { remediation: REMEDIATION });
      secrets = [credential.values.client_secret, credential.values.refresh_token, token];
      return token;
    };

    let token = await exchange();
    const headers = () => ({ authorization: `Bearer ${token}`, accept: "application/json" });

    // A token can expire mid-run; one re-exchange keeps a long collection going.
    const get = async (url) => {
      try {
        return await requestJson({
          fetchImpl,
          url,
          method: "GET",
          headers: headers(),
          maxRetries,
          ...(sleep ? { sleep } : {}),
          secrets,
          allowlist: ALLOWED_CALLS,
          channel: CHANNEL,
          onRetry,
        });
      } catch (error) {
        if (!(error instanceof CollectFailure) || error.reason !== "unauthorized") throw error;
        warnings.push("the access token expired mid-run; the refresh token was exchanged again");
        token = await exchange();
        return await requestJson({
          fetchImpl,
          url,
          method: "GET",
          headers: headers(),
          maxRetries,
          ...(sleep ? { sleep } : {}),
          secrets,
          allowlist: ALLOWED_CALLS,
          channel: CHANNEL,
          onRetry,
        });
      }
    };

    const store = new KnowledgeStore(join(resolve(root), "skills", family, person));
    const ledger = loadLedger(store);
    const checkpoint = options.resume === false ? null : readCheckpoint({ env, root, channel: CHANNEL, target: query || "inbox" });
    const seen = new Set(checkpoint?.seen ?? []);
    let pageToken = checkpoint?.page_token ?? null;
    if (seen.size > 0) warnings.push(`resuming: ${seen.size} message(s) already fetched`);

    const pageSize = Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), 500);
    let pages = 0;
    let fetched = 0;
    let anchors = 0;
    const textEntries = [];

    for (;;) {
      if (fetched >= maxMessages) {
        warnings.push(`stopped after --max-messages ${maxMessages}`);
        break;
      }
      const params = new URLSearchParams({ maxResults: String(Math.min(pageSize, maxMessages - fetched)) });
      if (query) params.set("q", query);
      if (pageToken) params.set("pageToken", pageToken);
      const listing = await get(`${baseUrl}/users/me/messages?${params.toString()}`);
      pages += 1;
      const ids = (listing.json?.messages ?? []).map((entry) => entry.id).filter(Boolean);
      pageToken = listing.json?.nextPageToken ?? null;

      for (const id of ids) {
        if (seen.has(id)) continue;
        const message = await get(`${baseUrl}/users/me/messages/${encodeURIComponent(id)}?format=raw`);
        const bytes = decodeRawMessage(message.json?.raw);
        if (bytes.length === 0) {
          warnings.push(`message ${id} carried no raw MIME payload and was skipped`);
          continue;
        }
        const file = new SourceFile({ path: `${id}.eml`, name: `${id}.eml`, raw: new Uint8Array(bytes) });
        let document;
        try {
          document = parseEmail(file, {
            source: CHANNEL,
            method: "api-oauth-refresh",
            credentialed: true,
            credential_source: credential.source,
            credential_file: CONFIG_FILE,
          });
        } catch (error) {
          warnings.push(`message ${id}: ${redact(error.message, secrets)}; the raw bytes are stored, the text is not`);
          document = null;
        }
        const recorded = recordDocument(
          store,
          ledger,
          document
            ? { ...document, fetched_at: now }
            : {
                parser: "gmail",
                format: "eml",
                kind: "email",
                method: "api-oauth-refresh",
                credentialed: true,
                credential_source: credential.source,
                credential_file: CONFIG_FILE,
                source: CHANNEL,
                origin: `gmail:${id}`,
                files: [{ path: `${id}.eml`, name: `${id}.eml`, raw: new Uint8Array(bytes) }],
                content: "",
                segments: [],
                entries: [],
                warnings: ["the message could not be parsed; only the raw bytes are recorded"],
                fetched_at: now,
              },
          { fetched_at: now },
        );
        seen.add(id);
        fetched += 1;
        const raw = recorded.written.files[0];
        if (raw) outputs.push({ path: raw.relativePath, sha256: raw.sha256, bytes: raw.bytes, kind: "raw" });
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

      writeCheckpoint(
        { env, root, channel: CHANNEL, target: query || "inbox" },
        { channel: CHANNEL, target: query || "inbox", page_token: pageToken, pages, fetched, seen: [...seen].slice(-500), updated_at: now },
      );
      if (!pageToken || ids.length === 0) break;
    }

    saveLedger(store, ledger);
    clearCheckpoint({ env, root, channel: CHANNEL, target: query || "inbox" });

    return {
      ok: true,
      exitCode: 0,
      receipt: scrub(
        {
          ...base,
          ok: true,
          person,
          query: query || null,
          pages,
          messages: fetched,
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

export function parseGmailArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), query: "", limit: DEFAULT_PAGE_SIZE, maxMessages: DEFAULT_MAX_MESSAGES, json: false };
  const takesValue = { "--person": "person", "--base-dir": "baseDir", "--query": "query", "--limit": "limit", "--max-messages": "maxMessages" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (takesValue[arg]) {
      const value = argv[index + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      options[takesValue[arg]] = /limit|maxMessages/.test(takesValue[arg]) ? Number(value) : value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else if (options.query === "") options.query = arg;
    else return { error: `unexpected argument: ${arg}` };
  }
  if (!options.person) return { error: "--person is required" };
  return { options };
}

export async function runCollectCli(argv, io = {}) {
  const out = typeof io.stdout === "function" ? io.stdout : (line) => process.stdout.write(`${line}\n`);
  const err = typeof io.stderr === "function" ? io.stderr : (line) => process.stderr.write(`${line}\n`);
  const parsed = parseGmailArgs(argv);
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
        unavailable: [{ channel: CHANNEL, reason: parsed.error, remediation: ["distilly collect gmail --help"] }],
        error: { code: "collect/usage", message: parsed.error, remedy: "distilly collect gmail --help" },
      },
    };
  }
  const { options } = parsed;
  const result = await collect({
    root: options.baseDir,
    person: options.person,
    query: options.query,
    limit: options.limit,
    maxMessages: options.maxMessages,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
  if (!options.json) {
    if (result.ok) {
      out(`collect gmail: ${result.receipt.messages} message(s) in ${result.receipt.pages} page(s), ${result.receipt.anchors.total} anchor(s)`);
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

export { REMEDIATION as GMAIL_REMEDIATION };
