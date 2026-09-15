/**
 * consent.mjs — the computer-use consent gate.
 *
 * Some channels can only be collected by *acting as the user* inside a real
 * browser session (X search, DingTalk message history, …). That is a capability
 * question, not a prompt question: the collectors in `src/collect/*` refuse to
 * run in `--mode browser` without a token a human explicitly granted.
 *
 * The store is `~/.distilly/consent.json` (`$DISTILLY_HOME/consent.json`), mode
 * 0600:
 *
 *   {
 *     "version": 1,
 *     "grants": [
 *       {
 *         "token": "dsc_3f0c…",              // capability, never an API key
 *         "scope": "collect:x:browser",
 *         "granted_at": "2026-09-13T02:20:00.000Z",
 *         "expires_at": "2026-09-14T02:20:00.000Z",
 *         "note": "collect my own timeline"
 *       }
 *     ]
 *   }
 *
 * Rules this module enforces mechanically:
 *
 *  - **No token, no run.** `verify()` is the only way in; an absent, unknown ,
 *    expired or scope-mismatched token yields `ok: false` plus the remediation
 *    the caller must print (CLI exit code 2, receipt status
 *    `waiting-for-user-consent`).
 *  - **Grants expire.** `expires_at` is mandatory; `--ttl` is minutes and must
 *    be positive. There is no "forever" grant.
 *  - **The store is the only thing written.** Nothing else in this module
 *    touches the filesystem, and the file is written atomically at 0600.
 *
 * A consent token is a *capability*, not an API key: it authorises one scope on
 * this machine and can be revoked at any time. It is still written nowhere
 * except this store — the ledger records `consent_token_sha256_12`, a hash, so
 * that an audit trail cannot be replayed as a grant.
 */

import { randomBytes, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** File name inside `$DISTILLY_HOME`. Printed in errors; never its contents. */
export const CONSENT_FILE = "consent.json";
export const CONSENT_VERSION = 1;

/** Default grant lifetime: 24 hours. Minutes are the CLI unit. */
export const DEFAULT_TTL_MINUTES = 24 * 60;

/** Exit code the contract reserves for "waiting for user consent". */
export const EXIT_CONSENT_REQUIRED = 2;

const TOKEN_PREFIX = "dsc_";
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9:._-]*$/i;

/** `$DISTILLY_HOME` wins over `~/.distilly`, so tests never touch the real home. */
export function distillyHome(env = process.env) {
  const override = env?.DISTILLY_HOME;
  return override ? resolve(String(override)) : join(homedir(), ".distilly");
}

export function consentPath(env = process.env) {
  return join(distillyHome(env), CONSENT_FILE);
}

function emptyState() {
  return { version: CONSENT_VERSION, grants: [] };
}

function normaliseState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyState();
  const grants = Array.isArray(raw.grants) ? raw.grants.filter((g) => g && typeof g === "object") : [];
  return { version: CONSENT_VERSION, grants };
}

/**
 * Read the store. A missing file is "no grants ever issued", not an error; a
 * corrupt file *is* an error, because silently forgetting a grant is safe while
 * silently inventing one is not.
 */
export function readConsent(env = process.env) {
  const path = consentPath(env);
  if (!existsSync(path)) return emptyState();
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${CONSENT_FILE}: ${error.message}`, { cause: error });
  }
  try {
    return normaliseState(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `${CONSENT_FILE} is not valid JSON; rerun \`distilly consent grant --scope <scope>\` to rewrite it`,
      { cause: error },
    );
  }
}

/** Atomic write at 0600: staged in the same directory, then renamed. */
export function writeConsent(state, env = process.env) {
  const path = consentPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const body = `${JSON.stringify(normaliseState(state), null, 2)}\n`;
  const staging = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(staging, body, { mode: 0o600 });
    chmodSync(staging, 0o600);
    renameSync(staging, path);
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { force: true });
    throw error;
  }
  return { path, bytes: Buffer.byteLength(body), sha256: sha256Text(body) };
}

function sha256Text(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function assertScope(scope) {
  if (typeof scope !== "string" || !SCOPE_PATTERN.test(scope)) {
    throw new TypeError(
      `invalid scope ${JSON.stringify(scope)}; expected something like "collect:x:browser"`,
    );
  }
  return scope;
}

export function isExpired(record, now = new Date()) {
  const ms = Date.parse(record?.expires_at ?? "");
  if (!Number.isFinite(ms)) return true;
  return ms <= now.getTime();
}

export function consentStatus(record, now = new Date()) {
  return isExpired(record, now) ? "expired" : "active";
}

/**
 * Issue a grant.
 *
 * @param {string} scope              e.g. `collect:x:browser`
 * @param {{env?: object, now?: Date, ttlMinutes?: number, note?: string, token?: string}} [options]
 *        `token` exists so tests can pin a deterministic value.
 */
export function grant(scope, options = {}) {
  const { env = process.env, now = new Date(), ttlMinutes = DEFAULT_TTL_MINUTES, note, token } = options;
  assertScope(scope);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    throw new TypeError("--ttl must be a positive number of minutes");
  }
  const value = token ?? `${TOKEN_PREFIX}${randomBytes(16).toString("hex")}`;
  const record = {
    token: value,
    scope,
    granted_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  };
  if (note) record.note = String(note);

  const state = readConsent(env);
  state.grants = [...state.grants.filter((g) => g.token !== value), record];
  const written = writeConsent(state, env);
  return { record, written, store: consentPath(env) };
}

