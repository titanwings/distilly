/**
 * dingtalk.mjs — credentialed collection from DingTalk.
 *
 * Legacy ported: `tools/dingtalk_auto_collector.py` (790 lines). What that file
 * actually proves about DingTalk's API surface matters here, so this module
 * splits the channel the same way the legacy did:
 *
 *  - **api mode** — read-only endpoints this repository has evidence for: the
 *    app credential exchange (`POST /v1.0/oauth2/accessToken`) and the contact
 *    directory card lookup (`POST /v1.0/contact/users/search`,
 *    `GET /v1.0/contact/users/{userId}`). Both are used by the legacy collector
 *    (`tools/dingtalk_auto_collector.py:106`, `:151`, `:202`).
 *  - **message history** — the legacy collector has **no API path** for it; it
 *    drives a browser instead (`tools/dingtalk_auto_collector.py:518`,
 *    "消息类（可选，仅用于发消息，历史消息需浏览器方案）"). Rather than invent an
 *    endpoint, api mode says so, loudly, and browser mode requires a consent
 *    token. The host performs the computer use and hands the bytes back through
 *    `--capture <file>`; this module never drives a browser itself.
 *
 * Same discipline as the other collectors: credential from
 * `~/.distilly/dingtalk_config.json` (or env), file name only in messages, raw
 * bytes verbatim under `knowledge/raw/dingtalk/`, ledger upsert, loud failures
 * with remediation, and a hard read-only guarantee.
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

export const CHANNEL = "dingtalk";
export const CONFIG_FILE = "dingtalk_config.json";
export const LEGACY_CONFIG_FILE = join(".colleague-skill", CONFIG_FILE);
export const DEFAULT_BASE_URL = "https://api.dingtalk.com";
export const DEFAULT_LIMIT = 10;
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

export const ENV_KEYS = {
  appKey: ["DISTILLY_DINGTALK_APP_KEY", "DINGTALK_APP_KEY"],
  appSecret: ["DISTILLY_DINGTALK_APP_SECRET", "DINGTALK_APP_SECRET"],
};

/**
 * Both entries are query-shaped POSTs: neither creates, updates or deletes
 * anything a user can see. Anything else non-GET is refused before it is sent.
 */
