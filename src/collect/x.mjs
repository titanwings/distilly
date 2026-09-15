/**
 * x.mjs — X (Twitter) collection, two ways.
 *
 *   api      X API v2 with a Bearer token: `GET /2/users/by/username/:handle`
 *            then `GET /2/users/:id/tweets` with `pagination_token` (page cursor)
 *            and `since_id` (incremental re-collection). Read-only, GET only.
 *   browser  computer use, which this module does **not** perform. It owns the
 *            consent gate (`src/consent.mjs`, scope `collect:x:browser`), the
 *            verbatim sink under `knowledge/raw/x/` and the ledger registration
 *            of whatever the host captured. Without `--consent <token>` (or with
 *            an expired one) the command exits 2 and the receipt says the run is
 *            waiting for user consent.
 *
 * Legacy context: `tools/research/xquik_public_posts.py` collected public posts
 * through the Xquik aggregator (`XQUIK_API_KEY`). That third-party route is *not*
 * migrated here — this module talks to X directly — and the aggregator remains a
 * known gap in `docs/evidence/pr-07-collect-consent.md`.
 *
 * Read-only by construction: `ALLOWED_MUTATIONS` is empty, so `assertReadOnly()`
 * refuses every non-GET request this file could ever issue. There is no code
 * path that likes, follows, reposts, posts or DMs.
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

import { consentTokenFingerprint, verify as verifyConsent } from "../consent.mjs";

export const CHANNEL = "x";
export const CONFIG_FILE = "x_config.json";
export const LEGACY_CONFIG_FILE = join(".colleague-skill", CONFIG_FILE);
export const DEFAULT_BASE_URL = "https://api.x.com/2";
export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;
export const BROWSER_SCOPE = "collect:x:browser";

export const ENV_KEYS = {
  bearer: ["DISTILLY_X_BEARER_TOKEN", "X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN"],
};

/** X API v2 reads only. Any non-GET request is refused before it is sent. */
export const ALLOWED_MUTATIONS = [];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REMEDIATION_SETUP = [
  `create ~/.distilly/${CONFIG_FILE} (chmod 600) with {"bearer_token": "…"}`,
  "  app: https://developer.x.com → Project & Apps → Keys and tokens → Bearer Token",
  "or export DISTILLY_X_BEARER_TOKEN for this shell only",
  "browser mode does not need this token: it needs consent — distilly consent grant --scope collect:x:browser",
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
  for (const name of ENV_KEYS.bearer) {
    const value = env?.[name];
    if (typeof value === "string" && value.trim() !== "") {
      return {
        ok: true,
        source: "env",
        configFile: CONFIG_FILE,
        path: null,
        values: { bearer_token: value.trim() },
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
        `${CONFIG_FILE} is not valid JSON (${redact(error.message)}); rewrite it with {"bearer_token": "…"}`,
        { remediation: REMEDIATION_SETUP },
      );
    }
    const token = parsed.bearer_token ?? parsed.bearerToken ?? parsed.bearer ?? parsed.api_key ?? null;
    if (!token) {
      throw new CollectFailure("incomplete-credential", `${CONFIG_FILE} is missing bearer_token`, {
        remediation: REMEDIATION_SETUP,
      });
    }
    return { ok: true, source, configFile: CONFIG_FILE, path, values: { bearer_token: token } };
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

/** X sends `x-rate-limit-reset` as epoch seconds when the window resets. */
export function parseRateLimitReset(headerValue, nowMs = Date.now()) {
  const epochSeconds = Number(headerValue);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  return Math.max(0, epochSeconds * 1000 - nowMs);
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
    const retryAfterMs =
      parseRetryAfter(headerBag?.get?.("retry-after") ?? null) ??
      (status === 429 ? parseRateLimitReset(headerBag?.get?.("x-rate-limit-reset") ?? null) : null);

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
              "X API v2 windows are 15 minutes; lower --limit / --max-pages",
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
      throw new CollectFailure("unauthorized", `HTTP ${status} from ${CHANNEL}; bearer token rejected or not entitled`, {
        remediation: [
          `the bearer token in ~/.distilly/${CONFIG_FILE} was rejected — regenerate it in the X developer portal`,
          "check that your access level includes user tweet lookup",
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

/**
 * Run state for X: unlike the other channels the file survives a successful run,
 * because `since_id` is what makes the *next* run incremental.
 */
export function statePath({ env = process.env, root = process.cwd(), target } = {}) {
  const key = sha256Hex(Buffer.from(`${resolve(root)}\n${target ?? ""}`, "utf8")).slice(0, 12);
  return join(distillyHome(env), "state", `${CHANNEL}-${key}.json`);
}

export function readState(options) {
  const path = statePath(options);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeState(options, value) {
  const path = statePath(options);
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(staging, path);
  return path;
}

/**
 * Resolve `@handle` → numeric user id (X API v2).
 * @returns {Promise<string>} the numeric id
 */
export async function resolveUserId(handle, { fetchImpl, baseUrl, headers, maxRetries, sleep, secrets, onRetry }) {
  const clean = String(handle).replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) {
    throw new CollectFailure("bad-username", `invalid X username: ${JSON.stringify(handle)}`, {
      remediation: ["use 1-15 letters, digits or underscores, with or without the leading @", ...REMEDIATION_SETUP],
    });
  }
  const response = await requestJson({
    fetchImpl,
    url: `${baseUrl}/users/by/username/${encodeURIComponent(clean)}`,
    headers,
    maxRetries,
    sleep,
    secrets,
    onRetry,
  });
  const id = response.json?.data?.id;
  if (!id) {
    throw new CollectFailure("user-not-found", `X has no user @${clean}`, {
      remediation: ["check the handle; deleted or suspended accounts return no data", ...REMEDIATION_SETUP],
    });
  }
  return String(id);
}

/**
 * api mode: collect one user's recent posts with cursor pagination and
 * `since_id` incremental collection.
 *
 * @param {object} options `fetch`, `env`, `root`, `person`, `userId` or `username`,
 *   `limit`, `maxPages`, `maxRetries`, `sinceId`, `paginationToken`, `resume`, `sleep`, `now`
 */
export async function collectApi(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    userId,
    username,
    limit = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    maxRetries = DEFAULT_MAX_RETRIES,
    sinceId,
    paginationToken,
    resume = true,
    sleep = defaultSleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_X_BASE_URL || DEFAULT_BASE_URL,
    tweetFields = "created_at,public_metrics,lang,author_id",
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
  let cursor = paginationToken ?? null;
  let since = sinceId ?? null;
  let prior = null;
  let target = userId ? String(userId) : username ? `@${String(username).replace(/^@/, "")}` : null;

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
  const fail = (failure) => ({
    ok: false,
    exitCode: failure.exitCode ?? 1,
    receipt: scrub(
      {
        ...base,
        ok: false,
        person: person ?? null,
        target,
        pages,
        items,
        requests,
        cursor,
        since_id: since,
        errors: [redact(failure.message, secrets)],
        unavailable: [
          {
            channel: CHANNEL,
            reason: redact(`${failure.reason}: ${failure.message}`, secrets),
            remediation: failure.remediation ?? [],
          },
        ],
      },
      secrets,
    ),
  });

  try {
    if (!userId && !username) {
      throw new CollectFailure("missing-target", "collect x needs --user-id <id> or --username <handle>", {
        remediation: [
          "find the numeric id with `distilly collect x --username <handle> --dry-run` or from the profile URL",
        ],
      });
    }

    credential = loadCredential({ env });
    secrets = [credential.values.bearer_token];
    base.credential_source = credential.source;
    const headers = { authorization: `Bearer ${credential.values.bearer_token}` };

    // Resolve the handle first so the run state is always keyed by the numeric id.
    let resolvedUserId = userId ? String(userId) : null;
    if (!resolvedUserId) {
      resolvedUserId = await resolveUserId(username, { fetchImpl, baseUrl, headers, maxRetries, sleep, secrets, onRetry });
      requests += 1;
    }
    target = resolvedUserId;

    if (resume) prior = readState({ env, root, target });
    if (since === undefined || since === null) {
      if (prior?.since_id) {
        since = prior.since_id;
        warnings.push(`incremental since_id ${since} from the previous run`);
      }
    }
    if (cursor === null && prior?.cursor && prior?.completed !== true) {
      cursor = prior.cursor;
      pages = Number(prior.pages ?? 0);
      warnings.push(`resuming from checkpoint cursor (page ${pages} done)`);
    }
    const resumedFrom = cursor;
    const sinceFromCheckpoint = prior?.since_id ?? null;

    let hasMore = true;
    let newestId = prior?.newest_id ?? null;
    const pageSize = Math.min(Math.max(10, Number(limit) || DEFAULT_PAGE_SIZE), 100);
    while (hasMore) {
      if (pages >= maxPages) {
        warnings.push(`stopped after --max-pages ${maxPages}; rerun to continue from the cursor`);
        break;
      }

      const url = new URL(`${baseUrl}/users/${encodeURIComponent(resolvedUserId)}/tweets`);
      url.searchParams.set("max_results", String(pageSize));
      url.searchParams.set("tweet.fields", tweetFields);
      if (cursor) url.searchParams.set("pagination_token", cursor);
      if (since) url.searchParams.set("since_id", String(since));

      const response = await requestJson({
        fetchImpl,
        url: url.toString(),
        headers,
        maxRetries,
        sleep,
        secrets,
        onRetry,
      });
      requests += 1;

      if (response.json?.errors?.length) {
        const detail = redact(JSON.stringify(response.json.errors).slice(0, 200), secrets);
        throw new CollectFailure("api-error", `X API error: ${detail}`, {
          remediation: ["check the user id / access level, then retry", ...REMEDIATION_SETUP],
        });
      }

      pages += 1;
      const pageItems = Array.isArray(response.json?.data) ? response.json.data : [];
      const meta = response.json?.meta ?? {};
      items += pageItems.length;
      if (meta.newest_id) newestId = String(meta.newest_id);

      const stored = writeRaw(knowledgeDir, `${target}-p${String(pages).padStart(3, "0")}`, response.text);
      outputs.push({ path: stored.path, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" });
      ledgerEntries.push({
        id: `${CHANNEL}:${slug(target)}:p${String(pages).padStart(3, "0")}`,
        kind: "raw",
        origin: stored.relativePath,
        source: CHANNEL,
        fetched_at: now,
        bytes: stored.bytes,
        sha256: stored.sha256,
        credentialed: true,
        credential_source: credential.source,
        credential_file: CONFIG_FILE,
        method: "api-v2-bearer",
        since_id: since ? String(since) : null,
        newest_id: meta.newest_id ? String(meta.newest_id) : null,
        items: pageItems.length,
        warnings: [],
      });

      const next = meta.next_token;
      cursor = typeof next === "string" && next !== "" ? next : null;
      const ids = pageItems.map((item) => String(item?.id ?? "")).filter(Boolean);
      const allOlderThanSince = since ? ids.length > 0 && ids.every((id) => BigInt(id) <= BigInt(since)) : false;
      hasMore = Boolean(cursor) && pageItems.length > 0 && !allOlderThanSince;

      if (resume) {
        writeState(
          { env, root, target },
          {
            channel: CHANNEL,
            target,
            cursor,
            pages,
            items,
            since_id: since ? String(since) : null,
            newest_id: newestId,
            updated_at: now,
            completed: false,
          },
        );
      }
      onProgress(`page ${pages}: ${pageItems.length} posts, has_more=${hasMore}`);
    }

    const ledger = appendLedger(knowledgeDir, ledgerEntries);
    if (resume) {
      writeState(
        { env, root, target },
        {
          channel: CHANNEL,
          target,
          cursor: null,
          pages,
          items,
          since_id: newestId ?? (since ? String(since) : null),
          newest_id: newestId,
          updated_at: now,
          completed: true,
        },
      );
    }

    return {
      ok: true,
      exitCode: 0,
      receipt: scrub(
        {
          ...base,
          ok: true,
          person: person ?? null,
          target,
          pages,
          items,
          requests,
          cursor,
          since_id: since ? String(since) : null,
          newest_id: newestId,
          resumed_from: resumedFrom,
          since_from_checkpoint: sinceFromCheckpoint,
          outputs,
          ledger: { path: ledger.path, added: ledger.added, total: ledger.total },
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

/** The plan the host must follow in browser mode. No browser runs here. */
export function browserPlan({ target, window = "recent", now = new Date().toISOString() }) {
  return {
    generated_at: now,
    target: target ?? "@handle or profile URL",
    window,
    host_steps: [
      "Host (computer use): open a browser you control, sign in as the user, and open the target profile or search.",
      "Host: scroll/expand the requested window; do not click like, follow, repost, reply or send — this tool cannot, and the grant does not cover it.",
      "Host: save the captured posts (JSON or text, verbatim) to a file.",
      `Host: register the capture with: distilly collect x --mode browser --consent <token> --capture <file>`,
    ],
    boundary: [
      "This module never drives a browser, never injects into one and never sends input events.",
      "It owns three things only: the consent gate, the verbatim sink under knowledge/raw/x/, and the ledger entry.",
      "Browser automation itself is a host capability (Claude Code, Codex, …); see docs/v2/STATUS.md for the host matrix.",
    ],
  };
}

/**
 * browser mode: consent gate + sink + ledger registration for a host capture.
 */
export function collectBrowser(options = {}) {
  const {
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    scope = BROWSER_SCOPE,
    consentToken,
    capturePath,
    label,
    target,
    producer = "host:computer-use",
    now = new Date().toISOString(),
    readFile = readFileSync,
  } = options;

  const knowledgeDir = knowledgeRoot({ root, person, family });
  const base = {
    command: "collect",
    channel: CHANNEL,
    mode: "browser",
    ok: false,
    inputs: [],
    outputs: [],
    warnings: [],
    unavailable: [],
    credential_file: null,
  };

  const verification = verifyConsent(consentToken, { env, scope });
  if (!verification.ok) {
    return {
      ok: false,
      exitCode: 2,
      receipt: {
        ...base,
        ok: false,
        status: "waiting-for-user-consent",
        person: person ?? null,
        target: target ?? null,
        errors: [`waiting for user consent (${verification.reason})`],
        unavailable: [
          {
            channel: CHANNEL,
            reason: `waiting for user consent: ${verification.reason}`,
            scope,
            remediation: verification.remediation,
          },
        ],
        consent_scope: scope,
      },
    };
  }

  const consentBlock = {
    scope: verification.record.scope,
    granted_at: verification.record.granted_at,
    expires_at: verification.record.expires_at,
    token_sha256_12: consentTokenFingerprint(consentToken),
  };

  if (!capturePath) {
    return {
      ok: true,
      exitCode: 0,
      receipt: {
        ...base,
        ok: true,
        status: "awaiting-host-capture",
        person: person ?? null,
        target: target ?? null,
        consent: consentBlock,
        plan: browserPlan({ target, now }),
        unavailable: [],
      },
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
        ok: false,
        person: person ?? null,
        errors: [`cannot read --capture ${capturePath}: ${redact(error.message)}`],
        unavailable: [
          {
            channel: CHANNEL,
            reason: `capture-unreadable: ${redact(error.message)}`,
            remediation: ["point --capture at a readable file produced by the host"],
          },
        ],
      },
    };
  }

  const name = label ?? `browser-${String(now).slice(0, 10)}`;
  const stored = writeRaw(knowledgeDir, name, bytes);
  const entry = {
    id: `${CHANNEL}:${slug(name)}:capture`,
    kind: "raw",
    origin: stored.relativePath,
    source: CHANNEL,
    fetched_at: now,
    bytes: stored.bytes,
    sha256: stored.sha256,
    credentialed: false,
    method: "browser-host",
    provenance: { method: "browser-host", producer, confidence: "host-reported" },
    consent: consentBlock,
    warnings: [],
  };
  const ledger = appendLedger(knowledgeDir, [entry]);

  return {
    ok: true,
    exitCode: 0,
    receipt: {
      ...base,
      ok: true,
      status: "captured",
      person: person ?? null,
      target: target ?? null,
      consent: consentBlock,
      outputs: [{ path: stored.path, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" }],
      ledger: { path: ledger.path, added: ledger.added, total: ledger.total },
      provenance: entry.provenance,
      unavailable: [],
    },
  };
}

export async function collect(options = {}) {
  return options.mode === "browser" ? collectBrowser(options) : collectApi(options);
}

export const HELP = `distilly collect x — X（Twitter）采集 / X collection

用法 (zh):
  distilly collect x --user-id <id> [--person <slug>] [--limit 100] [--max-pages 10]
                     [--since-id <id>] [--pagination-token <t>] [--no-resume] [--json]
  distilly collect x --username <handle> […同上…]
  distilly collect x --mode browser --consent <token> [--capture <file>] [--json]

凭据：~/.distilly/${CONFIG_FILE}（bearer_token，0600）或 DISTILLY_X_BEARER_TOKEN；
      错误信息只出现配置文件名，绝不出现值。
分页/续采：pagination_token 翻页；成功后把 newest_id 记为 since_id，下次自动增量采集。
限流：429 按 Retry-After（缺失时用 x-rate-limit-reset）退避，超上限保留已落盘页并非零退出。
同意门：browser 模式必须带 --consent <token>（distilly consent grant --scope ${BROWSER_SCOPE}），
        无 token / 已过期 → exit 2 + 回执写“等待用户同意”；本工具不做浏览器自动化，只负责
        同意门 + 原样落盘 + 账本登记，浏览器操作由宿主（computer use）完成。
只读：ALLOWED_MUTATIONS 为空，任何非 GET 请求都会被 assertReadOnly() 拒绝；不存在点赞/关注/发帖/私信代码。

---
## English
  distilly collect x --user-id <id> | --username <handle> [--since-id <id>] [--json]
      X API v2, Bearer token, cursor pagination + since_id incremental collection.
  distilly collect x --mode browser --consent <token> [--capture <file>] [--json]
      Requires a consent grant; without one the command exits 2 and the receipt says the
      run is waiting for user consent. This tool does not automate a browser — the host
      captures, this module stores bytes verbatim and registers them in the ledger.
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
    mode: flags.mode ?? "api",
    userId: flags["user-id"],
    username: flags.username,
    limit: flags.limit ? Number(flags.limit) : undefined,
    maxPages: flags["max-pages"] ? Number(flags["max-pages"]) : undefined,
    maxRetries: flags["max-retries"] ? Number(flags["max-retries"]) : undefined,
    sinceId: flags["since-id"],
    paginationToken: flags["pagination-token"],
    resume: !flags["no-resume"],
    consentToken: flags.consent,
    capturePath: flags.capture,
    label: flags.label,
    target: flags.target,
    sleep: io.sleep,
    now: io.now,
    baseUrl: flags["base-url"],
  });

  if (flags.json) out(JSON.stringify(result.receipt, null, 2));
  if (result.ok) {
    const status = result.receipt.status;
    if (status) out(`ok (${status})`);
    else out(`collected ${result.receipt.items} post(s) in ${result.receipt.pages} page(s) → ${result.receipt.outputs.length} raw file(s)`);
    for (const warning of result.receipt.warnings ?? []) err(`warning: ${warning}`);
    for (const step of result.receipt.plan?.host_steps ?? []) err(`host: ${step}`);
  } else {
    err(`Error: ${result.receipt.errors?.[0] ?? "collect failed"}`);
    for (const entry of result.receipt.unavailable ?? []) {
      err(`unavailable: ${entry.channel} — ${entry.reason}`);
      for (const step of entry.remediation ?? []) err(`  fix: ${step}`);
    }
    for (const warning of result.receipt.warnings ?? []) err(`warning: ${warning}`);
  }
  return result.exitCode;
}
