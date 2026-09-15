/**
 * slack.mjs — credentialed collection from the Slack Web API.
 *
 * Legacy ported: `tools/slack_auto_collector.py` (722 lines, `slack_sdk`). The
 * credential file, the retry policy and the two error classes (missing scope,
 * invalid token) keep their meaning; the SDK is replaced by an injected `fetch`,
 * so the channel is testable without a workspace and without a network.
 *
 * Slack differences from Feishu worth knowing:
 *  - the token is a bot token (`xoxb-…`) used directly — there is no exchange
 *    step, so this module makes **no non-GET request at all**;
 *  - rate limiting arrives twice: as HTTP 429 with `Retry-After`, and as HTTP 200
 *    with `{"ok": false, "error": "ratelimited"}`. Both back off;
 *  - pagination is `cursor` → `response_metadata.next_cursor`, and the empty
 *    string means "no more pages".
 *
 * Everything else follows the discipline described in `feishu.mjs`: raw bytes
 * verbatim into `knowledge/raw/slack/`, ledger upsert, resume checkpoints, and
 * no credential value in stdout / stderr / receipts.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const CHANNEL = "slack";
export const CONFIG_FILE = "slack_config.json";
export const LEGACY_CONFIG_FILE = join(".colleague-skill", CONFIG_FILE);
export const DEFAULT_BASE_URL = "https://slack.com/api";
export const DEFAULT_PAGE_SIZE = 200;
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

export const ENV_KEYS = {
  botToken: ["DISTILLY_SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN"],
};

/** Slack is read-only here: no method may be anything but GET. */
export const ALLOWED_MUTATIONS = [];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REMEDIATION_SETUP = [
  `create ~/.distilly/${CONFIG_FILE} (chmod 600) with {"bot_token": "xoxb-…"}`,
  "  app: https://api.slack.com/apps → OAuth & Permissions → Bot Token Scopes:",
  "  channels:history, groups:history, mpim:history, im:history, channels:read, groups:read, users:read",
  "or export DISTILLY_SLACK_BOT_TOKEN for this shell only",
  "then invite the bot to every channel you want collected: /invite @your-bot",
];

export class CollectFailure extends Error {
  constructor(reason, message, { remediation = [], exitCode = 1, kind = "failure" } = {}) {
    super(message);
    this.name = "CollectFailure";
    this.reason = reason;
    this.remediation = remediation;
    this.exitCode = exitCode;
    this.kind = kind;
  }
}

export function redact(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 4) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

export function scrub(value, secrets = []) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "string" ? redact(item, secrets) : item)),
  );
}

export function distillyHome(env = process.env) {
  const override = env?.DISTILLY_HOME;
  return override ? resolve(String(override)) : join(homedir(), ".distilly");
}

export function credentialPaths(env = process.env) {
  return {
    primary: join(distillyHome(env), CONFIG_FILE),
    legacy: join(homedir(), LEGACY_CONFIG_FILE),
  };
}

export function loadCredential({ env = process.env, readFile = readFileSync } = {}) {
  for (const name of ENV_KEYS.botToken) {
    const value = env?.[name];
    if (typeof value === "string" && value.trim() !== "") {
      return {
        ok: true,
        source: "env",
        configFile: CONFIG_FILE,
        path: null,
        values: { bot_token: value.trim() },
      };
    }
  }

  const { primary, legacy } = credentialPaths(env);
  for (const [path, source] of [
    [primary, "config"],
    [legacy, "legacy-config"],
  ]) {
    if (!existsSync(path)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFile(path, "utf8"));
    } catch (error) {
      throw new CollectFailure(
        "bad-credential-file",
        `${CONFIG_FILE} is not valid JSON (${redact(error.message)}); rewrite it with {"bot_token": "xoxb-…"}`,
        { remediation: REMEDIATION_SETUP },
      );
    }
    const token = parsed.bot_token ?? parsed.botToken ?? parsed.token ?? null;
    if (!token) {
      throw new CollectFailure("incomplete-credential", `${CONFIG_FILE} is missing bot_token`, {
        remediation: REMEDIATION_SETUP,
      });
    }
    return { ok: true, source, configFile: CONFIG_FILE, path, values: { bot_token: token } };
  }

  throw new CollectFailure("no-credential", `no credential at ~/.distilly/${CONFIG_FILE}`, {
    remediation: REMEDIATION_SETUP,
  });
}

