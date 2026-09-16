/**
 * tests/consent.test.mjs — the computer-use consent gate and the read-only proof.
 *
 * Two things are asserted here:
 *
 *  1. the gate: `grant` / `verify` / `revoke` / `list`, expiry, scope mismatch,
 *     and the CLI contract — a browser-mode collect without a usable token exits
 *     with code **2** and a receipt that says "等待用户同意 / waiting for user
 *     consent";
 *  2. the capability claim: the four collectors contain **no** write operation.
 *     Not "the prompt forbids it" — the code has no like/follow/repost/post/DM
 *     call, every request passes `assertReadOnly()`, and the per-channel mutation
 *     allowlist is pinned here, so adding a write endpoint breaks this test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as consent from "../src/consent.mjs";
import * as feishu from "../src/collect/feishu.mjs";
import * as slack from "../src/collect/slack.mjs";
import * as dingtalk from "../src/collect/dingtalk.mjs";
import * as x from "../src/collect/x.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(HERE, "bin", "distilly.mjs");
const TEST_HOME = mkdtempSync(join(tmpdir(), "dst-consent-home-"));
process.env.HOME = TEST_HOME;

function sandbox(name = "consent") {
  const root = mkdtempSync(join(tmpdir(), `dst-${name}-`));
  const fakeHome = join(root, "home");
  const distillyHome = join(root, "distilly");
  const work = join(root, "work");
  for (const dir of [fakeHome, distillyHome, work]) mkdirSync(dir, { recursive: true });
  return { root, fakeHome, distillyHome, work, env: { DISTILLY_HOME: distillyHome } };
}

function runCli(args, box, extraEnv = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: box.work,
    env: { ...process.env, HOME: box.fakeHome, DISTILLY_HOME: box.distillyHome, ...extraEnv },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function receiptOf(stdout) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1, `no JSON receipt in stdout: ${stdout}`);
  return JSON.parse(stdout.slice(start));
}

/** Remove comments so prose that *forbids* writes cannot trip the write scan. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// ─── the store ───────────────────────────────────────────────────────────────

test("grant writes ~/.distilly/consent.json (0600) with granted_at/scope/expires_at/token", () => {
  const box = sandbox("grant");
  const { record, written } = consent.grant("collect:x:browser", {
    env: box.env,
    now: new Date("2026-09-13T00:00:00.000Z"),
    ttlMinutes: 60,
    note: "unit test",
  });

  assert.equal(written.path, join(box.distillyHome, "consent.json"));
  assert.match(record.token, /^dsc_[0-9a-f]{32}$/);
  assert.equal(record.granted_at, "2026-09-13T00:00:00.000Z");
  assert.equal(record.expires_at, "2026-09-13T01:00:00.000Z");
  assert.equal(record.scope, "collect:x:browser");

  const onDisk = JSON.parse(readFileSync(written.path, "utf8"));
  assert.equal(onDisk.version, 1);
  assert.deepEqual(Object.keys(onDisk.grants[0]).sort(), ["expires_at", "granted_at", "note", "scope", "token"]);
  assert.equal(statSync(written.path).mode & 0o777, 0o600, "the consent store must be 0600");
});

test("grant refuses an invalid scope or a non-positive ttl", () => {
  const box = sandbox("grant-invalid");
  assert.throws(() => consent.grant("not a scope!", { env: box.env }), /invalid scope/);
  assert.throws(() => consent.grant("collect:x:browser", { env: box.env, ttlMinutes: 0 }), /positive number of minutes/);
  assert.throws(() => consent.revoke(undefined, { env: box.env }), /needs a token/);
});

test("verify: granted / no-token / unknown / scope-mismatch / expired", () => {
  const box = sandbox("verify");
  const now = new Date("2026-09-13T00:00:00.000Z");
  const { record } = consent.grant("collect:x:browser", { env: box.env, now, ttlMinutes: 30 });

  const granted = consent.verify(record.token, { env: box.env, scope: "collect:x:browser", now });
  assert.equal(granted.ok, true);
  assert.equal(granted.reason, "granted");
  assert.equal(granted.status, "granted");

  const missing = consent.verify(undefined, { env: box.env, scope: "collect:x:browser", now });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no-token");
  assert.equal(missing.status, "waiting-for-user-consent");
  assert.match(missing.remediation.join("\n"), /distilly consent grant --scope collect:x:browser/);

  const unknown = consent.verify("dsc_deadbeef", { env: box.env, scope: "collect:x:browser", now });
  assert.equal(unknown.reason, "unknown-token");

  const wrongScope = consent.verify(record.token, { env: box.env, scope: "collect:dingtalk:browser", now });
  assert.equal(wrongScope.reason, "scope-mismatch");
  assert.match(wrongScope.remediation.join("\n"), /collect:dingtalk:browser/);

  const expired = consent.verify(record.token, {
    env: box.env,
    scope: "collect:x:browser",
    now: new Date("2026-09-13T01:00:00.000Z"),
  });
  assert.equal(expired.reason, "expired");
  assert.match(expired.remediation.join("\n"), /grant expired at 2026-09-13T00:30:00\.000Z/);
  assert.equal(consent.consentUnavailable(expired, "x")[0].channel, "x");
  assert.match(consent.consentUnavailable(expired, "x")[0].reason, /waiting for user consent/);
});

test("list marks expiry, prune removes only expired grants, revoke clears by token/scope/all", () => {
  const box = sandbox("lifecycle");
  const now = new Date("2026-09-13T00:00:00.000Z");
  const short = consent.grant("collect:x:browser", { env: box.env, now, ttlMinutes: 1, token: "dsc_short" });
  const long = consent.grant("collect:dingtalk:browser", { env: box.env, now, ttlMinutes: 600, token: "dsc_long" });

  const later = new Date("2026-09-13T00:10:00.000Z");
  const listed = consent.list({ env: box.env, now: later });
  assert.equal(listed.length, 2);
  assert.equal(listed.find((g) => g.token === "dsc_short").status, "expired");
  assert.equal(listed.find((g) => g.token === "dsc_long").status, "active");

  const pruned = consent.prune({ env: box.env, now: later });
  assert.deepEqual(pruned.removed, ["dsc_short"]);
  assert.equal(pruned.remaining, 1);

  assert.equal(consent.revoke("dsc_long", { env: box.env }).revoked.length, 1);
  assert.equal(consent.list({ env: box.env, now: later }).length, 0);

  consent.grant("collect:x:browser", { env: box.env, now, ttlMinutes: 10, token: "dsc_a" });
  consent.grant("collect:dingtalk:browser", { env: box.env, now, ttlMinutes: 10, token: "dsc_b" });
  assert.equal(consent.revoke("all", { env: box.env }).revoked.length, 2);
  assert.equal(consent.revoke("all", { env: box.env }).revoked.length, 0, "revoking nothing is not an error");
});

test("a corrupt consent store is an explicit failure, not a silent empty grant list", () => {
  const box = sandbox("corrupt");
  writeFileSync(join(box.distillyHome, "consent.json"), "{not json");
  assert.throws(() => consent.readConsent(box.env), /not valid JSON/);
  const verified = consent.verify("dsc_x", { env: box.env, scope: "collect:x:browser" });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "unreadable-store");
});

// ─── the CLI gate ────────────────────────────────────────────────────────────

test("consent CLI: grant → verify → list → revoke, with exit 2 once it is gone", () => {
  const box = sandbox("cli-consent");

  const help = runCli(["consent", "--help"], box);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /distilly consent grant --scope/);
  assert.match(help.stdout, /## English/, "help must carry both languages");

  const granted = runCli(["consent", "grant", "--scope", "collect:x:browser", "--ttl", "60", "--json"], box);
  assert.equal(granted.status, 0, granted.stderr);
  const grantReceipt = receiptOf(granted.stdout);
  assert.equal(grantReceipt.ok, true);
  assert.equal(grantReceipt.action, "grant");
  const token = grantReceipt.grants[0].token;

  const verified = runCli(["consent", "verify", "--token", token, "--scope", "collect:x:browser", "--json"], box);
  assert.equal(verified.status, 0);
  assert.equal(receiptOf(verified.stdout).status, "granted");

  const listed = runCli(["consent", "list", "--json"], box);
  assert.equal(receiptOf(listed.stdout).grants.length, 1);

  const revoked = runCli(["consent", "revoke", token, "--json"], box);
  assert.equal(revoked.status, 0);
  assert.equal(receiptOf(revoked.stdout).ok, true);

  const afterRevoke = runCli(["consent", "verify", "--token", token, "--scope", "collect:x:browser", "--json"], box);
  assert.equal(afterRevoke.status, 2, "a revoked token is a consent failure");
  assert.equal(receiptOf(afterRevoke.stdout).status, "waiting-for-user-consent");
  assert.match(afterRevoke.stderr, /distilly consent grant/);
});

test("collect x --mode browser without a token exits 2 with a waiting-for-consent receipt and writes nothing", () => {
  const box = sandbox("cli-no-token");
  const run = runCli(["collect", "x", "--mode", "browser", "--json", "--root", box.work], box);

  assert.equal(run.status, 2, run.stderr);
  const receipt = receiptOf(run.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.status, "waiting-for-user-consent");
  assert.equal(receipt.mode, "browser");
  assert.equal(receipt.unavailable[0].channel, "x");
  assert.match(receipt.unavailable[0].reason, /waiting for user consent/);
  assert.match(receipt.unavailable[0].remediation.join("\n"), /consent grant/);
  assert.match(run.stderr, /waiting for user consent/);
  assert.equal(readFileSyncSafe(join(box.work, "knowledge")), null, "a gated run writes nothing");
});

test("collect x --mode browser with no token writes nothing, in every channel", () => {
  for (const channel of ["x", "dingtalk"]) {
    const box = sandbox(`cli-no-token-${channel}`);
    const run = runCli(["collect", channel, "--mode", "browser", "--json", "--root", box.work], box);
    assert.equal(run.status, 2, `${channel}: ${run.stderr}`);
    const receipt = receiptOf(run.stdout);
    assert.equal(receipt.status, "waiting-for-user-consent");
    assert.equal(readFileSyncSafe(join(box.work, "knowledge")), null, `${channel} must not create knowledge/`);
  }
});

test("an expired consent token exits 2 even though the file exists", () => {
  const box = sandbox("cli-expired");
  writeFileSync(
    join(box.distillyHome, "consent.json"),
    JSON.stringify({
      version: 1,
      grants: [
        {
          token: "dsc_expired",
          scope: "collect:x:browser",
          granted_at: "2020-01-01T00:00:00.000Z",
          expires_at: "2020-01-01T01:00:00.000Z",
        },
      ],
    }),
  );
  const run = runCli(
    ["collect", "x", "--mode", "browser", "--consent", "dsc_expired", "--json", "--root", box.work],
    box,
  );
  assert.equal(run.status, 2);
  const receipt = receiptOf(run.stdout);
  assert.equal(receipt.status, "waiting-for-user-consent");
  assert.match(receipt.unavailable[0].reason, /expired/);
});

test("a valid grant lets browser mode pass the gate, and the host capture is registered with a fingerprint", () => {
  const box = sandbox("cli-granted");
  const token = "dsc_" + "a".repeat(32);
  writeFileSync(
    join(box.distillyHome, "consent.json"),
    JSON.stringify({
      version: 1,
      grants: [
        {
          token,
          scope: "collect:x:browser",
          granted_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    }),
  );

  // Gate passed, host still has to capture: no file is written yet.
  const plan = runCli(["collect", "x", "--mode", "browser", "--consent", token, "--json", "--root", box.work], box);
  assert.equal(plan.status, 0, plan.stderr);
  const planReceipt = receiptOf(plan.stdout);
  assert.equal(planReceipt.status, "awaiting-host-capture");
  assert.ok(planReceipt.plan.host_steps.length >= 3);
  assert.match(planReceipt.plan.boundary.join("\n"), /never drives a browser/);
  assert.equal(readFileSyncSafe(join(box.work, "knowledge")), null);

  // Host hands the capture over.
  const capturePath = join(box.work, "capture.json");
  writeFileSync(capturePath, JSON.stringify({ posts: [{ id: "1", text: "host captured" }] }));
  const captured = runCli(
    [
      "collect", "x", "--mode", "browser", "--consent", token,
      "--capture", capturePath, "--label", "timeline",
      "--url", "https://x.com/someone",
      "--json", "--root", box.work,
    ],
    box,
  );
  assert.equal(captured.status, 0, captured.stderr);
  const receipt = receiptOf(captured.stdout);
  assert.equal(receipt.status, "captured");
  assert.equal(receipt.provenance.method, "browser-host");
  assert.equal(receipt.provenance.confidence, "host-reported");
  assert.deepEqual(receipt.urls, ["https://x.com/someone"]);
  assert.equal(receipt.outputs.length, 1);

  const raw = readFileSync(join(box.work, "knowledge/raw/x/timeline.json"), "utf8");
  assert.equal(raw, JSON.stringify({ posts: [{ id: "1", text: "host captured" }] }), "captured bytes are stored verbatim");

  const ledger = JSON.parse(readFileSync(join(box.work, "knowledge/index.json"), "utf8"));
  assert.equal(ledger[0].method, "browser-host");
  assert.equal(ledger[0].credentialed, false);
  assert.equal(ledger[0].url, "https://x.com/someone", "the ledger records the captured page URL");
  assert.equal(ledger[0].consent.token_sha256_12, consent.consentTokenFingerprint(token));
  assert.ok(!JSON.stringify(ledger).includes(token), "the ledger stores a fingerprint, never the token");
  assert.ok(!captured.stdout.includes(token), "the receipt echoes the scope, not the token");
});

function readFileSyncSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// ─── the capability proof: no write operation exists in the code ─────────────

test("no collector source contains a write endpoint (likes / retweets / follows / posts / DMs)", () => {
  const sources = {
    feishu: readFileSync(join(HERE, "src/collect/feishu.mjs"), "utf8"),
    slack: readFileSync(join(HERE, "src/collect/slack.mjs"), "utf8"),
    dingtalk: readFileSync(join(HERE, "src/collect/dingtalk.mjs"), "utf8"),
    x: readFileSync(join(HERE, "src/collect/x.mjs"), "utf8"),
  };
  const forbidden = [
    /\/likes\b/,
    /\/retweets\b/,
    /\/follows\b/,
    /\/favorites\b/,
    /statuses\/update/,
    /chat\.postMessage/,
    /direct_messages/,
    /reactions\.add/,
    /files\.upload/,
    /\/2\/tweets\b/,
    /\/messages\/send\b/,
    /sendMessage\s*\(/,
  ];

  for (const [name, source] of Object.entries(sources)) {
    const code = stripComments(source);
    for (const pattern of forbidden) {
      assert.doesNotMatch(code, pattern, `${name}.mjs must not contain ${pattern}`);
    }
    assert.match(code, /assertReadOnly\s*\(/, `${name}.mjs must route requests through assertReadOnly()`);
  }
});

test("only the allowlisted mutations exist, and adding one breaks this test", () => {
  assert.deepEqual(
    feishu.ALLOWED_MUTATIONS.map((m) => `${m.method} ${m.path}`),
    ["POST /auth/v3/tenant_access_token/internal"],
  );
  assert.deepEqual(slack.ALLOWED_MUTATIONS, [], "slack is GET-only");
  assert.deepEqual(x.ALLOWED_MUTATIONS, [], "x is GET-only");
  assert.deepEqual(
    dingtalk.ALLOWED_MUTATIONS.map((m) => `${m.method} ${m.path}`),
    ["POST /v1.0/oauth2/accessToken", "POST /v1.0/contact/users/search"],
  );

  // POST call-sites are pinned: occurrences minus the allowlist declarations.
  // A new POST either bumps the allowlist (caught above) or this count.
  const postCallSites = {
    "feishu.mjs": 1,
    "slack.mjs": 0,
    "dingtalk.mjs": 2,
    "x.mjs": 0,
  };
  const modules = { "feishu.mjs": feishu, "slack.mjs": slack, "dingtalk.mjs": dingtalk, "x.mjs": x };
  for (const [file, expected] of Object.entries(postCallSites)) {
    const code = stripComments(readFileSync(join(HERE, "src/collect", file), "utf8"));
    const found = [...code.matchAll(/method:\s*["']POST["']/g)].length;
    assert.equal(
      found - modules[file].ALLOWED_MUTATIONS.length,
      expected,
      `${file} has ${found - modules[file].ALLOWED_MUTATIONS.length} POST call-sites, expected ${expected}`,
    );
  }
});

test("no exported collector function can like, follow, repost, post or DM", () => {
  for (const [name, module] of Object.entries({ feishu, slack, dingtalk, x })) {
    for (const exported of Object.keys(module)) {
      assert.doesNotMatch(
        exported,
        /^(like|unlike|follow|unfollow|retweet|repost|reply|dm|send|post|create|delete|update|favorite)/i,
        `${name}.mjs exports a write-looking symbol: ${exported}`,
      );
    }
  }
});

test("every request a collector makes is GET, except the allowlisted exchange", async () => {
  const box = sandbox("runtime-readonly");
  writeFileSync(join(box.distillyHome, "feishu_config.json"), JSON.stringify({ app_id: "cli_x", app_secret: "secret-value-1234" }));
  const methods = [];
  await feishu.collect({
    fetch: async (url, init) => {
      methods.push(`${String(init?.method ?? "GET").toUpperCase()} ${String(url).replace("https://open.feishu.cn", "")}`);
      if (String(url).includes("tenant_access_token")) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "t", expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 });
    },
    env: box.env,
    root: box.work,
    chatId: "oc_demo",
  });

  assert.deepEqual(methods, [
    "POST /open-apis/auth/v3/tenant_access_token/internal",
    "GET /open-apis/im/v1/messages?container_id_type=chat&container_id=oc_demo&page_size=50&sort_type=ByCreateTimeDesc",
  ]);
});