/**
 * Verify a token for `scope`.
 *
 * @returns {{ok: boolean, reason: string, remediation: string[], record: object|null,
 *            status: 'granted'|'waiting-for-user-consent'}}
 */
export function verify(token, options = {}) {
  const { env = process.env, scope, now = new Date() } = options;
  const wanted = scope ? assertScope(scope) : null;
  const remediation = (target) => {
    const cmd = `distilly consent grant --scope ${target}`;
    // The scope names the channel (`collect:<channel>:browser`), so the follow-up
    // command can too. Hardcoding `collect x` told a Feishu user to run the X
    // collector — an instruction that fails for a reason unrelated to consent.
    const channel = /^collect:([a-z0-9-]+):browser$/.exec(String(target))?.[1] ?? "x";
    return [
      `run: ${cmd}`,
      `then pass the printed token: distilly collect ${channel} --mode browser --consent <token>`,
    ];
  };

  if (!token) {
    return {
      ok: false,
      reason: "no-token",
      status: "waiting-for-user-consent",
      record: null,
      remediation: remediation(wanted ?? "collect:x:browser"),
    };
  }

  let state;
  try {
    state = readConsent(env);
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable-store",
      status: "waiting-for-user-consent",
      record: null,
      remediation: [`fix or remove ${consentPath(env)} (${error.message})`],
    };
  }

  const record = state.grants.find((g) => g.token === token) ?? null;
  if (!record) {
    return {
      ok: false,
      reason: "unknown-token",
      status: "waiting-for-user-consent",
      record: null,
      remediation: remediation(wanted ?? "collect:x:browser"),
    };
  }
  if (wanted && record.scope !== wanted) {
    return {
      ok: false,
      reason: "scope-mismatch",
      status: "waiting-for-user-consent",
      record,
      remediation: [
        `token is for scope "${record.scope}", not "${wanted}"`,
        ...remediation(wanted),
      ],
    };
  }
  if (isExpired(record, now)) {
    return {
      ok: false,
      reason: "expired",
      status: "waiting-for-user-consent",
      record,
      remediation: [`grant expired at ${record.expires_at}`, ...remediation(record.scope)],
    };
  }
  return { ok: true, reason: "granted", status: "granted", record, remediation: [] };
}

/** Revoke one token, or every token (`"all"`), or a whole scope. */
export function revoke(target, options = {}) {
  const { env = process.env } = options;
  if (!target) throw new TypeError("revoke needs a token, a scope, or \"all\"");
  const state = readConsent(env);
  let revoked;
  if (target === "all") {
    revoked = state.grants;
    state.grants = [];
  } else {
    revoked = state.grants.filter((g) => g.token === target || g.scope === target);
    state.grants = state.grants.filter((g) => g.token !== target && g.scope !== target);
  }
  const written = revoked.length > 0 ? writeConsent(state, env) : null;
  return { revoked, remaining: state.grants.length, written, store: consentPath(env) };
}

/** All grants with a live `status`, newest first. */
export function list(options = {}) {
  const { env = process.env, now = new Date() } = options;
  const state = readConsent(env);
  return state.grants
    .map((record) => ({
      token: record.token,
      scope: record.scope,
      granted_at: record.granted_at,
      expires_at: record.expires_at,
      note: record.note ?? null,
      status: consentStatus(record, now),
    }))
    .sort((a, b) => String(b.granted_at).localeCompare(String(a.granted_at)));
}

/** Drop expired grants. Never touches active ones. */
export function prune(options = {}) {
  const { env = process.env, now = new Date() } = options;
  const state = readConsent(env);
  const expired = state.grants.filter((g) => isExpired(g, now));
  if (expired.length > 0) {
    state.grants = state.grants.filter((g) => !isExpired(g, now));
    writeConsent(state, env);
  }
  return { removed: expired.map((g) => g.token), remaining: state.grants.length };
}

/**
 * Turn a failed `verify()` into the receipt fragment every caller must emit.
 * Keeping it here means `collect`, `transcribe` and future hosts all say the
 * same thing, in both languages.
 */
export function consentUnavailable(verification, channel) {
  return [
    {
      channel,
      reason: `waiting for user consent: ${verification.reason}`,
      scope: verification.record?.scope ?? null,
      remediation: verification.remediation,
    },
  ];
}