export function assertReadOnly(url, method = "GET") {
  const verb = String(method).toUpperCase();
  if (!MUTATING_METHODS.has(verb)) return true;
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return String(url);
    }
  })();
  const allowed = ALLOWED_MUTATIONS.some((entry) => entry.method === verb && path.endsWith(entry.path));
  if (!allowed) {
    throw new CollectFailure(
      "write-operation-refused",
      `refusing ${verb} ${path}: this collector never writes to ${CHANNEL}`,
      { remediation: ["collectors are read-only; remove the mutating call instead of allowlisting it"] },
    );
  }
  return true;
}

export function parseRetryAfter(headerValue, nowMs = Date.now()) {
  if (headerValue === null || headerValue === undefined || headerValue === "") return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(String(headerValue));
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return null;
}

export function backoffDelay(attempt, retryAfterMs = null, options = {}) {
  const { baseMs = 500, maxMs = DEFAULT_MAX_BACKOFF_MS } = options;
  if (Number.isFinite(retryAfterMs) && retryAfterMs !== null) return Math.min(retryAfterMs, maxMs);
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
}

export function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function requestJson(options) {
  const {
    fetchImpl,
    url,
    method = "GET",
    headers = {},
    body,
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep = defaultSleep,
    secrets = [],
    onRetry = () => {},
    authRemediation = REMEDIATION_SETUP,
  } = options;

  assertReadOnly(url, method);
  if (typeof fetchImpl !== "function") {
    throw new CollectFailure("no-fetch", "no fetch implementation available", {
      remediation: ["run on Node >= 20, or pass an injected fetch"],
    });
  }

  let attempt = 0;
  for (;;) {
    attempt += 1;
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const message = redact(error?.message ?? String(error), secrets);
      if (attempt > maxRetries) {
        throw new CollectFailure("network-error", `request failed: ${message}`, {
          remediation: ["check the network/proxy and retry", ...authRemediation],
        });
      }
      await sleep(backoffDelay(attempt));
      onRetry({ attempt, status: null, delayMs: backoffDelay(attempt), reason: message });
      continue;
    }

    const status = Number(response?.status ?? 0);
    const headerBag = response?.headers;
    const retryAfterMs = parseRetryAfter(headerBag?.get?.("retry-after") ?? null);

    if (status === 429 || status >= 500) {
      if (attempt > maxRetries) {
        throw new CollectFailure(
          status === 429 ? "rate-limited" : "server-error",
          status === 429
            ? `rate limited (HTTP 429) after ${maxRetries} retries`
            : `server error (HTTP ${status}) after ${maxRetries} retries`,
          {
            remediation: [
              "retry later; already-fetched pages stay on disk and the cursor is checkpointed",
              `lower --limit / --max-pages to stay under the ${CHANNEL} quota`,
            ],
          },
        );
      }
      const delayMs = backoffDelay(attempt, retryAfterMs);
      onRetry({ attempt, status, delayMs, reason: `HTTP ${status}` });
      await sleep(delayMs);
      continue;
    }

    const text = await response.text();
    if (status === 401 || status === 403) {
      throw new CollectFailure("unauthorized", `HTTP ${status} from ${CHANNEL}; bot token rejected`, {
        remediation: [
          "the credential in ~/.distilly/" + CONFIG_FILE + " was rejected — reinstall the app and copy a fresh bot token",
          "check the bot token scopes at https://api.slack.com/apps → OAuth & Permissions",
        ],
      });
    }
    if (status >= 400) {
      throw new CollectFailure("http-error", `HTTP ${status}: ${redact(text.slice(0, 200), secrets)}`, {
        remediation: ["check the request parameters", ...authRemediation],
      });
    }

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CollectFailure("invalid-json", `${CHANNEL} returned a non-JSON body`, {
        remediation: ["retry later; if it persists the endpoint may have changed"],
      });
    }
    return { status, text, json, attempts: attempt, headers: headerBag };
  }
}

