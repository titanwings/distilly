/**
 * kit.mjs — the plumbing every credentialed collector needs, in one place.
 *
 * `src/collect/feishu.mjs` grew this by hand first (credential lookup, redaction,
 * retry/backoff, a read-only allowlist, checkpointed cursors, verbatim raw storage,
 * ledger registration). The channels added later share it from here instead of
 * copying it, so one fix — a leak in a log line, a retry that ignores
 * `Retry-After` — lands everywhere at once.
 *
 * Nothing here talks to a specific API: the caller supplies the base URL, the
 * allowlist and the parser. What this module guarantees is the discipline in
 * `docs/v2/CONTRACT.md`: credentials never reach stdout/stderr/a receipt (only the
 * config *file name* does), every request is checked against a read-only
 * allowlist before it is sent, and an interrupted run resumes from its cursor.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** A failure a collector reports as a receipt, never as a stack trace. */
export class CollectFailure extends Error {
  constructor(reason, message, options = {}) {
    super(message);
    this.name = "CollectFailure";
    this.reason = reason;
    this.exitCode = options.exitCode ?? 1;
    this.remediation = options.remediation ?? [];
  }
}

export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

export const sha256Hex = (bytes) => createHash("sha256").update(Buffer.from(bytes)).digest("hex");

export const slug = (text, fallback = "target") => {
  const cleaned = String(text ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned === "" ? fallback : cleaned;
};

/** Replace every occurrence of a secret with a fixed marker. */
export function redact(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 4) continue;
    output = output.split(secret).join("***");
  }
  return output;
}

/** Redact recursively, so no receipt field can carry a credential value. */
export function scrub(value, secrets = []) {
  if (typeof value === "string") return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => scrub(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, secrets)]));
  }
  return value;
}

export function distillyHome(env = process.env) {
  return env.DISTILLY_HOME && env.DISTILLY_HOME.trim() !== ""
    ? env.DISTILLY_HOME
    : join(homedir(), ".distilly");
}

/** `~/.distilly/<file>`, with the pre-rename location as a fallback. */
export function credentialPaths(configFile, env = process.env) {
  return {
    primary: join(distillyHome(env), configFile),
    legacy: join(env.HOME ?? homedir(), ".colleague-skill", configFile),
  };
}

/**
 * Read a channel credential from the environment or the config file.
 *
 * @param {{configFile: string, envKeys: string[], fields: string[], env?: object, readFile?: Function}} input
 * @returns {{values: object, source: string, configFile: string, path: string|null}}
 */
export function loadCredential(input) {
  const { configFile, envKeys, fields, env = process.env, readFile = readFileSync } = input;
  const pick = (name) => {
    const value = env?.[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const fromEnv = {};
  let envComplete = true;
  for (const [index, field] of fields.entries()) {
    const value = pick(envKeys[index]);
    if (value === null) envComplete = false;
    else fromEnv[field] = value;
  }
  if (envComplete) return { values: fromEnv, source: "env", configFile, path: null };

  const { primary, legacy } = credentialPaths(configFile, env);
  for (const [path, source] of [
    [primary, "config"],
    [legacy, "legacy-config"],
  ]) {
    if (!existsSync(path)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFile(path, "utf8"));
    } catch (error) {
      throw new CollectFailure("bad-credential-file", `${configFile} is not valid JSON (${redact(error.message)}); rewrite it as {${fields.map((f) => `"${f}": "…"`).join(", ")}}`, {
        remediation: [`write ~/.distilly/${configFile}`],
      });
    }
    const values = {};
    let complete = true;
    for (const field of fields) {
      const camel = field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = parsed[field] ?? parsed[camel] ?? null;
      if (typeof value !== "string" || value.trim() === "") complete = false;
      else values[field] = value.trim();
    }
    if (!complete) {
      throw new CollectFailure("incomplete-credential", `${configFile} is missing ${fields.join(" / ")}`, {
        remediation: [`write ~/.distilly/${configFile} with ${fields.join(", ")}`],
      });
    }
    return { values, source, configFile, path };
  }

  throw new CollectFailure("no-credential", `no credential for this channel: set ${envKeys.join(" / ")} or write ~/.distilly/${configFile}`, {
    remediation: [`write ~/.distilly/${configFile}`, `or export ${envKeys[0]}`],
  });
}

/**
 * Refuse anything outside the channel's read-only allowlist, before it is sent.
 *
 * @param {string} url
 * @param {string} method
 * @param {Array<{method: string, path: string|RegExp}>} allowlist
 * @param {string} channel
 */
export function assertReadOnly(url, method, allowlist, channel) {
  const verb = String(method ?? "GET").toUpperCase();
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return String(url);
    }
  })();
  const allowed = allowlist.some((entry) => {
    if (entry.method !== verb) return false;
    return entry.path instanceof RegExp ? entry.path.test(path) : path.startsWith(entry.path);
  });
  if (!allowed) {
    throw new CollectFailure("write-refused", `${channel} collection is read-only: ${verb} ${path} is not on the allowlist`, {
      remediation: ["this build never posts, edits or deletes anything"],
    });
  }
}