/** Stable, non-reversible fingerprint used when the ledger records a grant. */
export function consentTokenFingerprint(token) {
  if (!token) return null;
  return sha256Text(String(token)).slice(0, 12);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const HELP = `distilly consent — computer-use 同意门 / consent gate

用法 (zh):
  distilly consent grant --scope collect:x:browser [--ttl <分钟>] [--note <说明>] [--json]
  distilly consent list [--json]
  distilly consent verify --token <token> [--scope <scope>] [--json]
  distilly consent revoke <token|scope|--all> [--json]
  distilly consent prune [--json]

说明：授权写入 ~/.distilly/consent.json（0600）。浏览器模式采集必须带 --consent <token>；
无 token 或已过期时命令以 exit 2 退出，并在回执里写“等待用户同意”。

---
## English
  distilly consent grant --scope collect:x:browser [--ttl <minutes>] [--note <text>] [--json]
  distilly consent list | verify --token <token> [--scope <scope>] | revoke <token|scope|--all> | prune

Grants live in ~/.distilly/consent.json (0600). Browser-mode collection requires
--consent <token>; a missing or expired token exits with code 2 and a receipt
that says the run is waiting for user consent.
`;

function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") flags.json = true;
    else if (arg === "--all") flags.all = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      flags[name] = value;
      index += 1;
    } else flags._.push(arg);
  }
  return flags;
}

/**
 * @param {string[]} argv  arguments after `consent`
 * @param {{env?: object, now?: Date, stdout?: Function, stderr?: Function}} [io]
 * @returns {number} process exit code
 */
export function runConsentCli(argv, io = {}) {
  const env = io.env ?? process.env;
  const now = io.now ?? new Date();
  const out = io.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.stderr ?? ((line) => process.stderr.write(`${line}\n`));

  let flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    err(`Error: ${error.message}`);
    return 1;
  }

  const [action] = flags._;
  if (!action || action === "help" || flags.help) {
    out(HELP);
    return 0;
  }

  const emit = (receipt) => {
    if (flags.json) out(JSON.stringify(receipt, null, 2));
    return receipt;
  };

  try {
    if (action === "grant") {
      const scope = flags.scope ?? "collect:x:browser";
      const ttlMinutes = flags.ttl === undefined ? DEFAULT_TTL_MINUTES : Number(flags.ttl);
      const { record, written } = grant(scope, { env, now, ttlMinutes, note: flags.note });
      emit({
        command: "consent",
        action: "grant",
        ok: true,
        inputs: [],
        outputs: [{ path: written.path, sha256: written.sha256, bytes: written.bytes }],
        grants: [
          {
            token: record.token,
            scope: record.scope,
            granted_at: record.granted_at,
            expires_at: record.expires_at,
          },
        ],
        warnings: [],
        unavailable: [],
      });
      out(`granted ${record.scope} until ${record.expires_at}`);
      out(`token: ${record.token}`);
      out(`use it with: distilly collect x --mode browser --consent ${record.token}`);
      return 0;
    }

    if (action === "list") {
      const grants = list({ env, now });
      emit({
        command: "consent",
        action: "list",
        ok: true,
        inputs: [],
        outputs: [],
        grants,
        warnings: grants.filter((g) => g.status === "expired").map((g) => `expired grant for ${g.scope}`),
        unavailable: [],
      });
      if (grants.length === 0) out(`no grants in ${consentPath(env)}`);
      for (const g of grants) out(`${g.status}\t${g.scope}\t${g.token}\t${g.expires_at}`);
      return 0;
    }

    if (action === "verify") {
      const scope = flags.scope;
      const result = verify(flags.token, { env, scope, now });
      const receipt = {
        command: "consent",
        action: "verify",
        ok: result.ok,
        status: result.status,
        inputs: [],
        outputs: [],
        grants: result.record
          ? [
              {
                scope: result.record.scope,
                granted_at: result.record.granted_at,
                expires_at: result.record.expires_at,
              },
            ]
          : [],
        warnings: [],
        unavailable: result.ok ? [] : consentUnavailable(result, scope ?? "any"),
      };
      emit(receipt);
      if (result.ok) out(`granted\t${result.record.scope}\texpires ${result.record.expires_at}`);
      else {
        err(`waiting for user consent (${result.reason})`);
        for (const step of result.remediation) err(`  fix: ${step}`);
      }
      return result.ok ? 0 : EXIT_CONSENT_REQUIRED;
    }

    if (action === "revoke") {
      const target = flags.all ? "all" : flags._[1] ?? flags.token;
      const { revoked, remaining, written } = revoke(target, { env });
      emit({
        command: "consent",
        action: "revoke",
        ok: true,
        inputs: [],
        outputs: written ? [{ path: written.path, sha256: written.sha256, bytes: written.bytes }] : [],
        grants: [],
        warnings: revoked.length === 0 ? [`nothing matched ${target}`] : [],
        unavailable: [],
      });
      out(`revoked ${revoked.length} grant(s) for ${target}; ${remaining} remaining`);
      return 0;
    }

    if (action === "prune") {
      const { removed, remaining } = prune({ env, now });
      emit({
        command: "consent",
        action: "prune",
        ok: true,
        inputs: [],
        outputs: [],
        grants: [],
        warnings: [],
        unavailable: [],
        removed: removed.length,
      });
      out(`removed ${removed.length} expired grant(s); ${remaining} remaining`);
      return 0;
    }
  } catch (error) {
    err(`Error: ${error.message}`);
    return 1;
  }

  err(`Error: unknown consent action: ${action}`);
  err("run `distilly consent --help` for the usage");
  return 1;
}