export const ALLOWED_MUTATIONS = [
  { method: "POST", path: "/v1.0/oauth2/accessToken", why: "app token exchange; no user-visible state" },
  { method: "POST", path: "/v1.0/contact/users/search", why: "read-only directory search expressed as POST" },
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REMEDIATION_SETUP = [
  `create ~/.distilly/${CONFIG_FILE} (chmod 600) with {"app_key": "ding…", "app_secret": "…"}`,
  "  app: https://open-dev.dingtalk.com → 企业内部应用 → 权限 Contact.User.Read / qyapi_get_member_detail",
  "or export DISTILLY_DINGTALK_APP_KEY and DISTILLY_DINGTALK_APP_SECRET for this shell only",
];

/** What is missing on the API side, quoted from the legacy collector's own note. */
export const MESSAGE_API_GAP =
  "DingTalk exposes no documented read API for message history; the legacy collector used a browser " +
  "(tools/dingtalk_auto_collector.py:518 — “历史消息需浏览器方案”)";

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
  const pick = (names) => {
    for (const name of names) {
      const value = env?.[name];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return null;
  };
  const envKey = pick(ENV_KEYS.appKey);
  const envSecret = pick(ENV_KEYS.appSecret);
  if (envKey && envSecret) {
    return {
      ok: true,
      source: "env",
      configFile: CONFIG_FILE,
      path: null,
      values: { app_key: envKey, app_secret: envSecret },
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
        `${CONFIG_FILE} is not valid JSON (${redact(error.message)}); rewrite it with {"app_key": "ding…", "app_secret": "…"}`,
        { remediation: REMEDIATION_SETUP },
      );
    }
    const appKey = parsed.app_key ?? parsed.appKey ?? null;
    const appSecret = parsed.app_secret ?? parsed.appSecret ?? null;
    if (!appKey || !appSecret) {
      throw new CollectFailure("incomplete-credential", `${CONFIG_FILE} is missing app_key / app_secret`, {
        remediation: REMEDIATION_SETUP,
      });
    }
    return { ok: true, source, configFile: CONFIG_FILE, path, values: { app_key: appKey, app_secret: appSecret } };
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
              `lower --limit to stay under the ${CHANNEL} quota`,
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
      throw new CollectFailure("unauthorized", `HTTP ${status} from ${CHANNEL}; app credential rejected`, {
        remediation: [
          `the credential in ~/.distilly/${CONFIG_FILE} was rejected — regenerate AppKey/AppSecret`,
          "check the app scopes at https://open-dev.dingtalk.com",
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

/** Issues an app access token. Returns `{token, expiresIn}` — never logged. */
export async function fetchAppToken({ fetchImpl, env = process.env, credential, baseUrl, maxRetries, sleep, secrets }) {
  const response = await requestJson({
    fetchImpl,
    url: `${baseUrl}/v1.0/oauth2/accessToken`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { appKey: credential.values.app_key, appSecret: credential.values.app_secret },
    maxRetries,
    sleep,
    secrets,
  });
  const token = response.json?.accessToken;
  if (!token) {
    throw new CollectFailure("auth-failed", "DingTalk rejected the app credential (no accessToken in the response)", {
      remediation: REMEDIATION_SETUP,
    });
  }
  return { token, expiresIn: Number(response.json?.expireIn ?? 7200) };
}

/**
 * api mode: one directory-card lookup for `name`, plus the profile detail of the
 * single match. No pagination is claimed — the legacy collector only ever called
 * `/v1.0/contact/users/search` with `offset: 0` and never looped, so the
 * continuation parameter is left untested and documented as a known gap.
 */
export async function collectDirectory(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    name,
    limit = DEFAULT_LIMIT,
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep = defaultSleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_DINGTALK_BASE_URL || DEFAULT_BASE_URL,
    onProgress = () => {},
  } = options;

  const knowledgeDir = knowledgeRoot({ root, person, family });
  const outputs = [];
  const warnings = [];
  const ledgerEntries = [];
  let secrets = [];
  let credential = null;
  let requests = 0;
  let users = 0;

  const base = {
    command: "collect",
    channel: CHANNEL,
    mode: "api",
    resource: "directory-card",
    ok: false,
    inputs: [],
    outputs,
    warnings,
    unavailable: [],
    credential_file: CONFIG_FILE,
  };
  const fail = (failure) => ({
    ok: false,
    exitCode: failure.exitCode ?? 1,
    receipt: scrub(
      {
        ...base,
        ok: false,
        person: person ?? null,
        name: name ?? null,
        requests,
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
    if (!name) {
      throw new CollectFailure("missing-target", "collect dingtalk needs --name <person>", {
        remediation: [
          "api mode reads the contact directory card; message history has no API — see --mode browser",
          MESSAGE_API_GAP,
        ],
      });
    }
    credential = loadCredential({ env });
    secrets = [credential.values.app_secret];
    base.credential_source = credential.source;

    const size = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), 50);
    const { token } = await fetchAppToken({ fetchImpl, env, credential, baseUrl, maxRetries, sleep, secrets });
    secrets = [...secrets, token];
    requests += 1;

    const search = await requestJson({
      fetchImpl,
      url: `${baseUrl}/v1.0/contact/users/search`,
      method: "POST",
      headers: { "content-type": "application/json", "x-acs-dingtalk-access-token": token },
      body: { searchText: name, offset: 0, size },
      maxRetries,
      sleep,
      secrets,
    });
    requests += 1;

    const list = Array.isArray(search.json?.list) ? search.json.list : [];
    users = list.length;
    const stored = writeRaw(knowledgeDir, `${name}-search`, search.text);
    outputs.push({ path: stored.path, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" });
    ledgerEntries.push({
      id: `${CHANNEL}:${slug(name)}:search`,
      kind: "raw",
      origin: stored.relativePath,
      source: CHANNEL,
      fetched_at: now,
      bytes: stored.bytes,
      sha256: stored.sha256,
      credentialed: true,
      credential_source: credential.source,
      credential_file: CONFIG_FILE,
      method: "api-app-token",
      items: list.length,
      warnings: [],
    });
    if (list.length >= size) {
      warnings.push(
        `search returned a full page (${size}); the continuation parameter is not verified against a live tenant (known gap)`,
      );
    }

    if (list.length === 1) {
      const userId = list[0]?.userId ?? list[0]?.unionId;
      if (userId) {
        const detail = await requestJson({
          fetchImpl,
          url: `${baseUrl}/v1.0/contact/users/${encodeURIComponent(userId)}`,
          headers: { "x-acs-dingtalk-access-token": token },
          maxRetries,
          sleep,
          secrets,
        });
        requests += 1;
        const detailStored = writeRaw(knowledgeDir, `${name}-profile`, detail.text);
        outputs.push({ path: detailStored.path, sha256: detailStored.sha256, bytes: detailStored.bytes, kind: "raw" });
        ledgerEntries.push({
          id: `${CHANNEL}:${slug(name)}:profile`,
          kind: "raw",
          origin: detailStored.relativePath,
          source: CHANNEL,
          fetched_at: now,
          bytes: detailStored.bytes,
          sha256: detailStored.sha256,
          credentialed: true,
          credential_source: credential.source,
          credential_file: CONFIG_FILE,
          method: "api-app-token",
          items: 1,
          warnings: [],
        });
      }
    }

    const ledger = appendLedger(knowledgeDir, ledgerEntries);
    onProgress(`directory: ${list.length} match(es)`);
    warnings.push(MESSAGE_API_GAP);
    warnings.push(
      "message history: run `distilly collect dingtalk --mode browser --consent <token>` and let the host capture it",
    );

    return {
      ok: true,
      exitCode: 0,
      receipt: scrub(
        {
          ...base,
          ok: true,
          person: person ?? null,
          name,
          requests,
          items: users,
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

/**
 * browser mode: the consent gate plus capture registration. This module never
 * launches a browser — the host does the computer use and writes the captured
 * bytes with `--capture <file>`; we verify the grant, store the bytes verbatim
 * and register them in the ledger with their provenance.
 */
export function registerCapture(options = {}) {
  const {
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    scope = `collect:${CHANNEL}:browser`,
    consentToken,
    capturePath,
    label,
    producer = "host:computer-use",
    now = new Date().toISOString(),
    readFile = readFileSync,
  } = options;

  const knowledgeDir = knowledgeRoot({ root, person, family });
  const base = {
    command: "collect",
    channel: CHANNEL,
    mode: "browser",
    resource: "messages",
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

  if (!capturePath) {
    return {
      ok: true,
      exitCode: 0,
      receipt: {
        ...base,
        ok: true,
        status: "awaiting-host-capture",
        person: person ?? null,
        consent: {
          scope: verification.record.scope,
          granted_at: verification.record.granted_at,
          expires_at: verification.record.expires_at,
          token_sha256_12: consentTokenFingerprint(consentToken),
        },
        host_steps: [
          "Host (computer use): open the DingTalk client, open the target conversation, load the requested range.",
          "Host: write the captured messages to a file, verbatim, and rerun with --capture <file>.",
          "This tool does not click, scroll, send or react — consent only authorises the host's capture.",
          MESSAGE_API_GAP,
        ],
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

  const stored = writeRaw(knowledgeDir, label ?? `browser-${new Date(now).toISOString().slice(0, 10)}`, bytes);
  const entry = {
    id: `${CHANNEL}:${slug(label ?? "browser")}:capture`,
    kind: "raw",
    origin: stored.relativePath,
    source: CHANNEL,
    fetched_at: now,
    bytes: stored.bytes,
    sha256: stored.sha256,
    credentialed: false,
    method: "browser-host",
    provenance: { method: "browser-host", producer, confidence: "host-reported" },
    consent: {
      scope: verification.record.scope,
      granted_at: verification.record.granted_at,
      expires_at: verification.record.expires_at,
      token_sha256_12: consentTokenFingerprint(consentToken),
    },
    warnings: [],
  };
  const ledger = appendLedger(knowledgeDir, [entry]);

  return {
    ok: true,
    exitCode: 0,
    receipt: scrub(
      {
        ...base,
        ok: true,
        status: "captured",
        person: person ?? null,
        outputs: [{ path: stored.path, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" }],
        ledger: { path: ledger.path, added: ledger.added, total: ledger.total },
        provenance: entry.provenance,
        unavailable: [],
      },
      [],
    ),
  };
}

export async function collect(options = {}) {
  return options.mode === "browser" ? registerCapture(options) : collectDirectory(options);
}

export const HELP = `distilly collect dingtalk — 钉钉采集 / DingTalk collection

用法 (zh):
  distilly collect dingtalk --name <姓名> [--person <slug>] [--limit 10] [--json]
      只读的通讯录名片采集（企业应用凭据）。
  distilly collect dingtalk --mode browser --consent <token> [--capture <file>] [--json]
      消息历史没有公开读接口（见 tools/dingtalk_auto_collector.py:518）；浏览器采集由宿主完成，
      本工具只做同意门 + 原样落盘 + 账本登记。无 token / 已过期 → exit 2（等待用户同意）。

凭据：~/.distilly/${CONFIG_FILE}（app_key / app_secret，0600）或
      DISTILLY_DINGTALK_APP_KEY / DISTILLY_DINGTALK_APP_SECRET。错误信息只出现配置文件名。
只读：仅允许 POST /v1.0/oauth2/accessToken 与 POST /v1.0/contact/users/search（都是查询语义），
      其余非 GET 请求在 assertReadOnly() 里被拒绝。

---
## English
  distilly collect dingtalk --name <person> [--json]
      read-only directory card via the app credential.
  distilly collect dingtalk --mode browser --consent <token> [--capture <file>] [--json]
      message history has no public read API; the host captures it, this tool only gates
      consent, stores the bytes verbatim and registers them in the ledger. No/expired token → exit 2.
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
    if (name === "json" || name === "help") {
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
    name: flags.name,
    limit: flags.limit ? Number(flags.limit) : undefined,
    maxRetries: flags["max-retries"] ? Number(flags["max-retries"]) : undefined,
    consentToken: flags.consent,
    capturePath: flags.capture,
    label: flags.label,
    sleep: io.sleep,
    now: io.now,
  });

  if (flags.json) out(JSON.stringify(result.receipt, null, 2));
  if (result.ok) {
    out(`ok (${result.receipt.status ?? "collected"}) → ${result.receipt.outputs.length} raw file(s)`);
    for (const warning of result.receipt.warnings ?? []) err(`warning: ${warning}`);
    for (const step of result.receipt.host_steps ?? []) err(`host: ${step}`);
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