/** Seconds from a `Retry-After` header (or a body's `retry_after`). */
export function parseRetryAfter(headerValue, nowMs = Date.now()) {
  if (headerValue === undefined || headerValue === null || headerValue === "") return null;
  const text = String(headerValue).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.min(Number(text) * 1000, 15 * 60_000);
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.min(at - nowMs, 15 * 60_000));
}

export function backoffDelay(attempt, retryAfterMs = null, options = {}) {
  const maxMs = options.maxMs ?? DEFAULT_MAX_BACKOFF_MS;
  if (retryAfterMs !== null) return Math.min(retryAfterMs, maxMs);
  const base = options.baseMs ?? 500;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), maxMs);
}

export const defaultSleep = (ms) => new Promise((settle) => setTimeout(settle, ms));

/**
 * One request with retry, backoff and redaction.
 *
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
    allowlist = null,
    channel = "collect",
    onRetry = () => {},
    acceptStatus = [],
    parse = "json",
  } = options;

  if (allowlist) assertReadOnly(url, method, allowlist, channel);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const init = { method, headers, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) };
    const response = await fetchImpl(url, init);
    const status = response.status;
    if (status === 429 || (status >= 500 && status !== 501)) {
      if (attempt > maxRetries) {
        throw new CollectFailure("retry-exhausted", `${channel} still answering HTTP ${status} after ${maxRetries} retries`, {
          remediation: ["retry later; the pages already fetched are on disk"],
        });
      }
      const retryAfterHeader = response.headers?.get?.("retry-after") ?? null;
      const text = await response.text().catch(() => "");
      let bodyRetryAfter = null;
      if (text) {
        try {
          const parsed = JSON.parse(text);
          bodyRetryAfter = parsed?.retry_after ?? parsed?.error?.retry_after ?? null;
        } catch {
          bodyRetryAfter = null;
        }
      }
      const retryAfterMs =
        parseRetryAfter(retryAfterHeader) ??
        (typeof bodyRetryAfter === "number" ? Math.min(bodyRetryAfter * (bodyRetryAfter < 1000 ? 1000 : 1), 15 * 60_000) : null);
      const delayMs = backoffDelay(attempt, retryAfterMs);
      onRetry({ attempt, status, delayMs, reason: `HTTP ${status}` });
      await sleep(delayMs);
      continue;
    }
    const text = await response.text();
    if (status >= 400 && !acceptStatus.includes(status)) {
      throw new CollectFailure(status === 401 || status === 403 ? "unauthorized" : "http-error", `${channel} HTTP ${status}: ${redact(text.slice(0, 200), secrets)}`, {
        remediation: ["check the credential and its scopes"],
      });
    }
    let json = null;
    if (parse === "json" && text.trim() !== "") {
      try {
        json = JSON.parse(text);
      } catch {
        throw new CollectFailure("invalid-json", `${channel} returned a non-JSON body`, {
          remediation: ["retry later; if it persists the endpoint may have changed"],
        });
      }
    }
    return { status, text, json, attempts: attempt };
  }
}

/* ------------------------------------------------------------------ storage */

/** `<root>/skills/<family>/<person>/knowledge` — the Skill's evidence root. */
export function knowledgeRoot({ root = process.cwd(), person, family = "colleague" } = {}) {
  return person
    ? join(resolve(root), "skills", slug(family), slug(person), "knowledge")
    : join(resolve(root), "knowledge");
}

/** Store raw bytes verbatim, creating the bucket only now. */
export function writeRaw(knowledgeDir, bucket, name, bytes) {
  const dir = join(knowledgeDir, "raw", slug(bucket));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug(name, "page")}.json`);
  const staging = `${path}.${process.pid}.tmp`;
  const buffer = Buffer.from(bytes);
  writeFileSync(staging, buffer);
  renameSync(staging, path);
  const readBack = readFileSync(path);
  if (!readBack.equals(buffer)) throw new CollectFailure("write-verify", `raw bytes changed on disk: ${path}`, {});
  return { path, relativePath: `raw/${slug(bucket)}/${slug(name, "page")}.json`, bytes: buffer.length, sha256: sha256Hex(buffer) };
}

/** A JSON cursor file under `$DISTILLY_HOME/state`, so an interrupted run resumes. */
export function statePath({ env = process.env, root = process.cwd(), channel, target }) {
  const key = sha256Hex(Buffer.from(`${resolve(root)}\n${target ?? ""}`, "utf8")).slice(0, 12);
  return join(distillyHome(env), "state", `${slug(channel)}-${key}.json`);
}

export function readCheckpoint({ env = process.env, root = process.cwd(), channel, target }) {
  const path = statePath({ env, root, channel, target });
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeCheckpoint({ env = process.env, root = process.cwd(), channel, target }, value) {
  const path = statePath({ env, root, channel, target });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

export function clearCheckpoint({ env = process.env, root = process.cwd(), channel, target }) {
  const path = statePath({ env, root, channel, target });
  if (existsSync(path)) rmSync(path, { force: true });
  return path;
}
