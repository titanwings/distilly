/**
 * feishu.mjs — credentialed collection from Feishu / Lark open APIs.
 *
 * Legacies ported: `tools/feishu_auto_collector.py` (960 lines, SDK `requests`).
 * This module keeps the same credential location and the same two read paths
 * (tenant token for group chats, user token for p2p), but:
 *
 *  - the network goes through an **injected `fetch`** (default `globalThis.fetch`),
 *    so the whole channel is testable with a mock and never needs a live tenant;
 *  - raw response bytes are stored **verbatim** in `knowledge/raw/feishu/…` and
 *    registered in `knowledge/index.json` (contract §2);
 *  - pagination is cursor-driven, rate limits back off with `Retry-After`, and an
 *    interrupted run leaves a checkpoint so the next run resumes at the cursor
 *    instead of re-fetching finished pages;
 *  - credential values never reach stdout, stderr or a receipt — only the file
 *    name (`feishu_config.json`) is ever printed. See `redact()` / `scrub()`.
 *
 * Read-only by construction: every request goes through `assertReadOnly()`, which
 * rejects any method+path pair outside `ALLOWED_MUTATIONS` (the tenant token
 * exchange — a POST that changes no user-visible state). There is no code path
 * that can like, follow, post or send anything; that is a capability-level
 * guarantee, not a prompt instruction.
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

export const CHANNEL = "feishu";
/** Only the *name* may ever be printed. Never its contents. */
export const CONFIG_FILE = "feishu_config.json";
export const LEGACY_CONFIG_FILE = join(".colleague-skill", CONFIG_FILE);
export const DEFAULT_BASE_URL = "https://open.feishu.cn/open-apis";
export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

/** Env fallbacks, checked before the config file. Names are not secret. */
export const ENV_KEYS = {
  appId: ["DISTILLY_FEISHU_APP_ID", "FEISHU_APP_ID"],
  appSecret: ["DISTILLY_FEISHU_APP_SECRET", "FEISHU_APP_SECRET"],
  userToken: ["DISTILLY_FEISHU_USER_ACCESS_TOKEN", "FEISHU_USER_ACCESS_TOKEN"],
};

/**
 * The only non-GET calls this module may make. Anything else fails loudly
 * before the request leaves the process.
 */
export const ALLOWED_MUTATIONS = [
  {
    method: "POST",
    path: "/auth/v3/tenant_access_token/internal",
    why: "tenant token exchange; creates no user-visible state",
  },
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REMEDIATION_SETUP = [
  `create ~/.distilly/${CONFIG_FILE} (chmod 600) with {"app_id": "cli_…", "app_secret": "…"}`,
  "  app: https://open.feishu.cn → 开发者后台 → 创建企业自建应用 → 权限 im:message:readonly, im:chat:readonly",
  "or export DISTILLY_FEISHU_APP_ID and DISTILLY_FEISHU_APP_SECRET for this shell only",
  "private (p2p) chats additionally need a user token: DISTILLY_FEISHU_USER_ACCESS_TOKEN",
];

// ─── failures ────────────────────────────────────────────────────────────────

/** An expected, loud failure. `reason` is a stable machine-readable token. */
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

// ─── secret discipline ───────────────────────────────────────────────────────

/** Replace every credential value with `[redacted]`; keep file names visible. */
export function redact(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 4) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

/** Mechanical net: no secret can survive a round-trip through a receipt. */
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

/**
 * Load `{app_id, app_secret, user_access_token?}` from env or the config file.
 * Returns values for the caller only; every message names the *file*, never a
 * value, and the config file is never printed or copied anywhere else.
 */
export function loadCredential({ env = process.env, readFile = readFileSync } = {}) {
  const pick = (names) => {
    for (const name of names) {
      const value = env?.[name];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return null;
  };

  const envAppId = pick(ENV_KEYS.appId);
  const envAppSecret = pick(ENV_KEYS.appSecret);
  const envUserToken = pick(ENV_KEYS.userToken);
  if (envAppId && envAppSecret) {
    return {
      ok: true,
      source: "env",
      configFile: CONFIG_FILE,
      path: null,
      values: { app_id: envAppId, app_secret: envAppSecret, user_access_token: envUserToken },
    };
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
        `${CONFIG_FILE} is not valid JSON (${redact(error.message)}); rewrite it with {"app_id": "cli_…", "app_secret": "…"}`,
        { remediation: REMEDIATION_SETUP },
      );
    }
    const appId = parsed.app_id ?? parsed.appId ?? null;
    const appSecret = parsed.app_secret ?? parsed.appSecret ?? null;
    const userToken = parsed.user_access_token ?? parsed.userToken ?? null;
    if (!appId || !appSecret) {
      throw new CollectFailure(
        "incomplete-credential",
        `${CONFIG_FILE} is missing app_id / app_secret`,
        { remediation: REMEDIATION_SETUP },
      );
    }
    return {
      ok: true,
      source,
      configFile: CONFIG_FILE,
      path,
      values: { app_id: appId, app_secret: appSecret, user_access_token: userToken },
    };
  }

  throw new CollectFailure(
    "no-credential",
    `no credential at ~/.distilly/${CONFIG_FILE}`,
    { remediation: REMEDIATION_SETUP },
  );
}