/** Map a Slack `{ok:false, error}` body onto a loud failure with real steps. */
export function slackError(error, secrets = []) {
  const code = redact(String(error ?? "unknown_error"), secrets);
  const byCode = {
    invalid_auth: {
      remediation: [
        "the bot token is invalid or revoked — copy a fresh one from https://api.slack.com/apps → OAuth & Permissions",
        `then rewrite ~/.distilly/${CONFIG_FILE} with {"bot_token": "xoxb-…"}`,
      ],
    },
    token_revoked: { remediation: ["the token was revoked — reinstall the app and update the config file"] },
    account_inactive: { remediation: ["the Slack account is inactive; ask a workspace admin"] },
    missing_scope: {
      remediation: [
        "add the missing scope: https://api.slack.com/apps → OAuth & Permissions → Bot Token Scopes",
        "needed: channels:history, groups:history, mpim:history, channels:read, groups:read, users:read",
        "then reinstall the app so the token carries the new scope",
      ],
    },
    not_in_channel: {
      remediation: ["invite the bot to the channel: /invite @your-bot, then rerun"],
    },
    channel_not_found: {
      remediation: ["check --channel <C…>; list channels with conversations.list (channels:read)"],
    },
  };
  const entry = byCode[code] ?? { remediation: ["unexpected Slack error; retry or check the app configuration"] };
  return new CollectFailure("api-error", `Slack error: ${code}`, { remediation: entry.remediation });
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function slug(text, fallback = "target") {
  const slugged = String(text ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 64);
  return slugged || fallback;
}

export function knowledgeRoot({ root = process.cwd(), person, family = "colleague" } = {}) {
  return person ? join(resolve(root), "skills", slug(family), slug(person), "knowledge") : join(resolve(root), "knowledge");
}

export function writeRaw(knowledgeDir, name, bytes) {
  const dir = join(knowledgeDir, "raw", CHANNEL);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug(name, "page")}.json`);
  const staging = `${path}.${process.pid}.tmp`;
  const buffer = Buffer.from(bytes);
  try {
    writeFileSync(staging, buffer);
    renameSync(staging, path);
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { force: true });
    throw error;
  }
  return {
    path,
    relativePath: `raw/${CHANNEL}/${slug(name, "page")}.json`,
    bytes: buffer.length,
    sha256: sha256Hex(buffer),
  };
}

export function appendLedger(knowledgeDir, entries) {
  if (entries.length === 0) return { path: join(knowledgeDir, "index.json"), added: 0, total: 0, existed: false };
  const path = join(knowledgeDir, "index.json");
  let existing = [];
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      existing = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      throw new CollectFailure("bad-ledger", `knowledge/index.json is not valid JSON: ${redact(error.message)}`, {
        remediation: ["repair or remove knowledge/index.json, then rerun the collect"],
      });
    }
  }
  const byId = new Map(existing.filter((e) => e && typeof e === "object").map((e) => [e.id, e]));
  let added = 0;
  for (const entry of entries) {
    if (!byId.has(entry.id)) added += 1;
    byId.set(entry.id, entry);
  }
  const merged = [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const staging = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(staging, `${JSON.stringify(merged, null, 2)}\n`);
    renameSync(staging, path);
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { force: true });
    throw error;
  }
  return { path, added, total: merged.length, existed: existing.length > 0 };
}

export function statePath({ env = process.env, root = process.cwd(), target } = {}) {
  const key = sha256Hex(Buffer.from(`${resolve(root)}\n${target ?? ""}`, "utf8")).slice(0, 12);
  return join(distillyHome(env), "state", `${CHANNEL}-${key}.json`);
}

export function readCheckpoint(options) {
  const path = statePath(options);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeCheckpoint(options, value) {
  const path = statePath(options);
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(staging, path);
  return path;
}

export function clearCheckpoint(options) {
  const path = statePath(options);
  if (existsSync(path)) rmSync(path, { force: true });
  return path;
}

/**
 * Collect history from one Slack channel.
 *
 * @param {object} options `fetch`, `env`, `root`, `person`, `channel` (required),
 *   `limit`, `maxPages`, `maxRetries`, `since` (cursor), `resume`, `sleep`, `now`
 */
export async function collect(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    channel,
    limit = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    maxRetries = DEFAULT_MAX_RETRIES,
    since,
    resume = true,
    sleep = defaultSleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_SLACK_BASE_URL || DEFAULT_BASE_URL,
    onProgress = () => {},
  } = options;

  const knowledgeDir = knowledgeRoot({ root, person, family });
  const outputs = [];
  const warnings = [];
  const ledgerEntries = [];
  const retries = [];
  const onRetry = (info) => {
    retries.push(info);
    warnings.push(`retry ${info.attempt} after ${info.reason} (waited ${info.delayMs}ms)`);
    onProgress(`retry ${info.attempt}: ${info.reason}`);
  };

  let secrets = [];
  let credential = null;
  let pages = 0;
  let items = 0;
  let requests = 0;
  let cursor = since ?? null;
  let checkpoint = null;

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
  const fail = (failure) => {
    const receipt = {
      ...base,
      ok: false,
      person: person ?? null,
      channel_id: channel ?? null,
      pages,
      items,
      requests,
      cursor,
      resumed_from: checkpoint?.cursor ?? null,
      errors: [redact(failure.message, secrets)],
      unavailable: [
        {
          channel: CHANNEL,
          reason: redact(`${failure.reason}: ${failure.message}`, secrets),
          remediation: failure.remediation ?? [],
        },
      ],
    };
    return { ok: false, exitCode: failure.exitCode ?? 1, receipt: scrub(receipt, secrets) };
  };

  try {
    if (!channel) {
      throw new CollectFailure("missing-target", "collect slack needs --channel <C…>", {
        remediation: [
          "channel ids start with C (public), G (private) or D (dm); find them in the Slack URL",
        ],
      });
    }

    credential = loadCredential({ env });
    secrets = [credential.values.bot_token];
    base.credential_source = credential.source;

    if (resume) checkpoint = readCheckpoint({ env, root, target: channel });
    if (since === undefined && checkpoint?.cursor) {
      cursor = checkpoint.cursor;
      pages = Number(checkpoint.pages ?? 0);
      warnings.push(`resuming from checkpoint cursor (page ${pages} done)`);
    }

    let hasMore = true;
    const pageSize = Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), 200);
    while (hasMore) {
      if (pages >= maxPages) {
        warnings.push(`stopped after --max-pages ${maxPages}; rerun to continue from the cursor`);
        break;
      }

      const url = new URL(`${baseUrl}/conversations.history`);
      url.searchParams.set("channel", channel);
      url.searchParams.set("limit", String(pageSize));
      if (cursor) url.searchParams.set("cursor", cursor);

      // Slack can rate limit with HTTP 200 + {"ok": false, "error": "ratelimited"}.
      let response;
      for (let pageAttempt = 1; ; pageAttempt += 1) {
        response = await requestJson({
          fetchImpl,
          url: url.toString(),
          headers: { authorization: `Bearer ${credential.values.bot_token}` },
          maxRetries,
          sleep,
          secrets,
          onRetry,
        });
        requests += 1;
        if (response.json?.ok === false && response.json?.error === "ratelimited" && pageAttempt <= maxRetries) {
          const delayMs = backoffDelay(
            pageAttempt,
            parseRetryAfter(response.headers?.get?.("retry-after") ?? null),
          );
          warnings.push(`retry ${pageAttempt} after slack ratelimited (waited ${delayMs}ms)`);
          retries.push({ attempt: pageAttempt, status: 200, delayMs, reason: "ratelimited" });
          await sleep(delayMs);
          continue;
        }
        break;
      }

      if (response.json?.ok !== true) throw slackError(response.json?.error, secrets);

      pages += 1;
      const pageItems = Array.isArray(response.json?.messages) ? response.json.messages : [];
      items += pageItems.length;

      const stored = writeRaw(knowledgeDir, `${channel}-p${String(pages).padStart(3, "0")}`, response.text);
      outputs.push({ path: stored.path, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" });
      ledgerEntries.push({
        id: `${CHANNEL}:${slug(channel)}:p${String(pages).padStart(3, "0")}`,
        kind: "raw",
        origin: stored.relativePath,
        source: CHANNEL,
        fetched_at: now,
        bytes: stored.bytes,
        sha256: stored.sha256,
        credentialed: true,
        credential_source: credential.source,
        credential_file: CONFIG_FILE,
        method: "api-bot-token",
        items: pageItems.length,
        warnings: [],
      });

      const next = response.json?.response_metadata?.next_cursor;
      cursor = typeof next === "string" && next !== "" ? next : null;
      hasMore = Boolean(cursor);
      if (resume) {
        writeCheckpoint(
          { env, root, target: channel },
          { channel: CHANNEL, target: channel, cursor, pages, items, updated_at: now },
        );
      }
      onProgress(`page ${pages}: ${pageItems.length} messages, has_more=${hasMore}`);
    }

    const ledger = appendLedger(knowledgeDir, ledgerEntries);
    if (resume) clearCheckpoint({ env, root, target: channel });

    const receipt = {
      ...base,
      ok: true,
      person: person ?? null,
      channel_id: channel,
      pages,
      items,
      requests,
      cursor,
      resumed_from: checkpoint?.cursor ?? null,
      outputs,
      ledger: { path: ledger.path, added: ledger.added, total: ledger.total },
      unavailable: [],
    };
    return { ok: true, exitCode: 0, receipt: scrub(receipt, secrets) };
  } catch (error) {
    if (!(error instanceof CollectFailure)) {
      throw new CollectFailure("unexpected", redact(error?.message ?? String(error), secrets), {
        remediation: ["rerun with --json and report the receipt"],
      });
    }
    const result = fail(error);
    if (ledgerEntries.length > 0) {
      try {
        const ledger = appendLedger(knowledgeDir, ledgerEntries);
        result.receipt.ledger = { path: ledger.path, added: ledger.added, total: ledger.total };
        result.receipt.partial = true;
      } catch {
        result.receipt.warnings.push("could not register the partial pages in knowledge/index.json");
      }
    }
    return result;
  }
}

export const HELP = `distilly collect slack — Slack 频道消息采集（只读）/ Slack channel history (read-only)

用法 (zh):
  distilly collect slack --channel <C…> [--person <slug>] [--root <dir>]
                         [--limit 200] [--max-pages 10] [--max-retries 4]
                         [--since <cursor>] [--no-resume] [--json]

凭据：~/.distilly/${CONFIG_FILE}（bot_token，0600）或 DISTILLY_SLACK_BOT_TOKEN。
      错误信息只出现配置文件名，绝不出现值。缺凭据 → 非零退出 + 补救步骤。
权限：channels:history / groups:history / channels:read / users:read；机器人必须先被 /invite 进频道。
限流：HTTP 429 与 {"ok":false,"error":"ratelimited"} 都按 Retry-After / 指数退避重试，超上限则保留已落盘页并非零退出。
只读：本模块没有任何点赞/关注/发帖/私信调用；所有请求都是 GET（ALLOWED_MUTATIONS 为空）。

---
## English
  distilly collect slack --channel <C…> [--person <slug>] [--limit N] [--json]

Credentials: ~/.distilly/${CONFIG_FILE} or DISTILLY_SLACK_BOT_TOKEN. GET only.
Rate limits honour Retry-After; partial runs keep their pages and resume from a checkpoint.
`;

export function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "json" || name === "help" || name === "no-resume") {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    flags[name] = value;
    index += 1;
  }
  return flags;
}

/**
 * @param {string[]} argv arguments after `collect slack`
 * @param {{env?: object, stdout?: Function, stderr?: Function, fetch?: Function}} [io]
 * @returns {Promise<number>} exit code
 */
export async function runCollectCli(argv, io = {}) {
  const out = io.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.stderr ?? ((line) => process.stderr.write(`${line}\n`));

  let flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    err(`Error: ${error.message}`);
    return 1;
  }
  if (flags.help) {
    out(HELP);
    return 0;
  }

  const result = await collect({
    fetch: io.fetch ?? globalThis.fetch,
    env: io.env ?? process.env,
    root: flags.root ?? process.cwd(),
    person: flags.person,
    family: flags.family,
    channel: flags.channel,
    limit: flags.limit ? Number(flags.limit) : undefined,
    maxPages: flags["max-pages"] ? Number(flags["max-pages"]) : undefined,
    maxRetries: flags["max-retries"] ? Number(flags["max-retries"]) : undefined,
    since: flags.since,
    resume: !flags["no-resume"],
    sleep: io.sleep,
    now: io.now,
    baseUrl: flags["base-url"],
  });

  if (flags.json) out(JSON.stringify(result.receipt, null, 2));
  if (result.ok) {
    out(`collected ${result.receipt.items} message(s) in ${result.receipt.pages} page(s) → ${result.receipt.outputs.length} raw file(s)`);
    for (const warning of result.receipt.warnings) err(`warning: ${warning}`);
  } else {
    err(`Error: ${result.receipt.errors?.[0] ?? "collect failed"}`);
    for (const entry of result.receipt.unavailable) {
      err(`unavailable: ${entry.channel} — ${entry.reason}`);
      for (const step of entry.remediation ?? []) err(`  fix: ${step}`);
    }
    for (const warning of result.receipt.warnings) err(`warning: ${warning}`);
  }
  return result.exitCode;
}