// ─── read-only guard + HTTP ──────────────────────────────────────────────────

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

/** `Retry-After` wins; otherwise exponential backoff, capped. */
export function backoffDelay(attempt, retryAfterMs = null, options = {}) {
  const { baseMs = 500, maxMs = DEFAULT_MAX_BACKOFF_MS } = options;
  if (Number.isFinite(retryAfterMs) && retryAfterMs !== null) return Math.min(retryAfterMs, maxMs);
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
}

export function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * One JSON request with retry/backoff. Never returns a body on 4xx/5xx.
 * @returns {Promise<{status: number, text: string, json: any, attempts: number}>}
 */
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
    const retryAfterMs = parseRetryAfter(response?.headers?.get?.("retry-after") ?? null);

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
      throw new CollectFailure("unauthorized", `HTTP ${status} from ${CHANNEL}; credential rejected or missing scope`, {
        remediation: [
          "the credential in ~/.distilly/" + CONFIG_FILE + " was rejected — regenerate it",
          "check the app scopes: im:message:readonly, im:chat:readonly (add im:message for p2p)",
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
    return { status, text, json, attempts: attempt };
  }
}

// ─── sink: raw bytes + ledger ────────────────────────────────────────────────

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

/** `--person lin-gong` → `skills/colleague/lin-gong/knowledge`, else `<root>/knowledge`. */
export function knowledgeRoot({ root = process.cwd(), person, family = "colleague" } = {}) {
  return person ? join(resolve(root), "skills", slug(family), slug(person), "knowledge") : join(resolve(root), "knowledge");
}

/**
 * Write raw bytes verbatim, creating `knowledge/raw/<channel>/` only now — a run
 * that fails before its first successful page leaves no `knowledge/` behind.
 */
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

/**
 * Upsert entries into `knowledge/index.json` (an array, contract §2). Entries
 * with an identical `id` are replaced, which makes re-running a collect
 * idempotent in the ledger.
 */
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

// ─── resume checkpoints (outside the repo, next to the credential) ───────────

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

// ─── collect ─────────────────────────────────────────────────────────────────

export const BROWSER_STEPS = [
  "This module does not drive a browser: computer use is a host capability.",
  `Host: open the Feishu client, open the target chat, scroll to the requested range.`,
  "Host: hand the captured payload back to the user (copy the text into a file).",
];

/**
 * Collect messages from one Feishu chat.
 *
 * @param {object} options
 * @param {Function} [options.fetch] injected fetch (default `globalThis.fetch`)
 * @param {object} [options.env]     environment (default `process.env`)
 * @param {string} [options.root]    workspace root that contains `knowledge/`
 * @param {string} [options.person]  Skill slug; then the root is `skills/<family>/<person>/knowledge`
 * @param {string} options.chatId    `oc_…` chat container id (required)
 * @param {number} [options.limit]   page size
 * @param {number} [options.maxPages]
 * @param {number} [options.maxRetries]
 * @param {string} [options.since]   explicit cursor to resume from
 * @param {boolean} [options.resume] read/write the checkpoint (default true)
 * @param {Function} [options.sleep] injected sleeper so tests never really wait
 * @param {string} [options.now]     ISO timestamp used for `fetched_at`
 */
export async function collect(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    chatId,
    limit = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    maxRetries = DEFAULT_MAX_RETRIES,
    since,
    resume = true,
    sleep = defaultSleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_FEISHU_BASE_URL || DEFAULT_BASE_URL,
    useUserToken = Boolean(env?.DISTILLY_FEISHU_USE_USER_TOKEN),
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
      chat_id: chatId ?? null,
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
    if (!chatId) {
      throw new CollectFailure("missing-target", "collect feishu needs --chat-id <oc_…>", {
        remediation: [
          "find the chat id in the Feishu URL, or via GET /im/v1/chats with the app credential",
        ],
      });
    }

    credential = loadCredential({ env });
    secrets = [credential.values.app_secret, credential.values.user_access_token].filter(Boolean);
    base.credential_source = credential.source;

    if (resume) checkpoint = readCheckpoint({ env, root, target: chatId });
    if (since === undefined && checkpoint?.cursor) {
      cursor = checkpoint.cursor;
      pages = Number(checkpoint.pages ?? 0);
      warnings.push(`resuming from checkpoint cursor (page ${pages} done)`);
    }

    const userToken = useUserToken ? credential.values.user_access_token : null;
    if (useUserToken && !userToken) {
      warnings.push("DISTILLY_FEISHU_USE_USER_TOKEN is set but no user token is configured; using the tenant token");
    }
    let bearer = userToken;
    if (!bearer) {
      const auth = await requestJson({
        fetchImpl,
        url: `${baseUrl}/auth/v3/tenant_access_token/internal`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { app_id: credential.values.app_id, app_secret: credential.values.app_secret },
        maxRetries,
        sleep,
        secrets,
        onRetry,
      });
      requests += 1;
      if (auth.json?.code !== 0 || !auth.json?.tenant_access_token) {
        throw new CollectFailure(
          "auth-failed",
          `Feishu rejected the app credential (code=${auth.json?.code ?? "?"})`,
          { remediation: REMEDIATION_SETUP },
        );
      }
      bearer = auth.json.tenant_access_token;
      secrets = [...secrets, bearer];
    }

    let hasMore = true;
    const pageSize = Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), 50);
    while (hasMore) {
      if (pages >= maxPages) {
        warnings.push(`stopped after --max-pages ${maxPages}; rerun to continue from the cursor`);
        break;
      }
      const params = new URLSearchParams({
        container_id_type: "chat",
        container_id: chatId,
        page_size: String(pageSize),
        sort_type: "ByCreateTimeDesc",
      });
      if (cursor) params.set("page_token", cursor);

      const response = await requestJson({
        fetchImpl,
        url: `${baseUrl}/im/v1/messages?${params.toString()}`,
        headers: { authorization: `Bearer ${bearer}` },
        maxRetries,
        sleep,
        secrets,
        onRetry,
      });
      requests += 1;

      if (response.json?.code !== 0) {
        throw new CollectFailure(
          "api-error",
          `Feishu code=${response.json?.code ?? "?"}: ${redact(response.json?.msg ?? "", secrets)}`,
          {
            remediation: [
              "check the app scopes (im:message:readonly) and that the bot is in the chat",
              ...REMEDIATION_SETUP,
            ],
          },
        );
      }

      pages += 1;
      const data = response.json?.data ?? {};
      const pageItems = Array.isArray(data.items) ? data.items : [];
      items += pageItems.length;

      const stored = writeRaw(knowledgeDir, `${chatId}-p${String(pages).padStart(3, "0")}`, response.text);
      outputs.push({ path: stored.path, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" });
      ledgerEntries.push({
        id: `${CHANNEL}:${slug(chatId)}:p${String(pages).padStart(3, "0")}`,
        kind: "raw",
        origin: stored.relativePath,
        source: CHANNEL,
        fetched_at: now,
        bytes: stored.bytes,
        sha256: stored.sha256,
        credentialed: true,
        credential_source: credential.source,
        credential_file: CONFIG_FILE,
        method: useUserToken && userToken ? "api-user-token" : "api-tenant-token",
        items: pageItems.length,
        warnings: [],
      });

      cursor = data.page_token ?? null;
      hasMore = Boolean(data.has_more) && Boolean(cursor);
      if (resume) {
        writeCheckpoint(
          { env, root, target: chatId },
          { channel: CHANNEL, target: chatId, cursor, pages, items, updated_at: now },
        );
      }
      onProgress(`page ${pages}: ${pageItems.length} items, has_more=${hasMore}`);
    }

    const ledger = appendLedger(knowledgeDir, ledgerEntries);
    if (resume) clearCheckpoint({ env, root, target: chatId });

    const receipt = {
      ...base,
      ok: true,
      person: person ?? null,
      chat_id: chatId,
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
    // Keep whatever was already written; only the ledger is flushed for those pages.
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

// ─── CLI ─────────────────────────────────────────────────────────────────────

export const HELP = `distilly collect feishu — 飞书消息采集（只读）/ Feishu message collection (read-only)

用法 (zh):
  distilly collect feishu --chat-id <oc_…> [--person <slug>] [--root <dir>]
                          [--limit 50] [--max-pages 10] [--max-retries 4]
                          [--since <page_token>] [--no-resume] [--json]

凭据：~/.distilly/${CONFIG_FILE}（app_id / app_secret，0600）或环境变量
      DISTILLY_FEISHU_APP_ID / DISTILLY_FEISHU_APP_SECRET。
      错误信息只出现配置文件名，绝不出现值。缺凭据 → 非零退出 + 补救步骤。
权限：im:message:readonly、im:chat:readonly；私聊另需 user_access_token。
只读：本模块没有任何点赞/关注/发帖/私信调用，写操作在 assertReadOnly() 里被拒绝。

---
## English
  distilly collect feishu --chat-id <oc_…> [--person <slug>] [--limit N] [--json]

Credentials: ~/.distilly/${CONFIG_FILE} or DISTILLY_FEISHU_APP_ID / DISTILLY_FEISHU_APP_SECRET.
Raw pages land verbatim in knowledge/raw/feishu/ and are registered in knowledge/index.json.
Rate limits honour Retry-After; an interrupted run resumes from its checkpoint cursor.
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
    if (name === "json" || name === "help" || name === "no-resume" || name === "use-user-token") {
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
 * @param {string[]} argv arguments after `collect feishu`
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
    chatId: flags["chat-id"],
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
    out(`collected ${result.receipt.items} item(s) in ${result.receipt.pages} page(s) → ${result.receipt.outputs.length} raw file(s)`);
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
